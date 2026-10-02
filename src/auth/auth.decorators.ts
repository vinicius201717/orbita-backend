import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Actor } from '../common/actor';
import { Request } from 'express';
export const Public = () => SetMetadata('public', true);
export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor =>
    context.switchToHttp().getRequest<Request & { actor: Actor }>().actor,
);
