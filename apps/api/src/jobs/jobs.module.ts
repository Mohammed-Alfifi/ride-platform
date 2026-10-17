import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { ComplianceService } from '../drivers/compliance.service';
import { DriversModule } from '../drivers/drivers.module';

const QUEUE = 'compliance';

function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Background jobs. The daily compliance scan runs at 06:00 Riyadh time. BullMQ keeps one
 * schedule in Redis, so several API instances still run the scan once.
 */
@Injectable()
export class JobsRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly compliance: ComplianceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    const connection = redisConnection(this.env.REDIS_URL);
    this.queue = new Queue(QUEUE, { connection });
    await this.queue.upsertJobScheduler(
      'daily-compliance-scan',
      { pattern: '0 6 * * *', tz: 'Asia/Riyadh' },
      { name: 'scan', opts: { removeOnComplete: 30, removeOnFail: 100 } },
    );
    this.worker = new Worker(QUEUE, async () => this.compliance.scan(), { connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} failed: ${err.message}`));
    this.logger.log('Daily compliance scan scheduled for 06:00 Asia/Riyadh');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

@Module({
  imports: [DriversModule],
  providers: [JobsRunner],
})
export class JobsModule {}
