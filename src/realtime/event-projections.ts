import { OutboxEvent, Prisma } from '@prisma/client';

export function realtimeProjections(
  event: Pick<OutboxEvent, 'id' | 'type' | 'aggregateId' | 'payload'>,
  routeBusinessIds: string[],
) {
  const payload = event.payload as Record<string, Prisma.JsonValue>;
  const type =
    (
      {
        DeliveryDelivered: 'delivery.delivered',
        RouteOfferCreated: 'offer.created',
        RouteOfferAccepted: 'offer.accepted',
        RouteUpdated: 'route.updated',
        RouteCompleted: 'route.updated',
      } as Record<string, string>
    )[event.type] ?? (event.type.startsWith('Delivery') ? 'delivery.updated' : event.type);
  // Business participants may refresh their route projection without receiving
  // another business's delivery or offer identifiers, statuses or coordinates.
  const publicPayload = { eventId: event.id, entityId: event.aggregateId };
  const projections = [{ room: 'admin', type, payload: publicPayload }];
  if (typeof payload.driverId === 'string')
    projections.push({ room: `driver:${payload.driverId}`, type, payload: publicPayload });
  if (typeof payload.businessId === 'string')
    projections.push({ room: `business:${payload.businessId}`, type, payload: publicPayload });
  if (typeof payload.routeId === 'string') {
    projections.push({ room: `route:${payload.routeId}`, type, payload: publicPayload });
    for (const businessId of new Set(routeBusinessIds)) {
      if (businessId === payload.businessId) continue;
      projections.push({
        room: `business:${businessId}`,
        type: 'route.updated',
        payload: { eventId: event.id, entityId: payload.routeId },
      });
    }
  }
  return projections;
}
