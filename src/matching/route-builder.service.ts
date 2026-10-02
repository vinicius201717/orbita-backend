import { Injectable } from '@nestjs/common';
import { Delivery } from '@prisma/client';
import { ConfigService } from '../config/config.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PlanningService, PlanningSnapshot, planningDelivery } from './planning.service';
import { RouteInsertionEngine, Simulation } from './route-insertion.engine';
@Injectable()
export class RouteBuilderService {
  constructor(
    private readonly planning: PlanningService,
    private readonly insertion: RouteInsertionEngine,
    private readonly pricing: PricingEngineService,
    private readonly config: ConfigService,
  ) {}
  async build(snapshot: PlanningSnapshot, pool: Delivery[]) {
    if (snapshot.route && !this.config.get('DYNAMIC_ROUTE_INSERTION_ENABLED')) return null;
    let stops = snapshot.stops;
    let deliveries = snapshot.remaining.map(planningDelivery);
    let selected: Delivery[] = [];
    let simulation: Simulation | null = null;
    const baselineRoad = await this.planning.road(snapshot.start, deliveries, stops);
    const baseline = this.insertion.simulate(
      snapshot.start,
      stops,
      deliveries,
      snapshot.capacity,
      baselineRoad,
    );
    if (!baseline) return null;
    let accepted: {
      deliveries: Delivery[];
      simulation: Simulation;
      economics: NonNullable<ReturnType<PricingEngineService['quote']>>;
    } | null = null;
    for (const candidate of pool) {
      if (selected.length + snapshot.remaining.length >= this.config.get('MAX_ROUTE_DELIVERIES')) break;
      const delivery = planningDelivery(candidate);
      const road = await this.planning.road(snapshot.start, [...deliveries, delivery], stops);
      const plan = this.insertion.insert(
        snapshot.start,
        stops,
        deliveries,
        delivery,
        snapshot.capacity,
        road,
      )[0];
      if (!plan) continue;
      // Once a driver has arrived, preserve that physical stop as the next action.
      const arrived = snapshot.route?.stops.find((s) => s.status === 'ARRIVED');
      if (arrived && plan.stops[0]?.id !== arrived.id) continue;
      selected = [...selected, candidate];
      deliveries = [...deliveries, delivery];
      stops = plan.stops;
      simulation = plan;
      const extraDistance = Math.max(0, simulation.distanceMeters - baseline.distanceMeters),
        extraDuration = Math.max(0, simulation.durationSeconds - baseline.durationSeconds);
      const economics = this.pricing.quote(
        selected.reduce((s, d) => s + d.revenueCents, 0),
        selected.length,
        extraDistance,
        extraDuration,
      );
      const remainingPayout =
        snapshot.remaining.reduce((s, d) => s + d.driverPayoutCents, 0) + (economics?.driverPayoutCents ?? 0);
      if (
        economics &&
        remainingPayout * 1000 >= simulation.distanceMeters * this.config.get('MIN_DRIVER_CENTS_PER_KM') &&
        remainingPayout * 3600 >= simulation.durationSeconds * this.config.get('MIN_DRIVER_CENTS_PER_HOUR')
      )
        accepted = { deliveries: [...selected], simulation, economics };
    }
    return accepted;
  }
}
