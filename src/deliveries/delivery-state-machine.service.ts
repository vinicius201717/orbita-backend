import { Injectable } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { DomainError } from '../common/domain-error';

const transitions: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  CREATED: ['WAITING_POOL', 'CANCELLED'],
  WAITING_POOL: ['MATCHING', 'OFFERED', 'ASSIGNED', 'CANCELLED'],
  MATCHING: ['WAITING_POOL', 'OFFERED', 'ASSIGNED', 'CANCELLED'],
  OFFERED: ['WAITING_POOL', 'ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKUP_PENDING', 'WAITING_POOL', 'CANCELLED'],
  PICKUP_PENDING: ['PICKED_UP', 'WAITING_POOL', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'RETURN_REQUIRED', 'FAILED'],
  IN_TRANSIT: ['ARRIVING', 'DELIVERED', 'RETURN_REQUIRED', 'FAILED'],
  ARRIVING: ['DELIVERED', 'RETURN_REQUIRED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['RETURN_REQUIRED', 'CANCELLED'],
  CANCELLED: [],
  RETURN_REQUIRED: ['RETURNING'],
  RETURNING: ['RETURNED'],
  RETURNED: [],
};
@Injectable()
export class DeliveryStateMachineService {
  assertTransition(from: DeliveryStatus, to: DeliveryStatus): void {
    if (!transitions[from].includes(to))
      throw new DomainError('DELIVERY_INVALID_STATE', `Delivery cannot transition from ${from} to ${to}`);
  }
}
