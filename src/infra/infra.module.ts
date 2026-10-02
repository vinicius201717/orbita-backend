import { Global, Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';
import { CryptoService } from '../common/crypto.service';
import { OutboxService } from '../common/outbox.service';
@Global()
@Module({
  providers: [ConfigService, RedisService, PrismaService, CryptoService, OutboxService],
  exports: [ConfigService, RedisService, PrismaService, CryptoService, OutboxService],
})
export class InfraModule {}
