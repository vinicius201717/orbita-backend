import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/infra/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { actorFixture, businessFixture, createTestApp, testPassword } from './helpers';
describe('frontend identity and account integration', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('requires authentication and projects only the current identity for every role', async () => {
    const api = request(app.getHttpServer());
    await api.get('/api/v1/auth/me').expect(401);
    for (const role of ['ADMIN', 'DRIVER', 'BUSINESS_OWNER'] as const) {
      const fixture = await actorFixture(app, role);
      const result = await api
        .get('/api/v1/auth/me')
        .auth(fixture.accessToken, { type: 'bearer' })
        .expect(200);
      expect(result.body).toMatchObject({
        id: fixture.user.id,
        role,
        businessId: null,
        driverId: fixture.actor.driverId,
      });
      expect(Object.keys(result.body).sort()).toEqual([
        'businessId',
        'driverId',
        'email',
        'id',
        'name',
        'phone',
        'role',
      ]);
    }
    const owner = await businessFixture(app);
    const staff = await actorFixture(app, 'BUSINESS_OWNER');
    await app
      .get(PrismaService)
      .user.update({
        where: { id: staff.user.id },
        data: { role: 'BUSINESS_STAFF', businessId: owner.business.id },
      });
    const response = await api.get('/api/v1/auth/me').auth(staff.accessToken, { type: 'bearer' }).expect(200);
    expect(response.body).toMatchObject({ role: 'BUSINESS_STAFF', businessId: owner.business.id });
    const changed = await api
      .patch('/api/v1/auth/me')
      .auth(staff.accessToken, { type: 'bearer' })
      .send({ name: 'Updated name', phone: '+5511999998877' })
      .expect(200);
    expect(changed.body.name).toBe('Updated name');
    await api
      .patch('/api/v1/auth/me')
      .auth(staff.accessToken, { type: 'bearer' })
      .send({ role: 'ADMIN' })
      .expect(400);
  });
  it('invalidates old access and refresh tokens after password change', async () => {
    const fixture = await actorFixture(app, 'DRIVER');
    const api = request(app.getHttpServer());
    await api
      .post('/api/v1/auth/change-password')
      .auth(fixture.accessToken, { type: 'bearer' })
      .send({ currentPassword: 'wrong-password', newPassword: 'new-test-password-2026' })
      .expect(400);
    await api
      .post('/api/v1/auth/change-password')
      .auth(fixture.accessToken, { type: 'bearer' })
      .send({ currentPassword: testPassword, newPassword: 'new-test-password-2026' })
      .expect(201);
    await api.get('/api/v1/auth/me').auth(fixture.accessToken, { type: 'bearer' }).expect(401);
    await expect(app.get(AuthService).refresh(fixture.refreshToken)).rejects.toThrow();
    const tokens = await app
      .get(AuthService)
      .login({ email: fixture.email, password: 'new-test-password-2026' });
    await api.get('/api/v1/auth/me').auth(tokens.accessToken, { type: 'bearer' }).expect(200);
  });
});
