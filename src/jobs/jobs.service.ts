import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { TrackingService } from '../tracking/tracking.service';
import { MatchingEngineService } from '../matching/matching-engine.service';
import { OffersService } from '../offers/offers.service';
import { MessagingService } from '../messaging/messaging.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OutboxEvent, Prisma } from '@prisma/client';
import { RouteRecalculationService } from '../routes/route-recalculation.service';
import { realtimeProjections } from '../realtime/event-projections';
@Injectable()
export class JobsService implements OnModuleDestroy {
  readonly queue: Queue;
  private worker?: Worker;
  private readonly logger = new Logger(JobsService.name);
  private readonly connection;
  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly tracking: TrackingService,
    private readonly matching: MatchingEngineService,
    private readonly offers: OffersService,
    private readonly messaging: MessagingService,
    private readonly whatsapp: WhatsAppService,
    private readonly realtime: RealtimeService,
    private readonly recalculation: RouteRecalculationService,
  ) {
    const url = new URL(config.get('REDIS_URL'));
    this.connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: Number(url.pathname.slice(1) || 0),
      maxRetriesPerRequest: null,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
    this.queue = new Queue('orbita-operations', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    });
    this.queue.on('error', () => this.logger.error('Queue connection failure'));
  }
  async start() {
    if (this.worker) return;
    this.worker = new Worker('orbita-operations', (job: Job) => this.run(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', () => this.logger.error('Worker connection failure'));
    this.worker.on('failed', (job, error) =>
      this.logger.error({ jobId: job?.id, name: job?.name, errorName: error.name }),
    );
    await this.queue.upsertJobScheduler('maintenance', { every: 1000 }, { name: 'maintenance', data: {} });
    await this.queue.upsertJobScheduler(
      'pool',
      { every: this.config.get('POOL_INTERVAL_SECONDS') * 1000 },
      { name: 'rematchDeliveryPool', data: {} },
    );
    await this.queue.upsertJobScheduler('retention', { every: 3600000 }, { name: 'retention', data: {} });
  }
  private async run(job: Job) {
    await this.redis.client.set('orbita:worker:heartbeat', String(Date.now()), 'EX', 60);
    if (job.name === 'maintenance') {
      await this.tracking.flushLocations();
      await this.offers.expireDue();
      await this.whatsapp.processPending();
      await this.dispatchOutbox();
      await this.messaging.dispatchPending();
    } else if (job.name === 'rematchDeliveryPool') {
      await this.matching.rematchPool();
    } else if (job.name === 'expireRouteOffer') {
      const data = job.data as { offerId?: string };
      if (data.offerId) await this.offers.expire(data.offerId);
    } else if (job.name === 'matchDelivery') {
      const data = job.data as { deliveryId?: string };
      if (data.deliveryId) await this.matching.matchDelivery(data.deliveryId);
    } else if (job.name === 'retention') {
      await this.tracking.retention();
      const cutoff = new Date(Date.now() - 30 * 86400000);
      await this.db.delivery.updateMany({
        where: { customerCodeCiphertext: { not: null }, OR: [
          { status: { in: ['DELIVERED', 'FAILED', 'CANCELLED', 'RETURN_REQUIRED', 'RETURNING', 'RETURNED'] } },
          { confirmationExpiresAt: { lt: new Date() } },
        ] },
        data: { customerCodeCiphertext: null },
      });
      await this.db.messageOutbox.updateMany({
        where: { createdAt: { lt: cutoff } },
        data: { payload: '', recipient: 'redacted' },
      });
      await this.db.whatsAppInbox.updateMany({
        where: { receivedAt: { lt: cutoff } },
        data: { payload: '', sender: 'redacted', status: 'PROCESSED' },
      });
      await this.db.conversationSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await this.db.outboxEvent.deleteMany({ where: { processedAt: { lt: cutoff } } });
      await this.db.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    }
  }
  async dispatchOutbox() {
    const rows = await this.db.$queryRaw<
      OutboxEvent[]
    >`UPDATE "OutboxEvent" SET "leaseUntil"=now()+interval '60 seconds',attempts=attempts+1 WHERE id IN (SELECT id FROM "OutboxEvent" WHERE "processedAt" IS NULL AND "availableAt"<=now() AND ("leaseUntil" IS NULL OR "leaseUntil"<now()) AND attempts<20 ORDER BY "createdAt" LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING *`;
    for (const event of rows) {
      try {
        await this.dispatchEvent(event);
        await this.db.outboxEvent.updateMany({
          where: { id: event.id, leaseUntil: event.leaseUntil },
          data: { processedAt: new Date(), leaseUntil: null },
        });
      } catch {
        await this.db.outboxEvent.updateMany({
          where: { id: event.id, leaseUntil: event.leaseUntil },
          data: {
            leaseUntil: null,
            availableAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** event.attempts)),
          },
        });
      }
    }
    return rows.length;
  }
  private async dispatchEvent(event: OutboxEvent) {
    const payload = event.payload as Record<string, Prisma.JsonValue>;
    if (
      ['DeliveryCancelled', 'DeliveryIncidentCreated'].includes(event.type) &&
      typeof payload.routeId === 'string'
    )
      await this.recalculation.recalculate(payload.routeId);
    if (['DeliveryCreated', 'DeliveryReady', 'DeliveryUpdated', 'DeliveryCancelled'].includes(event.type))
      await this.queue.add(
        'matchDelivery',
        { deliveryId: event.aggregateId },
        { jobId: `event-${event.id}` },
      );
    if (event.type === 'RouteOfferCreated') {
      const offer = await this.db.routeOffer.findUnique({ where: { id: event.aggregateId } });
      if (offer)
        await this.queue.add(
          'expireRouteOffer',
          { offerId: offer.id },
          { jobId: `expire-${offer.id}`, delay: Math.max(0, offer.expiresAt.getTime() - Date.now()) },
        );
    }
    if (['RouteOfferClosed', 'RouteCompleted'].includes(event.type))
      await this.queue.add(
        'rematchDeliveryPool',
        {},
        { jobId: `pool-${Math.floor(Date.now() / (this.config.get('POOL_INTERVAL_SECONDS') * 1000))}` },
      );
    if (
      event.type === 'driver.location.updated' &&
      typeof payload.latitude === 'number' &&
      typeof payload.longitude === 'number'
    ) {
      const ids = await this.db.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "Delivery" WHERE status='WAITING_POOL' AND ST_DWithin("pickupLocation",ST_SetSRID(ST_MakePoint(${payload.longitude},${payload.latitude}),4326)::geography,${this.config.get('MATCH_RADIUS_METERS')}) LIMIT ${this.config.get('MAX_POOL_BATCH')}`;
      for (const d of ids)
        await this.queue.add(
          'matchDelivery',
          { deliveryId: d.id },
          { jobId: `gps-${d.id}-${Math.floor(Date.now() / 10000)}` },
        );
    }
    await this.messaging.handleDomainEvent(event);
    let routeBusinessIds: string[] = [];
    if (typeof payload.routeId === 'string') {
      const businesses = await this.db.delivery.findMany({
        where: { routeId: payload.routeId },
        distinct: ['businessId'],
        select: { businessId: true },
      });
      routeBusinessIds = businesses.map((business) => business.businessId);
    }
    for (const projection of realtimeProjections(event, routeBusinessIds))
      await this.realtime.publish(projection.room, projection.type, projection.payload);
  }
  async health() {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
    const heartbeat = await this.redis.client.get('orbita:worker:heartbeat');
    return { counts, worker: heartbeat && Date.now() - Number(heartbeat) < 60000 ? 'up' : 'stale' };
  }
  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}
