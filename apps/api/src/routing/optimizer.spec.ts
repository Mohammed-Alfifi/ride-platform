import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { evaluate, Job, Problem, solveBuiltin } from './optimizer';
import { VroomOptimizer } from './vroom';

/** Points on a straight road, one minute apart: travel time = |i - j| minutes. */
function line(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Math.abs(i - j) * 60));
}

const job = (id: string, pickup: number, dropoff: number, windowStart: number, extra: Partial<Job> = {}): Job => ({
  id,
  pickup,
  dropoff,
  windowStart,
  windowEnd: windowStart + 600,
  maxRide: 3600,
  ...extra,
});

function onBoard(plan: { stops: { kind: string }[] }): number {
  let load = 0;
  let max = 0;
  for (const s of plan.stops) {
    load += s.kind === 'pickup' ? 1 : -1;
    max = Math.max(max, load);
  }
  return max;
}

describe('BuiltinOptimizer', () => {
  // Three homes on the way (0, 1, 2) to one school (5).
  const problem: Problem = {
    jobs: [job('c', 2, 5, 120), job('a', 0, 5, 0), job('b', 1, 5, 60)],
    durations: line(6),
    capacity: 4,
    serviceSeconds: 0,
  };

  it('collects riders along the way and drops them together, on time', () => {
    const plan = solveBuiltin(problem);
    expect(plan.stops.slice(0, 3).map((s) => `${s.kind}:${s.jobId}`)).toEqual(['pickup:a', 'pickup:b', 'pickup:c']);
    // All three get off at the same school, in any order.
    expect(plan.stops.slice(3).every((s) => s.kind === 'dropoff' && s.at === 300)).toBe(true);
    expect(plan.lateSeconds).toBe(0);
    expect(plan.overRideSeconds).toBe(0);
    expect(plan.driveSeconds).toBe(5 * 60);
    expect(plan.stops[0].at).toBe(0);
  });

  it('never carries more riders than seats', () => {
    const plan = solveBuiltin({ ...problem, capacity: 2 });
    expect(onBoard(plan)).toBeLessThanOrEqual(2);
    expect(plan.stops).toHaveLength(6);
  });

  it('keeps each ride within its limit when it can', () => {
    // Rider a may ride at most 3 minutes; it is better to take them straight there.
    const tight: Problem = { ...problem, jobs: [job('a', 0, 3, 0, { maxRide: 180 }), job('b', 4, 5, 0, { windowEnd: 3000 })], capacity: 4 };
    const plan = solveBuiltin(tight);
    expect(plan.overRideSeconds).toBe(0);
    expect(plan.stops.slice(0, 2).map((s) => s.jobId)).toEqual(['a', 'a']);
  });

  it('waits for a window rather than arriving early', () => {
    const plan = solveBuiltin({ ...problem, jobs: [job('a', 0, 1, 0), job('b', 2, 3, 900)] });
    const pickB = plan.stops.find((s) => s.jobId === 'b' && s.kind === 'pickup')!;
    expect(pickB.at).toBe(900);
  });

  it('starts at the chosen time, earlier only to keep later riders on time', () => {
    const relaxed = solveBuiltin({ ...problem, jobs: [job('a', 0, 5, 600, { windowStart: 0, preferred: 600 })] });
    expect(relaxed.stops[0].at).toBe(600);
    // b must be collected by 700 at the latest (window 0..700), 4 minutes after a's home.
    const tight = solveBuiltin({
      ...problem,
      jobs: [job('a', 0, 5, 300, { windowStart: 0, preferred: 600, windowEnd: 900 }), job('b', 4, 5, 0, { windowStart: 0, windowEnd: 700, preferred: 700 })],
    });
    expect(tight.lateSeconds).toBe(0);
    expect(tight.stops[0].at).toBeLessThan(600);
  });

  it('treats riders at one spot as one stop', () => {
    // Three children leave one school gate (point 5) for homes along the street.
    const plan = solveBuiltin({
      jobs: [job('a', 5, 0, 0, { windowStart: 0, preferred: 0 }), job('b', 5, 1, 0, { windowStart: 0, preferred: 0 }), job('c', 5, 2, 0, { windowStart: 0, preferred: 0 })],
      durations: line(6),
      capacity: 4,
      serviceSeconds: 60,
    });
    expect(plan.stops.slice(0, 3).map((s) => s.at)).toEqual([0, 0, 0]);
    expect(plan.lateSeconds).toBe(0);
  });

  it('is deterministic', () => {
    expect(solveBuiltin(problem)).toEqual(solveBuiltin({ ...problem, jobs: [...problem.jobs].reverse() }));
  });

  it('rejects a drop-off before its pick-up', () => {
    expect(evaluate(problem, [{ job: 0, kind: 'dropoff' }])).toBeNull();
  });
});

describe('VroomOptimizer', () => {
  const problem: Problem = { jobs: [job('a', 0, 3, 0), job('b', 1, 3, 60)], durations: line(4), capacity: 4, serviceSeconds: 0 };
  let server: Server;
  let reply: unknown;
  let received: Record<string, unknown> | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received = JSON.parse(data);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const url = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  it('sends shipments with windows and seats, and reads the order back', async () => {
    reply = {
      code: 0,
      routes: [{ steps: [{ type: 'start', arrival: 0 }, { type: 'pickup', id: 1, arrival: 0 }, { type: 'pickup', id: 3, arrival: 60 }, { type: 'delivery', id: 2, arrival: 180 }, { type: 'delivery', id: 4, arrival: 180 }, { type: 'end', arrival: 180 }] }],
    };
    const plan = await new VroomOptimizer(url(), 2000).solve(problem);
    expect(received).toMatchObject({ vehicles: [{ id: 1, capacity: [4] }], matrices: { car: { durations: line(4) } } });
    expect((received!.shipments as unknown[])[1]).toMatchObject({ pickup: { id: 3, location_index: 1, time_windows: [[60, 660]] }, delivery: { id: 4, location_index: 3 } });
    expect(plan.stops.map((s) => `${s.kind}:${s.jobId}`)).toEqual(['pickup:a', 'pickup:b', 'dropoff:a', 'dropoff:b']);
    expect(plan.solvedBy).toBe('vroom');
  });

  it('falls back to the built-in plan when riders are left out or the server is down', async () => {
    reply = { code: 0, routes: [{ steps: [] }], unassigned: [{ id: 1 }] };
    expect((await new VroomOptimizer(url(), 2000).solve(problem)).solvedBy).toBe('builtin');
    const down = await new VroomOptimizer('http://127.0.0.1:1', 500).solve(problem);
    expect(down.solvedBy).toBe('builtin');
    expect(down.stops).toHaveLength(4);
  });
});
