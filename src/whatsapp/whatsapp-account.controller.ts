import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { PrismaService } from '../infra/prisma.service';
import { ConfigService } from '../config/config.service';

export class WhatsAppConsentDto {
  @ApiProperty() @IsBoolean() granted: boolean;
}

@ApiTags('whatsapp')
@ApiBearerAuth()
@Roles('DRIVER', 'BUSINESS_OWNER', 'BUSINESS_STAFF')
@Controller('whatsapp/me')
export class WhatsAppAccountController {
  constructor(private readonly db: PrismaService, private readonly config: ConfigService) {}
  private async owner(actor: Actor) {
    if (actor.role === 'DRIVER' && actor.driverId) {
      const driver = await this.db.driver.findUniqueOrThrow({ where: { id: actor.driverId }, select: { phone: true } });
      return { entityType: 'DRIVER' as const, entityId: actor.driverId, phoneNumber: driver.phone };
    }
    if (actor.businessId) {
      const business = await this.db.business.findUniqueOrThrow({ where: { id: actor.businessId }, select: { phone: true } });
      return { entityType: 'BUSINESS' as const, entityId: actor.businessId, phoneNumber: business.phone };
    }
    throw new DomainError('PROFILE_REQUIRED', 'Complete your profile first', 403);
  }
  @Get() async status(@CurrentActor() actor: Actor) {
    const owner = await this.owner(actor);
    const identity = await this.db.whatsAppIdentity.findFirst({ where: owner });
    return { ...owner, verifiedAt: identity?.verifiedAt ?? null, optInAt: identity?.optInAt ?? null,
      providerEnabled: this.config.get('WHATSAPP_ENABLED'),
      ready: Boolean(identity?.verifiedAt && identity.optInAt && this.config.get('WHATSAPP_ENABLED')),
    };
  }
  @Roles('DRIVER', 'BUSINESS_OWNER')
  @Post('consent') async consent(@CurrentActor() actor: Actor, @Body() dto: WhatsAppConsentDto) {
    const owner = await this.owner(actor);
    await this.db.transaction(async (tx) => {
      await lockEntities(tx, [`whatsapp:${owner.phoneNumber}`]);
      const existing = await tx.whatsAppIdentity.findUnique({ where: { phoneNumber: owner.phoneNumber } });
      if (existing && (existing.entityType !== owner.entityType || existing.entityId !== owner.entityId))
        throw new DomainError('IDENTITY_CONFLICT', 'Phone is associated with another profile; administrative verification is required', 409);
      const identity = await tx.whatsAppIdentity.upsert({ where: { phoneNumber: owner.phoneNumber },
        create: { ...owner, optInAt: dto.granted ? new Date() : null },
        update: { optInAt: dto.granted ? new Date() : null },
      });
      await tx.auditLog.create({ data: { actorId: actor.id, action: dto.granted ? 'whatsapp.consent_granted' : 'whatsapp.consent_revoked', entityType: 'WhatsAppIdentity', entityId: identity.id } });
    });
    return this.status(actor);
  }
}
