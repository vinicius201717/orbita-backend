import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { BusinessesService } from './businesses.service';
import { CreateBranchDto, CreateBusinessDto, UpdateBusinessDto } from './businesses.dto';
@ApiTags('businesses')
@ApiBearerAuth()
@Roles('ADMIN', 'BUSINESS_OWNER', 'BUSINESS_STAFF')
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly service: BusinessesService) {}
  @Post() create(@CurrentActor() actor: Actor, @Body() dto: CreateBusinessDto) {
    return this.service.create(actor, dto);
  }
  @Get(':id') get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(actor, id);
  }
  @Patch(':id') patch(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.service.update(actor, id, dto);
  }
  @Post(':id/branches') branch(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.service.createBranch(actor, id, dto);
  }
  @Get(':id/branches') branches(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.branches(actor, id);
  }
}
