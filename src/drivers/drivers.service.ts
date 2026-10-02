import { Injectable } from '@nestjs/common';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { lockEntities } from '../common/locks';
import { DriverStatus } from '@prisma/client';
import { OutboxService } from '../common/outbox.service';
import { VehicleDto } from './drivers.dto';
@Injectable()
export class DriversService {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly events: OutboxService,
  ) {}
  driverId(actor: Actor) {
    if (!actor.driverId || actor.role !== 'DRIVER')
      throw new DomainError('DRIVER_REQUIRED', 'Driver account required', 403);
    return actor.driverId;
  }
  async me(actor: Actor) {
    const driver = await this.db.driver.findUniqueOrThrow({
      where: { id: this.driverId(actor) },
      include: { vehicles: true, currentLocation: true },
    });
    return {
      ...driver,
      presence: driver.currentLocation && driver.currentLocation.expiresAt > new Date() ? 'FRESH' : 'STALE',
    };
  }
  async consent(actor: Actor, granted: boolean) {
    const id = this.driverId(actor);
    const result = await this.db.transaction(async (tx) => {
      await lockEntities(tx, [`driver:${id}`]);
      await tx.consentRecord.create({
        data: { userId: actor.id, purpose: 'OPERATIONAL_GPS', granted, version: '1' },
      });
      await tx.driver.update({
        where: { id },
        data: {
          locationConsentAt: granted ? new Date() : null,
          ...(!granted ? { status: 'PAUSED', acceptNewOrders: false } : {}),
        },
      });
      if (!granted) await tx.driverLocation.deleteMany({ where: { driverId: id } });
      return { granted };
    });
    if (!granted) await this.redis.client.del(`driver:${id}:location`);
    return result;
  }
  async status(actor: Actor, status: DriverStatus) {
    const id = this.driverId(actor);
    const result = await this.db.transaction(async (tx) => {
      await lockEntities(tx, [`driver:${id}`]);
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id },
        include: { vehicles: { where: { active: true } } },
      });
      if (status === 'ON_ROUTE' && !driver.currentRouteId)
        throw new DomainError('STATUS_MANAGED', 'ON_ROUTE requires an assigned route');
      if (driver.currentRouteId && status === 'AVAILABLE')
        throw new DomainError('ROUTE_ACTIVE', 'Finish the current route first');
      if (
        ['AVAILABLE', 'ON_ROUTE'].includes(status) &&
        (!driver.locationConsentAt || driver.onboardingStatus !== 'APPROVED' || !driver.vehicles.length)
      )
        throw new DomainError(
          'DRIVER_INELIGIBLE',
          'Approved onboarding, GPS consent and active vehicle required',
        );
      if (status === 'OFFLINE' && driver.currentRouteId)
        throw new DomainError(
          'ROUTE_ACTIVE',
          'Report an incident or finish the current route before going offline',
        );
      const updated = await tx.driver.update({
        where: { id },
        data: { status, acceptNewOrders: ['AVAILABLE', 'ON_ROUTE'].includes(status) },
      });
      if (status === 'OFFLINE' || status === 'PAUSED')
        await tx.driverLocation.deleteMany({ where: { driverId: id } });
      await this.events.emit(tx, 'driver.status.updated', id, { driverId: id, status });
      return updated;
    });
    if (status === 'OFFLINE' || status === 'PAUSED') await this.redis.client.del(`driver:${id}:location`);
    return result;
  }
  async vehicle(actor: Actor, dto: VehicleDto) {
    const id = this.driverId(actor);
    return this.db.transaction(async (tx) => {
      await lockEntities(tx, [`driver:${id}`]);
      const driver = await tx.driver.findUniqueOrThrow({ where: { id } });
      if (driver.currentRouteId)
        throw new DomainError('ROUTE_ACTIVE', 'Cannot change vehicle while a route is assigned');
      await tx.vehicle.updateMany({ where: { driverId: id, active: true }, data: { active: false } });
      const vehicle = await tx.vehicle.create({ data: { ...dto, driverId: id } });
      await tx.driver.update({ where: { id }, data: { maxCapacityUnits: dto.capacityUnits } });
      return vehicle;
    });
  }
}
