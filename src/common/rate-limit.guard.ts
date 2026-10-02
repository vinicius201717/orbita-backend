import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { RedisService } from '../infra/redis.service';
import { DomainError } from './domain-error';
const increment =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (context.getClass().name === 'HealthController') return true;
    const scope = `${context.getClass().name}:${context.getHandler().name}`;
    const limit = scope.includes('AuthController')
      ? 15
      : scope.toLowerCase().includes('verify')
        ? 15
        : scope.toLowerCase().includes('location')
          ? 180
          : scope.includes('Webhook') || scope.includes('WhatsApp')
            ? 300
            : 120;
    const ipHash = createHash('sha256')
      .update(request.ip ?? request.socket.remoteAddress ?? 'unknown')
      .digest('hex');
    let count: unknown;
    try {
      count = await this.redis.client.eval(increment, 1, `rate:${scope}:${ipHash}`, 60);
    } catch {
      throw new DomainError('RATE_LIMIT_UNAVAILABLE', 'Please retry shortly', 503);
    }
    if (Number(count) > limit) throw new DomainError('RATE_LIMITED', 'Request limit reached', 429);
    return true;
  }
}
