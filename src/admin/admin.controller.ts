import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { ConfigService } from '../config/config.service';
import { FinanceService } from '../finance/finance.service';
import { CursorDto } from '../finance/finance.controller';
import { CancelDto } from '../incidents/incidents.controller';
import { MatchingEngineService } from '../matching/matching-engine.service';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { AdminService } from './admin.service';
import { AdjustmentDto, AdminWhatsAppIdentityDto, ApproveDriverDto, ZoneDto } from './admin.dto';
import { CancellationService } from '../incidents/cancellation.service';
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly finance: FinanceService,
    private readonly zones: ServiceZonesService,
    private readonly matching: MatchingEngineService,
    private readonly config: ConfigService,
    private readonly cancellations: CancellationService,
  ) {}
  @Get('drivers/:id') driverDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.driverDetail(id);
  }
  @Get('wallets') wallets(@Query() query: CursorDto) {
    return this.finance.wallets(query.cursor);
  }
  @Get('wallets/:id') walletDetail(@Param('id', ParseUUIDPipe) id: string, @Query() query: CursorDto) {
    return this.finance.walletDetail(id, query.cursor);
  }
  @Post('drivers/:id/review') review(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDriverDto,
  ) {
    return this.service.driver(actor, id, dto);
  }
  @Post('whatsapp-identities') identity(@CurrentActor() actor: Actor, @Body() dto: AdminWhatsAppIdentityDto) {
    return this.service.identity(actor, dto);
  }
  @Post('deliveries/:id/confirm') proof(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.service.proof(actor, id, dto.reason);
  }
  @Post('deliveries/:id/reassign') reassign(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.cancellations.cancel(actor, id, dto.reason, true);
  }
  @Post('finance/adjustments') adjustment(@CurrentActor() actor: Actor, @Body() dto: AdjustmentDto) {
    return this.finance.adjust(actor, dto.walletId, dto.amountCents, dto.reason, dto.idempotencyKey);
  }
  @Post('service-zones') zone(@CurrentActor() actor: Actor, @Body() dto: ZoneDto) {
    return this.zones.create(actor, dto);
  }
  @Get('service-zones') zonesList() {
    return this.zones.list();
  }
  @Post('matching/run') match() {
    return this.matching.rematchPool();
  }
  @Get('matching-config') matchingConfig() {
    return {
      radiusMeters: this.config.get('MATCH_RADIUS_METERS'),
      candidateLimit: this.config.get('MATCH_CANDIDATE_LIMIT'),
      maxDeliveries: this.config.get('MAX_ROUTE_DELIVERIES'),
      dynamicInsertion: this.config.get('DYNAMIC_ROUTE_INSERTION_ENABLED'),
      multiPickup: this.config.get('MULTI_PICKUP_ENABLED'),
    };
  }
  @Get('pricing-rules') pricing() {
    return {
      baseRevenueCents: this.config.get('BASE_REVENUE_CENTS'),
      basePayoutCents: this.config.get('BASE_PAYOUT_CENTS'),
      minimumCentsPerKm: this.config.get('MIN_DRIVER_CENTS_PER_KM'),
      minimumCentsPerHour: this.config.get('MIN_DRIVER_CENTS_PER_HOUR'),
      realPaymentsEnabled: false,
    };
  }
  @Get(':resource') list(@Param('resource') resource: string, @Query() query: CursorDto) {
    return this.service.list(resource, query.cursor);
  }
}
