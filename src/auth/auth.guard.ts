import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { AuthService } from './auth.service';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;
    const request = context.switchToHttp().getRequest<Request & { actor: Actor }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED', 'Bearer token required', 401);
    request.actor = await this.auth.authenticate(header.slice(7));
    const roles = this.reflector.getAllAndOverride<UserRole[]>('roles', targets);
    if (roles && !roles.includes(request.actor.role))
      throw new DomainError('FORBIDDEN', 'Role not authorized', 403);
    return true;
  }
}
