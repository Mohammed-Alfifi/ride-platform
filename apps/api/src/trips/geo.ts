/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Rough arrival estimate for the rider's screen: road distance taken as 1.3x the straight line,
 * at an average city speed of 30 km/h. Never less than one minute while the driver is moving.
 */
export function etaMinutes(meters: number): number {
  return Math.max(1, Math.round(((meters * 1.3) / 1000 / 30) * 60));
}
