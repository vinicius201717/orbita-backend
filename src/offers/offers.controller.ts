import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { OffersService } from './offers.service';
@ApiTags('offers')
@ApiBearerAuth()
@Roles('DRIVER')
@Controller('driver/offers')
export class OffersController {
  constructor(private readonly service: OffersService) {}
  @Get() list(@CurrentActor() actor: Actor) {
    return this.service.list(actor);
  }
  @Post(':id/accept') accept(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.accept(actor, id);
  }
  @Post(':id/reject') reject(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reject(actor, id);
  }
}
