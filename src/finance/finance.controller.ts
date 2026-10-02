import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { FinanceService } from './finance.service';
export class CursorDto {
  @IsOptional() @IsUUID() cursor?: string;
}
@ApiTags('finance')
@ApiBearerAuth()
@Controller()
export class FinanceController {
  constructor(private readonly service: FinanceService) {}
  @Roles('DRIVER') @Get('driver/wallet') wallet(@CurrentActor() actor: Actor, @Query() query: CursorDto) {
    return this.service.wallet(actor, query.cursor);
  }
  @Roles('DRIVER') @Get('driver/earnings') earnings(@CurrentActor() actor: Actor, @Query() query: CursorDto) {
    return this.service.earnings(actor, query.cursor);
  }
  @Roles('BUSINESS_OWNER', 'BUSINESS_STAFF') @Get('business/billing') billing(
    @CurrentActor() actor: Actor,
    @Query() query: CursorDto,
  ) {
    return this.service.billing(actor, query.cursor);
  }
}
