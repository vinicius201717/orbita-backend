import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../src/infra/prisma.service';
import { actorFixture, businessFixture, createTestApp } from './helpers';

describe('merchant catalog and dispatch', () => {
  let app: INestApplication;
  let db: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  async function fixture() {
    const owner = await businessFixture(app);
    const api = request(app.getHttpServer());
    const product = (
      await api
        .post('/api/v1/business/products')
        .auth(owner.accessToken, { type: 'bearer' })
        .send({ name: 'X-bacon', category: 'Lanches', priceCents: 2490, description: 'Pão e queijo' })
        .expect(201)
    ).body as { id: string };
    const input = {
      branchId: owner.branch.id,
      customer: { name: 'Cliente da loja', phone: '+5562999998877' },
      address: 'Rua 9, 120, Goiânia, GO',
      dropoff: { latitude: -16.681, longitude: -49.251, complement: 'Apto 21' },
      items: [{ productId: product.id, quantity: 2 }],
      preparationMinutes: 15,
      notes: 'Sem cebola',
    };
    const create = (body: unknown = input, key = randomUUID()) =>
      api
        .post('/api/v1/business/orders')
        .auth(owner.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body as object);
    return { owner, api, product, input, create };
  }

  it('creates server-priced snapshots and one real delivery, ready and cancellation follow delivery state', async () => {
    const { owner, api, product, create } = await fixture();
    const { body: order } = await create().expect(201);
    expect(order.totalCents).toBe(4980);
    expect(order.items).toEqual([
      { productId: product.id, name: 'X-bacon', quantity: 2, unitPriceCents: 2490, totalCents: 4980 },
    ]);
    expect(order.delivery.businessId).toBe(owner.business.id);
    expect(order.delivery.complement).toContain('Rua 9, 120');
    expect(order.delivery.complement).toContain('Apto 21');
    expect(order.delivery).not.toHaveProperty('verificationCodeHash');
    expect(order).not.toHaveProperty('requestHash');
    await api
      .patch(`/api/v1/business/products/${product.id}`)
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ name: 'Novo nome', priceCents: 9990 })
      .expect(200);
    const saved = await api
      .get(`/api/v1/business/orders/${order.id}`)
      .auth(owner.accessToken, { type: 'bearer' })
      .expect(200);
    expect(saved.body.items[0].name).toBe('X-bacon');
    expect(saved.body.totalCents).toBe(4980);
    const summary = () =>
      api.get('/api/v1/business/orders/summary').auth(owner.accessToken, { type: 'bearer' }).expect(200);
    expect((await summary()).body).toMatchObject({
      preparing: 1,
      ready: 0,
      salesTodayCents: 4980,
      productCount: 1,
    });
    await api
      .post(`/api/v1/deliveries/${order.delivery.id}/ready`)
      .auth(owner.accessToken, { type: 'bearer' })
      .expect(201);
    expect((await summary()).body).toMatchObject({ preparing: 0, ready: 1 });
    expect(
      (await api.get('/api/v1/business/orders?stage=preparing').auth(owner.accessToken, { type: 'bearer' }))
        .body.items,
    ).toHaveLength(0);
    expect(
      (
        await api
          .get('/api/v1/business/orders?stage=ready&search=Cliente')
          .auth(owner.accessToken, { type: 'bearer' })
      ).body.items,
    ).toHaveLength(1);
    await api
      .post(`/api/v1/deliveries/${order.delivery.id}/cancel`)
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ reason: 'Cliente desistiu' })
      .expect(201);
    expect((await summary()).body).toMatchObject({ ready: 0, salesTodayCents: 0, cancelledToday: 1 });
  });

  it('replays concurrent requests once and rejects a key reused with different contents', async () => {
    const { owner, input, create } = await fixture();
    const key = randomUUID();
    const responses = await Promise.all([create(input, key), create(input, key)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(await db.delivery.count({ where: { businessId: owner.business.id } })).toBe(1);
    expect(await db.merchantOrder.count({ where: { businessId: owner.business.id } })).toBe(1);
    await create({ ...input, notes: 'Conteúdo diferente' }, key).expect(409);
    const replay = await create(
      { ...input, items: [{ quantity: 2, productId: input.items[0]?.productId }] },
      key,
    ).expect(201);
    expect(replay.body.id).toBe(responses[0].body.id);
  });

  it('isolates products, orders, pagination, branches and prices between establishments', async () => {
    const { owner, api, product, input, create } = await fixture();
    const other = await businessFixture(app);
    const { body: order } = await create().expect(201);
    const asOther = (path: string) => api.get(path).auth(other.accessToken, { type: 'bearer' });
    expect((await asOther('/api/v1/business/products').expect(200)).body).toHaveLength(0);
    expect((await asOther('/api/v1/business/orders').expect(200)).body.items).toHaveLength(0);
    await asOther(`/api/v1/business/orders/${order.id}`).expect(404);
    await asOther(`/api/v1/business/orders?cursor=${order.id}`).expect(400);
    await api
      .patch(`/api/v1/business/products/${product.id}`)
      .auth(other.accessToken, { type: 'bearer' })
      .send({ priceCents: 1 })
      .expect(404);
    await api
      .post('/api/v1/business/orders')
      .auth(other.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, branchId: other.branch.id })
      .expect(409);
    await create({ ...input, branchId: other.branch.id }).expect(404);
    expect(await db.delivery.count({ where: { businessId: owner.business.id } })).toBe(1);
    expect(await db.delivery.count({ where: { businessId: other.business.id } })).toBe(0);
  });

  it('rejects unavailable products, injected prices and invalid quantities without creating deliveries', async () => {
    const { owner, api, product, input, create } = await fixture();
    await create({ ...input, items: [{ productId: product.id, quantity: 1, unitPriceCents: 1 }] }).expect(
      400,
    );
    await create({ ...input, items: [{ productId: product.id, quantity: -1 }] }).expect(400);
    await create({ ...input, items: [input.items[0], input.items[0]] }).expect(400);
    await api
      .patch(`/api/v1/business/products/${product.id}`)
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ available: false })
      .expect(200);
    await create().expect(409);
    expect(await db.delivery.count({ where: { businessId: owner.business.id } })).toBe(0);
    expect(await db.merchantOrder.count({ where: { businessId: owner.business.id } })).toBe(0);
    await api
      .patch(`/api/v1/business/products/${product.id}`)
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ available: true })
      .expect(200);
    const { body } = await create({ ...input, preparationMinutes: 0 }).expect(201);
    expect(body.delivery.readinessStatus).toBe('READY_FOR_PICKUP');
  });

  it('requires authenticated merchant access and a retry key, and never returns a fake geocoded destination', async () => {
    const { owner, api, input } = await fixture();
    await api.get('/api/v1/business/products').expect(401);
    const driver = await actorFixture(app, 'DRIVER');
    await api.get('/api/v1/business/products').auth(driver.accessToken, { type: 'bearer' }).expect(403);
    await api
      .post('/api/v1/business/orders')
      .auth(owner.accessToken, { type: 'bearer' })
      .send(input)
      .expect(400);
    const response = await api
      .post('/api/v1/business/addresses/search')
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ address: input.address })
      .expect(503);
    expect(response.body.code).toBe('ADDRESS_SEARCH_UNAVAILABLE');
    expect(response.body).not.toHaveProperty('items');
  });

  it('paginates newest orders consistently and applies filters before pagination', async () => {
    const { owner, api, input, create } = await fixture();
    const older = await create({ ...input, customer: { name: 'Ana' } }).expect(201);
    const newer = await create({ ...input, customer: { name: 'Beatriz' }, preparationMinutes: 0 }).expect(
      201,
    );
    const list = (query: string) =>
      api.get(`/api/v1/business/orders?${query}`).auth(owner.accessToken, { type: 'bearer' }).expect(200);
    const first = await list('limit=1');
    expect(first.body.items[0].id).toBe(newer.body.id);
    const second = await list(`limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body.items[0].id).toBe(older.body.id);
    expect(second.body.nextCursor).toBeNull();
    expect((await list('stage=preparing&limit=1')).body.items[0].id).toBe(older.body.id);
    expect((await list('search=BEATRIZ')).body.items[0].id).toBe(newer.body.id);
  });

  it('finds formatted phone numbers without changing customer name searches', async () => {
    const { owner, api, input, create } = await fixture();
    const phoneMatch = await create().expect(201);
    const nameMatch = await create({
      ...input,
      customer: { name: 'Mesa 62', phone: '+5562988881234' },
    }).expect(201);
    const search = async (value: string) => {
      const response = await api
        .get('/api/v1/business/orders')
        .query({ search: value })
        .auth(owner.accessToken, { type: 'bearer' })
        .expect(200);
      return (response.body.items as Array<{ id: string }>).map((order) => order.id);
    };
    expect(await search('(62) 99999-8877')).toEqual([phoneMatch.body.id]);
    expect(await search('+55 (62) 99999-8877')).toEqual([phoneMatch.body.id]);
    expect(await search('99999-8877')).toEqual([phoneMatch.body.id]);
    expect(await search('mEsA 62')).toEqual([nameMatch.body.id]);
    expect(await search('(62) 99999-0000')).toEqual([]);
  });
});
