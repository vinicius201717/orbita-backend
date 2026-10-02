import { distanceMeters } from './tracking.service';
describe('tracking distance', () => {
  it('detects movement in meters', () => {
    expect(
      distanceMeters({ latitude: -16.68, longitude: -49.25 }, { latitude: -16.68, longitude: -49.25 }),
    ).toBe(0);
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeGreaterThan(
      111000,
    );
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeLessThan(112000);
  });
});
