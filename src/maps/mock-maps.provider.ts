import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { distanceMeters } from '../tracking/tracking.service';
import { GeoPoint, MapsProvider } from './maps.provider';
@Injectable()
export class MockMapsProvider extends MapsProvider {
  constructor(private readonly config: ConfigService) {
    super();
  }
  async distanceMatrix(points: GeoPoint[]) {
    return points.map((a) =>
      points.map((b) => {
        const distance = Math.ceil(distanceMeters(a, b) * 1.25);
        return {
          distanceMeters: distance,
          durationSeconds: Math.ceil(distance / this.config.get('MOCK_SPEED_METERS_PER_SECOND')),
        };
      }),
    );
  }
  async geocode(address: string) {
    const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(address);
    if (!match) throw new Error('Mock geocoding accepts latitude,longitude only');
    return { latitude: Number(match[1]), longitude: Number(match[2]) };
  }
  async reverseGeocode(point: GeoPoint) {
    return `${point.latitude},${point.longitude}`;
  }
}
