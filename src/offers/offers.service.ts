import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../infra/prisma.service';
import { PlanningService, driverInclude, planningDelivery } from '../matching/planning.service';
import { RouteInsertionEngine } from '../matching/route-insertion.engine';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { Prisma } from '@prisma/client';
const planSchema = z.object({
  stops: z.array(
    z.object({
      id: z.string().uuid().optional(),
      deliveryId: z.string().uuid(),
      type: z.enum(['PICKUP', 'DROPOFF']),
      latitude: z.number(),
      longitude: z.number(),
      estimatedArrivalAt: z.string().optional(),
    }),
  ),
  vehicleId: z.string().uuid(),
});
@Injectable()
export class OffersService {
  constructor(
    private readonly db: PrismaService,
    private readonly planning: PlanningService,
    private readonly insertion: RouteInsertionEngine,
    private readonly pricing: PricingEngineService,
    private readonly events: OutboxService,
  ) {}
  async list(actor: Actor) {
    if (!actor.driverId) throw new DomainError('DRIVER_REQUIRED', 'Driver required', 403);
    const offers = await this.db.routeOffer.findMany({
      where: { driverId: actor.driverId, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: {
        deliveries: { include: { delivery: { select: { pickupLatitude: true, pickupLongitude: true } } } },
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    return offers.map((o) => ({
      id: o.id,
      offerType: o.offerType,
      deliveryCount: o.deliveries.length,
      additionalDistanceMeters: o.additionalDistanceMeters,
      additionalDurationSeconds: o.additionalDurationSeconds,
      offeredPayoutCents: o.offeredPayoutCents,
      expiresAt: o.expiresAt,
      approximatePickup: o.deliveries[0]
        ? {
            latitude: Math.round(o.deliveries[0].delivery.pickupLatitude * 100) / 100,
            longitude: Math.round(o.deliveries[0].delivery.pickupLongitude * 100) / 100,
          }
        : null,
    }));
  }
  async accept(actor: Actor, id: string) {
    const offer = await this.db.routeOffer.findUniqueOrThrow({
      where: { id },
      include: { deliveries: { include: { delivery: true } } },
    });
    if (!actor.driverId || offer.driverId !== actor.driverId)
      throw new DomainError('OFFER_FORBIDDEN', 'Offer not assigned to this driver', 403);
    if (offer.status === 'ACCEPTED') return { id: offer.id, routeId: offer.routeId, status: offer.status };
    if (offer.status !== 'PENDING' || offer.expiresAt <= new Date())
      throw new DomainError('OFFER_EXPIRED', 'Offer no longer available');
    const plan = planSchema.parse(offer.plan);
    const snapshot = await this.planning.snapshot(actor.driverId);
    if (
      (snapshot.route?.id ?? null) !== offer.routeId ||
      snapshot.route?.version !== (offer.expectedRouteVersion ?? undefined) ||
      snapshot.vehicle.id !== plan.vehicleId
    )
      throw new DomainError('OFFER_STALE', 'Route or vehicle changed; a new offer is required');
    const newDeliveries = offer.deliveries.map((d) => d.delivery);
    const all = [...snapshot.remaining, ...newDeliveries].map(planningDelivery);
    const road = await this.planning.road(snapshot.start, all, plan.stops);
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [
        ...all.map((d) => `delivery:${d.id}`),
        `driver:${offer.driverId}`,
        ...(offer.routeId ? [`route:${offer.routeId}`] : []),
      ]);
      const current = await tx.routeOffer.findUniqueOrThrow({ where: { id } });
      if (current.status === 'ACCEPTED')
        return { id: current.id, routeId: current.routeId, status: current.status };
      if (current.status !== 'PENDING' || current.expiresAt <= new Date())
        throw new DomainError('OFFER_EXPIRED', 'Offer no longer available');
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: offer.driverId },
        include: driverInclude,
      });
      if (
        !driver.locationConsentAt ||
        !driver.acceptNewOrders ||
        driver.onboardingStatus !== 'APPROVED' ||
        !['AVAILABLE', 'ON_ROUTE'].includes(driver.status) ||
        driver.currentRouteId !== offer.routeId ||
        !driver.currentLocation ||
        driver.currentLocation.expiresAt <= new Date()
      )
        throw new DomainError('DRIVER_INELIGIBLE', 'Driver no longer eligible');
      if (
        driver.currentLocation.latitude !== snapshot.location.latitude ||
        driver.currentLocation.longitude !== snapshot.location.longitude ||
        JSON.stringify(driver.vehicles) !== JSON.stringify(snapshot.driver.vehicles)
      )
        throw new DomainError('OFFER_STALE', 'Driver position or vehicle changed; retry');
      const existing = offer.routeId
        ? await tx.route.findUniqueOrThrow({ where: { id: offer.routeId } })
        : null;
      if (existing && existing.version !== offer.expectedRouteVersion)
        throw new DomainError('ROUTE_VERSION_CONFLICT', 'Route was changed');
      const fresh = await tx.delivery.findMany({ where: { id: { in: all.map((d) => d.id) } } });
      const newIds = new Set(newDeliveries.map((d) => d.id));
      if (
        fresh.filter((d) => newIds.has(d.id) && !d.driverId && ['WAITING_POOL', 'OFFERED'].includes(d.status))
          .length !== newIds.size
      )
        throw new DomainError('DELIVERY_ALREADY_ASSIGNED', 'Another driver reserved a delivery');
      // Addresses and load cannot change underneath the precomputed road matrix.
      for (const d of fresh) {
        const prior = [...snapshot.remaining, ...newDeliveries].find((p) => p.id === d.id);
        if (
          !prior ||
          d.pickupLatitude !== prior.pickupLatitude ||
          d.pickupLongitude !== prior.pickupLongitude ||
          d.dropoffLatitude !== prior.dropoffLatitude ||
          d.dropoffLongitude !== prior.dropoffLongitude ||
          d.capacityUnits !== prior.capacityUnits ||
          d.revenueCents !== prior.revenueCents
        )
          throw new DomainError('OFFER_STALE', 'Delivery changed');
      }
      const simulation = this.insertion.simulate(
        snapshot.start,
        plan.stops,
        fresh.map(planningDelivery),
        snapshot.capacity,
        road,
        Date.now(),
      );
      if (!simulation)
        throw new DomainError('OFFER_INFEASIBLE', 'SLA or capacity no longer permits this route');
      const baseline = this.insertion.simulate(
        snapshot.start,
        snapshot.stops,
        snapshot.remaining.map(planningDelivery),
        snapshot.capacity,
        road,
        Date.now(),
      );
      if (!baseline) throw new DomainError('ROUTE_INFEASIBLE', 'Existing route requires replanning');
      const economics = this.pricing.quote(
        current.revenueCents,
        newIds.size,
        Math.max(0, simulation.distanceMeters - baseline.distanceMeters),
        Math.max(0, simulation.durationSeconds - baseline.durationSeconds),
      );
      if (!economics || economics.driverPayoutCents > current.offeredPayoutCents)
        throw new DomainError('ECONOMICS_CHANGED', 'Offer economics no longer meet policy');
      let route = existing;
      if (!route) route = await tx.route.create({ data: { driverId: driver.id, status: 'ASSIGNED' } });
      const routeId = route.id;
      const historicalStops = await tx.routeStop.findMany({
        where: { routeId, status: { in: ['COMPLETED', 'SKIPPED'] } },
        orderBy: { sequence: 'asc' },
      });
      // A released, uncollected delivery can be offered again to the same route.
      // Reuse its skipped stops while retaining the cancellation in the audit log.
      const reusable = historicalStops.filter((s) => s.status === 'SKIPPED' && newIds.has(s.deliveryId));
      const past = historicalStops.filter((s) => !reusable.some((r) => r.id === s.id));
      await tx.routeStop.updateMany({ where: { routeId }, data: { sequence: { increment: 10000 } } });
      for (let i = 0; i < past.length; i++) {
        const stop = past[i];
        if (stop) await tx.routeStop.update({ where: { id: stop.id }, data: { sequence: i } });
      }
      for (let i = 0; i < simulation.stops.length; i++) {
        const stop = simulation.stops[i];
        if (!stop) continue;
        const data = {
          sequence: past.length + i,
          estimatedArrivalAt: stop.estimatedArrivalAt ? new Date(stop.estimatedArrivalAt) : null,
        };
        if (stop.id) await tx.routeStop.update({ where: { id: stop.id, routeId }, data });
        else {
          const priorStop = reusable.find((s) => s.deliveryId === stop.deliveryId && s.type === stop.type);
          if (priorStop) {
            await tx.routeStop.update({
              where: { id: priorStop.id, routeId, status: 'SKIPPED' },
              data: {
                ...data,
                latitude: stop.latitude,
                longitude: stop.longitude,
                status: 'PENDING',
                arrivedAt: null,
                completedAt: null,
              },
            });
          } else
            await tx.routeStop.create({
              data: {
                ...data,
                routeId,
                deliveryId: stop.deliveryId,
                type: stop.type,
                latitude: stop.latitude,
                longitude: stop.longitude,
              },
            });
        }
      }
      const ids = [...newIds].sort();
      for (let i = 0; i < ids.length; i++) {
        const deliveryId = ids[i];
        if (!deliveryId) continue;
        const payout =
          Math.floor(current.offeredPayoutCents / ids.length) +
          (i < current.offeredPayoutCents % ids.length ? 1 : 0);
        const claimed = await tx.delivery.updateMany({
          where: { id: deliveryId, driverId: null, status: { in: ['WAITING_POOL', 'OFFERED'] } },
          data: {
            driverId: driver.id,
            routeId,
            status: route.status === 'ACTIVE' ? 'PICKUP_PENDING' : 'ASSIGNED',
            driverPayoutCents: payout,
          },
        });
        if (claimed.count !== 1)
          throw new DomainError('DELIVERY_ALREADY_ASSIGNED', 'Delivery already assigned');
      }
      await tx.route.update({
        where: { id: routeId, version: route.version },
        data: {
          version: { increment: 1 },
          estimatedDistanceMeters: existing
            ? { increment: current.additionalDistanceMeters }
            : simulation.distanceMeters,
          estimatedDurationSeconds: existing
            ? { increment: current.additionalDurationSeconds }
            : simulation.durationSeconds,
          grossValueCents: { increment: current.revenueCents },
          driverPayoutCents: { increment: current.offeredPayoutCents },
          platformMarginCents: { increment: current.platformMarginCents },
        },
      });
      await tx.driver.update({
        where: { id: driver.id },
        data: { currentRouteId: routeId, status: 'ON_ROUTE' },
      });
      await tx.routeOffer.update({
        where: { id },
        data: { status: 'ACCEPTED', respondedAt: new Date(), routeId },
      });
      await tx.routeOffer.updateMany({
        where: {
          id: { not: id },
          status: 'PENDING',
          OR: [{ deliveries: { some: { deliveryId: { in: ids } } } }, { driverId: driver.id }, { routeId }],
        },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
      await this.releaseUnclaimed(tx);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'offer.accepted',
          entityType: 'RouteOffer',
          entityId: id,
          metadata: { routeId },
        },
      });
      await this.events.emit(tx, 'RouteOfferAccepted', id, {
        offerId: id,
        routeId,
        driverId: driver.id,
        deliveryIds: ids,
      });
      return { id, routeId, status: 'ACCEPTED' };
    });
  }
  private releaseUnclaimed(tx: Prisma.TransactionClient) {
    return tx.delivery.updateMany({
      where: {
        status: 'OFFERED',
        driverId: null,
        offerDeliveries: { none: { offer: { status: 'PENDING', expiresAt: { gt: new Date() } } } },
      },
      data: { status: 'WAITING_POOL' },
    });
  }
  async reject(actor: Actor, id: string) {
    const offer = await this.db.routeOffer.findUniqueOrThrow({ where: { id } });
    if (!actor.driverId || offer.driverId !== actor.driverId)
      throw new DomainError('OFFER_FORBIDDEN', 'Offer not accessible', 403);
    return this.close(id, 'REJECTED');
  }
  async expire(id: string) {
    return this.close(id, 'EXPIRED');
  }
  private async close(id: string, status: 'REJECTED' | 'EXPIRED') {
    return this.db.transaction(async (tx) => {
      const offer = await tx.routeOffer.findUnique({ where: { id }, include: { deliveries: true } });
      if (!offer) return { id, status: 'MISSING' };
      await lockEntities(tx, [
        `driver:${offer.driverId}`,
        ...offer.deliveries.map((d) => `delivery:${d.deliveryId}`),
        ...(offer.routeId ? [`route:${offer.routeId}`] : []),
      ]);
      const changed = await tx.routeOffer.updateMany({
        where: { id, status: 'PENDING', ...(status === 'EXPIRED' ? { expiresAt: { lte: new Date() } } : {}) },
        data: { status, respondedAt: new Date() },
      });
      if (changed.count) {
        await this.releaseUnclaimed(tx);
        await this.events.emit(tx, 'RouteOfferClosed', id, { offerId: id, driverId: offer.driverId });
      }
      return { id, changed: changed.count === 1 };
    });
  }
  async expireDue() {
    const offers = await this.db.routeOffer.findMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      take: 100,
      select: { id: true },
    });
    for (const o of offers) await this.expire(o.id);
    await this.releaseUnclaimed(this.db);
  }
}
