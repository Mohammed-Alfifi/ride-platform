import { Controller, Get, Global, Inject, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import type { RequestMeta } from '../auth/auth.types';
import { ReqMeta, Roles } from '../auth/decorators';
import { DB, Database } from '../database/database.module';
import { REDIS } from '../redis/redis.module';
import { MetricsService } from './metrics.service';

async function timed(check: () => Promise<unknown>): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  try {
    await check();
    return { ok: true, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  }
}

@ApiTags('admin: system')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('v1/admin/system')
export class SystemController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health of this API instance: response times, errors, database, Redis and background jobs' })
  async status(@ReqMeta() meta: RequestMeta) {
    const [db, redis] = await Promise.all([timed(() => this.db.execute(sql`SELECT 1`)), timed(() => this.redis.ping())]);
    const last15 = this.metrics.summary(15);
    const mem = process.memoryUsage();
    return {
      startedAt: this.metrics.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? process.env.GIT_SHA?.slice(0, 7) ?? null,
      memoryMb: Math.round(mem.rss / 1_048_576),
      db,
      redis,
      requests: last15.total,
      routes: last15.routes.slice(0, 25),
      slowest: [...last15.routes].filter((r) => r.count >= 3).sort((a, b) => b.p95 - a.p95).slice(0, 5),
      lastHour: this.metrics.summary(60).total,
      jobs: this.metrics.jobRuns(),
      // Lets you check that rate limits see each visitor's own address behind the hosting proxy.
      you: { ip: meta.ip ?? null },
    };
  }
}

@Global()
@Module({
  controllers: [SystemController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MonitoringModule {}
