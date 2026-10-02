import { Injectable } from '@nestjs/common';
import { Delivery, Prisma } from '@prisma/client';
import { DomainError } from '../common/domain-error';

/** Called inside the delivery completion transaction; no payment provider is involved. */
@Injectable()
export class SettlementService {
  async settleDelivery(tx: Prisma.TransactionClient, delivery: Delivery): Promise<void> {
    if (!delivery.driverId)
      throw new DomainError('DELIVERY_UNASSIGNED', 'Delivery has no responsible driver');
    const idempotencyKey = `delivery-earning:${delivery.id}`;
    if (await tx.ledgerTransaction.findUnique({ where: { idempotencyKey } })) return;
    if (delivery.driverPayoutCents < 0 || delivery.revenueCents < 0 || delivery.tipCents < 0)
      throw new DomainError('INVALID_SETTLEMENT', 'Financial values cannot be negative');
    const driver = await tx.wallet.upsert({
      where: { key: `driver:${delivery.driverId}` },
      update: {},
      create: { key: `driver:${delivery.driverId}`, type: 'DRIVER', driverId: delivery.driverId },
    });
    const business = await tx.wallet.upsert({
      where: { key: `business:${delivery.businessId}` },
      update: {},
      create: { key: `business:${delivery.businessId}`, type: 'BUSINESS', businessId: delivery.businessId },
    });
    const platform = await tx.wallet.upsert({
      where: { key: 'platform' },
      update: {},
      create: { key: 'platform', type: 'PLATFORM' },
    });
    const entries: Prisma.WalletTransactionCreateWithoutLedgerTransactionInput[] = [
      {
        wallet: { connect: { id: business.id } },
        type: 'CHARGE',
        amountCents: -(delivery.revenueCents + delivery.tipCents),
      },
      {
        wallet: { connect: { id: driver.id } },
        type: 'DELIVERY_EARNING',
        amountCents: delivery.driverPayoutCents,
      },
      {
        wallet: { connect: { id: platform.id } },
        type: 'CHARGE',
        amountCents: delivery.revenueCents - delivery.driverPayoutCents,
      },
    ];
    if (delivery.tipCents > 0)
      entries.push({ wallet: { connect: { id: driver.id } }, type: 'TIP', amountCents: delivery.tipCents });
    await tx.ledgerTransaction.create({
      data: {
        idempotencyKey,
        referenceType: 'Delivery',
        referenceId: delivery.id,
        entries: { create: entries },
      },
    });
    await tx.driverEarning.create({
      data: {
        deliveryId: delivery.id,
        driverId: delivery.driverId,
        payoutCents: delivery.driverPayoutCents,
        tipCents: delivery.tipCents,
      },
    });
  }
}
