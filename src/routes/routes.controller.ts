import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { RoutesService } from './routes.service';
import { RouteListDto } from './routes.dto';
@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(private readonly service: RoutesService) {}
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: RouteListDto) {
    return this.service.list(actor, query);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Read an authorized route; businesses see only their own deliveries' })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(actor, id);
  }
  @Post(':id/start')
  @Roles('DRIVER')
  start(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.start(actor, id);
  }
  @Post(':id/stops/:stopId/arrive')
  @Roles('DRIVER')
  arrive(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
  ) {
    return this.service.arrive(actor, id, stopId);
  }
  @Post(':id/stops/:stopId/complete')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Complete pickup; dropoff completion requires recipient proof' })
  complete(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
  ) {
    return this.service.complete(actor, id, stopId);
  }
  @Post(':id/finish')
  @Roles('DRIVER')
  finish(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.finish(actor, id);
  }
}
