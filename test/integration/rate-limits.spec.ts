import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { PRE_AUTH_SOURCE_LIMIT } from '../../src/common/rate-limit.guard';
import { RedisService } from '../../src/infra/redis.service';
import { actorFixture, createTestApp } from './helpers';

describe('rate limits with the real HTTP, auth and Redis pipeline', () => {
  let app: INestApplication;
  const source = '192.0.2.210';
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const sourceKey = `rate:pre-auth:${digest(source)}`;
  const keysToClean = [sourceKey];
  beforeAll(async () => {
    app = await createTestApp();
    // Supertest connects through loopback; only that explicitly trusted proxy
    // may supply this suite's isolated documentation-only source address.
    app.getHttpAdapter().getInstance().set('trust proxy', ['127.0.0.1', '::1']);
  });
  afterAll(async () => {
    if (app) {
      await app.get(RedisService).client.del(...keysToClean);
      await app.close();
    }
  });
  beforeEach(async () => { await app.get(RedisService).client.del(sourceKey); });

  it('records 401 and 403 attempts in an expiring source budget before blocking further work', async () => {
    const redis = app.get(RedisService).client;
    const driver = await actorFixture(app, 'DRIVER');
    await request(app.getHttpServer()).get('/api/v1/driver/me').set('X-Forwarded-For', source).expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/wallets').set('X-Forwarded-For', source)
      .auth(driver.accessToken, { type: 'bearer' }).expect(403);
    expect(await redis.get(sourceKey)).toBe('2');
    expect(await redis.ttl(sourceKey)).toBeGreaterThan(0);
    expect(await redis.ttl(sourceKey)).toBeLessThanOrEqual(60);
    await redis.set(sourceKey, PRE_AUTH_SOURCE_LIMIT, 'EX', 60);
    await request(app.getHttpServer()).get('/api/v1/driver/me').set('X-Forwarded-For', source)
      .expect(429).expect(({ body }) => expect(body.code).toBe('RATE_LIMITED'));
  });

  it('does not exhaust a second driver quota when the first reaches its limit behind the same BFF', async () => {
    const redis = app.get(RedisService).client;
    const first = await actorFixture(app, 'DRIVER');
    const second = await actorFixture(app, 'DRIVER');
    const firstKey = `rate:DriversController:me:${digest(`actor:${first.user.id}`)}`;
    const secondKey = `rate:DriversController:me:${digest(`actor:${second.user.id}`)}`;
    keysToClean.push(firstKey, secondKey);
    await redis.set(firstKey, 120, 'EX', 60);
    await request(app.getHttpServer()).get('/api/v1/driver/me').set('X-Forwarded-For', source)
      .auth(first.accessToken, { type: 'bearer' }).expect(429);
    await request(app.getHttpServer()).get('/api/v1/driver/me').set('X-Forwarded-For', source)
      .auth(second.accessToken, { type: 'bearer' }).expect(200);
    expect(await redis.get(firstKey)).toBe('121');
    expect(await redis.get(secondKey)).toBe('1');
    expect(await redis.get(sourceKey)).toBe('2');
  });
});
