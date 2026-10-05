import { Body, Controller, Header, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { GoogleMapsProvider } from './google-maps.provider';

export class AddressSearchDto {
  @ApiProperty({ example: 'Avenida Paulista, 1578, São Paulo, SP' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  @MaxLength(300)
  address: string;
}

@ApiTags('business')
@ApiBearerAuth()
@Roles('BUSINESS_OWNER', 'BUSINESS_STAFF')
@Controller('business/addresses')
export class BusinessAddressesController {
  constructor(
    private readonly config: ConfigService,
    private readonly maps: GoogleMapsProvider,
    private readonly db: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Post('search')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Find delivery address candidates; the merchant must confirm the destination' })
  async search(@CurrentActor() actor: Actor, @Body() dto: AddressSearchDto) {
    if (
      !actor.businessId ||
      !(await this.db.business.findFirst({
        where: { id: actor.businessId, active: true },
        select: { id: true },
      }))
    )
      throw new DomainError(
        'BUSINESS_REQUIRED',
        'Cadastre um estabelecimento ativo para buscar endereços.',
        403,
      );
    if (this.config.get('MAPS_PROVIDER') !== 'google')
      throw new DomainError(
        'ADDRESS_SEARCH_UNAVAILABLE',
        'A busca de endereços ainda não está ativada. Use um ponto confirmado no mapa.',
        503,
      );
    const count = await this.redis.client.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
      1,
      `address-search:${actor.businessId}`,
    );
    if (Number(count) > 20)
      throw new DomainError('RATE_LIMITED', 'Aguarde um minuto antes de buscar outro endereço.', 429);
    try {
      return { items: await this.maps.searchAddresses(dto.address), provider: 'Google Maps' };
    } catch {
      throw new DomainError(
        'ADDRESS_SEARCH_UNAVAILABLE',
        'Não foi possível buscar agora. Tente novamente ou informe o ponto no mapa.',
        503,
      );
    }
  }
}
