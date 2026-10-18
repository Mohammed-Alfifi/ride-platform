import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface LivePosition {
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  at: string;
}

/** A position older than this is not shown as live. */
const TTL_SECONDS = 10 * 60;
const key = (driverId: string) => `live:driver:${driverId}`;

/** Latest position of each driver, kept in Redis only (it changes every few seconds). */
@Injectable()
export class LiveStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async set(driverId: string, pos: LivePosition): Promise<void> {
    await this.redis.set(key(driverId), JSON.stringify(pos), 'EX', TTL_SECONDS);
  }

  async get(driverId: string): Promise<LivePosition | null> {
    const raw = await this.redis.get(key(driverId));
    return raw ? (JSON.parse(raw) as LivePosition) : null;
  }

  async many(driverIds: string[]): Promise<Map<string, LivePosition>> {
    const out = new Map<string, LivePosition>();
    if (driverIds.length === 0) return out;
    const raws = await this.redis.mget(driverIds.map(key));
    raws.forEach((raw, i) => {
      if (raw) out.set(driverIds[i], JSON.parse(raw) as LivePosition);
    });
    return out;
  }
}
