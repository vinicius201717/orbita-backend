import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
@Injectable()
export class CancellationService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: OutboxService,
  ) {}
  async cancel(actor: Actor, id: string, reason: string, reassign = false) {
    if (reassign && actor.role !== 'ADMIN')
      throw new DomainError('FORBIDDEN', 'Only admin can reassign', 403);
    return this.db.transaction(async (tx) => {
      const snapshot = await tx.delivery.findUniqueOrThrow({ where: { id } });
      await lockEntities(tx, [
        `delivery:${id}`,
        ...(snapshot.driverId ? [`driver:${snapshot.driverId}`] : []),
        ...(snapshot.routeId ? [`route:${snapshot.routeId}`] : []),
      ]);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      const ownBusiness =
        ['BUSINESS_OWNER', 'BUSINESS_STAFF'].includes(actor.role) && actor.businessId === delivery.businessId;
      const ownDriver = actor.role === 'DRIVER' && actor.driverId === delivery.driverId;
      if (actor.role !== 'ADMIN' && !ownBusiness && !ownDriver)
        throw new DomainError('DELIVERY_FORBIDDEN', 'Delivery not accessible', 403);
      if (['DELIVERED', 'RETURNED'].includes(delivery.status))
        throw new DomainError('DELIVERY_FINAL', 'Completed delivery cannot be cancelled');
      if (delivery.status === 'CANCELLED' || delivery.status === 'RETURN_REQUIRED')
        return { id, status: delivery.status };
      let status: 'RETURN_REQUIRED' | 'WAITING_POOL' | 'CANCELLED';
      if (delivery.pickedUpAt) status = 'RETURN_REQUIRED';
      else if (ownDriver || reassign) status = 'WAITING_POOL';
      else status = 'CANCELLED';
      const result = await tx.delivery.update({
        where: { id },
        data: {
          status,
          cancellationReason: reason,
          ...(status !== 'WAITING_POOL' ? { customerCodeCiphertext: null } : {}),
          ...(status === 'WAITING_POOL' ? { driverId: null, routeId: null, driverPayoutCents: 0 } : {}),
        },
      });
      if (delivery.routeId) {
        if (!delivery.pickedUpAt)
          await tx.routeStop.updateMany({
            where: { routeId: delivery.routeId, deliveryId: id, status: { in: ['PENDING', 'ARRIVED'] } },
            data: { status: 'SKIPPED' },
          });
        await tx.route.update({
          where: { id: delivery.routeId },
          data: {
            version: { increment: 1 },
            ...(!delivery.pickedUpAt
              ? {
                  grossValueCents: { decrement: delivery.revenueCents },
                  driverPayoutCents: { decrement: delivery.driverPayoutCents },
                  platformMarginCents: { decrement: delivery.revenueCents - delivery.driverPayoutCents },
                }
              : {}),
          },
        });
      }
      await tx.routeOffer.updateMany({
        where: {
          status: 'PENDING',
          OR: [
            { deliveries: { some: { deliveryId: id } } },
            ...(delivery.routeId ? [{ routeId: delivery.routeId }] : []),
          ],
        },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
      await tx.delivery.updateMany({
        where: {
          status: 'OFFERED',
          driverId: null,
          offerDeliveries: { none: { offer: { status: 'PENDING', expiresAt: { gt: new Date() } } } },
        },
        data: { status: 'WAITING_POOL' },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'delivery.cancelled_or_reassigned',
          entityType: 'Delivery',
          entityId: id,
          metadata: { reason, status },
        },
      });
      await this.events.emit(tx, 'DeliveryCancelled', id, {
        deliveryId: id,
        businessId: delivery.businessId,
        driverId: delivery.driverId,
        routeId: delivery.routeId,
        status,
      });
      return { id: result.id, status: result.status };
    });
  }
  async returnCargo(actor: Actor, id: string, complete: boolean) {
    return this.db.transaction(async (tx) => {
      const snapshot = await tx.delivery.findUniqueOrThrow({ where: { id } });
      await lockEntities(tx, [`delivery:${id}`, `driver:${snapshot.driverId}`, `route:${snapshot.routeId}`]);
      const d = await tx.delivery.findUniqueOrThrow({ where: { id } });
      if (actor.role !== 'ADMIN' && (!actor.driverId || actor.driverId !== d.driverId))
        throw new DomainError('DELIVERY_FORBIDDEN', 'Responsible driver required', 403);
      if (!d.routeId || !d.driverId || !d.pickedUpAt || !['RETURN_REQUIRED', 'RETURNING'].includes(d.status))
        throw new DomainError('RETURN_INVALID', 'No cargo return is pending');
      if (complete && actor.role !== 'ADMIN')
        throw new DomainError(
          'ADMIN_RETURN_REQUIRED',
          'Admin must acknowledge custody returned to the business',
          403,
        );
      const status = complete ? 'RETURNED' : 'RETURNING';
      await tx.delivery.update({ where: { id }, data: { status, customerCodeCiphertext: null } });
      if (complete) {
        await tx.driver.update({
          where: { id: d.driverId },
          data: { currentCapacityUnits: { decrement: d.capacityUnits } },
        });
        await tx.routeStop.updateMany({
          where: { routeId: d.routeId, deliveryId: id, status: { in: ['PENDING', 'ARRIVED'] } },
          data: { status: 'SKIPPED', completedAt: new Date() },
        });
      }
      await tx.route.update({ where: { id: d.routeId }, data: { version: { increment: 1 } } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: `delivery.${status.toLowerCase()}`,
          entityType: 'Delivery',
          entityId: id,
        },
      });
      await this.events.emit(tx, 'DeliveryUpdated', id, {
        deliveryId: id,
        businessId: d.businessId,
        driverId: d.driverId,
        routeId: d.routeId,
      });
      return { id, status, returnTo: { latitude: d.pickupLatitude, longitude: d.pickupLongitude } };
    });
  }
}
