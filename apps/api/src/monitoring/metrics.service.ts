import { Injectable } from '@nestjs/common';

interface RouteStats {
  count: number;
  errors: number;
  /** A sample of response times (ms), enough for percentiles without unbounded memory. */
  samples: number[];
}

export interface RouteSummary {
  route: string;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  max: number;
}

export interface JobRun {
  name: string;
  lastRunAt: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
  runs: number;
  failures: number;
}

const BUCKET_MS = 60_000;
const KEEP_BUCKETS = 60;
const MAX_SAMPLES = 400;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/**
 * Request timings and background job results kept in memory for the last hour, per minute.
 * Small and dependency free: enough to answer "is it slow, where, and since when" from the
 * dashboard. Each API instance reports its own numbers.
 */
@Injectable()
export class MetricsService {
  readonly startedAt = new Date();
  private readonly buckets = new Map<number, Map<string, RouteStats>>();
  private readonly jobs = new Map<string, JobRun>();

  record(route: string, status: number, ms: number): void {
    const minute = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
    let bucket = this.buckets.get(minute);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(minute, bucket);
      for (const key of this.buckets.keys()) if (key < minute - KEEP_BUCKETS * BUCKET_MS) this.buckets.delete(key);
    }
    let stats = bucket.get(route);
    if (!stats) {
      stats = { count: 0, errors: 0, samples: [] };
      bucket.set(route, stats);
    }
    stats.count++;
    if (status >= 500) stats.errors++;
    if (stats.samples.length < MAX_SAMPLES) stats.samples.push(ms);
    else stats.samples[Math.floor(Math.random() * MAX_SAMPLES)] = ms;
  }

  /** Per route over the last `minutes`, busiest first, plus a total row. */
  summary(minutes = 15): { total: Omit<RouteSummary, 'route'>; routes: RouteSummary[] } {
    const since = Date.now() - minutes * BUCKET_MS;
    const merged = new Map<string, RouteStats>();
    for (const [minute, bucket] of this.buckets) {
      if (minute < since - BUCKET_MS) continue;
      for (const [route, s] of bucket) {
        const m = merged.get(route) ?? { count: 0, errors: 0, samples: [] };
        m.count += s.count;
        m.errors += s.errors;
        m.samples.push(...s.samples);
        merged.set(route, m);
      }
    }
    const all: number[] = [];
    let count = 0;
    let errors = 0;
    const routes = [...merged.entries()].map(([route, s]) => {
      const sorted = [...s.samples].sort((a, b) => a - b);
      all.push(...sorted);
      count += s.count;
      errors += s.errors;
      return { route, count: s.count, errors: s.errors, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] ?? 0 };
    });
    all.sort((a, b) => a - b);
    return {
      total: { count, errors, p50: percentile(all, 50), p95: percentile(all, 95), max: all[all.length - 1] ?? 0 },
      routes: routes.sort((a, b) => b.count - a.count),
    };
  }

  /** Wraps a background job so its last result shows on the system page. */
  async track<T>(name: string, run: () => Promise<T>): Promise<T> {
    const started = Date.now();
    const prev = this.jobs.get(name);
    try {
      const result = await run();
      this.jobs.set(name, this.jobRow(name, prev, started, null));
      return result;
    } catch (err) {
      this.jobs.set(name, this.jobRow(name, prev, started, (err as Error).message));
      throw err;
    }
  }

  jobRuns(): JobRun[] {
    return [...this.jobs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private jobRow(name: string, prev: JobRun | undefined, started: number, error: string | null): JobRun {
    return {
      name,
      lastRunAt: new Date(started).toISOString(),
      ok: error === null,
      durationMs: Date.now() - started,
      error: error?.slice(0, 300) ?? null,
      runs: (prev?.runs ?? 0) + 1,
      failures: (prev?.failures ?? 0) + (error ? 1 : 0),
    };
  }
}
