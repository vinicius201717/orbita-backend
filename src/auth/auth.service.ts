import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/prisma.service';
import { ConfigService } from '../config/config.service';
import { hashPassword, verifyPassword } from '../common/crypto.service';
import { DomainError } from '../common/domain-error';
import { Actor } from '../common/actor';
import { ChangePasswordDto, IdentityDto, LoginDto, RegisterDto, UpdateAccountDto } from './auth.dto';
import { lockEntities } from '../common/locks';
const claims = z.object({
  sub: z.string().uuid(),
  jti: z.string().uuid(),
  type: z.enum(['access', 'refresh']),
  familyId: z.string().uuid().optional(),
  v: z.number().int().nonnegative().default(0),
});
@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}
  async me(actor: Actor): Promise<IdentityDto> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        businessId: true,
        active: true,
        deletedAt: true,
        driver: { select: { id: true, phone: true } },
      },
    });
    if (!user.active || user.deletedAt) throw new DomainError('UNAUTHORIZED', 'Account unavailable', 401);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessId: user.businessId,
      driverId: user.driver?.id ?? null,
      phone: user.phone ?? user.driver?.phone ?? null,
    };
  }
  async updateAccount(actor: Actor, dto: UpdateAccountDto) {
    await this.db.transaction(async (tx) => {
      await lockEntities(tx, [`user:${actor.id}`, ...(actor.driverId ? [`driver:${actor.driverId}`] : [])]);
      if (actor.driverId && dto.phone) {
        const previous = await tx.driver.findUniqueOrThrow({ where: { id: actor.driverId } });
        await tx.driver.update({ where: { id: actor.driverId }, data: { phone: dto.phone } });
        if (dto.phone !== previous.phone)
          await tx.whatsAppIdentity.updateMany({
            where: { entityType: 'DRIVER', entityId: actor.driverId },
            data: { verifiedAt: null, optInAt: null },
          });
      }
      await tx.user.update({ where: { id: actor.id }, data: dto });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'account.updated', entityType: 'User', entityId: actor.id },
      });
    });
    return this.me(actor);
  }
  async changePassword(actor: Actor, dto: ChangePasswordDto) {
    const snapshot = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await verifyPassword(dto.currentPassword, snapshot.passwordHash)))
      throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect', 400);
    const passwordHash = await hashPassword(dto.newPassword);
    await this.db.transaction(async (tx) => {
      await lockEntities(tx, [`user:${actor.id}`]);
      const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (current.passwordHash !== snapshot.passwordHash)
        throw new DomainError('SESSION_CHANGED', 'Sign in again before changing password', 409);
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { userId: actor.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'account.password_changed',
          entityType: 'User',
          entityId: actor.id,
        },
      });
    });
    return { success: true, signInRequired: true };
  }
  async register(dto: RegisterDto) {
    const passwordHash = await hashPassword(dto.password);
    try {
      const user = await this.db.user.create({
        data: {
          email: dto.email.toLowerCase(),
          name: dto.name,
          phone: dto.phone,
          passwordHash,
          role: dto.role,
          ...(dto.role === 'DRIVER' ? { driver: { create: { phone: dto.phone } } } : {}),
        },
        select: { id: true, email: true, role: true },
      });
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainError('ACCOUNT_EXISTS', 'Email or phone already registered', 409);
      throw error;
    }
  }
  async login(dto: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Keep password derivation work even when the account is unknown.
    const valid = user
      ? await verifyPassword(dto.password, user.passwordHash)
      : await verifyPassword(dto.password, 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128));
    if (!user || !user.active || user.deletedAt || !valid)
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
    return this.db.transaction((tx) => this.issue(tx, user));
  }
  private async issue(tx: Prisma.TransactionClient, user: User, familyId: string = randomUUID()) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID(), type: 'access', v: user.authVersion },
      {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS'),
        issuer: 'orbita',
        audience: 'orbita-api',
        algorithm: 'HS256',
      },
    );
    const tokenId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: tokenId, type: 'refresh', familyId, v: user.authVersion },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_TTL_SECONDS'),
        issuer: 'orbita',
        audience: 'orbita-refresh',
        algorithm: 'HS256',
      },
    );
    await tx.refreshToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        familyId,
        tokenHash: this.digest(refreshToken),
        expiresAt: new Date(Date.now() + this.config.get('JWT_REFRESH_TTL_SECONDS') * 1000),
      },
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS'),
      tokenType: 'Bearer',
    };
  }
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  async refresh(token: string) {
    let parsed: z.infer<typeof claims>;
    try {
      parsed = claims.parse(
        await this.jwt.verifyAsync(token, {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          issuer: 'orbita',
          audience: 'orbita-refresh',
          algorithms: ['HS256'],
        }),
      );
    } catch {
      throw new DomainError('INVALID_REFRESH', 'Invalid refresh token', 401);
    }
    if (parsed.type !== 'refresh') throw new DomainError('INVALID_REFRESH', 'Invalid refresh token', 401);
    const result = await this.db.transaction(async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { tokenHash: this.digest(token) },
        include: { user: true },
      });
      if (
        !stored ||
        stored.userId !== parsed.sub ||
        !stored.user.active ||
        stored.user.deletedAt ||
        stored.user.authVersion !== parsed.v ||
        stored.expiresAt <= new Date()
      )
        return null;
      if (stored.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return null;
      }
      const claimed = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      return this.issue(tx, stored.user, stored.familyId);
    });
    if (!result) throw new DomainError('INVALID_REFRESH', 'Refresh token expired or revoked', 401);
    return result;
  }
  async logout(actor: Actor, token: string) {
    const stored = await this.db.refreshToken.findUnique({ where: { tokenHash: this.digest(token) } });
    if (stored?.userId === actor.id)
      await this.db.refreshToken.updateMany({
        where: { familyId: stored.familyId, userId: actor.id },
        data: { revokedAt: new Date() },
      });
    return { success: true };
  }
  async authenticate(token: string): Promise<Actor> {
    let parsed: z.infer<typeof claims>;
    try {
      parsed = claims.parse(
        await this.jwt.verifyAsync(token, {
          secret: this.config.get('JWT_SECRET'),
          issuer: 'orbita',
          audience: 'orbita-api',
          algorithms: ['HS256'],
        }),
      );
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Invalid access token', 401);
    }
    if (parsed.type !== 'access') throw new DomainError('UNAUTHORIZED', 'Invalid access token', 401);
    const user = await this.db.user.findUnique({
      where: { id: parsed.sub },
      include: { driver: { select: { id: true } } },
    });
    if (!user?.active || user.deletedAt || user.authVersion !== parsed.v)
      throw new DomainError('UNAUTHORIZED', 'Account unavailable', 401);
    return { id: user.id, role: user.role, businessId: user.businessId, driverId: user.driver?.id ?? null };
  }
}
