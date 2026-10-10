import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infra/prisma.service';
import { RedisService } from '../../src/infra/redis.service';
import { AuthService } from '../../src/auth/auth.service';
import { TrackingService } from '../../src/tracking/tracking.service';
import { DriversService } from '../../src/drivers/drivers.service';
import { actorFixture, businessFixture, createTestApp, testPassword } from './helpers';
describe('real API auth, tenancy and GPS', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('requires a current worker heartbeat as well as PostgreSQL, PostGIS and Redis', async () => {
    const redis = app.get(RedisService).client;
    const heartbeatKey = 'orbita:worker:heartbeat';
    // Use the isolated test Redis directly: readiness must not depend on suite
    // execution order or on a developer's separately running worker.
    await redis.del(heartbeatKey);
    try {
      await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
      await redis.set(heartbeatKey, String(Date.now() - 61000), 'EX', 60);
      await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
      await redis.set(heartbeatKey, String(Date.now()), 'EX', 60);
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            postgres: 'up', postgis: 'up', redis: 'up', queue: { worker: 'up' },
          });
        });
    } finally {
      await redis.del(heartbeatKey);
    }
    const geo = await app.get(PrismaService).$queryRaw<
      Array<{ distance: number }>
    >`SELECT ST_Distance(ST_MakePoint(-49.25,-16.68)::geography,ST_MakePoint(-49.25,-16.681)::geography) AS distance`;
    expect(geo[0]?.distance).toBeGreaterThan(100);
  });
  it('forbids privilege escalation and unknown payload keys', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `${randomUUID()}@example.test`,
        password: testPassword,
        name: 'Test',
        phone: '+5562999999999',
        role: 'ADMIN',
      })
      .expect(400);
    await request(app.getHttpServer()).get('/api/v1/driver/me').expect(401);
  });
  it('rotates refresh token and revokes family on reuse', async () => {
    const fixture = await actorFixture(app, 'DRIVER');
    const auth = app.get(AuthService);
    const rotated = await auth.refresh(fixture.refreshToken);
    expect(rotated.refreshToken).not.toBe(fixture.refreshToken);
    await expect(auth.refresh(fixture.refreshToken)).rejects.toThrow();
    await expect(auth.refresh(rotated.refreshToken)).rejects.toThrow();
  });
  it('enforces tenant ownership on business and delivery requests', async () => {
    const first = await businessFixture(app);
    const second = await businessFixture(app);
    await request(app.getHttpServer())
      .get(`/api/v1/businesses/${first.business.id}`)
      .auth(second.accessToken, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/deliveries')
      .auth(second.accessToken, { type: 'bearer' })
      .send({
        branchId: first.branch.id,
        customer: { name: 'Customer' },
        dropoff: { latitude: -16.681, longitude: -49.251 },
        items: [{ name: 'Meal', quantity: 1 }],
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/deliveries')
      .auth(first.accessToken, { type: 'bearer' })
      .send({ branchId: first.branch.id, items: [{ name: 'Meal', quantity: 1 }] })
      .expect(400);
  });
  it('persists GPS in batches, rejects regressions, removes offline presence', async () => {
    const fixture = await actorFixture(app, 'DRIVER');
    const tracking = app.get(TrackingService);
    const drivers = app.get(DriversService);
    const db = app.get(PrismaService);
    const timestamp = new Date();
    expect(
      await tracking.update(fixture.actor, {
        latitude: -16.68,
        longitude: -49.25,
        timestamp: timestamp.toISOString(),
      }),
    ).toEqual({ accepted: true });
    expect(
      await tracking.update(fixture.actor, {
        latitude: -17,
        longitude: -50,
        timestamp: new Date(timestamp.getTime() - 1000).toISOString(),
      }),
    ).toEqual({ accepted: false });
    await tracking.flushLocations();
    const stored = await db.driverLocation.findUniqueOrThrow({
      where: { driverId: fixture.actor.driverId ?? '' },
    });
    expect(stored.latitude).toBe(-16.68);
    await drivers.status(fixture.actor, 'OFFLINE');
    expect(await db.driverLocation.findUnique({ where: { driverId: stored.driverId } })).toBeNull();
    await expect(
      tracking.update(fixture.actor, {
        latitude: -16.68,
        longitude: -49.25,
        timestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });
});
