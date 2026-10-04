import { Injectable } from '@nestjs/common';
import { Prisma, Route, RouteStop } from '@prisma/client';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
import { ConfigService } from '../config/config.service';
import { DeliveryStateMachineService } from '../deliveries/delivery-state-machine.service';
import { deliveryView } from '../deliveries/deliveries.service';
import { PrismaService } from '../infra/prisma.service';
import { RouteListDto } from './routes.dto';

@Injectable()
export class RoutesService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly events: OutboxService,
    private readonly states: DeliveryStateMachineService,
  ) {}

  assertDriver(actor: Actor, route: Pick<Route, 'driverId'>): void {
    if (actor.role !== 'DRIVER' || !actor.driverId || actor.driverId !== route.driverId)
      throw new DomainError('ROUTE_FORBIDDEN', 'Only the assigned driver can operate this route', 403);
  }
  async list(actor: Actor, query: RouteListDto) {
    const where: Prisma.RouteWhereInput = { ...(query.status ? { status: query.status } : {}) };
    if (actor.role === 'DRIVER' && actor.driverId) where.driverId = actor.driverId;
    else if (['BUSINESS_OWNER', 'BUSINESS_STAFF'].includes(actor.role) && actor.businessId)
      where.deliveries = { some: { businessId: actor.businessId } };
    else if (actor.role !== 'ADMIN') throw new DomainError('ROUTE_FORBIDDEN', 'Route access required', 403);
    const rows = await this.db.route.findMany({
      where,
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return {
      items: await Promise.all(rows.slice(0, 25).map((route) => this.get(actor, route.id))),
      nextCursor: rows.length > 25 ? rows[24]?.id ?? null : null,
    };
  }
  async get(actor: Actor, id: string) {
    const route = await this.db.route.findUnique({
      where: { id },
      include: { stops: { orderBy: { sequence: 'asc' } }, deliveries: true },
    });
    if (!route) throw new DomainError('ROUTE_NOT_FOUND', 'Route not found', 404);
    if (actor.role === 'ADMIN' || (actor.role === 'DRIVER' && actor.driverId === route.driverId))
      return {
        ...route,
        deliveries: route.deliveries.map((delivery) => deliveryView(delivery, actor)),
        stops: route.stops.map((stop) => ({ ...stop, navigation: this.navigation(stop) })),
      };
    const visible = route.deliveries.filter((delivery) => delivery.businessId === actor.businessId);
    if (!['BUSINESS_OWNER', 'BUSINESS_STAFF'].includes(actor.role) || visible.length === 0)
      throw new DomainError('ROUTE_FORBIDDEN', 'Route not accessible', 403);
    const visibleIds = new Set(visible.map((delivery) => delivery.id));
    return {
      id: route.id,
      driverId: route.driverId,
      status: route.status,
      version: route.version,
      startedAt: route.startedAt,
      completedAt: route.completedAt,
      deliveries: visible.map((delivery) => deliveryView(delivery, actor)),
      // Sequence positions and route totals reveal other businesses' work, so omit them.
      stops: route.stops
        .filter((stop) => visibleIds.has(stop.deliveryId))
        .map((stop) => ({
          id: stop.id,
          deliveryId: stop.deliveryId,
          type: stop.type,
          status: stop.status,
          estimatedArrivalAt: stop.estimatedArrivalAt,
          arrivedAt: stop.arrivedAt,
          completedAt: stop.completedAt,
        })),
    };
  }
  private navigation(stop: Pick<RouteStop, 'latitude' | 'longitude'>) {
    const destination = `${stop.latitude},${stop.longitude}`;
    return {
      latitude: stop.latitude,
      longitude: stop.longitude,
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
      wazeUrl: `https://waze.com/ul?ll=${encodeURIComponent(destination)}&navigate=yes`,
    };
  }
  private async lockedRoute(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    const snapshot = await tx.route.findUniqueOrThrow({
      where: { id },
      include: { deliveries: { select: { id: true } } },
    });
    await lockEntities(tx, [
      `route:${id}`,
      `driver:${snapshot.driverId}`,
      ...snapshot.deliveries.map((delivery) => `delivery:${delivery.id}`),
    ]);
    const route = await tx.route.findUniqueOrThrow({
      where: { id },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        deliveries: true,
        driver: { include: { vehicles: { where: { active: true } } } },
      },
    });
    this.assertDriver(actor, route);
    return route;
  }
  assertNextStop(stops: RouteStop[], stopId: string): RouteStop {
    const stop = stops.find((item) => item.id === stopId);
    if (!stop) throw new DomainError('STOP_NOT_FOUND', 'Stop not found on route', 404);
    const next = stops.find((item) => !['COMPLETED', 'SKIPPED'].includes(item.status));
    if (stop.status !== 'COMPLETED' && next?.id !== stopId)
      throw new DomainError('STOP_OUT_OF_SEQUENCE', 'Complete earlier stops first');
    return stop;
  }
  private async changed(tx: Prisma.TransactionClient, route: Route, action: string, actorId: string) {
    const updated = await tx.route.update({
      where: { id: route.id, version: route.version },
      data: { version: { increment: 1 } },
    });
    await tx.routeOffer.updateMany({
      where: { routeId: route.id, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    await tx.auditLog.create({ data: { actorId, action, entityType: 'Route', entityId: route.id } });
    await this.events.emit(tx, 'RouteUpdated', route.id, { routeId: route.id, driverId: route.driverId });
    return updated;
  }
  async start(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const route = await this.lockedRoute(tx, actor, id);
      if (route.status === 'ACTIVE') return { id, status: route.status, version: route.version };
      if (route.status !== 'ASSIGNED')
        throw new DomainError('ROUTE_INVALID_STATE', 'Only assigned routes can start');
      if (route.driver.currentRouteId !== id)
        throw new DomainError('DRIVER_ROUTE_CHANGED', 'Driver is assigned to a different route');
      const started = await tx.route.update({
        where: { id },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });
      await tx.driver.update({ where: { id: route.driverId }, data: { status: 'ON_ROUTE' } });
      await tx.delivery.updateMany({
        where: { routeId: id, status: 'ASSIGNED' },
        data: { status: 'PICKUP_PENDING' },
      });
      const updated = await this.changed(tx, started, 'route.started', actor.id);
      return { id, status: updated.status, version: updated.version };
    });
  }
  async arrive(actor: Actor, id: string, stopId: string) {
    return this.db.transaction(async (tx) => {
      const route = await this.lockedRoute(tx, actor, id);
      if (route.status !== 'ACTIVE')
        throw new DomainError('ROUTE_INVALID_STATE', 'Start the route before arriving');
      const stop = this.assertNextStop(route.stops, stopId);
      if (stop.status === 'COMPLETED' || stop.status === 'ARRIVED')
        return { id: stop.id, status: stop.status };
      const now = new Date();
      const delivery = route.deliveries.find((item) => item.id === stop.deliveryId);
      if (!delivery) throw new DomainError('DELIVERY_NOT_FOUND', 'Stop delivery not found', 404);
      if (stop.type === 'DROPOFF') {
        this.states.assertTransition(delivery.status, 'ARRIVING');
        await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'ARRIVING' } });
      } else if (delivery.status === 'ASSIGNED') {
        this.states.assertTransition(delivery.status, 'PICKUP_PENDING');
        await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'PICKUP_PENDING' } });
      }
      const result = await tx.routeStop.update({
        where: { id: stopId },
        data: { status: 'ARRIVED', arrivedAt: now },
      });
      await this.changed(tx, route, 'route.stop_arrived', actor.id);
      return result;
    });
  }
  async complete(actor: Actor, id: string, stopId: string) {
    return this.db.transaction(async (tx) => {
      const route = await this.lockedRoute(tx, actor, id);
      if (route.status !== 'ACTIVE') throw new DomainError('ROUTE_INVALID_STATE', 'Route is not active');
      const stop = this.assertNextStop(route.stops, stopId);
      if (stop.type === 'DROPOFF')
        throw new DomainError(
          'DELIVERY_PROOF_REQUIRED',
          'Confirm dropoff through PIN, customer confirmation or audited admin proof',
        );
      if (stop.status === 'COMPLETED') return { id: stop.id, status: stop.status };
      if (stop.status !== 'ARRIVED' || !stop.arrivedAt)
        throw new DomainError('STOP_NOT_ARRIVED', 'Record arrival before pickup');
      const delivery = route.deliveries.find((item) => item.id === stop.deliveryId);
      if (!delivery) throw new DomainError('DELIVERY_NOT_FOUND', 'Stop delivery not found', 404);
      if (delivery.readinessStatus !== 'READY_FOR_PICKUP')
        throw new DomainError('DELIVERY_NOT_READY', 'Business must mark this delivery ready');
      this.states.assertTransition(delivery.status, 'PICKED_UP');
      const vehicle = route.driver.vehicles[0];
      if (!vehicle) throw new DomainError('VEHICLE_REQUIRED', 'An active vehicle is required');
      if (
        route.driver.currentCapacityUnits + delivery.capacityUnits >
        Math.min(vehicle.capacityUnits, route.driver.maxCapacityUnits)
      )
        throw new DomainError('CAPACITY_EXCEEDED', 'Vehicle capacity exceeded');
      const onboard = route.deliveries.filter(
        (item) => item.pickedUpAt && !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(item.status),
      );
      if (
        (vehicle.weightCapacityGrams &&
          onboard.reduce((sum, item) => sum + (item.weightGrams ?? 0), delivery.weightGrams ?? 0) >
            vehicle.weightCapacityGrams) ||
        (vehicle.volumeCapacityCm3 &&
          onboard.reduce((sum, item) => sum + (item.volumeCm3 ?? 0), delivery.volumeCm3 ?? 0) >
            vehicle.volumeCapacityCm3)
      )
        throw new DomainError('CAPACITY_EXCEEDED', 'Vehicle weight or volume exceeded');
      if (vehicle.compatibleCategories.length && !vehicle.compatibleCategories.includes(delivery.category))
        throw new DomainError('CARGO_INCOMPATIBLE', 'Vehicle is incompatible with this cargo');
      const now = new Date();
      const waitSeconds = Math.max(0, Math.floor((now.getTime() - stop.arrivedAt.getTime()) / 1000));
      const billableSeconds = Math.max(0, waitSeconds - this.config.get('WAIT_FREE_SECONDS'));
      await tx.waitFee.upsert({
        where: { deliveryId: delivery.id },
        update: {},
        create: {
          deliveryId: delivery.id,
          waitSeconds,
          billableSeconds,
          amountCents: Math.ceil(billableSeconds / 60) * this.config.get('WAIT_FEE_CENTS_PER_MINUTE'),
        },
      });
      await tx.delivery.update({
        where: { id: delivery.id },
        data: { status: 'IN_TRANSIT', pickedUpAt: now, pickupWaitTimeSeconds: waitSeconds },
      });
      await tx.driver.update({
        where: { id: route.driverId },
        data: { currentCapacityUnits: { increment: delivery.capacityUnits } },
      });
      const result = await tx.routeStop.update({
        where: { id: stop.id },
        data: { status: 'COMPLETED', completedAt: now },
      });
      await this.changed(tx, route, 'route.pickup_completed', actor.id);
      await this.events.emit(tx, 'DeliveryPickedUp', delivery.id, {
        deliveryId: delivery.id,
        routeId: id,
        driverId: route.driverId,
        businessId: delivery.businessId,
      });
      return result;
    });
  }
  async finish(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const route = await this.lockedRoute(tx, actor, id);
      if (route.status === 'COMPLETED') return { id, status: route.status, version: route.version };
      if (route.status !== 'ACTIVE')
        throw new DomainError('ROUTE_INVALID_STATE', 'Only active routes can finish');
      if (
        route.stops.some((stop) => !['COMPLETED', 'SKIPPED'].includes(stop.status)) ||
        route.deliveries.some((delivery) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(delivery.status))
      )
        throw new DomainError('ROUTE_INCOMPLETE', 'Complete or resolve every delivery first');
      if (route.driver.currentCapacityUnits !== 0)
        throw new DomainError('DRIVER_LOAD_REMAINS', 'Driver still has cargo to resolve');
      const completed = await tx.route.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await tx.driver.update({
        where: { id: route.driverId },
        data: { status: route.driver.acceptNewOrders ? 'AVAILABLE' : 'PAUSED', currentRouteId: null },
      });
      const updated = await this.changed(tx, completed, 'route.completed', actor.id);
      await this.events.emit(tx, 'RouteCompleted', id, { routeId: id, driverId: route.driverId });
      return { id, status: updated.status, version: updated.version };
    });
  }
}
