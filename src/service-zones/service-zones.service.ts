import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../infra/prisma.service';
import { DomainError } from '../common/domain-error';
import { Actor } from '../common/actor';
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z
  .array(position)
  .min(4)
  .max(200)
  .refine((v) => JSON.stringify(v[0]) === JSON.stringify(v[v.length - 1]), 'Ring must be closed');
const polygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(10) });
@Injectable()
export class ServiceZonesService {
  constructor(private readonly db: PrismaService) {}
  async create(actor: Actor, dto: { name: string; city: string; boundary: unknown }) {
    const shape = polygon.safeParse(dto.boundary);
    if (!shape.success)
      throw new DomainError('INVALID_POLYGON', 'Supply a valid closed GeoJSON Polygon', 400);
    return this.db.transaction(async (tx) => {
      const serialized = JSON.stringify(shape.data);
      const valid = await tx.$queryRaw<
        Array<{ valid: boolean }>
      >`SELECT ST_IsValid(ST_GeomFromGeoJSON(${serialized})) AS valid`;
      if (!valid[0]?.valid)
        throw new DomainError('INVALID_POLYGON', 'Polygon intersects itself or is invalid', 400);
      const zone = await tx.serviceZone.create({ data: { name: dto.name, city: dto.city } });
      await tx.$executeRaw`UPDATE "ServiceZone" SET boundary=ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${serialized}),4326)) WHERE id=${zone.id}::uuid`;
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'zone.created', entityType: 'ServiceZone', entityId: zone.id },
      });
      return zone;
    });
  }
  async list() {
    return this.db.$queryRaw<
      Array<{ id: string; name: string; city: string; active: boolean; boundary: unknown }>
    >`SELECT id,name,city,active,ST_AsGeoJSON(boundary)::json AS boundary FROM "ServiceZone" ORDER BY id LIMIT 100`;
  }
  async available(latitude: number, longitude: number) {
    const rows = await this.db.$queryRaw<
      Array<{ id: string; name: string }>
    >`SELECT id,name FROM "ServiceZone" WHERE active AND ST_Covers(boundary,ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326)) LIMIT 20`;
    return { available: rows.length > 0, zones: rows };
  }
}
