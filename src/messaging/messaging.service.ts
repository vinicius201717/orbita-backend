import { Injectable } from '@nestjs/common';
import { OutboxEvent, Prisma, WhatsAppIdentity } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { MessagingProvider, MessagePayload, messageSchema } from './messaging.provider';
const operationalAuthorization = z.object({
  authorization: z.object({
    identityId: z.string().uuid(),
    entityType: z.enum(['BUSINESS', 'DRIVER']),
    entityId: z.string().uuid(),
  }),
});
@Injectable()
export class MessagingService {
  constructor(
    private readonly db: PrismaService,
    private readonly crypto: CryptoService,
    private readonly provider: MessagingProvider,
  ) {}
  enqueue(
    identity: Pick<WhatsAppIdentity, 'id' | 'phoneNumber' | 'entityType' | 'entityId'>,
    payload: MessagePayload,
    key: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    return tx.messageOutbox.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: {
        idempotencyKey: key,
        recipient: identity.phoneNumber,
        payload: this.crypto.encrypt({
          ...payload,
          authorization: {
            identityId: identity.id,
            entityType: identity.entityType,
            entityId: identity.entityId,
          },
        }),
      },
    });
  }
  private async authorizeRecipient(recipient: string, key: string, decoded: unknown) {
    const customerPin = /^delivery-pin:([a-f0-9-]{36})$/i.exec(key);
    if (customerPin) {
      // Customer permission belongs to this delivery, independently of any operational identity.
      const delivery = await this.db.delivery.findFirst({
        where: {
          id: customerPin[1],
          customerPhone: recipient,
          customerOptInAt: { not: null },
          confirmationExpiresAt: { gt: new Date() },
          status: { notIn: ['CANCELLED', 'DELIVERED', 'RETURN_REQUIRED', 'RETURNING', 'RETURNED'] },
        },
        select: { id: true },
      });
      return { allowed: !!delivery, withinWindow: false };
    }
    const parsed = operationalAuthorization.safeParse(decoded);
    if (!parsed.success) return { allowed: false, withinWindow: false };
    const binding = parsed.data.authorization;
    const identity = await this.db.whatsAppIdentity.findUnique({ where: { id: binding.identityId } });
    if (
      !identity?.verifiedAt ||
      !identity.optInAt ||
      identity.phoneNumber !== recipient ||
      identity.entityType !== binding.entityType ||
      identity.entityId !== binding.entityId
    )
      return { allowed: false, withinWindow: false };
    const eligible =
      identity.entityType === 'BUSINESS'
        ? await this.db.business.findFirst({
            where: {
              id: identity.entityId,
              phone: recipient,
              active: true,
              users: { some: { role: 'BUSINESS_OWNER', active: true, deletedAt: null } },
            },
            select: { id: true },
          })
        : await this.db.driver.findFirst({
            where: {
              id: identity.entityId,
              phone: recipient,
              user: { role: 'DRIVER', active: true, deletedAt: null },
            },
            select: { id: true },
          });
    return {
      allowed: !!eligible,
      withinWindow: !!identity.lastInboundAt && Date.now() - identity.lastInboundAt.getTime() < 86400000,
    };
  }
  async dispatchPending() {
    const rows = await this.db.messageOutbox.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() }, attempts: { lt: 10 } },
          { status: 'SENDING', leaseUntil: { lt: new Date() }, attempts: { lt: 10 } },
        ],
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    for (const row of rows) {
      const lease = new Date(Date.now() + 30000);
      const claimed = await this.db.messageOutbox.updateMany({
        where: { id: row.id, status: row.status, attempts: row.attempts },
        data: { status: 'SENDING', leaseUntil: lease, attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        const decoded = this.crypto.decrypt(row.payload);
        const authorization = await this.authorizeRecipient(row.recipient, row.idempotencyKey, decoded);
        if (!authorization.allowed) {
          await this.db.messageOutbox.updateMany({
            where: { id: row.id, leaseUntil: lease },
            data: {
              status: 'FAILED',
              attempts: 10,
              leaseUntil: null,
              lastErrorCode: 'MESSAGE_AUTHORIZATION_REVOKED',
              payload: '',
            },
          });
          continue;
        }
        const providerMessageId = await this.provider.send(
          row.recipient,
          messageSchema.parse(decoded),
          authorization.withinWindow,
        );
        await this.db.messageOutbox.updateMany({
          where: { id: row.id, leaseUntil: lease },
          data: {
            status: 'SENT',
            providerMessageId,
            sentAt: new Date(),
            leaseUntil: null,
            lastErrorCode: null,
            payload: '',
          },
        });
      } catch (error) {
        await this.db.messageOutbox.updateMany({
          where: { id: row.id, leaseUntil: lease },
          data: {
            status: 'FAILED',
            leaseUntil: null,
            lastErrorCode:
              error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
                ? error.message
                : 'PROVIDER_SEND_FAILED',
            nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** (row.attempts + 1))),
          },
        });
      }
    }
    return rows.length;
  }
  async handleDomainEvent(event: OutboxEvent) {
    const payload = event.payload as Record<string, Prisma.JsonValue>;
    if (event.type === 'RouteOfferCreated') {
      const offer = await this.db.routeOffer.findUnique({
        where: { id: event.aggregateId },
        include: { deliveries: true },
      });
      if (!offer || offer.status !== 'PENDING' || offer.expiresAt <= new Date()) return;
      const identity = await this.db.whatsAppIdentity.findFirst({
        where: {
          entityType: 'DRIVER',
          entityId: offer.driverId,
          verifiedAt: { not: null },
          optInAt: { not: null },
        },
      });
      if (!identity) return;
      const text = `🛵 Nova oportunidade ORBITA\n+${offer.deliveries.length} entregas\n+${(offer.additionalDistanceMeters / 1000).toFixed(1)} km / ~${Math.ceil(offer.additionalDurationSeconds / 60)} min\nR$ ${(offer.offeredPayoutCents / 100).toFixed(2)}\nACEITAR ${offer.id} ou RECUSAR ${offer.id}`;
      await this.enqueue(
        identity,
        {
          kind: 'buttons',
          text,
          buttons: [
            { id: `ACCEPT:${offer.id}`, title: 'ACEITAR' },
            { id: `REJECT:${offer.id}`, title: 'RECUSAR' },
          ],
        },
        `event:${event.id}`,
      );
    } else if (event.type === 'RouteOfferAccepted') {
      const id = typeof payload.driverId === 'string' ? payload.driverId : null;
      if (id) {
        const identity = await this.db.whatsAppIdentity.findFirst({
          where: { entityType: 'DRIVER', entityId: id, verifiedAt: { not: null }, optInAt: { not: null } },
        });
        if (identity)
          await this.enqueue(
            identity,
            {
              kind: 'text',
              text: `✅ Oferta aceita. Rota ${String(payload.routeId)} atualizada. Consulte a sequência no companion.`,
            },
            `event:${event.id}:driver`,
          );
      }
      const ids = Array.isArray(payload.deliveryIds)
        ? payload.deliveryIds.filter((v): v is string => typeof v === 'string')
        : [];
      const deliveries = await this.db.delivery.findMany({
        where: { id: { in: ids } },
        select: { businessId: true },
      });
      for (const businessId of [...new Set(deliveries.map((d) => d.businessId))]) {
        const identity = await this.db.whatsAppIdentity.findFirst({
          where: {
            entityType: 'BUSINESS',
            entityId: businessId,
            verifiedAt: { not: null },
            optInAt: { not: null },
          },
        });
        if (identity)
          await this.enqueue(
            identity,
            {
              kind: 'text',
              text: `✅ ${deliveries.filter((d) => d.businessId === businessId).length} entrega(s) distribuída(s).`,
            },
            `event:${event.id}:business:${businessId}`,
          );
      }
    } else if (
      ['DeliveryDelivered', 'DeliveryCancelled', 'DeliveryPickedUp'].includes(event.type) &&
      typeof payload.businessId === 'string'
    ) {
      const identity = await this.db.whatsAppIdentity.findFirst({
        where: {
          entityType: 'BUSINESS',
          entityId: payload.businessId,
          verifiedAt: { not: null },
          optInAt: { not: null },
        },
      });
      if (identity)
        await this.enqueue(
          identity,
          {
            kind: 'text',
            text: `Entrega ${event.aggregateId}: ${event.type === 'DeliveryDelivered' ? 'concluída' : event.type === 'DeliveryPickedUp' ? 'coletada' : 'cancelamento/reatribuição registrado'}.`,
          },
          `event:${event.id}`,
        );
    }
  }
}
