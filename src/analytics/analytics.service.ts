import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: PrismaService) {}
  async business(actor: Actor) {
    if (!actor.businessId) throw new DomainError('BUSINESS_REQUIRED', 'Business required', 403);
    const rows = await this.db.$queryRaw<
      Array<Record<string, number>>
    >`SELECT COUNT(*)::int AS deliveries,COUNT(*) FILTER(WHERE status='DELIVERED')::int AS completed,COUNT(*) FILTER(WHERE status='CANCELLED')::int AS cancelled,COALESCE(AVG(EXTRACT(EPOCH FROM ("deliveredAt"-"createdAt"))) FILTER(WHERE status='DELIVERED'),0)::float8 AS "averageDeliverySeconds",COALESCE(ROUND(AVG("revenueCents") FILTER(WHERE status='DELIVERED')),0)::int AS "averageCostCents",COALESCE(AVG(CASE WHEN "deliveredAt"<="deliveryDeadline" THEN 1.0 ELSE 0 END) FILTER(WHERE status='DELIVERED'),0)::float8 AS "onTimeRate" FROM "Delivery" WHERE "businessId"=${actor.businessId}::uuid`;
    return rows[0];
  }
  async driver(actor: Actor) {
    if (!actor.driverId) throw new DomainError('DRIVER_REQUIRED', 'Driver required', 403);
    const [earnings, routes, deliveries] = await Promise.all([
      this.db.driverEarning.aggregate({
        where: { driverId: actor.driverId },
        _sum: { payoutCents: true, tipCents: true },
      }),
      this.db.route.aggregate({
        where: { driverId: actor.driverId, status: 'COMPLETED' },
        _sum: { estimatedDistanceMeters: true, estimatedDurationSeconds: true },
        _count: true,
      }),
      this.db.delivery.count({ where: { driverId: actor.driverId, status: 'DELIVERED' } }),
    ]);
    const total = (earnings._sum.payoutCents ?? 0) + (earnings._sum.tipCents ?? 0),
      distance = routes._sum.estimatedDistanceMeters ?? 0,
      duration = routes._sum.estimatedDurationSeconds ?? 0;
    return {
      earningsCents: total,
      deliveries,
      routes: routes._count,
      estimatedDistanceMeters: distance,
      estimatedDurationSeconds: duration,
      estimatedCentsPerKm: distance ? Math.round((total * 1000) / distance) : 0,
      estimatedCentsPerHour: duration ? Math.round((total * 3600) / duration) : 0,
    };
  }
  async platform() {
    const [totals, drivers, businesses, offers, daily, sla] = await Promise.all([
      this.db.delivery.aggregate({
        where: { status: 'DELIVERED' },
        _sum: { revenueCents: true, driverPayoutCents: true },
        _count: true,
      }),
      this.db.driver.count({
        where: {
          status: { in: ['AVAILABLE', 'ON_ROUTE'] },
          currentLocation: { expiresAt: { gt: new Date() } },
        },
      }),
      this.db.business.count({ where: { active: true } }),
      this.db.routeOffer.groupBy({ by: ['status'], _count: true }),
      this.db.$queryRaw<Array<{ day: string; deliveries: number }>>(
        Prisma.sql`SELECT to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,COUNT(*)::int AS deliveries FROM "Delivery" WHERE "createdAt">now()-interval '30 days' GROUP BY 1 ORDER BY 1`,
      ),
      this.db.$queryRaw<Array<{ onTimeRate: number }>>(
        Prisma.sql`SELECT COALESCE(AVG(CASE WHEN "deliveredAt"<="deliveryDeadline" THEN 1.0 ELSE 0 END),0)::float8 AS "onTimeRate" FROM "Delivery" WHERE status='DELIVERED'`,
      ),
    ]);
    const revenue = totals._sum.revenueCents ?? 0,
      payout = totals._sum.driverPayoutCents ?? 0;
    return {
      logisticsGmvCents: revenue,
      grossRevenueCents: revenue,
      driverPayoutsCents: payout,
      grossMarginCents: revenue - payout,
      completed: totals._count,
      onTimeRate: sla[0]?.onTimeRate ?? 0,
      activeDrivers: drivers,
      activeBusinesses: businesses,
      offerAcceptanceRate: offers.reduce((s, o) => s + o._count, 0)
        ? (offers.find((o) => o.status === 'ACCEPTED')?._count ?? 0) /
          offers.reduce((s, o) => s + o._count, 0)
        : 0,
      deliveriesPerDay: daily,
    };
  }
}
