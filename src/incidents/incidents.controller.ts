import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IncidentType } from '@prisma/client';
import { Actor } from '../common/actor';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { CancellationService } from './cancellation.service';
import { IncidentsService } from './incidents.service';
export class CancelDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
export class IncidentDto {
  @ApiProperty({ enum: IncidentType }) @IsEnum(IncidentType) type: IncidentType;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  attachments?: string[];
}
export class ResolveIncidentDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) resolution: string;
}
@ApiTags('incidents')
@ApiBearerAuth()
@Controller('deliveries')
export class IncidentsController {
  constructor(
    private readonly cancellation: CancellationService,
    private readonly incidents: IncidentsService,
  ) {}
  @Post(':id/cancel') cancel(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.cancellation.cancel(actor, id, dto.reason);
  }
  @Post(':id/return') returning(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.cancellation.returnCargo(actor, id, false);
  }
  @Roles('ADMIN') @Post(':id/return/complete') returned(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cancellation.returnCargo(actor, id, true);
  }
  @Post(':id/incidents') create(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IncidentDto,
  ) {
    return this.incidents.create(actor, id, dto);
  }
  @Get(':id/incidents') list(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.list(actor, id);
  }
  @Roles('ADMIN')
  @Patch(':id/incidents/:incidentId/resolve') resolve(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body() dto: ResolveIncidentDto,
  ) {
    return this.incidents.resolve(actor, id, incidentId, dto.resolution);
  }
}
