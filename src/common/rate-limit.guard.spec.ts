import { Controller, Get, INestApplication, Type, CanActivate } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { Roles } from '../auth/auth.decorators';
import { configureApp } from '../bootstrap';
import { ConfigService } from '../config/config.service';
import { RedisService } from '../infra/redis.service';
import { DomainError } from './domain-error';
import { PRE_AUTH_SOURCE_LIMIT } from './rate-limit.guard';

@Controller('protected')
class ProtectedController {
  @Get() read() { return { ok: true }; }
  @Get('admin') @Roles('ADMIN') admin() { return { ok: true }; }
}

describe('HTTP authentication and rate limit pipeline', () => {
  let app: INestApplication;
  const counters = new Map<string, number>();
  const evalCounter = jest.fn(async (_script: string, _keys: number, key: string) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    return count;
  });
  const authenticate = jest.fn(async (token: string) => {
    if (!['one', 'two'].includes(token))
      throw new DomainError('UNAUTHORIZED', 'Invalid access token', 401);
    return { id: token, role: 'DRIVER', driverId: token, businessId: null };
  });

  beforeEach(async () => {
    counters.clear();
    // Use the production registration order: this test catches moving the
    // source guard behind authentication/authorization again.
    const guards = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) as
      { provide: string; useClass: Type<CanActivate> }[]).filter(({ provide }) => provide === APP_GUARD);
    const module = await Test.createTestingModule({
      controllers: [ProtectedController],
      providers: [
        ...guards,
        { provide: RedisService, useValue: { client: { eval: evalCounter } } },
        { provide: AuthService, useValue: { authenticate } },
        { provide: ConfigService, useValue: {
          get: (key: string) => key === 'TRUST_PROXY_CIDRS' ? '' : 'http://localhost:3001',
        } },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it.each([
    { token: undefined, path: '/api/v1/protected', status: 401 },
    { token: 'invalid', path: '/api/v1/protected', status: 401 },
    { token: 'one', path: '/api/v1/protected/admin', status: 403 },
  ])('limits rejected requests before more authentication work ($status, $token)', async ({ token, path, status }) => {
    const send = () => {
      const call = request(app.getHttpServer()).get(path);
      return token ? call.set('Authorization', `Bearer ${token}`) : call;
    };
    await send().expect(status);
    const sourceKey = [...counters.keys()].find((key) => key.startsWith('rate:pre-auth:'));
    if (!sourceKey) throw new Error('Source quota was not recorded before authentication');
    counters.set(sourceKey, PRE_AUTH_SOURCE_LIMIT);
    authenticate.mockClear();
    await send().expect(429).expect(({ body }) => expect(body.code).toBe('RATE_LIMITED'));
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('keeps distinct actor quotas behind the same BFF source', async () => {
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const actorKey = (id: string) => `rate:ProtectedController:read:${digest(`actor:${id}`)}`;
    counters.set(actorKey('one'), 119);
    counters.set(actorKey('two'), 119);
    for (const id of ['one', 'two'])
      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${id}`).expect(200);
    for (const id of ['one', 'two'])
      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${id}`).expect(429);
    const sourceCounts = [...counters].filter(([key]) => key.startsWith('rate:pre-auth:'));
    expect(sourceCounts).toHaveLength(1);
    expect(sourceCounts[0]?.[1]).toBe(4);
  });

  it('ignores spoofed forwarded addresses when the socket proxy is not trusted', async () => {
    for (const ip of ['198.51.100.1', '198.51.100.2'])
      await request(app.getHttpServer()).get('/api/v1/protected').set('X-Forwarded-For', ip).expect(401);
    const sourceCounts = [...counters].filter(([key]) => key.startsWith('rate:pre-auth:'));
    expect(sourceCounts).toHaveLength(1);
    expect(sourceCounts[0]?.[1]).toBe(2);
  });

  it('uses forwarded client addresses only through an explicitly trusted proxy', async () => {
    app.getHttpAdapter().getInstance().set('trust proxy', ['127.0.0.1', '::1']);
    for (const ip of ['198.51.100.1', '198.51.100.2'])
      await request(app.getHttpServer()).get('/api/v1/protected').set('X-Forwarded-For', ip).expect(401);
    expect([...counters.keys()].filter((key) => key.startsWith('rate:pre-auth:'))).toHaveLength(2);
  });

  it('fails closed before authentication if the source limiter is unavailable', async () => {
    evalCounter.mockRejectedValueOnce(new Error('Redis unavailable'));
    await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', 'Bearer one')
      .expect(503).expect(({ body }) => expect(body.code).toBe('RATE_LIMIT_UNAVAILABLE'));
    expect(authenticate).not.toHaveBeenCalled();
  });
});
