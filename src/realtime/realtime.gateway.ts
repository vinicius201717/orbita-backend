import { Injectable } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { Actor } from '../common/actor';
import { TrackingService } from '../tracking/tracking.service';
import { LocationDto } from '../drivers/drivers.dto';
import { RedisService } from '../infra/redis.service';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../infra/prisma.service';
type ActorSocket = Socket & { data: { actor?: Actor; token?: string } };
@Injectable()
@WebSocketGateway({
  namespace: '/operations',
  cors: { origin: (process.env.CORS_ORIGINS ?? '').split(',') },
  maxHttpBufferSize: 16384,
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly auth: AuthService,
    private readonly tracking: TrackingService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
    private readonly db: PrismaService,
  ) {}
  afterInit(server: Server) {
    this.realtime.server = server;
  }
  async handleConnection(socket: ActorSocket) {
    try {
      const token: unknown = socket.handshake.auth.token;
      if (typeof token !== 'string') throw new Error('Missing token');
      const actor = await this.auth.authenticate(token);
      socket.data.actor = actor;
      socket.data.token = token;
      if (actor.role === 'DRIVER' && actor.driverId) await socket.join(`driver:${actor.driverId}`);
      if (actor.businessId) await socket.join(`business:${actor.businessId}`);
      if (actor.role === 'ADMIN') await socket.join('admin');
      // Access tokens expire during long-lived connections as well.
      const payload: unknown = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      );
      const expiry =
        typeof payload === 'object' && payload !== null && 'exp' in payload
          ? Number(payload.exp) * 1000
          : Date.now();
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, expiry - Date.now()));
      timer.unref();
      socket.once('disconnect', () => clearTimeout(timer));
    } catch {
      socket.disconnect(true);
    }
  }
  @SubscribeMessage('driver.location')
  async location(@ConnectedSocket() socket: ActorSocket, @MessageBody() body: unknown) {
    try {
      const actor = await this.auth.authenticate(socket.data.token ?? '');
      if (actor.role !== 'DRIVER') return { error: 'FORBIDDEN' };
      const count = await this.redis.client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
        1,
        `ws:location:${actor.id}`,
      );
      if (Number(count) > 180) return { error: 'RATE_LIMITED' };
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        return { error: 'INVALID_PAYLOAD' };
      const dto = plainToInstance(LocationDto, body);
      if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length)
        return { error: 'INVALID_PAYLOAD' };
      return await this.tracking.update(actor, dto);
    } catch {
      return { error: 'LOCATION_REJECTED' };
    }
  }
  @SubscribeMessage('route.subscribe')
  async route(@ConnectedSocket() socket: ActorSocket, @MessageBody() body: unknown) {
    try {
      const actor = await this.auth.authenticate(socket.data.token ?? '');
      if (
        typeof body !== 'object' ||
        body === null ||
        !('routeId' in body) ||
        typeof body.routeId !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(body.routeId)
      )
        return { error: 'INVALID_PAYLOAD' };
      const route = await this.db.route.findUnique({ where: { id: body.routeId } });
      if (!route || (actor.role !== 'ADMIN' && actor.driverId !== route.driverId))
        return { error: 'FORBIDDEN' };
      await socket.join(`route:${route.id}`);
      return { subscribed: true };
    } catch {
      return { error: 'UNAUTHORIZED' };
    }
  }
}
