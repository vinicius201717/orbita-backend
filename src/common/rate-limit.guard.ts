import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { RedisService } from '../infra/redis.service';
import { DomainError } from './domain-error';
import { Actor } from './actor';
const increment =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
// An abuse ceiling for the whole trusted source, not the normal per-user quota.
// Shared BFFs must have room for many independently limited authenticated users.
export const PRE_AUTH_SOURCE_LIMIT = 6000;
@Injectable()
export class PreAuthRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getClass().name === 'HealthController') return true;
    const request = context.switchToHttp().getRequest<Request>();
    // Express resolves this only through bootstrap's explicit proxy allowlist.
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    let count: unknown;
    try {
      count = await this.redis.client.eval(increment, 1, `rate:pre-auth:${digest(ip)}`, 60);
    } catch {
      throw new DomainError('RATE_LIMIT_UNAVAILABLE', 'Please retry shortly', 503);
    }
    if (Number(count) > PRE_AUTH_SOURCE_LIMIT)
      throw new DomainError('RATE_LIMITED', 'Request limit reached', 429);
    return true;
  }
}
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    if (context.getClass().name === 'HealthController') return true;
    const scope = `${context.getClass().name}:${context.getHandler().name}`;
    const limit =
      scope.includes('AuthController') &&
      ['register', 'login', 'refresh', 'changePassword'].includes(context.getHandler().name)
        ? 15
        : scope.toLowerCase().includes('verify') || context.getHandler().name === 'customerCode'
          ? 15
          : scope.toLowerCase().includes('location')
            ? 180
            : scope.includes('Webhook') || scope.includes('WhatsApp')
              ? 300
              : 120;
    // request.ip only honors the explicit proxy allowlist configured in bootstrap.
    // Never read a client-supplied forwarded-for header here.
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const body = request.body as { email?: unknown; refreshToken?: unknown } | undefined;
    const authEndpoint = context.getClass().name === 'AuthController';
    const email = authEndpoint && ['login', 'register'].includes(context.getHandler().name) && typeof body?.email === 'string'
      ? body.email.trim().toLowerCase().slice(0, 320) : null;
    const refresh = authEndpoint && context.getHandler().name === 'refresh' && typeof body?.refreshToken === 'string'
      ? body.refreshToken : null;
    const identity = request.actor ? `actor:${request.actor.id}` : email ? `account:${email}` : refresh ? `refresh:${refresh}` : `ip:${ip}`;
    let counts: unknown[];
    try {
      counts = await Promise.all([
        this.redis.client.eval(increment, 1, `rate:${scope}:${digest(identity)}`, 60),
        // A second, generous anonymous source budget limits account/token spraying while
        // allowing distinct legitimate logins through the same BFF or corporate network.
        ...(!request.actor && (email || refresh) ? [this.redis.client.eval(increment, 1, `rate:anonymous-source:${digest(ip)}`, 60)] : []),
      ]);
    } catch {
      throw new DomainError('RATE_LIMIT_UNAVAILABLE', 'Please retry shortly', 503);
    }
    if (Number(counts[0]) > limit || Number(counts[1] ?? 0) > 1000)
      throw new DomainError('RATE_LIMITED', 'Request limit reached', 429);
    return true;
  }
}
