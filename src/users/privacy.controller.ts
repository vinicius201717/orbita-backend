import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { CurrentActor } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { PrismaService } from '../infra/prisma.service';
class PrivacyRequestDto {
  @ApiProperty({ enum: ['EXPORT', 'DELETE'] }) @IsEnum({ EXPORT: 'EXPORT', DELETE: 'DELETE' }) type:
    'EXPORT' | 'DELETE';
}
@ApiTags('privacy')
@ApiBearerAuth()
@Controller('users/me/privacy')
export class PrivacyController {
  constructor(private readonly db: PrismaService) {}
  @Post('requests') request(@CurrentActor() actor: Actor, @Body() dto: PrivacyRequestDto) {
    return this.db.privacyRequest.create({ data: { userId: actor.id, type: dto.type } });
  }
  @Get('requests') list(@CurrentActor() actor: Actor) {
    return this.db.privacyRequest.findMany({
      where: { userId: actor.id },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  }
}
