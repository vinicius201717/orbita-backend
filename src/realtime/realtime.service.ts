import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { RedisService } from '../infra/redis.service';
import { z } from 'zod';
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  server?: Server;
  private subscriber?: Redis;
  constructor(private readonly redis: RedisService) {}
  async onModuleInit() {
    this.subscriber = this.redis.client.duplicate();
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('message', (_channel, message) => {
      try {
        const event = z
          .object({ room: z.string(), event: z.string(), payload: z.unknown() })
          .parse(JSON.parse(message));
        this.emit(event.room, event.event, event.payload);
      } catch {
        return;
      }
    });
    await this.subscriber.subscribe('orbita:realtime');
  }
  onModuleDestroy() {
    this.subscriber?.disconnect();
  }
  emit(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }
  publish(room: string, event: string, payload: unknown) {
    return this.redis.client.publish('orbita:realtime', JSON.stringify({ room, event, payload }));
  }
}
