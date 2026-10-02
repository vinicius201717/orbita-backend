import { INestApplication } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { actorFixture, createTestApp } from './helpers';
import { PrismaService } from '../../src/infra/prisma.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { ConfigService } from '../../src/config/config.service';
import { FinanceService } from '../../src/finance/finance.service';
describe('database constraints and real workers', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('rejects an empty financial transaction at commit', async () => {
    const db = app.get(PrismaService);
    const key = `invalid-${randomUUID()}`;
    await expect(
      db.$transaction((tx) =>
        tx.ledgerTransaction.create({
          data: { idempotencyKey: key, referenceType: 'test', referenceId: 'test' },
        }),
      ),
    ).rejects.toThrow();
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(0);
  });
  it('deduplicates simultaneous financial adjustments and rejects conflicting key reuse', async () => {
    const db = app.get(PrismaService);
    const admin = await actorFixture(app, 'ADMIN');
    const driver = await actorFixture(app, 'DRIVER');
    const wallet = await db.wallet.create({
      data: { key: `driver:${driver.actor.driverId}`, type: 'DRIVER', driverId: driver.actor.driverId },
    });
    const key = randomUUID();
    const finance = app.get(FinanceService);
    const results = await Promise.all([
      finance.adjust(admin.actor, wallet.id, 100, 'Test adjustment', key),
      finance.adjust(admin.actor, wallet.id, 100, 'Test adjustment', key),
    ]);
    expect(results[0].id).toBe(results[1].id);
    await expect(finance.adjust(admin.actor, wallet.id, 200, 'Test adjustment', key)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    await expect(finance.adjust(admin.actor, wallet.id, 100, 'Different reason', key)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect((await finance.wallet(driver.actor)).balanceCents).toBe(100);
  });
  it('has spatial indexes and the uniqueness constraints needed by matching', async () => {
    const indexes = await app.get(PrismaService).$queryRaw<
      Array<{ indexname: string }>
    >`SELECT indexname FROM pg_indexes WHERE schemaname='public'`;
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        'driver_location_gist',
        'delivery_pickup_gist',
        'stop_location_gist',
        'one_live_route_per_driver',
        'one_active_vehicle_per_driver',
      ]),
    );
  });
  it('processes a real BullMQ job and reports a live worker heartbeat', async () => {
    const url = new URL(app.get(ConfigService).get('REDIS_URL'));
    const events = new QueueEvents('orbita-operations', {
      connection: { host: url.hostname, port: Number(url.port), db: Number(url.pathname.slice(1) || 0) },
    });
    try {
      await events.waitUntilReady();
      const jobs = app.get(JobsService);
      await jobs.start();
      const job = await jobs.queue.add('retention', {}, { jobId: `test-retention-${randomUUID()}` });
      await job.waitUntilFinished(events, 20000);
      expect((await jobs.health()).worker).toBe('up');
    } finally {
      await events.close();
    }
  });
});
