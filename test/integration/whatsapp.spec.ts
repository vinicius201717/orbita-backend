import { INestApplication } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { actorFixture, businessFixture, createTestApp } from './helpers';
import { PrismaService } from '../../src/infra/prisma.service';
import { WhatsAppService } from '../../src/whatsapp/whatsapp.service';
import { MessagingService } from '../../src/messaging/messaging.service';
import { MockMessagingProvider } from '../../src/messaging/mock-messaging.provider';
import { OffersService } from '../../src/offers/offers.service';
import { DeliveriesService } from '../../src/deliveries/deliveries.service';
describe('WhatsApp signed inbox and stateful commands', () => {
  let app: INestApplication;
  let db: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  function envelope(phone: string, text: string, id = randomUUID()) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ id, from: phone.replace(/^\+/, ''), type: 'text', text: { body: text } }],
              },
            },
          ],
        },
      ],
    };
  }
  async function send(body: unknown) {
    const raw = JSON.stringify(body);
    const signature =
      'sha256=' +
      createHmac('sha256', process.env.WHATSAPP_APP_SECRET ?? '')
        .update(raw)
        .digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw)
      .expect(200);
    await app.get(WhatsAppService).processPending();
  }
  async function verifiedIdentity(type: 'BUSINESS' | 'DRIVER') {
    const subject = type === 'BUSINESS' ? await businessFixture(app) : await actorFixture(app, 'DRIVER');
    const entityId = type === 'BUSINESS' ? subject.actor.businessId : subject.actor.driverId;
    const identity = await db.whatsAppIdentity.create({
      data: {
        entityType: type,
        entityId: entityId ?? '',
        phoneNumber: subject.phone,
        verifiedAt: new Date(),
        optInAt: new Date(),
      },
    });
    return { ...subject, identity };
  }
  async function expectSuppressed(id: string, recipient: string) {
    await app.get(MessagingService).dispatchPending();
    expect(app.get(MockMessagingProvider).sent.some((message) => message.to === recipient)).toBe(false);
    expect(await db.messageOutbox.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'FAILED',
      attempts: 10,
      lastErrorCode: 'MESSAGE_AUTHORIZATION_REVOKED',
      payload: '',
    });
  }
  it('rejects invalid signatures and malformed payloads', async () => {
    await request(app.getHttpServer()).post('/api/v1/webhooks/whatsapp').send({}).expect(401);
    const raw = '{}',
      signature =
        'sha256=' +
        createHmac('sha256', process.env.WHATSAPP_APP_SECRET ?? '')
          .update(raw)
          .digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw)
      .expect(400);
  });
  it('creates one delivery for a repeated business message and resumes the conversation', async () => {
    const business = await businessFixture(app);
    await db.whatsAppIdentity.create({
      data: {
        entityType: 'BUSINESS',
        entityId: business.business.id,
        phoneNumber: business.phone,
        verifiedAt: new Date(),
        optInAt: new Date(),
      },
    });
    for (const text of ['nova entrega', 'João', '-16.681,-49.251', 'Casa 12'])
      await send(envelope(business.phone, text));
    const id = randomUUID();
    const message = envelope(business.phone, '2 X-Burgers e Coca', id);
    await Promise.all([send(message), send(message)]);
    expect(await db.whatsAppInbox.count({ where: { externalMessageId: id } })).toBe(1);
    expect(await db.delivery.count({ where: { businessId: business.business.id } })).toBe(1);
    const delivery = await db.delivery.findFirstOrThrow({ where: { businessId: business.business.id } });
    expect(delivery.status).toBe('WAITING_POOL');
    expect(delivery.readinessStatus).toBe('PREPARING');
    await send(envelope(business.phone, `pronto ${delivery.id}`));
    expect((await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).readinessStatus).toBe(
      'READY_FOR_PICKUP',
    );
    await app.get(MessagingService).dispatchPending();
    expect(
      app
        .get(MockMessagingProvider)
        .sent.some((m) => m.to === business.phone && m.payload.text.includes('Entrega registrada')),
    ).toBe(true);
  });
  it('ignores unverified senders and recognizes a verified driver', async () => {
    const unknownId = randomUUID();
    await send(envelope('+5562000000000', 'nova entrega', unknownId));
    expect(
      (await db.whatsAppInbox.findUniqueOrThrow({ where: { externalMessageId: unknownId } })).errorCode,
    ).toBe('UNKNOWN_OR_UNVERIFIED_IDENTITY');
    const driver = await actorFixture(app, 'DRIVER');
    await db.whatsAppIdentity.create({
      data: {
        entityType: 'DRIVER',
        entityId: driver.actor.driverId ?? '',
        phoneNumber: driver.phone,
        verifiedAt: new Date(),
        optInAt: new Date(),
      },
    });
    await send(envelope(driver.phone, 'saldo'));
    await app.get(MessagingService).dispatchPending();
    expect(
      app
        .get(MockMessagingProvider)
        .sent.some((m) => m.to === driver.phone && m.payload.text.includes('Saldo contábil')),
    ).toBe(true);
  });
  it('routes ACCEPT and REJECT button IDs through the authenticated driver', async () => {
    const driver = await actorFixture(app, 'DRIVER');
    await db.whatsAppIdentity.create({
      data: {
        entityType: 'DRIVER',
        entityId: driver.actor.driverId ?? '',
        phoneNumber: driver.phone,
        verifiedAt: new Date(),
        optInAt: new Date(),
      },
    });
    const id = randomUUID(),
      offers = app.get(OffersService);
    const accept = jest
      .spyOn(offers, 'accept')
      .mockResolvedValue({ id, routeId: randomUUID(), status: 'ACCEPTED' });
    const reject = jest.spyOn(offers, 'reject').mockResolvedValue({ id, changed: true });
    try {
      for (const action of ['ACCEPT', 'REJECT'])
        await send({
          object: 'whatsapp_business_account',
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        id: randomUUID(),
                        from: driver.phone.slice(1),
                        type: 'interactive',
                        interactive: {
                          button_reply: { id: `${action}:${id}`, title: 'Do not trust display text' },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });
      expect(accept).toHaveBeenCalledWith(driver.actor, id);
      expect(reject).toHaveBeenCalledWith(driver.actor, id);
    } finally {
      accept.mockRestore();
      reject.mockRestore();
    }
  });
  it.each([
    ['BUSINESS', 'deleted'],
    ['DRIVER', 'deleted'],
    ['BUSINESS', 'disabled'],
    ['DRIVER', 'disabled'],
  ] as const)('blocks incoming and queued messages for a %s account that is %s', async (type, state) => {
    const subject = await verifiedIdentity(type);
    const queued = await app
      .get(MessagingService)
      .enqueue(subject.identity, { kind: 'text', text: 'Private balance' }, `test:${randomUUID()}`);
    await db.user.update({
      where: { id: subject.user.id },
      data: state === 'deleted' ? { deletedAt: new Date() } : { active: false },
    });
    const messageId = randomUUID();
    await send(envelope(subject.phone, 'saldo', messageId));
    expect(
      (await db.whatsAppInbox.findUniqueOrThrow({ where: { externalMessageId: messageId } })).errorCode,
    ).toBe('UNKNOWN_OR_UNVERIFIED_IDENTITY');
    await expectSuppressed(queued.id, subject.phone);
  });
  it.each(['BUSINESS', 'DRIVER'] as const)(
    'rejects a stale %s phone association even when the identity is still marked verified',
    async (type) => {
      const subject = await verifiedIdentity(type);
      const queued = await app
        .get(MessagingService)
        .enqueue(subject.identity, { kind: 'text', text: 'Private operation' }, `test:${randomUUID()}`);
      const phone = '+5562' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      if (type === 'BUSINESS')
        await db.business.update({ where: { id: subject.identity.entityId }, data: { phone } });
      else await db.driver.update({ where: { id: subject.identity.entityId }, data: { phone } });
      const messageId = randomUUID();
      await send(envelope(subject.phone, 'saldo', messageId));
      expect(
        (await db.whatsAppInbox.findUniqueOrThrow({ where: { externalMessageId: messageId } })).errorCode,
      ).toBe('UNKNOWN_OR_UNVERIFIED_IDENTITY');
      await expectSuppressed(queued.id, subject.phone);
    },
  );
  it('does not deliver old operational content after consent revocation or reassignment of a phone', async () => {
    const subject = await verifiedIdentity('BUSINESS');
    const messaging = app.get(MessagingService);
    const revoked = await messaging.enqueue(
      subject.identity,
      { kind: 'text', text: 'Private balance before revocation' },
      `test:${randomUUID()}`,
    );
    await db.whatsAppIdentity.update({ where: { id: subject.identity.id }, data: { optInAt: null } });
    await expectSuppressed(revoked.id, subject.phone);
    await db.whatsAppIdentity.update({ where: { id: subject.identity.id }, data: { optInAt: new Date() } });
    const reassigned = await messaging.enqueue(
      subject.identity,
      { kind: 'text', text: 'Private balance from the previous business' },
      `test:${randomUUID()}`,
    );
    const next = await businessFixture(app);
    await db.business.update({
      where: { id: subject.identity.entityId },
      data: { phone: '+5599' + subject.phone.slice(5) },
    });
    await db.business.update({ where: { id: next.business.id }, data: { phone: subject.phone } });
    await db.whatsAppIdentity.update({
      where: { id: subject.identity.id },
      data: { entityId: next.business.id },
    });
    await expectSuppressed(reassigned.id, subject.phone);
  });
  it('uses the delivery customer consent independently of an operational WhatsApp identity', async () => {
    const business = await businessFixture(app);
    const phone = '+5562' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    await db.whatsAppIdentity.create({
      data: { entityType: 'BUSINESS', entityId: business.business.id, phoneNumber: phone },
    });
    const create = () =>
      app.get(DeliveriesService).create(business.actor, {
        branchId: business.branch.id,
        customer: { name: 'Customer with independent consent', phone, optIn: true },
        dropoff: { latitude: -16.681, longitude: -49.251 },
        items: [{ name: 'Lunch', quantity: 1 }],
      });
    const delivery = await create();
    await app.get(MessagingService).dispatchPending();
    expect(
      await db.messageOutbox.findUniqueOrThrow({
        where: { idempotencyKey: `delivery-pin:${delivery.id}` },
      }),
    ).toMatchObject({ status: 'SENT' });
    const sent = app.get(MockMessagingProvider).sent.filter((message) => message.to === phone).length;
    const revoked = await create();
    await db.delivery.update({ where: { id: revoked.id }, data: { customerOptInAt: null } });
    await app.get(MessagingService).dispatchPending();
    expect(app.get(MockMessagingProvider).sent.filter((message) => message.to === phone)).toHaveLength(sent);
    expect(
      await db.messageOutbox.findUniqueOrThrow({
        where: { idempotencyKey: `delivery-pin:${revoked.id}` },
      }),
    ).toMatchObject({ status: 'FAILED', lastErrorCode: 'MESSAGE_AUTHORIZATION_REVOKED' });
  });
});
