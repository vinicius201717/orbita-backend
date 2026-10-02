import { Delivery, Prisma } from '@prisma/client';
import { SettlementService } from './settlement.service';

describe('Atomic delivery settlement', () => {
  const delivery = {
    id: 'delivery',
    driverId: 'driver',
    businessId: 'business',
    revenueCents: 700,
    driverPayoutCents: 500,
    tipCents: 123,
  } as Delivery;
  function setup(alreadyPosted = false) {
    const tx = {
      wallet: {
        upsert: jest
          .fn()
          .mockImplementation(({ where }: { where: { key: string } }) => Promise.resolve({ id: where.key })),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(alreadyPosted ? { id: 'posted' } : null),
        create: jest.fn().mockResolvedValue({}),
      },
      driverEarning: { create: jest.fn().mockResolvedValue({}) },
    };
    return { tx, service: new SettlementService() };
  }
  it('balances integer cents and attributes the whole tip separately', async () => {
    const { tx, service } = setup();
    await service.settleDelivery(tx as unknown as Prisma.TransactionClient, delivery);
    const call = tx.ledgerTransaction.create.mock.calls[0]?.[0] as {
      data: {
        entries: { create: { amountCents: number; type: string; wallet: { connect: { id: string } } }[] };
      };
    };
    const entries = call.data.entries.create;
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
    expect(entries.every((entry) => Number.isInteger(entry.amountCents))).toBe(true);
    expect(entries.find((entry) => entry.type === 'TIP')).toMatchObject({
      amountCents: 123,
      wallet: { connect: { id: 'driver:driver' } },
    });
    expect(tx.driverEarning.create).toHaveBeenCalledTimes(1);
  });
  it('does not create another earning when the reference is already posted', async () => {
    const { tx, service } = setup(true);
    await service.settleDelivery(tx as unknown as Prisma.TransactionClient, delivery);
    expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
    expect(tx.driverEarning.create).not.toHaveBeenCalled();
  });
});
