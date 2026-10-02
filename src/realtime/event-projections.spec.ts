import { realtimeProjections } from './event-projections';

describe('business event isolation on shared routes', () => {
  it('sends delivery details only to its owner and a route refresh to other businesses', () => {
    const projections = realtimeProjections(
      {
        id: 'event',
        type: 'DeliveryDelivered',
        aggregateId: 'private-delivery',
        payload: {
          businessId: 'owner',
          driverId: 'driver',
          routeId: 'route',
          customerPhone: 'private-phone',
        },
      },
      ['owner', 'other', 'other'],
    );
    expect(projections.filter((p) => p.room === 'business:owner')).toEqual([
      {
        room: 'business:owner',
        type: 'delivery.delivered',
        payload: { eventId: 'event', entityId: 'private-delivery' },
      },
    ]);
    expect(projections.filter((p) => p.room === 'business:other')).toEqual([
      { room: 'business:other', type: 'route.updated', payload: { eventId: 'event', entityId: 'route' } },
    ]);
    expect(JSON.stringify(projections)).not.toContain('private-phone');
  });
  it('does not expose driver offer identifiers to route businesses', () => {
    const projections = realtimeProjections(
      {
        id: 'event',
        type: 'RouteOfferAccepted',
        aggregateId: 'private-offer',
        payload: { driverId: 'driver', routeId: 'route' },
      },
      ['first', 'second'],
    );
    const businesses = projections.filter((p) => p.room.startsWith('business:'));
    expect(businesses).toHaveLength(2);
    expect(businesses.every((p) => p.type === 'route.updated' && p.payload.entityId === 'route')).toBe(true);
    expect(JSON.stringify(businesses)).not.toContain('private-offer');
  });
});
