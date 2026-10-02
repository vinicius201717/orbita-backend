import { ConfigService } from '../config/config.service';
import { MockMapsProvider } from '../maps/mock-maps.provider';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PlanningDelivery, PlanningVehicle, RouteInsertionEngine, pointKey } from './route-insertion.engine';
describe('route insertion constraints', () => {
  const config = new ConfigService(),
    engine = new RouteInsertionEngine(config),
    maps = new MockMapsProvider(config);
  const start = { latitude: -16.68, longitude: -49.25 };
  const now = Date.now();
  const vehicle: PlanningVehicle = {
    capacityUnits: 20,
    weightCapacityGrams: 5000,
    volumeCapacityCm3: 10000,
    compatibleCategories: ['HOT'],
  };
  const delivery: PlanningDelivery = {
    id: 'one',
    branchId: 'branch',
    pickup: start,
    dropoff: { latitude: -16.681, longitude: -49.251 },
    capacityUnits: 10,
    weightGrams: 1000,
    volumeCm3: 1000,
    category: 'HOT',
    readyAt: now,
    pickupDeadline: now + 600000,
    deliveryDeadline: now + 1800000,
    maxDeliveryDurationSeconds: 1200,
    pickedUpAt: null,
  };
  async function road(deliveries: PlanningDelivery[]) {
    const points = [
      ...new Map(
        [start, ...deliveries.flatMap((d) => [d.pickup, d.dropoff])].map((p) => [pointKey(p), p]),
      ).values(),
    ];
    return { points, matrix: await maps.distanceMatrix(points) };
  }
  it('finds a valid route with pickup before destination', async () => {
    const results = engine.insert(start, [], [], delivery, vehicle, await road([delivery]), now);
    expect(results).toHaveLength(1);
    expect(results[0]?.stops.map((s) => s.type)).toEqual(['PICKUP', 'DROPOFF']);
  });
  it('enumerates several insertion positions without breaking existing SLA', async () => {
    const other = { ...delivery, id: 'two', dropoff: { latitude: -16.682, longitude: -49.252 } };
    const stops = [
      { ...delivery.pickup, deliveryId: 'one', type: 'PICKUP' as const },
      { ...delivery.dropoff, deliveryId: 'one', type: 'DROPOFF' as const },
    ];
    const results = engine.insert(
      start,
      stops,
      [delivery],
      other,
      vehicle,
      await road([delivery, other]),
      now,
    );
    expect(results.length).toBeGreaterThan(1);
    for (const result of results)
      for (const id of ['one', 'two'])
        expect(result.stops.findIndex((s) => s.deliveryId === id && s.type === 'PICKUP')).toBeLessThan(
          result.stops.findIndex((s) => s.deliveryId === id && s.type === 'DROPOFF'),
        );
  });
  it('rejects overload, late delivery, unsupported cargo and reverse precedence', async () => {
    const r = await road([delivery]);
    expect(engine.insert(start, [], [], { ...delivery, capacityUnits: 21 }, vehicle, r, now)).toEqual([]);
    expect(engine.insert(start, [], [], { ...delivery, deliveryDeadline: now }, vehicle, r, now)).toEqual([]);
    expect(engine.insert(start, [], [], { ...delivery, category: 'FROZEN' }, vehicle, r, now)).toEqual([]);
    expect(
      engine.simulate(
        start,
        [
          { ...delivery.dropoff, deliveryId: 'one', type: 'DROPOFF' },
          { ...delivery.pickup, deliveryId: 'one', type: 'PICKUP' },
        ],
        [delivery],
        vehicle,
        r,
        now,
      ),
    ).toBeNull();
  });
  it('honors existing on-board cargo and max delivery duration', async () => {
    const picked = { ...delivery, pickedUpAt: now - 1201000 };
    expect(
      engine.simulate(
        start,
        [{ ...picked.dropoff, deliveryId: picked.id, type: 'DROPOFF' }],
        [picked],
        vehicle,
        await road([picked]),
        now,
      ),
    ).toBeNull();
  });
  it('rejects a route which cannot pay the internal floors', () => {
    const pricing = new PricingEngineService(config);
    expect(pricing.quote(700, 1, 10000, 3600)).toBeNull();
    expect(pricing.quote(700, 1, 1000, 600)?.driverPayoutCents).toBe(500);
  });
});
