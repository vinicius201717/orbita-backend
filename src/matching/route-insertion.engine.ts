import { Injectable } from '@nestjs/common';
import { CargoCategory } from '@prisma/client';
import { ConfigService } from '../config/config.service';
import { GeoPoint, RoadLeg } from '../maps/maps.provider';
export interface PlanningDelivery {
  id: string;
  branchId: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  capacityUnits: number;
  weightGrams: number;
  volumeCm3: number;
  category: CargoCategory;
  readyAt: number;
  pickupDeadline: number;
  deliveryDeadline: number;
  maxDeliveryDurationSeconds: number;
  pickedUpAt: number | null;
}
export interface PlanningStop extends GeoPoint {
  id?: string;
  deliveryId: string;
  type: 'PICKUP' | 'DROPOFF';
  estimatedArrivalAt?: string;
}
export interface PlanningVehicle {
  capacityUnits: number;
  weightCapacityGrams: number | null;
  volumeCapacityCm3: number | null;
  compatibleCategories: CargoCategory[];
}
export interface Simulation {
  stops: PlanningStop[];
  distanceMeters: number;
  durationSeconds: number;
  minSlackSeconds: number;
  peakCapacityUnits: number;
}
export interface RoadTable {
  points: GeoPoint[];
  matrix: RoadLeg[][];
}
export function pointKey(p: GeoPoint) {
  return `${p.latitude},${p.longitude}`;
}
@Injectable()
export class RouteInsertionEngine {
  constructor(private readonly config: ConfigService) {}
  simulate(
    start: GeoPoint,
    stops: PlanningStop[],
    deliveries: PlanningDelivery[],
    vehicle: PlanningVehicle,
    road: RoadTable,
    now = Date.now(),
  ): Simulation | null {
    const lookup = new Map(deliveries.map((d) => [d.id, d]));
    const indices = new Map(road.points.map((p, i) => [pointKey(p), i]));
    const onboard = new Set(deliveries.filter((d) => d.pickedUpAt !== null).map((d) => d.id));
    const picked = new Map(
      deliveries.filter((d) => d.pickedUpAt !== null).map((d) => [d.id, d.pickedUpAt as number]),
    );
    let units = 0,
      weight = 0,
      volume = 0;
    for (const d of deliveries)
      if (onboard.has(d.id)) {
        units += d.capacityUnits;
        weight += d.weightGrams;
        volume += d.volumeCm3;
      }
    const fits = () =>
      units <= vehicle.capacityUnits &&
      units >= 0 &&
      (!vehicle.weightCapacityGrams || weight <= vehicle.weightCapacityGrams) &&
      (!vehicle.volumeCapacityCm3 || volume <= vehicle.volumeCapacityCm3);
    if (!fits()) return null;
    let previous = start,
      time = now,
      distance = 0,
      slack = Infinity,
      peak = units;
    const plan: PlanningStop[] = [];
    const completed = new Set<string>();
    for (const stop of stops) {
      const d = lookup.get(stop.deliveryId);
      if (!d) return null;
      const a = indices.get(pointKey(previous)),
        b = indices.get(pointKey(stop));
      const leg = a === undefined || b === undefined ? undefined : road.matrix[a]?.[b];
      if (!leg || !Number.isFinite(leg.durationSeconds) || !Number.isFinite(leg.distanceMeters)) return null;
      distance += leg.distanceMeters;
      time += leg.durationSeconds * 1000;
      if (stop.type === 'PICKUP') {
        if (onboard.has(d.id) || picked.has(d.id) || completed.has(d.id)) return null;
        if (vehicle.compatibleCategories.length && !vehicle.compatibleCategories.includes(d.category))
          return null;
        time = Math.max(time, d.readyAt);
        if (time > d.pickupDeadline) return null;
        slack = Math.min(slack, (d.pickupDeadline - time) / 1000);
        units += d.capacityUnits;
        weight += d.weightGrams;
        volume += d.volumeCm3;
        if (!fits()) return null;
        onboard.add(d.id);
        picked.set(d.id, time);
        peak = Math.max(peak, units);
      } else {
        const pickup = picked.get(d.id);
        if (!onboard.has(d.id) || pickup === undefined || completed.has(d.id)) return null;
        if (time > d.deliveryDeadline || time - pickup > d.maxDeliveryDurationSeconds * 1000) return null;
        slack = Math.min(slack, (d.deliveryDeadline - time) / 1000);
        onboard.delete(d.id);
        completed.add(d.id);
        units -= d.capacityUnits;
        weight -= d.weightGrams;
        volume -= d.volumeCm3;
      }
      plan.push({ ...stop, estimatedArrivalAt: new Date(time).toISOString() });
      time += this.config.get('STOP_SERVICE_SECONDS') * 1000;
      previous = stop;
    }
    if (onboard.size || completed.size !== deliveries.length) return null;
    return {
      stops: plan,
      distanceMeters: distance,
      durationSeconds: Math.ceil((time - now) / 1000),
      minSlackSeconds: slack === Infinity ? 0 : Math.floor(slack),
      peakCapacityUnits: peak,
    };
  }
  insert(
    start: GeoPoint,
    stops: PlanningStop[],
    existing: PlanningDelivery[],
    delivery: PlanningDelivery,
    vehicle: PlanningVehicle,
    road: RoadTable,
    now = Date.now(),
  ): Simulation[] {
    if (stops.length + 2 > this.config.get('MAX_ROUTE_DELIVERIES') * 2) return [];
    if (!this.config.get('MULTI_PICKUP_ENABLED') && existing.some((d) => d.branchId !== delivery.branchId))
      return [];
    const plans: Simulation[] = [];
    for (let pickup = 0; pickup <= stops.length; pickup++)
      for (let dropoff = pickup + 1; dropoff <= stops.length + 1; dropoff++) {
        const next = [...stops];
        next.splice(pickup, 0, { ...delivery.pickup, deliveryId: delivery.id, type: 'PICKUP' });
        next.splice(dropoff, 0, { ...delivery.dropoff, deliveryId: delivery.id, type: 'DROPOFF' });
        const result = this.simulate(start, next, [...existing, delivery], vehicle, road, now);
        if (result) plans.push(result);
      }
    return plans.sort((a, b) => a.distanceMeters - b.distanceMeters || a.durationSeconds - b.durationSeconds);
  }
}
