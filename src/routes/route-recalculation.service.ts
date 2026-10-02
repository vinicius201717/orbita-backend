import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { MapsProvider } from '../maps/maps.provider';
import { ConfigService } from '../config/config.service';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
@Injectable()
export class RouteRecalculationService {
  constructor(
    private readonly db: PrismaService,
    private readonly maps: MapsProvider,
    private readonly config: ConfigService,
    private readonly events: OutboxService,
  ) {}
  async recalculate(id: string) {
    const route = await this.db.route.findUnique({
      where: { id },
      include: {
        stops: {
          where: { status: { in: ['PENDING', 'ARRIVED'] } },
          orderBy: { sequence: 'asc' },
          include: { delivery: true },
        },
        driver: { include: { currentLocation: true } },
      },
    });
    if (!route || !['ACTIVE', 'ASSIGNED'].includes(route.status) || !route.stops.length) return;
    const current = route.driver.currentLocation;
    if (!current || current.expiresAt <= new Date()) return;
    const points = [
      { latitude: current.latitude, longitude: current.longitude },
      ...route.stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ];
    const matrix = await this.maps.distanceMatrix(points);
    let at = Date.now(),
      distance = 0;
    const estimates: Array<{ id: string; at: Date; late: boolean }> = [];
    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i],
        leg = matrix[i]?.[i + 1];
      if (!stop || !leg || !Number.isFinite(leg.durationSeconds)) return;
      distance += leg.distanceMeters;
      at += leg.durationSeconds * 1000;
      if (stop.type === 'PICKUP')
        at = Math.max(at, (stop.delivery.readyAt ?? stop.delivery.estimatedReadyAt ?? new Date()).getTime());
      estimates.push({
        id: stop.id,
        at: new Date(at),
        late:
          at >
          (stop.type === 'PICKUP' ? stop.delivery.pickupDeadline : stop.delivery.deliveryDeadline).getTime(),
      });
      at += this.config.get('STOP_SERVICE_SECONDS') * 1000;
    }
    await this.db.transaction(async (tx) => {
      await lockEntities(tx, [`driver:${route.driverId}`, `route:${id}`]);
      const updated = await tx.route.updateMany({
        where: { id, version: route.version },
        data: { version: { increment: 1 } },
      });
      if (!updated.count) return;
      for (const estimate of estimates)
        await tx.routeStop.update({ where: { id: estimate.id }, data: { estimatedArrivalAt: estimate.at } });
      await tx.routeOffer.updateMany({
        where: { routeId: id, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: 'route.recalculated',
          entityType: 'Route',
          entityId: id,
          metadata: {
            remainingDistanceMeters: distance,
            remainingDurationSeconds: Math.ceil((at - Date.now()) / 1000),
            slaAtRisk: estimates.some((e) => e.late),
          },
        },
      });
      await this.events.emit(tx, 'RouteUpdated', id, { routeId: id, driverId: route.driverId });
    });
  }
}
