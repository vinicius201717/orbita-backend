import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { actorFixture, businessFixture, createTestApp, testPassword } from './helpers';
import { PrismaService } from '../../src/infra/prisma.service';
import { AuthService } from '../../src/auth/auth.service';

describe('frontend operational alignment contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('scopes route and branch operations and exposes self WhatsApp consent', async () => {
    const owner = await businessFixture(app);
    const driver = await actorFixture(app, 'DRIVER');
    const staff = await actorFixture(app, 'BUSINESS_OWNER');
    await app
      .get(PrismaService)
      .user.update({
        where: { id: staff.user.id },
        data: { role: 'BUSINESS_STAFF', businessId: owner.business.id },
      });
    const staffTokens = await app.get(AuthService).login({ email: staff.email, password: testPassword });
    const api = request(app.getHttpServer());

    await api
      .get('/api/v1/routes')
      .auth(owner.accessToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(expect.any(Array));
        expect(body).toHaveProperty('nextCursor');
      });
    await api.get('/api/v1/routes').auth(driver.accessToken, { type: 'bearer' }).expect(200);
    await api
      .patch(`/api/v1/businesses/${owner.business.id}/branches/${owner.branch.id}`)
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ name: 'Central atualizada' })
      .expect(200);
    await api
      .patch(`/api/v1/businesses/${owner.business.id}/branches/${owner.branch.id}`)
      .auth(staffTokens.accessToken, { type: 'bearer' })
      .send({ name: 'Não autorizado' })
      .expect(403);
    await api
      .patch(`/api/v1/businesses/${owner.business.id}/branches/${owner.branch.id}`)
      .auth(driver.accessToken, { type: 'bearer' })
      .send({ name: 'Não autorizado' })
      .expect(403);

    const ownerStatus = await api
      .get('/api/v1/whatsapp/me')
      .auth(owner.accessToken, { type: 'bearer' })
      .expect(200);
    expect(ownerStatus.body).toMatchObject({
      entityType: 'BUSINESS',
      entityId: owner.business.id,
      phoneNumber: owner.phone,
      optInAt: null,
    });
    await api
      .post('/api/v1/whatsapp/me/consent')
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ granted: true })
      .expect(201);
    await api
      .get('/api/v1/whatsapp/me')
      .auth(staffTokens.accessToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => expect(body.optInAt).toEqual(expect.any(String)));
    await api
      .post('/api/v1/whatsapp/me/consent')
      .auth(staffTokens.accessToken, { type: 'bearer' })
      .send({ granted: false })
      .expect(403);
    await api
      .post('/api/v1/whatsapp/me/consent')
      .auth(driver.accessToken, { type: 'bearer' })
      .send({ granted: true })
      .expect(201);
  });

  it('gives administrators dedicated driver and wallet projections', async () => {
    const driver = await actorFixture(app, 'DRIVER');
    const admin = await actorFixture(app, 'ADMIN');
    const api = request(app.getHttpServer());
    const detail = await api
      .get(`/api/v1/admin/drivers/${driver.actor.driverId}`)
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(200);
    expect(detail.body).toMatchObject({
      id: driver.actor.driverId,
      user: { id: driver.user.id, email: driver.email },
    });
    expect(detail.body.vehicles).toEqual(expect.any(Array));
    await api
      .get(`/api/v1/admin/drivers/${driver.actor.driverId}`)
      .auth(driver.accessToken, { type: 'bearer' })
      .expect(403);
    const wallets = await api
      .get('/api/v1/admin/wallets')
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(200);
    expect(wallets.body.items).toEqual(expect.any(Array));
    expect(wallets.body).toHaveProperty('nextCursor');
    await api.get('/api/v1/admin/wallets').auth(driver.accessToken, { type: 'bearer' }).expect(403);
  });
});
