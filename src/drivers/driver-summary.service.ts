import { Injectable } from '@nestjs/common';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { PrismaService } from '../infra/prisma.service';
import { DriverSummaryDto } from './driver-summary.dto';

@Injectable()
export class DriverSummaryService {
  constructor(private readonly db: PrismaService) {}

  async get(actor: Actor): Promise<DriverSummaryDto> {
    if (actor.role !== 'DRIVER' || !actor.driverId)
      throw new DomainError('DRIVER_REQUIRED', 'Driver account required', 403);
    const driverId = actor.driverId;
    return this.db.transaction(async (tx) => {
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: driverId },
        include: { currentLocation: { select: { expiresAt: true } } },
      });
      const [day] = await tx.$queryRaw<Array<{ date: string; start: Date; end: Date }>>`
        SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
        date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS start,
        (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo' AS end
      `;
      if (!day) throw new DomainError('SUMMARY_UNAVAILABLE', 'Driver summary unavailable', 503);
      const today = { gte: day.start, lt: day.end };
      const [balance, earnings, completedDeliveries, route] = await Promise.all([
        tx.walletTransaction.aggregate({
          where: { wallet: { driverId, type: 'DRIVER' } },
          _sum: { amountCents: true },
        }),
        tx.driverEarning.aggregate({
          where: { driverId, createdAt: today },
          _sum: { payoutCents: true, tipCents: true },
        }),
        tx.delivery.count({ where: { driverId, status: 'DELIVERED', deliveredAt: today } }),
        driver.currentRouteId
          ? tx.route.findFirst({
              where: { id: driver.currentRouteId, driverId, status: { in: ['ASSIGNED', 'ACTIVE'] } },
              include: {
                stops: { orderBy: { sequence: 'asc' } },
                deliveries: {
                  select: {
                    id: true,
                    status: true,
                    readinessStatus: true,
                    customerName: true,
                    complement: true,
                    branch: {
                      select: { name: true, address: true, business: { select: { tradeName: true } } },
                    },
                  },
                },
              },
            })
          : null,
      ]);
      const pendingStops =
        route?.stops.filter((stop) => !['COMPLETED', 'SKIPPED'].includes(stop.status)) ?? [];
      const next = pendingStops[0];
      const delivery = next ? route?.deliveries.find((item) => item.id === next.deliveryId) : null;
      const destination = next ? encodeURIComponent(`${next.latitude},${next.longitude}`) : '';
      return {
        driver: {
          id: driver.id,
          status: driver.status,
          acceptNewOrders: driver.acceptNewOrders,
          onboardingStatus: driver.onboardingStatus,
          locationConsentAt: driver.locationConsentAt,
          presence:
            driver.currentLocation && driver.currentLocation.expiresAt > new Date() ? 'FRESH' : 'STALE',
        },
        wallet: { balanceCents: balance._sum.amountCents ?? 0, currency: 'BRL' },
        today: {
          date: day.date,
          timeZone: 'America/Sao_Paulo',
          earningsCents: (earnings._sum.payoutCents ?? 0) + (earnings._sum.tipCents ?? 0),
          completedDeliveries,
        },
        currentRoute: route
          ? {
              id: route.id,
              status: route.status,
              version: route.version,
              remainingStops: pendingStops.length,
              totalStops: route.stops.length,
              remainingDeliveries: route.deliveries.filter(
                (item) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(item.status),
              ).length,
              driverPayoutCents: route.driverPayoutCents,
            }
          : null,
        nextStop:
          next && delivery
            ? {
                id: next.id,
                deliveryId: next.deliveryId,
                type: next.type,
                status: next.status,
                sequence: next.sequence,
                latitude: next.latitude,
                longitude: next.longitude,
                estimatedArrivalAt: next.estimatedArrivalAt,
                title:
                  next.type === 'PICKUP'
                    ? `${delivery.branch.business.tradeName} · ${delivery.branch.name}`
                    : delivery.customerName,
                address: next.type === 'PICKUP' ? delivery.branch.address : delivery.complement,
                readinessStatus: delivery.readinessStatus,
                deliveryStatus: delivery.status,
                navigation: {
                  googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
                  wazeUrl: `https://waze.com/ul?ll=${destination}&navigate=yes`,
                },
              }
            : null,
      };
    });
  }
}
