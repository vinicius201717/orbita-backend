import { Delivery } from '@prisma/client';
import { Actor } from '../common/actor';
import { CryptoService } from '../common/crypto.service';
import { OutboxService } from '../common/outbox.service';
import { ConfigService } from '../config/config.service';
import { SettlementService } from '../finance/settlement.service';
import { PrismaService } from '../infra/prisma.service';
import { DeliveriesService, deliveryView } from './deliveries.service';
import { DeliveryStateMachineService } from './delivery-state-machine.service';

const driver: Actor = { id: 'user-driver', role: 'DRIVER', driverId: 'driver', businessId: null };
const business: Actor = {
  id: 'user-business',
  role: 'BUSINESS_OWNER',
  driverId: null,
  businessId: 'business',
};
function fixture(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery',
    businessId: 'business',
    driverId: 'driver',
    routeId: 'route',
    status: 'IN_TRANSIT',
    verificationCodeHash: 'private-pin-hash',
    verificationAttempts: 0,
    lockedAt: null,
    customerConfirmationTokenHash: 'private-token-hash',
    customerPhone: '+5562999999999',
    confirmationExpiresAt: new Date(Date.now() + 3600000),
    customerOptInAt: new Date(),
    pickedUpAt: new Date(),
    capacityUnits: 10,
    ...overrides,
  } as Delivery;
}
function setup(initial = fixture()) {
  let delivery = initial;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    delivery: {
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(delivery)),
      update: jest.fn().mockImplementation(({ data }: { data: Partial<Delivery> }) => {
        delivery = { ...delivery, ...data };
        return Promise.resolve(delivery);
      }),
    },
    fraudFlag: { create: jest.fn().mockResolvedValue({}) },
  };
  const transaction = jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  const crypto = { matches: jest.fn().mockReturnValue(true) };
  const config = { get: jest.fn((key: string) => (key === 'PIN_MAX_ATTEMPTS' ? 3 : 0)) };
  const service = new DeliveriesService(
    { transaction } as unknown as PrismaService,
    config as unknown as ConfigService,
    crypto as unknown as CryptoService,
    {} as OutboxService,
    new DeliveryStateMachineService(),
    {} as SettlementService,
  );
  return { service, tx, crypto, transaction };
}
describe('Delivery security and PIN', () => {
  it('does not expose verification secrets to drivers or businesses', () => {
    for (const actor of [driver, business]) {
      const view = deliveryView(fixture(), actor);
      expect(view).not.toHaveProperty('verificationCodeHash');
      expect(view).not.toHaveProperty('customerConfirmationTokenHash');
      expect(view).not.toHaveProperty('verificationAttempts');
    }
    expect(deliveryView(fixture(), driver).customerPhone).toBe('+55******99');
  });
  it('rejects unrelated business and unassigned driver access', () => {
    const { service } = setup();
    expect(() => service.assertAccess({ ...business, businessId: 'other' }, fixture())).toThrow(
      'Delivery not accessible',
    );
    expect(() => service.assertAccess(driver, fixture({ driverId: null }))).toThrow(
      'Delivery not accessible',
    );
  });
  it('accepts the correct PIN for the assigned driver', async () => {
    const { service, crypto } = setup();
    const completion = jest.spyOn(service, 'complete').mockResolvedValue(fixture({ status: 'DELIVERED' }));
    await expect(service.verify(driver, 'delivery', { code: '4821' })).resolves.toMatchObject({
      status: 'DELIVERED',
    });
    expect(crypto.matches).toHaveBeenCalledWith('delivery:4821', 'private-pin-hash');
    expect(completion).toHaveBeenCalledTimes(1);
  });
  it('commits incorrect attempts before returning the HTTP error', async () => {
    const { service, tx, crypto, transaction } = setup();
    crypto.matches.mockReturnValue(false);
    await expect(service.verify(driver, 'delivery', { code: '0000' })).rejects.toThrow(
      'Invalid verification code',
    );
    expect(tx.delivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { verificationAttempts: 1, lockedAt: null } }),
    );
    await expect(transaction.mock.results[0]?.value as Promise<unknown>).resolves.toEqual({
      error: 'PIN_INVALID',
    });
  });
  it('locks exactly at the configured limit and records a fraud signal', async () => {
    const { service, tx, crypto } = setup(fixture({ verificationAttempts: 2 }));
    crypto.matches.mockReturnValue(false);
    await expect(service.verify(driver, 'delivery', { code: '0000' })).rejects.toThrow(
      'Verification attempts exhausted',
    );
    expect(tx.delivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { verificationAttempts: 3, lockedAt: expect.any(Date) } }),
    );
    expect(tx.fraudFlag.create).toHaveBeenCalledTimes(1);
    crypto.matches.mockClear();
    await expect(service.verify(driver, 'delivery', { code: '4821' })).rejects.toThrow(
      'Verification attempts exhausted',
    );
    expect(crypto.matches).not.toHaveBeenCalled();
  });
  it('does not verify a PIN on behalf of another driver', async () => {
    const { service, crypto } = setup();
    await expect(
      service.verify({ ...driver, driverId: 'other' }, 'delivery', { code: '4821' }),
    ).rejects.toThrow('Only the assigned driver');
    expect(crypto.matches).not.toHaveBeenCalled();
  });
  it('returns completed deliveries idempotently without another settlement', async () => {
    const { service, crypto } = setup(fixture({ status: 'DELIVERED' }));
    const complete = jest.spyOn(service, 'complete');
    await expect(service.verify(driver, 'delivery', { code: '4821' })).resolves.toMatchObject({
      status: 'DELIVERED',
    });
    expect(complete).not.toHaveBeenCalled();
    expect(crypto.matches).not.toHaveBeenCalled();
  });
  it('rejects confirmation before the pickup lifecycle', async () => {
    const { service } = setup(fixture({ status: 'ASSIGNED' }));
    await expect(service.verify(driver, 'delivery', { code: '4821' })).rejects.toThrow('cannot transition');
  });
});
describe('Delivery state machine', () => {
  const states = new DeliveryStateMachineService();
  it('supports collection, transit, proof and return paths', () => {
    expect(() => states.assertTransition('PICKUP_PENDING', 'PICKED_UP')).not.toThrow();
    expect(() => states.assertTransition('IN_TRANSIT', 'DELIVERED')).not.toThrow();
    expect(() => states.assertTransition('RETURN_REQUIRED', 'RETURNING')).not.toThrow();
  });
  it('rejects terminal resurrection and proof bypass', () => {
    expect(() => states.assertTransition('DELIVERED', 'WAITING_POOL')).toThrow();
    expect(() => states.assertTransition('CANCELLED', 'ASSIGNED')).toThrow();
    expect(() => states.assertTransition('WAITING_POOL', 'DELIVERED')).toThrow();
  });
});
