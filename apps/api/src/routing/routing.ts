import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { distanceMeters } from '../trips/geo';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Travel times between points, in seconds. `durations[i][j]` is from point i to point j. */
export interface TravelMatrix {
  durations: number[][];
  /** Which source produced it: osrm (road network) or haversine (straight-line estimate). */
  source: 'osrm' | 'haversine';
}

/**
 * The straight-line estimate the platform used before road routing: 1.3x the great-circle distance
 * at 30 km/h. Always available, so planning and ETAs never stop when the routing server is down.
 */
export function haversineSeconds(a: LatLng, b: LatLng): number {
  return Math.round(((distanceMeters(a, b) * 1.3) / 1000 / 30) * 3600);
}

export function haversineMatrix(points: LatLng[]): TravelMatrix {
  return { durations: points.map((a) => points.map((b) => haversineSeconds(a, b))), source: 'haversine' };
}

/**
 * Road travel times. With OSRM_URL set, asks a self-hosted OSRM (Saudi OpenStreetMap extract, car
 * profile) for a duration table; otherwise, or if OSRM fails or times out, falls back to the
 * straight-line estimate and says so in `source`.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger('Routing');

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return Boolean(this.env.OSRM_URL);
  }

  async matrix(points: LatLng[]): Promise<TravelMatrix> {
    if (points.length < 2 || !this.env.OSRM_URL) return haversineMatrix(points);
    // OSRM wants lng,lat; one request handles the small tables of a run (at most ~30 points).
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const url = `${this.env.OSRM_URL.replace(/\/$/, '')}/table/v1/driving/${coords}?annotations=duration`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.env.ROUTING_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { code: string; durations?: (number | null)[][] };
      if (body.code !== 'Ok' || !body.durations) throw new Error(`code ${body.code}`);
      // Unroutable pairs (null) fall back to the estimate for that pair only.
      const durations = body.durations.map((row, i) =>
        row.map((d, j) => (d == null ? haversineSeconds(points[i], points[j]) : Math.round(d))),
      );
      return { durations, source: 'osrm' };
    } catch (err) {
      this.logger.warn(`OSRM unavailable (${(err as Error).message}); using straight-line estimates`);
      return haversineMatrix(points);
    }
  }

  /** Seconds from one point to another. */
  async seconds(from: LatLng, to: LatLng): Promise<number> {
    if (!this.env.OSRM_URL) return haversineSeconds(from, to);
    return (await this.matrix([from, to])).durations[0][1];
  }

  /** Minutes for the rider's screen: never less than one while the driver is still moving. */
  async etaMinutes(from: LatLng, to: LatLng): Promise<number> {
    return Math.max(1, Math.round((await this.seconds(from, to)) / 60));
  }
}
