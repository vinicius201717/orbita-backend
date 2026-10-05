import { Injectable } from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
import { ConfigService } from '../config/config.service';
import { DeliveriesService, deliveryView } from '../deliveries/deliveries.service';
import { PrismaService } from '../infra/prisma.service';
import { CreateOrderDto, CreateProductDto, OrderListDto, UpdateProductDto } from './merchant.dto';

const orderInclude = {
  items: { orderBy: { position: 'asc' as const } },
  delivery: true,
} satisfies Prisma.MerchantOrderInclude;
type OrderWithDelivery = Prisma.MerchantOrderGetPayload<{ include: typeof orderInclude }>;
const prePickup: DeliveryStatus[] = [
  'CREATED',
  'WAITING_POOL',
  'MATCHING',
  'OFFERED',
  'ASSIGNED',
  'PICKUP_PENDING',
];
const failed: DeliveryStatus[] = ['CANCELLED', 'FAILED', 'RETURN_REQUIRED', 'RETURNING', 'RETURNED'];

function orderView(order: OrderWithDelivery, actor: Actor) {
  return {
    id: order.id,
    businessId: order.businessId,
    branchId: order.branchId,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: order.address,
    notes: order.notes,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    items: order.items.map(({ productId, name, quantity, unitPriceCents, totalCents }) => ({
      productId,
      name,
      quantity,
      unitPriceCents,
      totalCents,
    })),
    delivery: deliveryView(order.delivery, actor),
  };
}

@Injectable()
export class MerchantService {
  constructor(
    private readonly db: PrismaService,
    private readonly deliveries: DeliveriesService,
    private readonly config: ConfigService,
    private readonly events: OutboxService,
  ) {}

  private async business(actor: Actor, db: Prisma.TransactionClient = this.db) {
    if (!['BUSINESS_OWNER', 'BUSINESS_STAFF'].includes(actor.role) || !actor.businessId)
      throw new DomainError('BUSINESS_REQUIRED', 'Business profile required', 403);
    const business = await db.business.findFirst({ where: { id: actor.businessId, active: true } });
    if (!business) throw new DomainError('BUSINESS_UNAVAILABLE', 'Business unavailable', 403);
    return business.id;
  }

  async products(actor: Actor) {
    const businessId = await this.business(actor);
    return this.db.merchantProduct.findMany({
      where: { businessId },
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  }

  async createProduct(actor: Actor, dto: CreateProductDto) {
    return this.db.transaction(async (tx) => {
      const businessId = await this.business(actor, tx);
      await lockEntities(tx, [`merchant-catalog:${businessId}`]);
      if ((await tx.merchantProduct.count({ where: { businessId } })) >= 500)
        throw new DomainError('CATALOG_LIMIT', 'Catalog supports up to 500 products');
      const product = await tx.merchantProduct.create({
        data: {
          businessId,
          name: dto.name,
          description: dto.description || null,
          category: dto.category,
          priceCents: dto.priceCents,
          available: dto.available ?? true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'product.created',
          entityType: 'MerchantProduct',
          entityId: product.id,
        },
      });
      return product;
    });
  }

  async updateProduct(actor: Actor, id: string, dto: UpdateProductDto) {
    return this.db.transaction(async (tx) => {
      const businessId = await this.business(actor, tx);
      await lockEntities(tx, [`merchant-catalog:${businessId}`]);
      const product = await tx.merchantProduct.findFirst({ where: { id, businessId } });
      if (!product) throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found', 404);
      const updated = await tx.merchantProduct.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description === undefined ? undefined : dto.description || null,
          category: dto.category,
          priceCents: dto.priceCents,
          available: dto.available ?? undefined,
        },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'product.updated', entityType: 'MerchantProduct', entityId: id },
      });
      return updated;
    });
  }

  async createOrder(actor: Actor, dto: CreateOrderDto, key?: string) {
    if (!key || key.length > 100 || !/^[\w:.-]+$/.test(key))
      throw new DomainError('INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key is required', 400);
    const input = {
      branchId: dto.branchId,
      customer: {
        name: dto.customer.name.trim(),
        phone: dto.customer.phone ?? null,
        optIn: dto.customer.optIn ?? false,
      },
      dropoff: {
        latitude: dto.dropoff.latitude,
        longitude: dto.dropoff.longitude,
        complement: dto.dropoff.complement?.trim() || null,
      },
      address: dto.address,
      notes: dto.notes || null,
      items: dto.items
        .map(({ productId, quantity }) => ({ productId, quantity }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
      serviceLevel: dto.serviceLevel ?? 'SMART',
      category: dto.category ?? 'AMBIENT',
      preparationMinutes: dto.preparationMinutes ?? 15,
    };
    if (!input.customer.name)
      throw new DomainError('CUSTOMER_NAME_REQUIRED', 'Customer name is required', 400);
    if (new Set(input.items.map((item) => item.productId)).size !== input.items.length)
      throw new DomainError('DUPLICATE_ORDER_ITEM', 'Include each product only once', 400);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(async (tx) => {
      const businessId = await this.business(actor, tx);
      await lockEntities(tx, [`merchant-order:${businessId}:${key}`, `merchant-catalog:${businessId}`]);
      const existing = await tx.merchantOrder.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } },
        include: orderInclude,
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            'This key has already been used for a different order',
          );
        return orderView(existing, actor);
      }
      const branch = await tx.businessBranch.findFirst({
        where: { id: dto.branchId, businessId, active: true },
      });
      if (!branch) throw new DomainError('BRANCH_UNAVAILABLE', 'Branch unavailable', 404);
      const products = await tx.merchantProduct.findMany({
        where: { businessId, available: true, id: { in: input.items.map((item) => item.productId) } },
      });
      if (products.length !== input.items.length)
        throw new DomainError('PRODUCT_UNAVAILABLE', 'One or more products are unavailable', 409);
      const items = dto.items.map((item, position) => {
        const product = products.find((product) => product.id === item.productId);
        if (!product) throw new DomainError('PRODUCT_UNAVAILABLE', 'Product unavailable', 409);
        return {
          productId: product.id,
          position,
          name: product.name,
          quantity: item.quantity,
          unitPriceCents: product.priceCents,
          totalCents: item.quantity * product.priceCents,
        };
      });
      const totalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
      if (!Number.isSafeInteger(totalCents) || totalCents > 2000000000)
        throw new DomainError('ORDER_TOTAL_TOO_LARGE', 'Order total exceeds the supported limit', 400);
      const id = randomUUID();
      const now = new Date();
      const estimatedReadyAt = new Date(now.getTime() + input.preparationMinutes * 60000);
      const pickupDeadline = new Date(
        estimatedReadyAt.getTime() + this.config.get('DEFAULT_PICKUP_SLA_SECONDS') * 1000,
      );
      const deliveryDeadline = new Date(
        pickupDeadline.getTime() + this.config.get('DEFAULT_DELIVERY_SLA_SECONDS') * 1000,
      );
      const delivery = await this.deliveries.createInTransaction(
        tx,
        actor,
        {
          branchId: dto.branchId,
          customer: {
            name: input.customer.name,
            phone: input.customer.phone ?? undefined,
            optIn: input.customer.optIn,
          },
          dropoff: {
            ...dto.dropoff,
            complement: [input.address, input.dropoff.complement].filter(Boolean).join(' · '),
          },
          items: items.map(({ name, quantity }) => ({ name, quantity })),
          serviceLevel: input.serviceLevel,
          category: input.category,
          estimatedReadyAt: estimatedReadyAt.toISOString(),
          pickupDeadline: pickupDeadline.toISOString(),
          deliveryDeadline: deliveryDeadline.toISOString(),
        },
        `merchant-order:${id}`,
      );
      if (input.preparationMinutes === 0) {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: { readinessStatus: 'READY_FOR_PICKUP', readyAt: now },
        });
        await this.events.emit(tx, 'DeliveryReady', delivery.id, { deliveryId: delivery.id, businessId });
      }
      const order = await tx.merchantOrder.create({
        data: {
          id,
          businessId,
          branchId: branch.id,
          deliveryId: delivery.id,
          idempotencyKey: key,
          requestHash,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          address: input.address,
          notes: input.notes,
          totalCents,
          items: { create: items },
        },
        include: orderInclude,
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'order.created', entityType: 'MerchantOrder', entityId: id },
      });
      return orderView(order, actor);
    });
  }

  async orders(actor: Actor, query: OrderListDto) {
    const businessId = await this.business(actor);
    const where: Prisma.MerchantOrderWhereInput = { businessId };
    const stages: Record<string, Prisma.DeliveryWhereInput> = {
      preparing: { status: { in: prePickup }, readinessStatus: 'PREPARING' },
      ready: { status: { in: prePickup }, readinessStatus: 'READY_FOR_PICKUP' },
      'on-the-way': { status: { in: ['PICKED_UP', 'IN_TRANSIT', 'ARRIVING'] } },
      completed: { status: 'DELIVERED' },
      attention: { status: { in: ['FAILED', 'RETURN_REQUIRED', 'RETURNING'] } },
      cancelled: { status: { in: ['CANCELLED', 'RETURNED'] } },
    };
    if (query.stage) where.delivery = stages[query.stage];
    if (query.search) {
      const digits = query.search.replace(/\D/g, '');
      const phoneSearch = /^\+?[\d\s().-]+$/.test(query.search) && digits.length >= 3 ? digits : query.search;
      where.AND = [
        {
          OR: [
            { customerName: { contains: query.search, mode: 'insensitive' } },
            { customerPhone: { contains: phoneSearch } },
          ],
        },
      ];
    }
    if (query.cursor) {
      const cursor = await this.db.merchantOrder.findFirst({ where: { id: query.cursor, businessId } });
      if (!cursor) throw new DomainError('INVALID_CURSOR', 'Invalid order cursor', 400);
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }
    const take = query.limit ?? 25;
    const rows = await this.db.merchantOrder.findMany({
      where,
      include: orderInclude,
      take: take + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const page = rows.slice(0, take);
    return {
      items: page.map((order) => orderView(order, actor)),
      nextCursor: rows.length > take ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async order(actor: Actor, id: string) {
    const businessId = await this.business(actor);
    const order = await this.db.merchantOrder.findFirst({ where: { id, businessId }, include: orderInclude });
    if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Order not found', 404);
    return orderView(order, actor);
  }

  async summary(actor: Actor) {
    return this.db.transaction(async (tx) => {
      const businessId = await this.business(actor, tx);
      const [day] = await tx.$queryRaw<Array<{ start: Date; end: Date }>>`
        SELECT date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS start,
        (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo' AS end
      `;
      if (!day) throw new DomainError('SUMMARY_UNAVAILABLE', 'Não foi possível calcular o resumo.', 503);
      const today = { gte: day.start, lt: day.end };
      const [
        preparing,
        ready,
        onTheWay,
        completedToday,
        cancelledToday,
        productCount,
        availableProductCount,
        sales,
      ] = await Promise.all([
        tx.merchantOrder.count({
          where: { businessId, delivery: { status: { in: prePickup }, readinessStatus: 'PREPARING' } },
        }),
        tx.merchantOrder.count({
          where: { businessId, delivery: { status: { in: prePickup }, readinessStatus: 'READY_FOR_PICKUP' } },
        }),
        tx.merchantOrder.count({
          where: {
            businessId,
            delivery: {
              status: { in: ['PICKED_UP', 'IN_TRANSIT', 'ARRIVING'] },
            },
          },
        }),
        tx.merchantOrder.count({
          where: { businessId, delivery: { status: 'DELIVERED', deliveredAt: today } },
        }),
        tx.merchantOrder.count({
          where: { businessId, delivery: { status: 'CANCELLED', updatedAt: today } },
        }),
        tx.merchantProduct.count({ where: { businessId } }),
        tx.merchantProduct.count({ where: { businessId, available: true } }),
        tx.merchantOrder.aggregate({
          where: { businessId, createdAt: today, delivery: { status: { notIn: failed } } },
          _sum: { totalCents: true },
        }),
      ]);
      return {
        preparing,
        ready,
        onTheWay,
        completedToday,
        cancelledToday,
        productCount,
        availableProductCount,
        salesTodayCents: sales._sum.totalCents ?? 0,
      };
    });
  }
}
