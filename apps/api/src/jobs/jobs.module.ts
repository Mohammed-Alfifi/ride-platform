import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { ComplianceService } from '../drivers/compliance.service';
import { DriversModule } from '../drivers/drivers.module';
import { RenewalsService } from '../subscriptions/renewals.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TripGenerator } from '../trips/trip.generator';
import { TripWatch } from '../trips/trip.watch';
import { MetricsService } from '../monitoring/metrics.service';
import { TripsModule } from '../trips/trips.module';

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
 * Background jobs: trips for today and tomorrow at 00:10, location history purge at 03:30, subscription renewals
 * at 05:00, the compliance scan at 06:00 Riyadh time, and the trip watch (late drivers, trips without a driver)
 * every two minutes. BullMQ keeps one
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
    private readonly renewals: RenewalsService,
    private readonly tripGenerator: TripGenerator,
    private readonly tripWatch: TripWatch,
    private readonly metrics: MetricsService,
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
    await this.queue.upsertJobScheduler(
      'daily-renewals',
      { pattern: '0 5 * * *', tz: 'Asia/Riyadh' },
      { name: 'renewals', opts: { removeOnComplete: 30, removeOnFail: 100 } },
    );
    await this.queue.upsertJobScheduler(
      'daily-trips',
      { pattern: '10 0 * * *', tz: 'Asia/Riyadh' },
      { name: 'trips', opts: { removeOnComplete: 30, removeOnFail: 100 } },
    );
    await this.queue.upsertJobScheduler(
      'trip-watch',
      { pattern: '*/2 * * * *', tz: 'Asia/Riyadh' },
      { name: 'watch', opts: { removeOnComplete: 10, removeOnFail: 50 } },
    );
    await this.queue.upsertJobScheduler(
      'daily-purge',
      { pattern: '30 3 * * *', tz: 'Asia/Riyadh' },
      { name: 'purge', opts: { removeOnComplete: 30, removeOnFail: 100 } },
    );
    this.worker = new Worker(
      QUEUE,
      // Each run is recorded for the dashboard's system page (last run, duration, failures).
      async (job) =>
        this.metrics.track<unknown>(job.name, () => {
          if (job.name === 'renewals') return this.renewals.run();
          if (job.name === 'trips') return this.tripGenerator.generate();
          if (job.name === 'watch') return this.tripWatch.run();
          if (job.name === 'purge') return this.tripWatch.purge();
          return this.compliance.scan();
        }),
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} failed: ${err.message}`));
    this.logger.log('Daily jobs scheduled (Asia/Riyadh): trips 00:10, purge 03:30, renewals 05:00, compliance scan 06:00, trip watch every 2 min');
    // Catch up after downtime: make sure today's and tomorrow's trips exist.
    await this.metrics.track('trips', () => this.tripGenerator.generate()).catch((err: Error) => this.logger.error(`Trip generation failed: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

@Module({
  imports: [DriversModule, SubscriptionsModule, TripsModule],
  providers: [JobsRunner],
})
export class JobsModule {}
