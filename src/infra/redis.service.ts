import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor(config: ConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: 2, lazyConnect: true });
    this.client.on('error', () => undefined);
  }
  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
