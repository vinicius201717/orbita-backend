import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma, WhatsAppIdentity } from '@prisma/client';
import { z } from 'zod';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../infra/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { Actor } from '../common/actor';
import { MessagingService } from '../messaging/messaging.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { CreateDeliveryDto } from '../deliveries/deliveries.dto';
import { OffersService } from '../offers/offers.service';
import { FinanceService } from '../finance/finance.service';
import { CancellationService } from '../incidents/cancellation.service';
import { IncomingMessage, incomingSchema, webhookSchema } from './webhook.dto';
const contextSchema = z.object({
  branchId: z.string().uuid().optional(),
  name: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  complement: z.string().optional(),
});
@Injectable()
export class WhatsAppService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
    private readonly crypto: CryptoService,
    private readonly messaging: MessagingService,
    private readonly deliveries: DeliveriesService,
    private readonly offers: OffersService,
    private readonly finance: FinanceService,
    private readonly cancellations: CancellationService,
  ) {}
  verifySignature(raw: Buffer, signature: string | undefined) {
    const secret = this.config.get('WHATSAPP_APP_SECRET');
    if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = createHmac('sha256', secret).update(raw).digest();
    const received = Buffer.from(signature.slice(7), 'hex');
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
  challenge(mode: unknown, token: unknown, challenge: unknown) {
    if (
      mode !== 'subscribe' ||
      typeof token !== 'string' ||
      typeof challenge !== 'string' ||
      !this.config.get('WHATSAPP_VERIFY_TOKEN') ||
      token !== this.config.get('WHATSAPP_VERIFY_TOKEN')
    )
      throw new DomainError('WEBHOOK_FORBIDDEN', 'Invalid verification token', 403);
    return challenge;
  }
  async receive(raw: Buffer, signature: string | undefined, body: unknown) {
    if (!this.verifySignature(raw, signature))
      throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature', 401);
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) throw new DomainError('WEBHOOK_PAYLOAD_INVALID', 'Invalid WhatsApp payload', 400);
    for (const entry of parsed.data.entry)
      for (const change of entry.changes) {
        if (
          this.config.get('WHATSAPP_ENABLED') &&
          change.value.metadata?.phone_number_id !== this.config.get('WHATSAPP_PHONE_NUMBER_ID')
        )
          throw new DomainError('WEBHOOK_ORIGIN_INVALID', 'Wrong receiving phone identity', 403);
        for (const message of change.value.messages ?? [])
          await this.db.whatsAppInbox.createMany({
            skipDuplicates: true,
            data: [
              {
                externalMessageId: message.id,
                sender: `+${message.from}`,
                payload: this.crypto.encrypt(message),
              },
            ],
          });
      }
    return { received: true };
  }
  private async actor(identity: WhatsAppIdentity): Promise<Actor | null> {
    if (!identity.verifiedAt || !identity.optInAt) return null;
    if (identity.entityType === 'BUSINESS') {
      const user = await this.db.user.findFirst({
        where: {
          businessId: identity.entityId,
          role: 'BUSINESS_OWNER',
          active: true,
          deletedAt: null,
          business: { phone: identity.phoneNumber, active: true },
        },
      });
      return user ? { id: user.id, role: user.role, businessId: user.businessId, driverId: null } : null;
    }
    if (identity.entityType === 'DRIVER') {
      const driver = await this.db.driver.findUnique({
        where: { id: identity.entityId },
        include: { user: true },
      });
      return driver?.user.active &&
        !driver.user.deletedAt &&
        driver.phone === identity.phoneNumber &&
        driver.user.role === 'DRIVER'
        ? { id: driver.user.id, role: 'DRIVER', businessId: null, driverId: driver.id }
        : null;
    }
    return null;
  }
  async processPending() {
    const rows = await this.db.whatsAppInbox.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 8 } },
      take: 50,
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      try {
        await this.db.transaction(async (tx) => {
          await lockEntities(tx, [`whatsapp:${row.sender}`]);
          const current = await tx.whatsAppInbox.findUniqueOrThrow({ where: { id: row.id } });
          if (current.status === 'PROCESSED') return;
          const first = await tx.whatsAppInbox.findFirst({
            where: { sender: row.sender, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 8 } },
            orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
            select: { id: true },
          });
          if (first?.id !== row.id) return;
          const identity = await tx.whatsAppIdentity.findUnique({ where: { phoneNumber: row.sender } });
          const actor = identity ? await this.actor(identity) : null;
          if (identity && actor) {
            await tx.whatsAppIdentity.update({
              where: { id: identity.id },
              data: { lastInboundAt: new Date() },
            });
            const message = incomingSchema.parse(this.crypto.decrypt(current.payload));
            let reply: string;
            try {
              reply = await this.command(tx, identity, actor, message, row.id);
            } catch (error) {
              if (!(error instanceof DomainError) || error.getStatus() >= 500) throw error;
              reply = (error.getResponse() as { message: string }).message;
            }
            await this.messaging.enqueue(
              identity,
              { kind: 'text', text: reply },
              `inbox:${row.id}:reply`,
              tx,
            );
          }
          await tx.whatsAppInbox.update({
            where: { id: row.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
              payload: '',
              attempts: { increment: 1 },
              errorCode: identity && actor ? null : 'UNKNOWN_OR_UNVERIFIED_IDENTITY',
            },
          });
        });
      } catch {
        await this.db.whatsAppInbox.updateMany({
          where: { id: row.id, status: { not: 'PROCESSED' } },
          data: { status: 'FAILED', attempts: { increment: 1 }, errorCode: 'COMMAND_RETRY_REQUIRED' },
        });
      }
    }
    return rows.length;
  }
  private async command(
    tx: Prisma.TransactionClient,
    identity: WhatsAppIdentity,
    actor: Actor,
    message: IncomingMessage,
    messageId: string,
  ): Promise<string> {
    const text = message.text?.body.trim() ?? '';
    const lower = text.toLocaleLowerCase('pt-BR');
    const button = message.interactive?.button_reply?.id ?? message.button?.payload;
    const action =
      /^(ACCEPT|REJECT):([a-f0-9-]{36})$/i.exec(button ?? '') ??
      /^(aceitar|recusar) ([a-f0-9-]{36})$/i.exec(text);
    if (action) {
      if (actor.role !== 'DRIVER')
        throw new DomainError('DRIVER_REQUIRED', 'Comando exclusivo de entregador', 403);
      const id = action[2] ?? '';
      if (['accept', 'aceitar'].includes((action[1] ?? '').toLowerCase())) {
        await this.offers.accept(actor, id);
        return '✅ Oferta aceita. A sequência está disponível no companion.';
      }
      await this.offers.reject(actor, id);
      return 'Oferta recusada.';
    }
    if (lower === 'suporte')
      return 'Sua mensagem foi registrada. Use os canais de suporte informados pela sua operação ORBITA.';
    if (lower === 'saldo') {
      const result =
        actor.role === 'DRIVER' ? await this.finance.wallet(actor) : await this.finance.billing(actor);
      return `Saldo contábil: R$ ${(result.balanceCents / 100).toFixed(2)}. Pagamentos reais não são enviados neste MVP.`;
    }
    if (actor.role === 'DRIVER')
      return 'Comandos: saldo, suporte, ACEITAR <id>, RECUSAR <id>. GPS e navegação usam o companion.';
    if (lower === 'pedidos') {
      const result = await this.deliveries.list(actor, { limit: 10 });
      return JSON.stringify(result).slice(0, 3500);
    }
    const ready = /^pronto ([a-f0-9-]{36})$/i.exec(text);
    if (ready?.[1]) {
      await this.deliveries.ready(actor, ready[1]);
      return '✅ Pedido pronto para coleta.';
    }
    const cancel = /^cancelar ([a-f0-9-]{36})(?: (.+))?$/i.exec(text);
    if (cancel?.[1]) {
      await this.cancellations.cancel(actor, cancel[1], cancel[2] ?? 'Cancelado pelo WhatsApp');
      return 'Solicitação de cancelamento registrada.';
    }
    const stored = await tx.conversationSession.findUnique({ where: { identityId: identity.id } });
    let state = stored && stored.expiresAt > new Date() ? stored.state : 'IDLE';
    let context =
      stored && stored.expiresAt > new Date()
        ? contextSchema.parse(this.crypto.decrypt(stored.context))
        : ({} as z.infer<typeof contextSchema>);
    const save = async (next: string) => {
      state = next;
      await tx.conversationSession.upsert({
        where: { identityId: identity.id },
        update: {
          state,
          context: this.crypto.encrypt(context),
          expiresAt: new Date(Date.now() + 900000),
          version: { increment: 1 },
        },
        create: {
          identityId: identity.id,
          state,
          context: this.crypto.encrypt(context),
          expiresAt: new Date(Date.now() + 900000),
        },
      });
    };
    if (lower === 'cancelar') {
      context = {};
      await save('IDLE');
      return 'Cadastro em andamento cancelado.';
    }
    if (lower === 'nova entrega') {
      const branches = await tx.businessBranch.findMany({
        where: { businessId: actor.businessId ?? '', active: true },
        take: 20,
        select: { id: true, name: true },
      });
      context = {};
      if (!branches.length) return 'Nenhuma filial ativa cadastrada.';
      if (branches.length > 1) {
        await save('BRANCH');
        return `Envie o ID da filial:\n${branches.map((b) => `${b.name}: ${b.id}`).join('\n')}`;
      }
      context.branchId = branches[0]?.id;
      await save('NAME');
      return 'Envie o nome do cliente.';
    }
    if (state === 'BRANCH') {
      const branch = await tx.businessBranch.findFirst({
        where: {
          id: z.string().uuid().safeParse(text).success ? text : '00000000-0000-0000-0000-000000000000',
          businessId: actor.businessId ?? '',
          active: true,
        },
      });
      if (!branch) return 'Envie um ID válido da sua filial.';
      context.branchId = branch.id;
      await save('NAME');
      return 'Envie o nome do cliente.';
    }
    if (state === 'NAME') {
      if (text.length < 2 || text.length > 120) return 'Nome deve ter 2 a 120 caracteres.';
      context.name = text;
      await save('LOCATION');
      return 'Envie a localização do WhatsApp ou latitude,longitude.';
    }
    if (state === 'LOCATION') {
      const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(text);
      const point =
        message.location ?? (match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : null);
      if (!point || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)
        return 'Envie uma localização válida.';
      context = { ...context, ...point };
      await save('COMPLEMENT');
      return 'Envie o complemento ou - para nenhum.';
    }
    if (state === 'COMPLEMENT') {
      context.complement = text === '-' ? '' : text.slice(0, 500);
      await save('ITEMS');
      return 'Envie a descrição dos itens (até 120 caracteres).';
    }
    if (state === 'ITEMS') {
      const dto = plainToInstance(CreateDeliveryDto, {
        branchId: context.branchId,
        customer: { name: context.name },
        dropoff: { latitude: context.latitude, longitude: context.longitude, complement: context.complement },
        items: [{ name: text, quantity: 1 }],
        serviceLevel: 'SMART',
      });
      if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length)
        return 'Dados inválidos. Envie nova entrega para reiniciar.';
      const created = await this.deliveries.create(actor, dto, `whatsapp:${messageId}`);
      context = {};
      await save('IDLE');
      return `✅ Entrega registrada: ${created.id}. Estamos procurando o melhor encaixe logístico.\nQuando estiver pronta, envie pronto ${created.id}. O código de entrega pode ser emitido no painel da empresa para repassar ao cliente.`;
    }
    return 'Comandos: nova entrega, pedidos, pronto <id>, cancelar <id>, saldo, suporte.';
  }
}
