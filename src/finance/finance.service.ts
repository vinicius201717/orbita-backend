import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
@Injectable()
export class FinanceService {
  constructor(private readonly db: PrismaService) {}
  async wallets(cursor?: string) {
    const rows = await this.db.wallet.findMany({
      take: 51, orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { business: { select: { tradeName: true } }, driver: { select: { user: { select: { name: true } } } } },
    });
    const sums = await this.db.walletTransaction.groupBy({ by: ['walletId'], where: { walletId: { in: rows.slice(0, 50).map((row) => row.id) } }, _sum: { amountCents: true } });
    return { items: rows.slice(0, 50).map(({ business, driver, ...wallet }) => ({
      ...wallet, ownerName: business?.tradeName ?? driver?.user.name ?? 'ORBITA',
      balanceCents: sums.find((sum) => sum.walletId === wallet.id)?._sum.amountCents ?? 0,
    })), nextCursor: rows.length > 50 ? rows[49]?.id ?? null : null };
  }
  async walletDetail(id: string, cursor?: string) {
    const wallet = await this.db.wallet.findUnique({ where: { id } });
    if (!wallet) throw new DomainError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    return { ...wallet, ...await this.account(wallet.key, cursor) };
  }
  async wallet(actor: Actor, cursor?: string) {
    if (!actor.driverId) throw new DomainError('DRIVER_REQUIRED', 'Driver required', 403);
    return this.account(`driver:${actor.driverId}`, cursor);
  }
  async billing(actor: Actor, cursor?: string) {
    if (!actor.businessId) throw new DomainError('BUSINESS_REQUIRED', 'Business account required', 403);
    return this.account(`business:${actor.businessId}`, cursor);
  }
  private async account(key: string, cursor?: string) {
    const wallet = await this.db.wallet.findUnique({ where: { key } });
    if (!wallet) return { balanceCents: 0, entries: [], nextCursor: null };
    const where = { walletId: wallet.id };
    const [sum, entries] = await Promise.all([
      this.db.walletTransaction.aggregate({ where, _sum: { amountCents: true } }),
      this.db.walletTransaction.findMany({
        where,
        take: 51,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    ]);
    return {
      walletId: wallet.id,
      balanceCents: sum._sum.amountCents ?? 0,
      entries: entries.slice(0, 50),
      nextCursor: entries.length > 50 ? entries[49]?.id : null,
    };
  }
  async earnings(actor: Actor, cursor?: string) {
    if (!actor.driverId) throw new DomainError('DRIVER_REQUIRED', 'Driver required', 403);
    return this.db.driverEarning.findMany({
      where: { driverId: actor.driverId },
      take: 50,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
  async adjust(actor: Actor, walletId: string, amountCents: number, reason: string, key: string) {
    if (actor.role !== 'ADMIN') throw new DomainError('FORBIDDEN', 'Admin required', 403);
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [`ledger:${key}`, `wallet:${walletId}`]);
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
      if (wallet.type === 'PLATFORM')
        throw new DomainError('INVALID_ADJUSTMENT', 'Choose a business or driver wallet', 400);
      const prior = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: `adjust:${key}` },
        include: { entries: true },
      });
      if (prior) {
        if (
          prior.referenceId !== actor.id ||
          prior.description !== reason ||
          !prior.entries.some((entry) => entry.walletId === walletId && entry.amountCents === amountCents)
        )
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key already used for a different adjustment',
          );
        const { entries: _entries, ...transaction } = prior;
        return transaction;
      }
      const platform = await tx.wallet.upsert({
        where: { key: 'platform' },
        update: {},
        create: { key: 'platform', type: 'PLATFORM' },
      });
      const result = await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: `adjust:${key}`,
          referenceType: 'AdminAdjustment',
          referenceId: actor.id,
          description: reason,
          entries: {
            create: [
              { walletId, type: 'ADJUSTMENT', amountCents },
              { walletId: platform.id, type: 'ADJUSTMENT', amountCents: -amountCents },
            ],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'finance.adjusted',
          entityType: 'Wallet',
          entityId: walletId,
          metadata: { amountCents, reason, ledgerTransactionId: result.id },
        },
      });
      return result;
    });
  }
}
