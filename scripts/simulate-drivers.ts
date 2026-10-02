import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma.service';
import { ConfigService } from '../src/config/config.service';
import { TrackingService } from '../src/tracking/tracking.service';
import { MatchingEngineService } from '../src/matching/matching-engine.service';
import { OffersService } from '../src/offers/offers.service';
import { DeliveriesService } from '../src/deliveries/deliveries.service';
import { RoutesService } from '../src/routes/routes.service';
import { Actor } from '../src/common/actor';
import { setTimeout } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AdminService } from '../src/admin/admin.service';
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get(ConfigService);
    if (
      config.get('NODE_ENV') === 'production' ||
      config.get('WHATSAPP_ENABLED') ||
      config.get('MAPS_PROVIDER') !== 'mock'
    )
      throw new Error('Simulator requires development, mock maps and WhatsApp disabled');
    const db = app.get(PrismaService),
      tracking = app.get(TrackingService),
      matching = app.get(MatchingEngineService),
      offers = app.get(OffersService),
      deliveries = app.get(DeliveriesService),
      routes = app.get(RoutesService);
    const owner = await db.user.findUnique({ where: { email: 'business1@orbita.example' } });
    if (!owner?.businessId) throw new Error('Run npm run db:seed first');
    const branch = await db.businessBranch.findFirstOrThrow({ where: { businessId: owner.businessId } });
    const business: Actor = { id: owner.id, role: owner.role, businessId: owner.businessId, driverId: null };
    const fleet = await db.driver.findMany({
      where: { user: { email: { endsWith: '@orbita.example' } }, onboardingStatus: 'APPROVED' },
      include: { user: true },
      take: 10,
    });
    const adminUser = await db.user.findUniqueOrThrow({ where: { email: 'admin@orbita.example' } });
    const admin: Actor = { id: adminUser.id, role: 'ADMIN', businessId: null, driverId: null };
    if (!fleet.length)
      throw new Error('No free seeded drivers. Complete or resolve their existing routes first.');
    const actors = new Map(
      fleet.map((d) => [d.id, { id: d.userId, role: 'DRIVER' as const, businessId: null, driverId: d.id }]),
    );
    const count = Math.min(
      20,
      Math.max(1, Number(process.argv.find((a) => a.startsWith('--deliveries='))?.split('=')[1] ?? 5)),
    );
    const steps = Math.min(
      100,
      Math.max(1, Number(process.argv.find((a) => a.startsWith('--steps='))?.split('=')[1] ?? 30)),
    );
    const interval = Math.min(
      10000,
      Math.max(0, Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 250)),
    );
    if (!Number.isFinite(count + steps + interval)) throw new Error('Numeric simulator arguments required');
    const codes = new Map<string, string>();
    const ids: string[] = [];
    const runId = randomUUID();
    for (const driver of fleet) {
      await db.driver.update({
        where: { id: driver.id },
        data: {
          status: driver.currentRouteId ? 'ON_ROUTE' : 'AVAILABLE',
          acceptNewOrders: true,
          locationConsentAt: new Date(),
        },
      });
      const actor = actors.get(driver.id);
      if (actor)
        await tracking.update(actor, {
          latitude: branch.latitude + 0.0001,
          longitude: branch.longitude,
          timestamp: new Date().toISOString(),
        });
    }
    await tracking.flushLocations();
    for (let i = 0; i < count; i++) {
      const d = await deliveries.create(business, {
        branchId: branch.id,
        customer: { name: `Simulated customer ${i + 1}` },
        dropoff: {
          latitude: branch.latitude + 0.002 + i * 0.0005,
          longitude: branch.longitude + 0.001 + i * 0.0003,
        },
        items: [{ name: 'Simulated meal', quantity: 1 }],
        serviceLevel: 'EXPRESS',
        externalReference: `simulation:${runId}:${i}`,
      });
      const credential = await deliveries.customerCode(business, d.id);
      codes.set(d.id, credential.code);
      ids.push(d.id);
      await deliveries.ready(business, d.id);
    }
    console.log(
      `Simulation ${runId}: ${ids.length} deliveries, ${fleet.length} drivers. No real messages or payments.`,
    );
    for (let step = 0; step < steps; step++) {
      for (const id of ids) await matching.matchDelivery(id);
      for (const driver of fleet) {
        const actor = actors.get(driver.id);
        if (!actor) continue;
        const pending = await offers.list(actor);
        for (const offer of pending) {
          try {
            await offers.accept(actor, offer.id);
          } catch {
            /* Expired or superseded offers are retried by the pool. */
          }
        }
        const current = await db.driver.findUniqueOrThrow({ where: { id: driver.id } });
        if (!current.currentRouteId) continue;
        const routeId = current.currentRouteId;
        const route = await db.route.findUniqueOrThrow({ where: { id: routeId } });
        if (route.status === 'ASSIGNED') await routes.start(actor, routeId);
        const next = await db.routeStop.findFirst({
          where: { routeId, status: { in: ['PENDING', 'ARRIVED'] } },
          orderBy: { sequence: 'asc' },
        });
        if (!next) {
          await routes.finish(actor, routeId);
          continue;
        }
        await tracking.update(actor, {
          latitude: next.latitude,
          longitude: next.longitude,
          timestamp: new Date().toISOString(),
          accuracy: 5,
        });
        await tracking.flushLocations();
        if (next.status === 'PENDING') await routes.arrive(actor, routeId, next.id);
        if (next.type === 'PICKUP') {
          const pending = await db.delivery.findUniqueOrThrow({
            where: { id: next.deliveryId },
            include: {
              business: {
                include: { users: { where: { role: 'BUSINESS_OWNER' }, select: { id: true, email: true } } },
              },
            },
          });
          const demoOwner = pending.business.users.find((user) => user.email.endsWith('@orbita.example'));
          if (!demoOwner) throw new Error('Simulator refuses non-demo pickup');
          if (pending.readinessStatus !== 'READY_FOR_PICKUP')
            await deliveries.ready(
              { id: demoOwner.id, role: 'BUSINESS_OWNER', businessId: pending.businessId, driverId: null },
              pending.id,
            );
          await routes.complete(actor, routeId, next.id);
        } else {
          const code = codes.get(next.deliveryId);
          if (code) await deliveries.verify(actor, next.deliveryId, { code });
          else {
            const old = await db.delivery.findUniqueOrThrow({
              where: { id: next.deliveryId },
              include: { business: { include: { users: { select: { email: true } } } } },
            });
            if (!old.business.users.some((user) => user.email.endsWith('@orbita.example')))
              throw new Error('Simulator refuses to complete non-demo deliveries');
            await app
              .get(AdminService)
              .proof(admin, old.id, 'Simulated receipt for development seed or previous simulator run');
          }
        }
      }
      const completed = await db.delivery.count({ where: { id: { in: ids }, status: 'DELIVERED' } });
      console.log(`Step ${step + 1}: ${completed}/${count} delivered`);
      if (
        completed === count &&
        (await db.driver.count({
          where: { id: { in: fleet.map((d) => d.id) }, currentRouteId: { not: null } },
        })) === 0
      )
        break;
      await setTimeout(interval);
    }
    const result = await db.delivery.groupBy({ by: ['status'], where: { id: { in: ids } }, _count: true });
    console.log(JSON.stringify({ runId, deliveries: ids, result }));
    if (result.some((r) => r.status !== 'DELIVERED')) process.exitCode = 1;
  } finally {
    await app.close();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Simulation failed');
  process.exitCode = 1;
});
