import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { lockEntities } from '../common/locks';
import { OutboxService } from '../common/outbox.service';
import { LocationDto } from '../drivers/drivers.dto';
const cachedLocation = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timestamp: z.string(),
  accuracy: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
});
const updateLocation =
  "local old=redis.call('GET',KEYS[1]); if old then local obj=cjson.decode(old); if obj.timestamp >= ARGV[2] then return 0 end end; redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[3]); redis.call('SADD',KEYS[2],ARGV[4]); return 1";
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
@Injectable()
export class TrackingService {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly events: OutboxService,
  ) {}
  async update(actor: Actor, dto: LocationDto) {
    if (!actor.driverId) throw new DomainError('DRIVER_REQUIRED', 'Driver account required', 403);
    const timestamp = new Date(dto.timestamp);
    const age = Date.now() - timestamp.getTime();
    if (age < -15000 || age > this.config.get('GPS_TTL_SECONDS') * 1000)
      throw new DomainError('GPS_TIMESTAMP_INVALID', 'Location timestamp is stale or in the future', 400);
    const driver = await this.db.driver.findUniqueOrThrow({ where: { id: actor.driverId } });
    if (!driver.locationConsentAt || !['AVAILABLE', 'ON_ROUTE'].includes(driver.status))
      throw new DomainError('GPS_NOT_OPERATIONAL', 'GPS requires consent and operational status', 409);
    const value = { ...dto, timestamp: timestamp.toISOString() };
    const accepted = await this.redis.client.eval(
      updateLocation,
      2,
      `driver:${driver.id}:location`,
      'tracking:dirty',
      JSON.stringify(value),
      value.timestamp,
      this.config.get('GPS_TTL_SECONDS'),
      driver.id,
    );
    return { accepted: accepted === 1 };
  }
  async flushLocations(limit = 200) {
    const ids = await this.redis.client.spop('tracking:dirty', limit);
    for (const id of ids) {
      try {
        const raw = await this.redis.client.get(`driver:${id}:location`);
        if (!raw) continue;
        const location = cachedLocation.parse(JSON.parse(raw) as unknown);
        const timestamp = new Date(location.timestamp);
        await this.db.transaction(async (tx) => {
          await lockEntities(tx, [`driver:${id}`]);
          const driver = await tx.driver.findUnique({ where: { id } });
          if (!driver?.locationConsentAt || !['AVAILABLE', 'ON_ROUTE'].includes(driver.status)) return;
          const previous = await tx.driverLocation.findUnique({ where: { driverId: id } });
          if (previous && previous.timestamp >= timestamp) return;
          const expiresAt = new Date(timestamp.getTime() + this.config.get('GPS_TTL_SECONDS') * 1000);
          if (expiresAt <= new Date()) return;
          await tx.driverLocation.upsert({
            where: { driverId: id },
            create: { ...location, timestamp, driverId: id, expiresAt },
            update: { ...location, timestamp, expiresAt },
          });
          // The main Driver row is updated once per persistence batch, never on every GPS request.
          await tx.driver.update({ where: { id }, data: { lastLocationAt: timestamp } });
          const last = await tx.locationHistory.findFirst({
            where: { driverId: id },
            orderBy: { timestamp: 'desc' },
            select: { timestamp: true },
          });
          if (
            !last ||
            timestamp.getTime() - last.timestamp.getTime() >=
              this.config.get('GPS_HISTORY_SAMPLE_SECONDS') * 1000
          )
            await tx.locationHistory.create({
              data: { ...location, timestamp, driverId: id, routeId: driver.currentRouteId },
            });
          const moved = previous ? distanceMeters(previous, location) : 0;
          if (
            (previous &&
              moved / Math.max(1, (timestamp.getTime() - previous.timestamp.getTime()) / 1000) > 70) ||
            (location.speed ?? 0) > 70
          )
            await tx.fraudFlag.create({
              data: { driverId: id, type: 'IMPOSSIBLE_SPEED', metadata: { distanceMeters: moved } },
            });
          if (!previous || moved >= 250)
            await this.events.emit(tx, 'driver.location.updated', id, {
              driverId: id,
              latitude: location.latitude,
              longitude: location.longitude,
            });
        });
      } catch {
        await this.redis.client.sadd('tracking:dirty', id);
      }
    }
    return ids.length;
  }
  async retention() {
    const cutoff = new Date(Date.now() - this.config.get('GPS_RETENTION_DAYS') * 86400000);
    const history = await this.db.locationHistory.deleteMany({ where: { timestamp: { lt: cutoff } } });
    await this.db.driverLocation.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return { deleted: history.count };
  }
}
