import { Injectable } from '@nestjs/common';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { PrismaService } from '../infra/prisma.service';
import { CreateBranchDto, CreateBusinessDto, UpdateBusinessDto } from './businesses.dto';
import { lockEntities } from '../common/locks';
@Injectable()
export class BusinessesService {
  constructor(private readonly db: PrismaService) {}
  assertAccess(actor: Actor, id: string) {
    if (actor.role !== 'ADMIN' && (!actor.businessId || actor.businessId !== id))
      throw new DomainError('BUSINESS_FORBIDDEN', 'Business not accessible', 403);
  }
  async create(actor: Actor, dto: CreateBusinessDto) {
    if (!['ADMIN', 'BUSINESS_OWNER'].includes(actor.role))
      throw new DomainError('FORBIDDEN', 'Owner role required', 403);
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [`user:${actor.id}`]);
      const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (actor.role !== 'ADMIN' && user.businessId)
        throw new DomainError('BUSINESS_EXISTS', 'Account already owns a business');
      const business = await tx.business.create({ data: dto });
      await tx.wallet.create({
        data: { key: `business:${business.id}`, type: 'BUSINESS', businessId: business.id },
      });
      if (actor.role !== 'ADMIN')
        await tx.user.update({ where: { id: actor.id }, data: { businessId: business.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'business.created',
          entityType: 'Business',
          entityId: business.id,
        },
      });
      return business;
    });
  }
  async get(actor: Actor, id: string) {
    this.assertAccess(actor, id);
    return this.db.business.findUniqueOrThrow({ where: { id } });
  }
  async update(actor: Actor, id: string, dto: UpdateBusinessDto) {
    this.assertAccess(actor, id);
    if (!['ADMIN', 'BUSINESS_OWNER'].includes(actor.role))
      throw new DomainError('FORBIDDEN', 'Owner role required', 403);
    return this.db.transaction(async (tx) => {
      const previous = await tx.business.findUniqueOrThrow({ where: { id } });
      const result = await tx.business.update({ where: { id }, data: dto });
      if (dto.phone && dto.phone !== previous.phone)
        await tx.whatsAppIdentity.updateMany({
          where: { entityType: 'BUSINESS', entityId: id },
          data: { verifiedAt: null, optInAt: null },
        });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'business.updated', entityType: 'Business', entityId: id },
      });
      return result;
    });
  }
  async createBranch(actor: Actor, businessId: string, dto: CreateBranchDto) {
    this.assertAccess(actor, businessId);
    return this.db.businessBranch.create({ data: { ...dto, businessId } });
  }
  async branches(actor: Actor, businessId: string) {
    this.assertAccess(actor, businessId);
    return this.db.businessBranch.findMany({ where: { businessId }, take: 100, orderBy: { id: 'asc' } });
  }
}
