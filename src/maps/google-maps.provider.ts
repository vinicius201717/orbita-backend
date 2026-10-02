import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../config/config.service';
import { GeoPoint, MapsProvider, RoadLeg } from './maps.provider';
const element = z.object({
  originIndex: z.number().int(),
  destinationIndex: z.number().int(),
  distanceMeters: z.number().optional(),
  duration: z.string().optional(),
  condition: z.string().optional(),
  status: z.object({ code: z.number().optional() }).optional(),
});
@Injectable()
export class GoogleMapsProvider extends MapsProvider {
  constructor(private readonly config: ConfigService) {
    super();
  }
  async distanceMatrix(points: GeoPoint[]): Promise<RoadLeg[][]> {
    if (points.length > 25) throw new Error('Road matrix limited to 625 elements');
    const waypoints = points.map((p) => ({ waypoint: { location: { latLng: p } } }));
    const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.config.get('GOOGLE_MAPS_API_KEY'),
        'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,distanceMeters,duration',
      },
      body: JSON.stringify({
        origins: waypoints,
        destinations: waypoints,
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
    });
    if (!response.ok) throw new Error(`Maps unavailable (${response.status})`);
    const rows = z.array(element).parse(await response.json());
    const result: RoadLeg[][] = points.map(() =>
      points.map(() => ({ distanceMeters: Infinity, durationSeconds: Infinity })),
    );
    for (const row of rows) {
      const origin = result[row.originIndex];
      if (
        origin &&
        row.condition === 'ROUTE_EXISTS' &&
        !row.status?.code &&
        row.distanceMeters !== undefined &&
        row.duration
      )
        origin[row.destinationIndex] = {
          distanceMeters: Math.ceil(row.distanceMeters),
          durationSeconds: Math.ceil(Number(row.duration.replace(/s$/, ''))),
        };
    }
    return result;
  }
  private async geocoding(query: string) {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${query}&key=${encodeURIComponent(this.config.get('GOOGLE_MAPS_API_KEY'))}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw new Error('Geocoding unavailable');
    const schema = z.object({
      status: z.literal('OK'),
      results: z
        .array(
          z.object({
            formatted_address: z.string(),
            geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }) }),
          }),
        )
        .min(1),
    });
    const result = schema.parse(await response.json()).results[0];
    if (!result) throw new Error('Address not found');
    return result;
  }
  async geocode(address: string) {
    const row = await this.geocoding(`address=${encodeURIComponent(address)}`);
    return { latitude: row.geometry.location.lat, longitude: row.geometry.location.lng };
  }
  async reverseGeocode(point: GeoPoint) {
    return (await this.geocoding(`latlng=${point.latitude},${point.longitude}`)).formatted_address;
  }
}
