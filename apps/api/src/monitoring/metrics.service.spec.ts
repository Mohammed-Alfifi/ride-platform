import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('summarises timings and server errors per route', () => {
    const m = new MetricsService();
    for (let i = 1; i <= 100; i++) m.record('GET /v1/trips', 200, i);
    m.record('GET /v1/trips', 500, 900);
    m.record('POST /v1/driver/location', 200, 5);
    const { total, routes } = m.summary();
    expect(routes[0]).toMatchObject({ route: 'GET /v1/trips', count: 101, errors: 1, max: 900 });
    expect(routes[0].p50).toBeGreaterThanOrEqual(49);
    expect(routes[0].p50).toBeLessThanOrEqual(52);
    expect(routes[0].p95).toBeGreaterThanOrEqual(94);
    expect(total).toMatchObject({ count: 102, errors: 1 });
  });

  it('remembers the last result of each background job', async () => {
    const m = new MetricsService();
    await m.track('trips', async () => 1);
    await expect(m.track('trips', async () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
    expect(m.jobRuns()[0]).toMatchObject({ name: 'trips', ok: false, error: 'db down', runs: 2, failures: 1 });
  });
});
