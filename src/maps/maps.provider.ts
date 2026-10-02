export interface GeoPoint {
  latitude: number;
  longitude: number;
}
export interface RoadLeg {
  distanceMeters: number;
  durationSeconds: number;
}
export abstract class MapsProvider {
  abstract distanceMatrix(points: GeoPoint[]): Promise<RoadLeg[][]>;
  abstract geocode(address: string): Promise<GeoPoint>;
  abstract reverseGeocode(point: GeoPoint): Promise<string>;
  async directions(points: GeoPoint[]): Promise<RoadLeg> {
    const matrix = await this.distanceMatrix(points);
    return points.slice(1).reduce(
      (sum, _point, i) => {
        const leg = matrix[i]?.[i + 1];
        if (!leg) throw new Error('Missing road leg');
        return {
          distanceMeters: sum.distanceMeters + leg.distanceMeters,
          durationSeconds: sum.durationSeconds + leg.durationSeconds,
        };
      },
      { distanceMeters: 0, durationSeconds: 0 },
    );
  }
}
