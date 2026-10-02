import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { TrackingService } from '../tracking/tracking.service';
import { ConsentDto, DriverStatusDto, LocationDto, VehicleDto } from './drivers.dto';
import { DriversService } from './drivers.service';
@ApiTags('driver')
@ApiBearerAuth()
@Roles('DRIVER')
@Controller('driver')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly tracking: TrackingService,
  ) {}
  @Get('me') me(@CurrentActor() actor: Actor) {
    return this.drivers.me(actor);
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
