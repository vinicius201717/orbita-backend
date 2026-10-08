import { RouteStop } from '@prisma/client';
import { OutboxService } from '../common/outbox.service';
import { ConfigService } from '../config/config.service';
import { DeliveryStateMachineService } from '../deliveries/delivery-state-machine.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { RoutesService } from './routes.service';

describe('Route lifecycle guards', () => {
  const service = new RoutesService(
    {} as PrismaService,
    {} as ConfigService,
    {} as OutboxService,
    new DeliveryStateMachineService(),
    {} as RedisService,
  );
  const stops = [
    { id: 'pickup-1', sequence: 0, status: 'COMPLETED', type: 'PICKUP' },
    { id: 'pickup-2', sequence: 1, status: 'PENDING', type: 'PICKUP' },
    { id: 'dropoff-1', sequence: 2, status: 'PENDING', type: 'DROPOFF' },
  ] as RouteStop[];
  it('preserves strict stop order after an executed prefix', () => {
    expect(service.assertNextStop(stops, 'pickup-2').id).toBe('pickup-2');
    expect(() => service.assertNextStop(stops, 'dropoff-1')).toThrow('Complete earlier stops first');
  });
  it('allows idempotent completed stop checks and denies missing stops', () => {
    expect(service.assertNextStop(stops, 'pickup-1').status).toBe('COMPLETED');
    expect(() => service.assertNextStop(stops, 'unknown')).toThrow('Stop not found');
  });
  it('prevents business and unrelated driver mutations', () => {
    expect(() =>
      service.assertDriver(
        { id: 'user', role: 'BUSINESS_OWNER', businessId: 'business', driverId: null },
        { driverId: 'driver' },
      ),
    ).toThrow();
    expect(() =>
      service.assertDriver(
        { id: 'user', role: 'DRIVER', businessId: null, driverId: 'other' },
        { driverId: 'driver' },
      ),
    ).toThrow();
  });
});
