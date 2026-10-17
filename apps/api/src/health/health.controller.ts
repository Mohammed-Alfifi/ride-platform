import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import Redis from 'ioredis';
import { Public } from '../auth/decorators';
import { DB, Database } from '../database/database.module';
import { REDIS } from '../redis/redis.module';

/** Liveness (/health/live) for the process, readiness (/health) for its dependencies. */
@ApiExcludeController()
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get()
  async ready(@Res() res: Response): Promise<void> {
    const [db, redis] = await Promise.all([
      this.db.execute(sql`select 1`).then(() => 'up' as const, () => 'down' as const),
      this.redis.ping().then(() => 'up' as const, () => 'down' as const),
    ]);
    const ok = db === 'up' && redis === 'up';
    res
      .status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: ok ? 'ok' : 'degraded', checks: { database: db, redis } });
  }
}
