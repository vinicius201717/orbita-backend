import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { actorFixture, businessFixture, createTestApp } from './helpers';
import { PrismaService } from '../../src/infra/prisma.service';
import { RedisService } from '../../src/infra/redis.service';
import { TrackingService } from '../../src/tracking/tracking.service';
import { DriversService } from '../../src/drivers/drivers.service';
import { DeliveriesService } from '../../src/deliveries/deliveries.service';
import { RoutesService } from '../../src/routes/routes.service';
import { CryptoService } from '../../src/common/crypto.service';
import { SettlementService } from '../../src/finance/settlement.service';
import { FinanceService } from '../../src/finance/finance.service';
import { OffersService } from '../../src/offers/offers.service';
import { RouteCandidateService } from '../../src/matching/route-candidate.service';

describe('native driver home and availability', () => {
  let app: INestApplication;
  let db: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });

  const point = { latitude: -16.68, longitude: -49.25 };
  const driverId = (driver: Awaited<ReturnType<typeof actorFixture>>) =>
    app.get(DriversService).driverId(driver.actor);
  async function gps(driver: Awaited<ReturnType<typeof actorFixture>>) {
    await app.get(TrackingService).update(driver.actor, {
      ...point,
      timestamp: new Date().toISOString(),
    });
    await app.get(TrackingService).flushLocations();
  }
  const summary = (driver: Awaited<ReturnType<typeof actorFixture>>) =>
    request(app.getHttpServer()).get('/api/v1/driver/summary').auth(driver.accessToken, { type: 'bearer' });
  const availability = (driver: Awaited<ReturnType<typeof actorFixture>>, acceptingOrders: boolean) =>
    request(app.getHttpServer())
      .patch('/api/v1/driver/availability')
      .auth(driver.accessToken, { type: 'bearer' })
      .send({ acceptingOrders });

  it('requires a driver identity and returns an empty account without inventing earnings', async () => {
    const driver = await actorFixture(app, 'DRIVER');
    const owner = await actorFixture(app, 'BUSINESS_OWNER');
    await request(app.getHttpServer()).get('/api/v1/driver/summary').expect(401);
    await summary(owner).expect(403);
    await availability(owner, true).expect(403);
    const { body } = await summary(driver).expect(200).expect('Cache-Control', 'no-store');
    expect(body).toMatchObject({
      driver: { id: driver.actor.driverId, status: 'AVAILABLE', acceptNewOrders: true, presence: 'STALE' },
      wallet: { balanceCents: 0, currency: 'BRL' },
      today: { timeZone: 'America/Sao_Paulo', earningsCents: 0, completedDeliveries: 0 },
      currentRoute: null,
      nextStop: null,
    });
  });

  it('separates ledger balance from local-day earnings and excludes other drivers', async () => {
    const driver = await actorFixture(app, 'DRIVER');
    const other = await actorFixture(app, 'DRIVER');
    const business = await businessFixture(app);
    const [bounds] = await db.$queryRaw<Array<{ start: Date; end: Date; date: string }>>`
      SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
      date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS start,
      (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo' AS end
    `;
    if (!bounds) throw new Error('Missing local-day bounds');
    for (const entry of [
      { driver, at: new Date(bounds.start.getTime() - 1), payout: 100, tip: 10 },
      { driver, at: bounds.start, payout: 200, tip: 20 },
      { driver, at: bounds.end, payout: 400, tip: 40 },
      { driver: other, at: bounds.start, payout: 10000, tip: 1000 },
    ]) {
      const delivery = await app.get(DeliveriesService).create(business.actor, {
        branchId: business.branch.id,
        customer: { name: 'Accounting fixture' },
        dropoff: point,
        items: [{ name: 'Meal', quantity: 1 }],
      });
      await db.transaction(async (tx) => {
        const settled = await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            driverId: entry.driver.actor.driverId,
            status: 'DELIVERED',
            deliveredAt: entry.at,
            revenueCents: entry.payout + 100,
            driverPayoutCents: entry.payout,
            tipCents: entry.tip,
          },
        });
        await app.get(SettlementService).settleDelivery(tx, settled);
        await tx.driverEarning.update({ where: { deliveryId: delivery.id }, data: { createdAt: entry.at } });
      });
    }
    const admin = await actorFixture(app, 'ADMIN');
    const wallet = await db.wallet.findUniqueOrThrow({ where: { driverId: driverId(driver) } });
    await app.get(FinanceService).adjust(admin.actor, wallet.id, -50, 'Test adjustment', randomUUID());
    const { body } = await summary(driver).expect(200);
    expect(body.wallet.balanceCents).toBe(720);
    expect(body.today).toEqual({
      date: bounds.date,
      timeZone: 'America/Sao_Paulo',
      earningsCents: 220,
      completedDeliveries: 1,
    });
    expect((await summary(other).expect(200)).body.wallet.balanceCents).toBe(11000);
  });

  it('pauses idle work, clears GPS and checks eligibility before reactivation', async () => {
    const driver = await actorFixture(app, 'DRIVER');
    await gps(driver);
    const paused = await availability(driver, false).expect(200);
    expect(paused.body).toMatchObject({ status: 'PAUSED', acceptNewOrders: false, currentRouteId: null });
    expect(await db.driverLocation.findUnique({ where: { driverId: driverId(driver) } })).toBeNull();
    await expect(gps(driver)).rejects.toThrow('GPS requires consent');
    await app.get(DriversService).consent(driver.actor, false);
    await availability(driver, true).expect(409);
    await app.get(DriversService).consent(driver.actor, true);
    await availability(driver, true)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('AVAILABLE');
        expect(body.acceptNewOrders).toBe(true);
      });
  });

  it('pauses offers during an assigned route while preserving GPS, custody and the stop lifecycle', async () => {
    const driver = await actorFixture(app, 'DRIVER');
    const other = await actorFixture(app, 'DRIVER');
    const business = await businessFixture(app);
    const deliveries = app.get(DeliveriesService);
    const delivery = await deliveries.create(business.actor, {
      branchId: business.branch.id,
      customer: { name: 'Recipient' },
      dropoff: { ...point, complement: 'Rua do cliente, 100' },
      items: [{ name: 'Meal', quantity: 1 }],
    });
    await deliveries.ready(business.actor, delivery.id);
    const route = await db.route.create({
      data: { driverId: driverId(driver), status: 'ASSIGNED', driverPayoutCents: 500 },
    });
    await db.delivery.update({
      where: { id: delivery.id },
      data: {
        driverId: driver.actor.driverId,
        routeId: route.id,
        status: 'ASSIGNED',
        driverPayoutCents: 500,
        verificationCodeHash: app.get(CryptoService).hash(`${delivery.id}:4821`),
      },
    });
    const pickup = await db.routeStop.create({
      data: { routeId: route.id, deliveryId: delivery.id, type: 'PICKUP', sequence: 0, ...point },
    });
    const dropoff = await db.routeStop.create({
      data: { routeId: route.id, deliveryId: delivery.id, type: 'DROPOFF', sequence: 1, ...point },
    });
    await db.driver.update({
      where: { id: driverId(driver) },
      data: { currentRouteId: route.id, status: 'ON_ROUTE' },
    });
    await gps(driver);
    const paused = await availability(driver, false).expect(200);
    expect(paused.body).toMatchObject({
      status: 'ON_ROUTE',
      acceptNewOrders: false,
      currentRouteId: route.id,
    });
    expect(await db.driverLocation.findUnique({ where: { driverId: driverId(driver) } })).not.toBeNull();
    await gps(driver);
    expect(await app.get(RouteCandidateService).drivers(point.latitude, point.longitude)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: driver.actor.driverId })]),
    );
    const vehicle = await db.vehicle.findFirstOrThrow({
      where: { driverId: driverId(driver), active: true },
    });
    const offer = await db.routeOffer.create({
      data: {
        driverId: driverId(driver),
        routeId: route.id,
        offerType: 'INSERTION',
        expectedRouteVersion: route.version,
        additionalDistanceMeters: 100,
        additionalDurationSeconds: 60,
        offeredPayoutCents: 500,
        revenueCents: 700,
        platformMarginCents: 200,
        expiresAt: new Date(Date.now() + 30000),
        plan: { stops: [], vehicleId: vehicle.id },
      },
    });
    await expect(app.get(OffersService).accept(driver.actor, offer.id)).rejects.toThrow(
      'Driver is not eligible',
    );
    const home = (await summary(driver).expect(200)).body;
    expect(home.currentRoute).toMatchObject({ id: route.id, remainingStops: 2, remainingDeliveries: 1 });
    expect(home.nextStop).toMatchObject({
      id: pickup.id,
      type: 'PICKUP',
      address: 'Rua de teste',
      readinessStatus: 'READY_FOR_PICKUP',
    });
    expect(home.nextStop.navigation.googleMapsUrl).toContain('destination=');
    expect(JSON.stringify(home)).not.toMatch(/verificationCodeHash|customerConfirmationTokenHash|4821/);
    expect((await summary(other).expect(200)).body.currentRoute).toBeNull();
    const routes = app.get(RoutesService);
    await routes.start(driver.actor, route.id);
    await routes.arrive(driver.actor, route.id, pickup.id);
    await routes.complete(driver.actor, route.id, pickup.id);
    expect((await summary(driver).expect(200)).body.nextStop).toMatchObject({
      id: dropoff.id,
      type: 'DROPOFF',
      address: 'Rua do cliente, 100',
    });
    await routes.arrive(driver.actor, route.id, dropoff.id);
    await deliveries.verify(driver.actor, delivery.id, { code: '4821' });
    expect((await summary(driver).expect(200)).body.nextStop).toBeNull();
    await routes.finish(driver.actor, route.id);
    const finished = (await summary(driver).expect(200)).body;
    expect(finished.driver).toMatchObject({ status: 'PAUSED', acceptNewOrders: false, presence: 'STALE' });
    expect(await db.driverLocation.findUnique({ where: { driverId: driverId(driver) } })).toBeNull();
    expect(await app.get(RedisService).client.get(`driver:${driver.actor.driverId}:location`)).toBeNull();
    expect(finished.currentRoute).toBeNull();
    expect(finished.wallet.balanceCents).toBe(500);
  });
});
