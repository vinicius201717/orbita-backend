import { Controller, Get, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Gauge, Registry } from 'prom-client';
import { Roles } from '../auth/auth.decorators';
import { PrismaService } from '../infra/prisma.service';
@ApiTags('observability')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly db: PrismaService) {}
  @Get() @Header('Content-Type', 'text/plain; version=0.0.4') async metrics() {
    const [deliveries, completed, failed, waits, offers, accepted, poolWait, margin] = await Promise.all([
      this.db.delivery.count(),
      this.db.delivery.count({ where: { status: 'DELIVERED' } }),
      this.db.delivery.count({ where: { status: 'FAILED' } }),
      this.db.delivery.aggregate({ _avg: { pickupWaitTimeSeconds: true } }),
      this.db.routeOffer.count(),
      this.db.routeOffer.count({ where: { status: 'ACCEPTED' } }),
      this.db.$queryRaw<
        Array<{ seconds: number }>
      >`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (now()-"createdAt"))),0)::float8 AS seconds FROM "Delivery" WHERE status='WAITING_POOL'`,
      this.db.$queryRaw<
        Array<{ cents: number }>
      >`SELECT COALESCE(AVG("revenueCents"-"driverPayoutCents"),0)::float8 AS cents FROM "Delivery" WHERE status='DELIVERED'`,
    ]);
    const registry = new Registry();
    for (const [name, value] of Object.entries({
      deliveries_created_total: deliveries,
      deliveries_completed_total: completed,
      delivery_failure_rate: deliveries ? failed / deliveries : 0,
      average_pickup_wait_seconds: waits._avg.pickupWaitTimeSeconds ?? 0,
      pool_wait_seconds: poolWait[0]?.seconds ?? 0,
      offer_acceptance_rate: offers ? accepted / offers : 0,
      platform_margin_per_delivery_cents: margin[0]?.cents ?? 0,
    }))
      new Gauge({ name: `orbita_${name}`, help: name, registers: [registry] }).set(value);
    return registry.metrics();
  }
}
