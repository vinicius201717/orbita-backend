import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../infra/prisma.service';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
import { RouteCandidateService } from './route-candidate.service';
import { PlanningService } from './planning.service';
import { RouteBuilderService } from './route-builder.service';
import { MatchingScoreService } from './matching-score.service';
import { Prisma } from '@prisma/client';
@Injectable()
export class MatchingEngineService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly candidates: RouteCandidateService,
    private readonly planning: PlanningService,
    private readonly builder: RouteBuilderService,
    private readonly scores: MatchingScoreService,
    private readonly events: OutboxService,
  ) {}
  async matchDelivery(id: string) {
    const delivery = await this.db.delivery.findUnique({ where: { id } });
    if (!delivery || delivery.status !== 'WAITING_POOL' || delivery.pickupDeadline <= new Date()) return null;
    const pool = await this.candidates.poolNear(id, delivery.pickupLatitude, delivery.pickupLongitude);
    if (!pool.length) return null;
    const candidates = await this.candidates.drivers(delivery.pickupLatitude, delivery.pickupLongitude);
    type Proposal = {
      snapshot: Awaited<ReturnType<PlanningService['snapshot']>>;
      plan: NonNullable<Awaited<ReturnType<RouteBuilderService['build']>>>;
      score: number;
      priority: number;
    };
    const proposals: Proposal[] = [];
    for (const candidate of candidates.slice(0, this.config.get('MATCH_EVALUATION_LIMIT'))) {
      if (proposals.some((p) => p.priority < candidate.priority)) break;
      try {
        const snapshot = await this.planning.snapshot(candidate.id);
        const wait =
          delivery.serviceLevel === 'EXPRESS'
            ? 0
            : this.config.get(
                delivery.serviceLevel === 'SMART' ? 'SMART_POOL_WAIT_SECONDS' : 'ECONOMY_POOL_WAIT_SECONDS',
              );
        if (!snapshot.route && Date.now() - delivery.createdAt.getTime() < wait * 1000) continue;
        const plan = await this.builder.build(snapshot, pool);
        if (!plan || !plan.deliveries.some((d) => d.id === id)) continue;
        proposals.push({
          snapshot,
          plan,
          priority: candidate.priority,
          score: this.scores.score(
            plan.economics,
            plan.simulation,
            snapshot.capacity.capacityUnits,
            snapshot.driver.reliabilityScore,
          ),
        });
      } catch {
        continue;
      }
    }
    proposals.sort((a, b) => a.priority - b.priority || b.score - a.score);
    const chosen = proposals[0];
    if (!chosen) return null;
    return this.db.transaction(async (tx) => {
      const ids = chosen.plan.deliveries.map((d) => d.id);
      const routeId = chosen.snapshot.route?.id;
      await lockEntities(tx, [
        ...ids.map((d) => `delivery:${d}`),
        `driver:${chosen.snapshot.driver.id}`,
        ...(routeId ? [`route:${routeId}`] : []),
      ]);
      if ((await tx.delivery.count({ where: { id: { in: ids }, status: 'WAITING_POOL' } })) !== ids.length)
        return null;
      const driver = await tx.driver.findUniqueOrThrow({ where: { id: chosen.snapshot.driver.id } });
      if (
        driver.currentRouteId !== (routeId ?? null) ||
        !driver.acceptNewOrders ||
        !['AVAILABLE', 'ON_ROUTE'].includes(driver.status)
      )
        return null;
      if (
        await tx.routeOffer.count({
          where: { driverId: driver.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        })
      )
        return null;
      if (
        routeId &&
        (await tx.route.findUniqueOrThrow({ where: { id: routeId } })).version !==
          chosen.snapshot.route?.version
      )
        return null;
      const plan = {
        stops: chosen.plan.simulation.stops,
        deliverySnapshots: [...chosen.snapshot.remaining, ...chosen.plan.deliveries].map((d) => ({
          id: d.id,
          updatedAt: d.updatedAt.toISOString(),
        })),
        distanceMeters: chosen.plan.simulation.distanceMeters,
        durationSeconds: chosen.plan.simulation.durationSeconds,
        vehicleId: chosen.snapshot.vehicle.id,
      };
      const offer = await tx.routeOffer.create({
        data: {
          driverId: driver.id,
          routeId,
          offerType: routeId ? 'INSERTION' : 'NEW_ROUTE',
          expectedRouteVersion: chosen.snapshot.route?.version,
          additionalDistanceMeters: chosen.plan.economics.extraDistanceMeters,
          additionalDurationSeconds: chosen.plan.economics.extraDurationSeconds,
          offeredPayoutCents: chosen.plan.economics.driverPayoutCents,
          revenueCents: chosen.plan.economics.revenueCents,
          platformMarginCents: chosen.plan.economics.platformMarginCents,
          plan: JSON.parse(JSON.stringify(plan)) as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + this.config.get('OFFER_TTL_SECONDS') * 1000),
          deliveries: { create: ids.map((deliveryId) => ({ deliveryId })) },
        },
      });
      await tx.delivery.updateMany({
        where: { id: { in: ids }, status: 'WAITING_POOL' },
        data: { status: 'OFFERED' },
      });
      await this.events.emit(tx, 'RouteOfferCreated', offer.id, { offerId: offer.id, driverId: driver.id });
      return { id: offer.id, driverId: offer.driverId, deliveryCount: ids.length };
    });
  }
  async rematchPool() {
    const deliveries = await this.db.delivery.findMany({
      where: { status: 'WAITING_POOL', pickupDeadline: { gt: new Date() } },
      orderBy: [{ deliveryDeadline: 'asc' }, { id: 'asc' }],
      take: this.config.get('MAX_POOL_BATCH'),
      select: { id: true },
    });
    const result = [];
    for (const delivery of deliveries) {
      const offer = await this.matchDelivery(delivery.id);
      if (offer) result.push(offer);
    }
    return result;
  }
}
