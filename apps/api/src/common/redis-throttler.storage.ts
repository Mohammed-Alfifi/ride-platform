import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/** Shares rate-limit counters across API instances through Redis. Times are in milliseconds. */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;

    const blockTtl = await this.redis.pttl(blockKey);
    if (blockTtl > 0) {
      return { totalHits: limit + 1, timeToExpire: blockTtl, isBlocked: true, timeToBlockExpire: blockTtl };
    }

    const [[, hits], [, pttl]] = (await this.redis
      .multi()
      .incr(hitKey)
      .pttl(hitKey)
      .exec()) as [[null, number], [null, number]];
    let timeToExpire = pttl;
    if (pttl < 0) {
      await this.redis.pexpire(hitKey, ttl);
      timeToExpire = ttl;
    }

    if (hits > limit) {
      const duration = blockDuration > 0 ? blockDuration : timeToExpire;
      await this.redis.set(blockKey, '1', 'PX', duration);
      return { totalHits: hits, timeToExpire, isBlocked: true, timeToBlockExpire: duration };
    }
    return { totalHits: hits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
