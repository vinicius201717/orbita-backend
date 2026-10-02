import { Injectable } from '@nestjs/common';
import { Delivery, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { MapsProvider, GeoPoint } from '../maps/maps.provider';
import { DomainError } from '../common/domain-error';
import {
  PlanningDelivery,
  PlanningStop,
  PlanningVehicle,
  RoadTable,
  pointKey,
} from './route-insertion.engine';
export const driverInclude = {
  vehicles: { where: { active: true } },
  currentLocation: true,
} satisfies Prisma.DriverInclude;
export const routeInclude = {
  stops: { orderBy: { sequence: 'asc' } },
  deliveries: true,
} satisfies Prisma.RouteInclude;
export function planningDelivery(d: Delivery): PlanningDelivery {
  return {
    id: d.id,
    branchId: d.branchId,
    pickup: { latitude: d.pickupLatitude, longitude: d.pickupLongitude },
    dropoff: { latitude: d.dropoffLatitude, longitude: d.dropoffLongitude },
    capacityUnits: d.capacityUnits,
    weightGrams: d.weightGrams ?? 0,
    volumeCm3: d.volumeCm3 ?? 0,
    category: d.category,
    readyAt: (d.readyAt ?? d.estimatedReadyAt ?? d.pickupDeadline).getTime(),
    pickupDeadline: d.pickupDeadline.getTime(),
    deliveryDeadline: d.deliveryDeadline.getTime(),
    maxDeliveryDurationSeconds: d.maxDeliveryDurationSeconds,
    pickedUpAt: d.pickedUpAt?.getTime() ?? null,
  };
}
@Injectable()
export class PlanningService {
  constructor(
    private readonly db: PrismaService,
    private readonly maps: MapsProvider,
  ) {}
  async snapshot(driverId: string) {
    const driver = await this.db.driver.findUniqueOrThrow({
      where: { id: driverId },
      include: driverInclude,
    });
    const vehicle = driver.vehicles[0];
    const location = driver.currentLocation;
    if (
      !vehicle ||
      !location ||
      location.expiresAt <= new Date() ||
      !driver.locationConsentAt ||
      !driver.acceptNewOrders ||
      driver.onboardingStatus !== 'APPROVED' ||
      !['AVAILABLE', 'ON_ROUTE'].includes(driver.status)
    )
      throw new DomainError('DRIVER_INELIGIBLE', 'Driver is not eligible');
    const route = driver.currentRouteId
      ? await this.db.route.findUniqueOrThrow({ where: { id: driver.currentRouteId }, include: routeInclude })
      : null;
    if (route && !['ASSIGNED', 'ACTIVE'].includes(route.status))
      throw new DomainError('ROUTE_INELIGIBLE', 'Route cannot receive deliveries');
    const remaining =
      route?.deliveries.filter((d) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(d.status)) ?? [];
    if (remaining.some((d) => ['RETURN_REQUIRED', 'RETURNING', 'FAILED'].includes(d.status)))
      throw new DomainError('ROUTE_INCIDENT', 'Resolve route incidents before adding deliveries');
    const stops: PlanningStop[] =
      route?.stops
        .filter((s) => !['COMPLETED', 'SKIPPED'].includes(s.status))
        .map((s) => ({
          id: s.id,
          deliveryId: s.deliveryId,
          type: s.type,
          latitude: s.latitude,
          longitude: s.longitude,
        })) ?? [];
    const capacity: PlanningVehicle = {
      capacityUnits: Math.min(vehicle.capacityUnits, driver.maxCapacityUnits),
      weightCapacityGrams: vehicle.weightCapacityGrams,
      volumeCapacityCm3: vehicle.volumeCapacityCm3,
      compatibleCategories: vehicle.compatibleCategories,
    };
    return {
      driver,
      vehicle,
      location,
      route,
      remaining,
      stops,
      capacity,
      start: { latitude: location.latitude, longitude: location.longitude },
    };
  }
  async road(start: GeoPoint, deliveries: PlanningDelivery[], stops: PlanningStop[]): Promise<RoadTable> {
    const points = [
      ...new Map(
        [
          start,
          ...stops,
          ...deliveries.flatMap((d) => (d.pickedUpAt ? [d.dropoff] : [d.pickup, d.dropoff])),
        ].map((p) => [pointKey(p), { latitude: p.latitude, longitude: p.longitude }]),
      ).values(),
    ];
    if (points.length > 25) throw new DomainError('ROUTE_TOO_LARGE', 'Road matrix limit exceeded');
    return { points, matrix: await this.maps.distanceMatrix(points) };
  }
}
export type PlanningSnapshot = Awaited<ReturnType<PlanningService['snapshot']>>;
