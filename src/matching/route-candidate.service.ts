import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../infra/prisma.service';
@Injectable()
export class RouteCandidateService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async drivers(latitude: number, longitude: number) {
    return this.db.$queryRaw<Array<{ id: string; priority: number }>>`
      SELECT d.id, CASE WHEN d."currentRouteId" IS NOT NULL THEN 1 ELSE 3 END AS priority
      FROM "Driver" d JOIN "DriverLocation" l ON l."driverId"=d.id JOIN "User" u ON u.id=d."userId"
      WHERE d.status IN ('AVAILABLE','ON_ROUTE') AND d."onboardingStatus"='APPROVED'
      AND u.active AND u."deletedAt" IS NULL AND d."acceptNewOrders" AND d."locationConsentAt" IS NOT NULL AND l."expiresAt">now()
      AND (ST_DWithin(l.location,ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326)::geography,${this.config.get('MATCH_RADIUS_METERS')})
        OR EXISTS(SELECT 1 FROM "RouteStop" s WHERE s."routeId"=d."currentRouteId" AND s.status IN ('PENDING','ARRIVED') AND ST_DWithin(s.location,ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326)::geography,${this.config.get('MATCH_RADIUS_METERS')})))
      AND NOT EXISTS(SELECT 1 FROM "RouteOffer" o WHERE o."driverId"=d.id AND o.status='PENDING' AND o."expiresAt">now())
      ORDER BY priority,ST_Distance(l.location,ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326)::geography)
      LIMIT ${this.config.get('MATCH_CANDIDATE_LIMIT')}`;
  }
  async poolNear(id: string, latitude: number, longitude: number) {
    const ids = await this.db.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "Delivery" WHERE status='WAITING_POOL' AND ("readinessStatus"='READY_FOR_PICKUP' OR "estimatedReadyAt" IS NOT NULL) AND "pickupDeadline">now() AND ST_DWithin("pickupLocation",ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326)::geography,${this.config.get('MATCH_RADIUS_METERS')}) ORDER BY CASE WHEN id=${id}::uuid THEN 0 ELSE 1 END,"deliveryDeadline" LIMIT ${this.config.get('MAX_POOL_BATCH')}`;
    const deliveries = await this.db.delivery.findMany({ where: { id: { in: ids.map((d) => d.id) } } });
    const byId = new Map(deliveries.map((d) => [d.id, d]));
    return ids.flatMap((d) => {
      const item = byId.get(d.id);
      return item ? [item] : [];
    });
  }
}
