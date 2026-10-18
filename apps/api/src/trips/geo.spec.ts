import { distanceMeters, etaMinutes } from './geo';

describe('geo', () => {
  it('measures distances on the ground', () => {
    // About 1.1 km between two points 0.01 degrees of latitude apart.
    expect(distanceMeters({ lat: 24.7, lng: 46.7 }, { lat: 24.71, lng: 46.7 })).toBeGreaterThan(1100);
    expect(distanceMeters({ lat: 24.7, lng: 46.7 }, { lat: 24.71, lng: 46.7 })).toBeLessThan(1120);
    expect(distanceMeters({ lat: 24.7, lng: 46.7 }, { lat: 24.7, lng: 46.7 })).toBe(0);
  });

  it('estimates arrival time at city speed', () => {
    expect(etaMinutes(0)).toBe(1);
    expect(etaMinutes(5000)).toBe(13);
  });
});
