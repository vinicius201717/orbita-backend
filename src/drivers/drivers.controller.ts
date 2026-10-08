import { Body, Controller, Get, Header, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { TrackingService } from '../tracking/tracking.service';
import { ConsentDto, DriverAvailabilityDto, DriverStatusDto, LocationDto, VehicleDto } from './drivers.dto';
import { DriversService } from './drivers.service';
import { DriverSummaryDto } from './driver-summary.dto';
import { DriverSummaryService } from './driver-summary.service';
@ApiTags('driver')
@ApiBearerAuth()
@Roles('DRIVER')
@Controller('driver')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly tracking: TrackingService,
    private readonly summary: DriverSummaryService,
  ) {}
  @Get('me') me(@CurrentActor() actor: Actor) {
    return this.drivers.me(actor);
  }
  @Get('summary')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: DriverSummaryDto })
  @ApiOperation({ summary: 'Driver home: posted balance, local-day earnings and assigned next stop' })
  home(@CurrentActor() actor: Actor) {
    return this.summary.get(actor);
  }
  @Patch('availability')
  @ApiOperation({
    summary: 'Start or pause new offers while retaining custody and GPS during an assigned route',
  })
  availability(@CurrentActor() actor: Actor, @Body() dto: DriverAvailabilityDto) {
    return this.drivers.availability(actor, dto.acceptingOrders);
  }
  @Patch('me/status') status(@CurrentActor() actor: Actor, @Body() dto: DriverStatusDto) {
    return this.drivers.status(actor, dto.status);
  }
  @Post('consent') consent(@CurrentActor() actor: Actor, @Body() dto: ConsentDto) {
    return this.drivers.consent(actor, dto.granted);
  }
  @Post('vehicles') vehicle(@CurrentActor() actor: Actor, @Body() dto: VehicleDto) {
    return this.drivers.vehicle(actor, dto);
  }
  @Post('location') location(@CurrentActor() actor: Actor, @Body() dto: LocationDto) {
    return this.tracking.update(actor, dto);
  }
  @Post('heartbeat') heartbeat(@CurrentActor() actor: Actor, @Body() dto: LocationDto) {
    return this.tracking.update(actor, dto);
  }
}
