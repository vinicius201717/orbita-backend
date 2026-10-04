import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { AdminWhatsAppIdentityDto, ApproveDriverDto } from './admin.dto';
@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly deliveries: DeliveriesService,
  ) {}
  async driverDetail(id: string) {
    const driver = await this.db.driver.findUnique({ where: { id }, include: {
      user: { select: { id: true, name: true, email: true, active: true } },
      vehicles: { orderBy: { id: 'desc' } },
    } });
    if (!driver) throw new DomainError('DRIVER_NOT_FOUND', 'Driver not found', 404);
    return driver;
  }
  async driver(actor: Actor, id: string, dto: ApproveDriverDto) {
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [`driver:${id}`]);
      const result = await tx.driver.update({
        where: { id },
        data: {
          onboardingStatus: dto.status,
          ...(dto.status !== 'APPROVED' ? { acceptNewOrders: false } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'driver.reviewed',
          entityType: 'Driver',
          entityId: id,
          metadata: { status: dto.status },
        },
      });
      return result;
    });
  }
  async identity(actor: Actor, dto: AdminWhatsAppIdentityDto) {
    const entity =
      dto.entityType === 'BUSINESS'
        ? await this.db.business.findUnique({ where: { id: dto.entityId }, select: { phone: true } })
        : dto.entityType === 'DRIVER'
          ? await this.db.driver.findUnique({ where: { id: dto.entityId }, select: { phone: true } })
          : null;
    if (!entity || entity.phone !== dto.phoneNumber)
      throw new DomainError(
        'IDENTITY_MISMATCH',
        'Identity must match the registered business or driver phone',
        400,
      );
    return this.db.transaction(async (tx) => {
      const identity = await tx.whatsAppIdentity.upsert({
        where: { phoneNumber: dto.phoneNumber },
        create: {
          phoneNumber: dto.phoneNumber,
          entityType: dto.entityType,
          entityId: dto.entityId,
          verifiedAt: new Date(),
          optInAt: new Date(),
        },
        update: {
          entityType: dto.entityType,
          entityId: dto.entityId,
          verifiedAt: new Date(),
          optInAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'whatsapp.identity_verified',
          entityType: 'WhatsAppIdentity',
          entityId: identity.id,
          metadata: { evidence: dto.evidence },
        },
      });
      return identity;
    });
  }
  async proof(actor: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const snapshot = await tx.delivery.findUniqueOrThrow({ where: { id } });
      await lockEntities(tx, [`delivery:${id}`, `driver:${snapshot.driverId}`, `route:${snapshot.routeId}`]);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      if (delivery.status === 'DELIVERED') return { id, status: delivery.status };
      const result = await this.deliveries.complete(tx, delivery, 'ADMIN', actor.id);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'admin.delivery_override',
          entityType: 'Delivery',
          entityId: id,
          metadata: { reason },
        },
      });
      return { id: result.id, status: result.status };
    });
  }
  list(resource: string, cursor?: string) {
    const page = {
      take: 50,
      orderBy: { id: 'asc' as const },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    };
    switch (resource) {
      case 'businesses':
        return this.db.business.findMany(page);
      case 'drivers':
        return this.db.driver.findMany(page);
      case 'deliveries':
        return this.db.delivery.findMany({
          ...page,
          select: {
            id: true,
            businessId: true,
            driverId: true,
            routeId: true,
            status: true,
            createdAt: true,
            deliveryDeadline: true,
            revenueCents: true,
          },
        });
      case 'routes':
        return this.db.route.findMany(page);
      case 'incidents':
        return this.db.deliveryIncident.findMany(page);
      case 'financial-transactions':
        return this.db.ledgerTransaction.findMany({ ...page, include: { entries: true } });
      case 'audit':
        return this.db.auditLog.findMany(page);
      case 'fraud-flags':
        return this.db.fraudFlag.findMany(page);
      case 'privacy-requests':
        return this.db.privacyRequest.findMany(page);
      case 'whatsapp-identities':
        return this.db.whatsAppIdentity.findMany(page);
      default:
        throw new DomainError('NOT_FOUND', 'Unknown resource', 404);
    }
  }
}
