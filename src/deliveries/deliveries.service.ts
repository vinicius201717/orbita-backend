import { Injectable } from '@nestjs/common';
import { Delivery, Prisma, ProofMethod } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Actor } from '../common/actor';
import { CryptoService } from '../common/crypto.service';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
import { ConfigService } from '../config/config.service';
import { SettlementService } from '../finance/settlement.service';
import { PrismaService } from '../infra/prisma.service';
import { CreateDeliveryDto, DeliveryListDto, UpdateDeliveryDto, VerifyDeliveryDto } from './deliveries.dto';
import { DeliveryStateMachineService } from './delivery-state-machine.service';

const freeStatuses = ['WAITING_POOL', 'MATCHING', 'OFFERED'];
const customerCodeStatuses = ['CREATED', ...freeStatuses, 'ASSIGNED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVING'];
export function deliveryView(delivery: Delivery, actor: Actor) {
  const {
    verificationCodeHash: _pin,
    customerCodeCiphertext: _privateCode,
    customerConfirmationTokenHash: _token,
    confirmationExpiresAt: _expires,
    verificationAttempts: _attempts,
    lockedAt: _locked,
    customerOptInAt: _optIn,
    ...view
  } = delivery;
  return {
    ...view,
    customerPhone:
      actor.role === 'DRIVER' && view.customerPhone
        ? `${view.customerPhone.slice(0, 3)}******${view.customerPhone.slice(-2)}`
        : view.customerPhone,
  };
}
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly events: OutboxService,
    private readonly states: DeliveryStateMachineService,
    private readonly settlement: SettlementService,
  ) {}

  assertAccess(actor: Actor, delivery: Pick<Delivery, 'businessId' | 'driverId'>): void {
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'DRIVER' && actor.driverId && actor.driverId === delivery.driverId) return;
    if (
      ['BUSINESS_OWNER', 'BUSINESS_STAFF'].includes(actor.role) &&
      actor.businessId &&
      actor.businessId === delivery.businessId
    )
      return;
    throw new DomainError('DELIVERY_FORBIDDEN', 'Delivery not accessible', 403);
  }
  private assertBusiness(actor: Actor, businessId: string): void {
    if (
      actor.role !== 'ADMIN' &&
      (!['BUSINESS_OWNER', 'BUSINESS_STAFF'].includes(actor.role) || actor.businessId !== businessId)
    )
      throw new DomainError('DELIVERY_FORBIDDEN', 'Business operation not permitted', 403);
  }
  async create(actor: Actor, dto: CreateDeliveryDto, idempotencyKey?: string) {
    return this.db.transaction((tx) => this.createInTransaction(tx, actor, dto, idempotencyKey));
  }
  async createInTransaction(
    tx: Prisma.TransactionClient,
    actor: Actor,
    dto: CreateDeliveryDto,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey && (idempotencyKey.length > 100 || !/^[\w:.-]+$/.test(idempotencyKey)))
      throw new DomainError('INVALID_IDEMPOTENCY_KEY', 'Invalid idempotency key', 400);
    const reference = idempotencyKey ?? dto.externalReference;
    const branch = await tx.businessBranch.findUnique({
      where: { id: dto.branchId },
      include: { business: true },
    });
    if (!branch || !branch.active || !branch.business.active)
      throw new DomainError('BRANCH_UNAVAILABLE', 'Branch unavailable', 404);
    this.assertBusiness(actor, branch.businessId);
    if (reference) {
      await lockEntities(tx, [`delivery-reference:${branch.businessId}:${reference}`]);
      const existing = await tx.delivery.findUnique({
        where: {
          businessId_externalReference: { businessId: branch.businessId, externalReference: reference },
        },
      });
      if (existing) return deliveryView(existing, actor);
    }
    const now = new Date();
    const estimatedReadyAt = dto.estimatedReadyAt ? new Date(dto.estimatedReadyAt) : null;
    const pickupDeadline = dto.pickupDeadline
      ? new Date(dto.pickupDeadline)
      : new Date(now.getTime() + this.config.get('DEFAULT_PICKUP_SLA_SECONDS') * 1000);
    const deliveryDeadline = dto.deliveryDeadline
      ? new Date(dto.deliveryDeadline)
      : new Date(now.getTime() + this.config.get('DEFAULT_DELIVERY_SLA_SECONDS') * 1000);
    if (
      pickupDeadline <= now ||
      deliveryDeadline <= pickupDeadline ||
      (estimatedReadyAt && estimatedReadyAt > pickupDeadline)
    )
      throw new DomainError('INVALID_SLA', 'Deadlines must be future, ordered and allow preparation', 400);
    const id = randomUUID();
    const pin = this.crypto.pin();
    const confirmation = this.crypto.token();
    const delivery = await tx.delivery.create({
      data: {
        id,
        businessId: branch.businessId,
        branchId: branch.id,
        externalReference: reference,
        customerName: dto.customer.name,
        customerPhone: dto.customer.phone,
        customerOptInAt: dto.customer.optIn && dto.customer.phone ? now : null,
        pickupLatitude: branch.latitude,
        pickupLongitude: branch.longitude,
        dropoffLatitude: dto.dropoff.latitude,
        dropoffLongitude: dto.dropoff.longitude,
        complement: dto.dropoff.complement,
        items: dto.items.map((item) => ({ name: item.name, quantity: item.quantity })),
        serviceLevel: dto.serviceLevel ?? 'SMART',
        category: dto.category ?? 'AMBIENT',
        capacityUnits: dto.capacityUnits ?? this.config.get('DEFAULT_CAPACITY_UNITS'),
        weightGrams: dto.weightGrams,
        volumeCm3: dto.volumeCm3,
        temperatureRequirement: dto.temperatureRequirement,
        packageType: dto.packageType,
        estimatedReadyAt,
        pickupDeadline,
        deliveryDeadline,
        maxDeliveryDurationSeconds:
          dto.maxDeliveryDurationSeconds ?? this.config.get('DEFAULT_MAX_DELIVERY_SECONDS'),
        revenueCents: this.config.get('BASE_REVENUE_CENTS'),
        verificationCodeHash: this.crypto.hash(`${id}:${pin}`),
        customerCodeCiphertext: this.crypto.encrypt({ deliveryId: id, code: pin }),
        customerConfirmationTokenHash: this.crypto.hash(`confirmation:${confirmation}`),
        confirmationExpiresAt: new Date(deliveryDeadline.getTime() + 86400000),
      },
    });
    if (dto.customer.optIn && dto.customer.phone)
      await tx.messageOutbox.create({
        data: {
          idempotencyKey: `delivery-pin:${id}`,
          recipient: dto.customer.phone,
          payload: this.crypto.encrypt({
            kind: 'text',
            text: `ORBITA: seu código de entrega é ${pin}. Informe apenas ao receber o pedido. Confirmação: ${this.config.get('PUBLIC_BASE_URL')}/api/v1/deliveries/${id}/confirm#token=${confirmation}`,
          }),
        },
      });
    await this.events.emit(tx, 'DeliveryCreated', id, { deliveryId: id, businessId: branch.businessId });
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'delivery.created', entityType: 'Delivery', entityId: id },
    });
    return deliveryView(delivery, actor);
  }
  async list(actor: Actor, query: DeliveryListDto) {
    const where: Prisma.DeliveryWhereInput = {
      status: query.status,
      branchId: query.branchId,
      businessId: query.businessId,
      driverId: query.driverId,
      routeId: query.routeId,
      serviceLevel: query.serviceLevel,
      createdAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
      id: query.cursor ? { gt: query.cursor } : undefined,
    };
    if (actor.role === 'DRIVER') {
      if (!actor.driverId) throw new DomainError('DRIVER_REQUIRED', 'Driver profile required', 403);
      where.driverId = actor.driverId;
    } else if (actor.role !== 'ADMIN') {
      if (!actor.businessId) throw new DomainError('BUSINESS_REQUIRED', 'Business profile required', 403);
      where.businessId = actor.businessId;
    }
    const take = query.limit ?? 25;
    const rows = await this.db.delivery.findMany({ where, take: take + 1, orderBy: { id: 'asc' } });
    const page = rows.slice(0, take);
    return {
      items: page.map((row) => deliveryView(row, actor)),
      nextCursor: rows.length > take ? (page.at(-1)?.id ?? null) : null,
    };
  }
  async get(actor: Actor, id: string) {
    const delivery = await this.db.delivery.findUnique({ where: { id } });
    if (!delivery) throw new DomainError('DELIVERY_NOT_FOUND', 'Delivery not found', 404);
    this.assertAccess(actor, delivery);
    return deliveryView(delivery, actor);
  }
  async customerCode(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [`delivery:${id}`]);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      this.assertBusiness(actor, delivery.businessId);
      if (!customerCodeStatuses.includes(delivery.status) || !delivery.confirmationExpiresAt || delivery.confirmationExpiresAt <= new Date())
        throw new DomainError(
          'CUSTOMER_CODE_UNAVAILABLE',
          'Customer code is unavailable for closed or expired deliveries',
        );
      if (delivery.lockedAt || delivery.verificationAttempts >= this.config.get('PIN_MAX_ATTEMPTS'))
        throw new DomainError('PIN_LOCKED', 'Verification attempts exhausted; contact support', 400);
      let code: string;
      let rotated = false;
      if (delivery.customerCodeCiphertext) {
        let recovered: { deliveryId?: unknown; code?: unknown };
        try {
          recovered = this.crypto.decrypt(delivery.customerCodeCiphertext) as {
            deliveryId?: unknown;
            code?: unknown;
          };
        } catch {
          throw new DomainError('CUSTOMER_CODE_UNAVAILABLE', 'Customer code recovery requires support', 503);
        }
        if (recovered.deliveryId !== id || typeof recovered.code !== 'string' || !this.crypto.matches(`${id}:${recovered.code}`, delivery.verificationCodeHash))
          throw new DomainError('CUSTOMER_CODE_UNAVAILABLE', 'Customer code recovery requires support', 503);
        code = recovered.code;
      } else {
        // Older deliveries only stored the hash. Recover a still-encrypted queued message first.
        // Claim the outbox row before examining it: a dispatcher may already be sending the old PIN.
        const key = `delivery-pin:${id}`;
        const rows = await tx.$queryRaw<Array<{ payload: string; status: string }>>`SELECT payload, status FROM "MessageOutbox" WHERE "idempotencyKey"=${key} FOR UPDATE`;
        const queued = rows[0];
        let decoded: { text?: unknown } | null = null;
        if (queued?.payload) {
          try {
            decoded = this.crypto.decrypt(queued.payload) as { text?: unknown };
          } catch {
            decoded = null;
          }
        }
        const legacyCode = typeof decoded?.text === 'string' ? /código de entrega é (\d{4})\./.exec(decoded.text)?.[1] : undefined;
        if (legacyCode && this.crypto.matches(`${id}:${legacyCode}`, delivery.verificationCodeHash)) {
          code = legacyCode;
        } else {
          if (queued?.status === 'SENDING')
            throw new DomainError('CUSTOMER_CODE_PENDING', 'A customer message is being sent; retry shortly', 409);
          code = this.crypto.pin();
          rotated = true;
          // Prevent an obsolete queued code from being delivered after recovery.
          await tx.messageOutbox.updateMany({ where: { idempotencyKey: key }, data: { status: 'FAILED', attempts: 10, leaseUntil: null, payload: '', lastErrorCode: 'CUSTOMER_CODE_RECOVERED_PRIVATELY' } });
        }
        await tx.delivery.update({ where: { id }, data: {
          customerCodeCiphertext: this.crypto.encrypt({ deliveryId: id, code }),
          ...(rotated ? { verificationCodeHash: this.crypto.hash(`${id}:${code}`) } : {}),
        } });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: rotated ? 'delivery.customer_code_recovered' : 'delivery.customer_code_viewed',
          entityType: 'Delivery',
          entityId: id,
        },
      });
      return {
        deliveryId: id,
        code,
        instructions:
          `${rotated ? 'Este código substitui o anterior. ' : ''}Envie este código em particular ao cliente. Nunca compartilhe com o entregador; o cliente deve informá-lo somente depois de receber o pedido.`,
      };
    });
  }
  async ready(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [`delivery:${id}`]);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      this.assertBusiness(actor, delivery.businessId);
      if (
        !freeStatuses.includes(delivery.status) &&
        !['ASSIGNED', 'PICKUP_PENDING'].includes(delivery.status)
      )
        throw new DomainError('DELIVERY_INVALID_STATE', 'Delivery cannot be marked ready in this state');
      if (delivery.readinessStatus === 'READY_FOR_PICKUP') return deliveryView(delivery, actor);
      const result = await tx.delivery.update({
        where: { id },
        data: { readinessStatus: 'READY_FOR_PICKUP', readyAt: new Date() },
      });
      await this.events.emit(tx, 'DeliveryReady', id, { deliveryId: id, businessId: delivery.businessId });
      return deliveryView(result, actor);
    });
  }
  async update(actor: Actor, id: string, dto: UpdateDeliveryDto) {
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [`delivery:${id}`]);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      this.assertBusiness(actor, delivery.businessId);
      if (!freeStatuses.includes(delivery.status) || delivery.driverId || delivery.routeId)
        throw new DomainError('DELIVERY_ALREADY_ASSIGNED', 'Only unassigned deliveries can be edited');
      if (dto.estimatedReadyAt && new Date(dto.estimatedReadyAt) > delivery.pickupDeadline)
        throw new DomainError('INVALID_SLA', 'Preparation exceeds pickup deadline', 400);
      await tx.routeOffer.updateMany({
        where: { status: 'PENDING', deliveries: { some: { deliveryId: id } } },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
      const result = await tx.delivery.update({
        where: { id },
        data: {
          dropoffLatitude: dto.dropoff?.latitude,
          dropoffLongitude: dto.dropoff?.longitude,
          complement: dto.complement ?? dto.dropoff?.complement,
          estimatedReadyAt: dto.estimatedReadyAt ? new Date(dto.estimatedReadyAt) : undefined,
          status: 'WAITING_POOL',
        },
      });
      await this.events.emit(tx, 'DeliveryUpdated', id, { deliveryId: id, businessId: delivery.businessId });
      return deliveryView(result, actor);
    });
  }
  async verify(actor: Actor, id: string, dto: VerifyDeliveryDto) {
    const result = await this.db.transaction(async (tx) => {
      const snapshot = await tx.delivery.findUniqueOrThrow({ where: { id } });
      await lockEntities(tx, [
        `delivery:${id}`,
        ...(snapshot.routeId ? [`route:${snapshot.routeId}`] : []),
        ...(snapshot.driverId ? [`driver:${snapshot.driverId}`] : []),
      ]);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      if (actor.role !== 'DRIVER' || !actor.driverId || actor.driverId !== delivery.driverId)
        throw new DomainError('DELIVERY_FORBIDDEN', 'Only the assigned driver can verify the PIN', 403);
      if (delivery.status === 'DELIVERED') return { delivery };
      this.states.assertTransition(delivery.status, 'DELIVERED');
      if (delivery.lockedAt || delivery.verificationAttempts >= this.config.get('PIN_MAX_ATTEMPTS'))
        return { error: 'PIN_LOCKED' as const };
      if (!this.crypto.matches(`${id}:${dto.code}`, delivery.verificationCodeHash)) {
        const attempts = delivery.verificationAttempts + 1;
        const locked = attempts >= this.config.get('PIN_MAX_ATTEMPTS');
        await tx.delivery.update({
          where: { id },
          data: { verificationAttempts: attempts, lockedAt: locked ? new Date() : null },
        });
        if (locked)
          await tx.fraudFlag.create({
            data: { driverId: delivery.driverId, deliveryId: id, type: 'PIN_ATTEMPTS_EXHAUSTED' },
          });
        return { error: locked ? ('PIN_LOCKED' as const) : ('PIN_INVALID' as const) };
      }
      const radius = this.config.get('PIN_PROXIMITY_METERS');
      if (radius > 0) {
        const location = await tx.driverLocation.findUnique({ where: { driverId: actor.driverId } });
        if (!location || location.expiresAt <= new Date())
          throw new DomainError('LOCATION_REQUIRED', 'A current location is required to confirm delivery');
        const radians = (degrees: number) => (degrees * Math.PI) / 180;
        const lat = radians(location.latitude - delivery.dropoffLatitude),
          lng = radians(location.longitude - delivery.dropoffLongitude);
        const distance =
          6371000 *
          2 *
          Math.atan2(
            Math.sqrt(
              Math.min(
                1,
                Math.sin(lat / 2) ** 2 +
                  Math.cos(radians(location.latitude)) *
                    Math.cos(radians(delivery.dropoffLatitude)) *
                    Math.sin(lng / 2) ** 2,
              ),
            ),
            Math.sqrt(
              Math.max(
                0,
                1 -
                  (Math.sin(lat / 2) ** 2 +
                    Math.cos(radians(location.latitude)) *
                      Math.cos(radians(delivery.dropoffLatitude)) *
                      Math.sin(lng / 2) ** 2),
              ),
            ),
          );
        if (distance > radius)
          throw new DomainError('DELIVERY_TOO_FAR', 'Driver is outside the verification radius');
      }
      return { delivery: await this.complete(tx, delivery, 'PIN', actor.id, dto.latitude, dto.longitude) };
    });
    if ('error' in result)
      throw new DomainError(
        result.error ?? 'PIN_INVALID',
        result.error === 'PIN_LOCKED' ? 'Verification attempts exhausted' : 'Invalid verification code',
        400,
      );
    return deliveryView(result.delivery, actor);
  }
  async confirm(id: string, token: string) {
    return this.db.transaction(async (tx) => {
      const snapshot = await tx.delivery.findUniqueOrThrow({ where: { id } });
      await lockEntities(tx, [
        `delivery:${id}`,
        ...(snapshot.routeId ? [`route:${snapshot.routeId}`] : []),
        ...(snapshot.driverId ? [`driver:${snapshot.driverId}`] : []),
      ]);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      if (
        !delivery.customerConfirmationTokenHash ||
        !delivery.confirmationExpiresAt ||
        delivery.confirmationExpiresAt <= new Date() ||
        !this.crypto.matches(`confirmation:${token}`, delivery.customerConfirmationTokenHash)
      )
        throw new DomainError('CONFIRMATION_INVALID', 'Confirmation token is invalid or expired', 400);
      if (delivery.status !== 'DELIVERED') await this.complete(tx, delivery, 'CUSTOMER_CONFIRMATION', null);
      return { id, status: 'DELIVERED' as const };
    });
  }
  async customerTracking(id: string, token: string) {
    const delivery = await this.db.delivery.findUniqueOrThrow({ where: { id } });
    if (
      !delivery.customerConfirmationTokenHash ||
      !delivery.confirmationExpiresAt ||
      delivery.confirmationExpiresAt <= new Date() ||
      !this.crypto.matches(`confirmation:${token}`, delivery.customerConfirmationTokenHash)
    )
      throw new DomainError('CONFIRMATION_INVALID', 'Tracking token invalid or expired', 400);
    const stop = delivery.routeId
      ? await this.db.routeStop.findFirst({
          where: { routeId: delivery.routeId, deliveryId: id, type: 'DROPOFF' },
          select: { estimatedArrivalAt: true },
        })
      : null;
    return {
      id,
      status: delivery.status,
      estimatedArrivalAt: stop?.estimatedArrivalAt ?? null,
      deliveredAt: delivery.deliveredAt,
    };
  }
  async complete(
    tx: Prisma.TransactionClient,
    delivery: Delivery,
    method: ProofMethod,
    actorId: string | null,
    latitude?: number,
    longitude?: number,
  ) {
    this.states.assertTransition(delivery.status, 'DELIVERED');
    if (!delivery.driverId || !delivery.routeId || !delivery.pickedUpAt)
      throw new DomainError('DELIVERY_NOT_COLLECTED', 'Delivery must be collected before confirmation');
    const stop = await tx.routeStop.findFirst({
      where: { routeId: delivery.routeId, deliveryId: delivery.id, type: 'DROPOFF' },
    });
    if (
      !stop ||
      (await tx.routeStop.count({
        where: {
          routeId: delivery.routeId,
          sequence: { lt: stop.sequence },
          status: { notIn: ['COMPLETED', 'SKIPPED'] },
        },
      }))
    )
      throw new DomainError('STOP_OUT_OF_SEQUENCE', 'Complete earlier stops first');
    const now = new Date();
    // Advisory locks do not refresh a Serializable transaction's snapshot. Write
    // the existing delivery before inserting its unique proof so a concurrent
    // completion produces a serialization retry, which then sees DELIVERED.
    const result = await tx.delivery.update({
      where: { id: delivery.id },
      data: { status: 'DELIVERED', deliveredAt: now, verifiedAt: now, customerCodeCiphertext: null },
    });
    await tx.deliveryProof.create({
      data: { deliveryId: delivery.id, method, verifiedAt: now, latitude, longitude },
    });
    await tx.routeStop.update({ where: { id: stop.id }, data: { status: 'COMPLETED', completedAt: now } });
    await tx.route.update({ where: { id: delivery.routeId }, data: { version: { increment: 1 } } });
    await tx.driver.update({
      where: { id: delivery.driverId },
      data: { currentCapacityUnits: { decrement: delivery.capacityUnits } },
    });
    await tx.routeOffer.updateMany({
      where: { routeId: delivery.routeId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: now },
    });
    await this.settlement.settleDelivery(tx, result);
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'delivery.delivered',
        entityType: 'Delivery',
        entityId: delivery.id,
        metadata: { method },
      },
    });
    await this.events.emit(tx, 'DeliveryDelivered', delivery.id, {
      deliveryId: delivery.id,
      businessId: delivery.businessId,
      driverId: delivery.driverId,
      routeId: delivery.routeId,
    });
    return result;
  }
}
