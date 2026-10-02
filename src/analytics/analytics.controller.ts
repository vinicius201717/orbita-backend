import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { AnalyticsService } from './analytics.service';
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Roles('BUSINESS_OWNER', 'BUSINESS_STAFF') @Get('business/overview') business(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.business(actor);
  }
  @Roles('DRIVER') @Get('driver/overview') driver(@CurrentActor() actor: Actor) {
    return this.service.driver(actor);
  }
  @Roles('ADMIN') @Get('platform/overview') platform() {
    return this.service.platform();
  }
}
