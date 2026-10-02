import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { actorFixture, businessFixture, createTestApp } from './helpers';
import { PrismaService } from '../../src/infra/prisma.service';
import { TrackingService } from '../../src/tracking/tracking.service';
import { MatchingEngineService } from '../../src/matching/matching-engine.service';
import { OffersService } from '../../src/offers/offers.service';
import { RoutesService } from '../../src/routes/routes.service';
import { DeliveriesService } from '../../src/deliveries/deliveries.service';
import { FinanceService } from '../../src/finance/finance.service';
import { CryptoService } from '../../src/common/crypto.service';
import { CancellationService } from '../../src/incidents/cancellation.service';
import { ConfigService } from '../../src/config/config.service';
import { PlanningService } from '../../src/matching/planning.service';
describe('logistics E2E and real transaction races', () => {
  let app: INestApplication;
  let db: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function fixture() {
    // A new isolated region per run, away from other retained test fixtures.
    const point = { latitude: -30 + Math.random() * 10, longitude: -55 + Math.random() * 5 };
    const business = await businessFixture(app, point);
    const driver = await actorFixture(app, 'DRIVER');
    await app.get(TrackingService).update(driver.actor, { ...point, timestamp: new Date().toISOString() });
    await app.get(TrackingService).flushLocations();
    return { point, business, driver };
  }
  async function delivery(f: Awaited<ReturnType<typeof fixture>>, offset = 0.001) {
    const created = await app.get(DeliveriesService).create(f.business.actor, {
      branchId: f.business.branch.id,
      customer: { name: 'Customer' },
      dropoff: { latitude: f.point.latitude + offset, longitude: f.point.longitude + offset },
      items: [{ name: 'Meal', quantity: 1 }],
      serviceLevel: 'EXPRESS',
    });
    await app.get(DeliveriesService).ready(f.business.actor, created.id);
    const code = '4821';
    await db.delivery.update({
      where: { id: created.id },
      data: { verificationCodeHash: app.get(CryptoService).hash(`${created.id}:${code}`) },
    });
    return { ...created, code };
  }
  it('creates delivery, matches, executes route, verifies PIN and credits ledger once', async () => {
    const f = await fixture();
    const d = await delivery(f);
    const matching = app.get(MatchingEngineService);
    const offers = app.get(OffersService);
    const offer = await matching.matchDelivery(d.id);
    expect(offer?.driverId).toBe(f.driver.actor.driverId);
    if (!offer) throw new Error('No offer');
    const preview = await offers.list(f.driver.actor);
    expect(JSON.stringify(preview)).not.toContain(d.customerName);
    expect(JSON.stringify(preview)).not.toContain('verificationCodeHash');
    const accepted = await offers.accept(f.driver.actor, offer.id);
    if (!accepted.routeId) throw new Error('No route');
    const routes = app.get(RoutesService);
    await routes.start(f.driver.actor, accepted.routeId);
    const stops = await db.routeStop.findMany({
      where: { routeId: accepted.routeId },
      orderBy: { sequence: 'asc' },
    });
    const pickup = stops[0],
      dropoff = stops[1];
    if (!pickup || !dropoff) throw new Error('Missing stops');
    await routes.arrive(f.driver.actor, accepted.routeId, pickup.id);
    await routes.complete(f.driver.actor, accepted.routeId, pickup.id);
    await routes.arrive(f.driver.actor, accepted.routeId, dropoff.id);
    await expect(routes.complete(f.driver.actor, accepted.routeId, dropoff.id)).rejects.toThrow(
      'Confirm dropoff',
    );
    await expect(app.get(DeliveriesService).verify(f.driver.actor, d.id, { code: '0000' })).rejects.toThrow();
    expect((await db.delivery.findUniqueOrThrow({ where: { id: d.id } })).verificationAttempts).toBe(1);
    const confirmations = await Promise.all([
      app.get(DeliveriesService).verify(f.driver.actor, d.id, { code: d.code }),
      app.get(DeliveriesService).verify(f.driver.actor, d.id, { code: d.code }),
    ]);
    expect(confirmations.every((v) => v.status === 'DELIVERED')).toBe(true);
    expect(await db.driverEarning.count({ where: { deliveryId: d.id } })).toBe(1);
    const ledger = await db.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `delivery-earning:${d.id}` },
      include: { entries: true },
    });
    expect(ledger.entries.reduce((s, e) => s + e.amountCents, 0)).toBe(0);
    expect((await app.get(FinanceService).wallet(f.driver.actor)).balanceCents).toBeGreaterThan(0);
    await routes.finish(f.driver.actor, accepted.routeId);
    await request(app.getHttpServer())
      .get('/api/v1/analytics/business/overview')
      .auth(f.business.accessToken, { type: 'bearer' })
      .expect(200)
      .expect((res) => {
        expect((res.body as { completed: number }).completed).toBe(1);
      });
  });
  it('allows only one winner when two drivers race for the same delivery', async () => {
    const f = await fixture();
    const d = await delivery(f);
    const second = await actorFixture(app, 'DRIVER');
    await app.get(TrackingService).update(second.actor, { ...f.point, timestamp: new Date().toISOString() });
    await app.get(TrackingService).flushLocations();
    const generated = await app.get(MatchingEngineService).matchDelivery(d.id);
    if (!generated) throw new Error('No offer');
    const firstActor = generated.driverId === f.driver.actor.driverId ? f.driver.actor : second.actor;
    const otherActor = generated.driverId === f.driver.actor.driverId ? second.actor : f.driver.actor;
    const source = await db.routeOffer.findUniqueOrThrow({ where: { id: generated.id } });
    const otherVehicle = await db.vehicle.findFirstOrThrow({
      where: { driverId: otherActor.driverId ?? '', active: true },
    });
    const duplicate = await db.routeOffer.create({
      data: {
        driverId: otherActor.driverId ?? '',
        offerType: 'NEW_ROUTE',
        additionalDistanceMeters: source.additionalDistanceMeters,
        additionalDurationSeconds: source.additionalDurationSeconds,
        offeredPayoutCents: source.offeredPayoutCents,
        revenueCents: source.revenueCents,
        platformMarginCents: source.platformMarginCents,
        plan: { ...(source.plan as Prisma.JsonObject), vehicleId: otherVehicle.id } as Prisma.InputJsonObject,
        expiresAt: new Date(Date.now() + 30000),
        deliveries: { create: { deliveryId: d.id } },
      },
    });
    const results = await Promise.allSettled([
      app.get(OffersService).accept(firstActor, source.id),
      app.get(OffersService).accept(otherActor, duplicate.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await db.routeOffer.count({ where: { id: { in: [source.id, duplicate.id] }, status: 'ACCEPTED' } }),
    ).toBe(1);
  });
  it('inserts into an existing route and rejects an obsolete route version', async () => {
    const f = await fixture();
    const a = await delivery(f);
    const matching = app.get(MatchingEngineService);
    const offers = app.get(OffersService);
    const initial = await matching.matchDelivery(a.id);
    if (!initial) throw new Error('No initial offer');
    const accepted = await offers.accept(f.driver.actor, initial.id);
    if (!accepted.routeId) throw new Error('No route');
    await app.get(RoutesService).start(f.driver.actor, accepted.routeId);
    const b = await delivery(f, 0.002);
    const insertion = await matching.matchDelivery(b.id);
    if (!insertion) throw new Error('No insertion');
    const offered = await db.routeOffer.findUniqueOrThrow({ where: { id: insertion.id } });
    expect(offered.offerType).toBe('INSERTION');
    const updated = await offers.accept(f.driver.actor, insertion.id);
    expect(updated.routeId).toBe(accepted.routeId);
    expect(await db.delivery.count({ where: { routeId: accepted.routeId } })).toBe(2);
    const c = await delivery(f, 0.003);
    const stale = await matching.matchDelivery(c.id);
    if (!stale) throw new Error('No later offer');
    const next = await db.routeStop.findFirstOrThrow({
      where: { routeId: accepted.routeId, status: 'PENDING' },
      orderBy: { sequence: 'asc' },
    });
    await app.get(RoutesService).arrive(f.driver.actor, accepted.routeId, next.id);
    await expect(offers.accept(f.driver.actor, stale.id)).rejects.toThrow();
  });
  it('expires offers and returns unclaimed deliveries to the pool', async () => {
    const f = await fixture();
    const d = await delivery(f);
    const generated = await app.get(MatchingEngineService).matchDelivery(d.id);
    if (!generated) throw new Error('No offer');
    await db.routeOffer.update({
      where: { id: generated.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await app.get(OffersService).expire(generated.id);
    expect((await db.delivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('WAITING_POOL');
    await expect(app.get(OffersService).accept(f.driver.actor, generated.id)).rejects.toThrow();
  });
  it('accepts an offer after a fresh stationary GPS heartbeat during planning', async () => {
    const f = await fixture();
    const d = await delivery(f);
    const offer = await app.get(MatchingEngineService).matchDelivery(d.id);
    if (!offer) throw new Error('No offer');
    const planning = app.get(PlanningService);
    const road = planning.road.bind(planning);
    const spy = jest.spyOn(planning, 'road').mockImplementationOnce(async (...args) => {
      const result = await road(...args);
      await db.driverLocation.update({
        where: { driverId: f.driver.actor.driverId ?? '' },
        data: { timestamp: new Date(Date.now() + 1), expiresAt: new Date(Date.now() + 90000) },
      });
      return result;
    });
    try {
      expect((await app.get(OffersService).accept(f.driver.actor, offer.id)).status).toBe('ACCEPTED');
    } finally {
      spy.mockRestore();
    }
  });
  it('reuses skipped stops when an uncollected delivery is reassigned to its previous route', async () => {
    const f = await fixture();
    const d = await delivery(f);
    await delivery(f, 0.002);
    const matching = app.get(MatchingEngineService);
    const offers = app.get(OffersService);
    const initial = await matching.matchDelivery(d.id);
    if (!initial) throw new Error('No offer');
    const accepted = await offers.accept(f.driver.actor, initial.id);
    if (!accepted.routeId) throw new Error('No route');
    const where = { routeId: accepted.routeId, deliveryId: d.id };
    const original = await db.routeStop.findMany({ where });
    expect(
      (await app.get(CancellationService).cancel(f.driver.actor, d.id, 'Temporary release')).status,
    ).toBe('WAITING_POOL');
    expect(await db.routeStop.count({ where: { ...where, status: 'SKIPPED' } })).toBe(2);
    const replacement = await matching.matchDelivery(d.id);
    if (!replacement) throw new Error('No replacement offer');
    expect((await offers.accept(f.driver.actor, replacement.id)).routeId).toBe(accepted.routeId);
    const restored = await db.routeStop.findMany({ where });
    expect(restored.map((s) => s.id).sort()).toEqual(original.map((s) => s.id).sort());
    expect(
      restored.every((s) => s.status === 'PENDING' && s.arrivedAt === null && s.completedAt === null),
    ).toBe(true);
    expect(await db.routeStop.count({ where: { routeId: accepted.routeId } })).toBe(4);
  });
  it('holds custody after pickup cancellation and never requeues collected cargo', async () => {
    const f = await fixture();
    const d = await delivery(f);
    const offer = await app.get(MatchingEngineService).matchDelivery(d.id);
    if (!offer) throw new Error('No offer');
    const accepted = await app.get(OffersService).accept(f.driver.actor, offer.id);
    if (!accepted.routeId) throw new Error('No route');
    const routes = app.get(RoutesService);
    await routes.start(f.driver.actor, accepted.routeId);
    const pickup = await db.routeStop.findFirstOrThrow({
      where: { routeId: accepted.routeId, type: 'PICKUP' },
    });
    await routes.arrive(f.driver.actor, accepted.routeId, pickup.id);
    await routes.complete(f.driver.actor, accepted.routeId, pickup.id);
    const result = await app.get(CancellationService).cancel(f.business.actor, d.id, 'Customer cancellation');
    expect(result.status).toBe('RETURN_REQUIRED');
    const record = await db.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(record.driverId).toBe(f.driver.actor.driverId);
    expect(record.routeId).toBe(accepted.routeId);
  });
  it('distributes five deliveries as two insertions and a new three-delivery route, excluding a far driver', async () => {
    const config = app.get(ConfigService);
    const previousLimit = config.values.MAX_ROUTE_DELIVERIES;
    config.values.MAX_ROUTE_DELIVERIES = 3;
    try {
      const f = await fixture();
      const initial = await delivery(f);
      const matching = app.get(MatchingEngineService),
        offers = app.get(OffersService);
      const first = await matching.matchDelivery(initial.id);
      if (!first) throw new Error('No initial route');
      const accepted = await offers.accept(f.driver.actor, first.id);
      if (!accepted.routeId) throw new Error('No route');
      await app.get(RoutesService).start(f.driver.actor, accepted.routeId);
      const marcos = await actorFixture(app, 'DRIVER'),
        joao = await actorFixture(app, 'DRIVER');
      await app
        .get(TrackingService)
        .update(marcos.actor, { ...f.point, timestamp: new Date().toISOString() });
      await app.get(TrackingService).update(joao.actor, {
        latitude: f.point.latitude + 1,
        longitude: f.point.longitude + 1,
        timestamp: new Date().toISOString(),
      });
      await app.get(TrackingService).flushLocations();
      const batch = [];
      for (let i = 0; i < 5; i++) batch.push(await delivery(f, 0.0015 + i * 0.0002));
      for (const item of batch) await matching.matchDelivery(item.id);
      const carlosOffers = await offers.list(f.driver.actor),
        marcosOffers = await offers.list(marcos.actor),
        joaoOffers = await offers.list(joao.actor);
      expect(carlosOffers[0]?.deliveryCount).toBe(2);
      expect(marcosOffers[0]?.deliveryCount).toBe(3);
      expect(joaoOffers).toHaveLength(0);
      const carlosOffer = carlosOffers[0],
        marcosOffer = marcosOffers[0];
      if (!carlosOffer || !marcosOffer) throw new Error('Missing grouped offers');
      await Promise.all([
        offers.accept(f.driver.actor, carlosOffer.id),
        offers.accept(marcos.actor, marcosOffer.id),
      ]);
      const assignments = await db.delivery.groupBy({
        by: ['driverId'],
        where: { id: { in: batch.map((d) => d.id) } },
        _count: true,
      });
      expect(assignments.map((v) => v._count).sort()).toEqual([2, 3]);
    } finally {
      config.values.MAX_ROUTE_DELIVERIES = previousLimit;
    }
  });
});
