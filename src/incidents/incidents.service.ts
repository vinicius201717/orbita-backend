import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { Actor } from '../common/actor';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { OutboxService } from '../common/outbox.service';
import { IncidentDto } from './incidents.controller';
@Injectable()
export class IncidentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly deliveries: DeliveriesService,
    private readonly events: OutboxService,
  ) {}
  async create(actor: Actor, id: string, dto: IncidentDto) {
    const delivery = await this.db.delivery.findUniqueOrThrow({ where: { id } });
    this.deliveries.assertAccess(actor, delivery);
    return this.db.transaction(async (tx) => {
      const result = await tx.deliveryIncident.create({
        data: { deliveryId: id, createdBy: actor.id, ...dto },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'incident.created',
          entityType: 'DeliveryIncident',
          entityId: result.id,
          metadata: { deliveryId: id, type: dto.type },
        },
      });
      await this.events.emit(tx, 'DeliveryIncidentCreated', result.id, {
        deliveryId: id,
        businessId: delivery.businessId,
        routeId: delivery.routeId,
        driverId: delivery.driverId,
      });
      return result;
    });
  }
  async list(actor: Actor, id: string) {
    const delivery = await this.db.delivery.findUniqueOrThrow({ where: { id } });
    this.deliveries.assertAccess(actor, delivery);
    return this.db.deliveryIncident.findMany({
      where: { deliveryId: id },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  }
}
