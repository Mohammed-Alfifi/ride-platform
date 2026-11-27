/**
 * Orders the stops of one car: every rider is picked up inside their time window, dropped off after
 * being picked up, never ridden much longer than the direct trip, and the car never carries more
 * riders than it has seats. This is the pickup-and-delivery problem with time windows for one
 * vehicle; a run carries at most 14 riders, so a careful heuristic finds good orders quickly.
 */

export interface Job {
  /** The trip this rider's pickup and drop-off belong to. */
  id: string;
  /** Indexes into the travel matrix. */
  pickup: number;
  dropoff: number;
  /** Seconds since the plan's epoch: earliest and latest acceptable pick-up. */
  windowStart: number;
  windowEnd: number;
  /** The time the rider chose, inside the window; being early is allowed but costs a little. */
  preferred?: number;
  /** Longest acceptable time on board, seconds. */
  maxRide: number;
}

export interface Problem {
  jobs: Job[];
  durations: number[][];
  capacity: number;
  /** Seconds spent at each stop (getting in or out). */
  serviceSeconds: number;
}

export interface PlannedStop {
  jobId: string;
  kind: 'pickup' | 'dropoff';
  /** Seconds since the plan's epoch when the car is at the stop (after any waiting). */
  at: number;
}

export interface Plan {
  stops: PlannedStop[];
  /** Driving time between stops, seconds. */
  driveSeconds: number;
  /** Seconds past the latest pick-up time, summed over riders. */
  lateSeconds: number;
  /** Seconds over the longest acceptable ride, summed over riders. */
  overRideSeconds: number;
  start: number;
  end: number;
}

export interface Optimizer {
  readonly name: string;
  solve(problem: Problem): Promise<Plan>;
}

type Step = { job: number; kind: 'pickup' | 'dropoff' };

/** Penalty weights: being late or keeping a rider too long costs far more than driving. */
const LATE_WEIGHT = 50;
const OVER_RIDE_WEIGHT = 20;
/** A rider picked up before the time they chose waits less than they would for a late car. */
const EARLY_WEIGHT = 1;

/**
 * Walks a sequence of stops in time and measures it. Returns null when seats would overflow.
 * The car sets off to reach the first rider at their chosen time, or earlier (down to their
 * window) when that keeps later riders on time; whichever costs less.
 */
export function evaluate(problem: Problem, route: Step[]): (Plan & { cost: number }) | null {
  if (route.length === 0) return walk(problem, route, 0);
  const first = problem.jobs[route[0].job];
  const preferred = first.preferred ?? first.windowStart;
  const atPreferred = walk(problem, route, preferred);
  if (!atPreferred || preferred === first.windowStart || atPreferred.lateSeconds === 0) return atPreferred;
  const atWindow = walk(problem, route, first.windowStart);
  return atWindow && atWindow.cost < atPreferred.cost ? atWindow : atPreferred;
}

function walk(problem: Problem, route: Step[], firstArrival: number): (Plan & { cost: number }) | null {
  const { jobs, durations, capacity, serviceSeconds } = problem;
  if (route.length === 0) return { stops: [], driveSeconds: 0, lateSeconds: 0, overRideSeconds: 0, start: 0, end: 0, cost: 0 };
  const pickedAt = new Map<number, number>();
  const stops: PlannedStop[] = [];
  let load = 0;
  let drive = 0;
  let late = 0;
  let early = 0;
  let overRide = 0;
  let clock = 0;
  let prev = -1;
  let prevAt = 0;
  let start = 0;
  for (let i = 0; i < route.length; i++) {
    const { job, kind } = route[i];
    const j = jobs[job];
    const node = kind === 'pickup' ? j.pickup : j.dropoff;
    let arrival: number;
    // Several riders at one spot (a school gate) are one stop: they get in or out together.
    const sameSpot = i > 0 && (prev === node || durations[prev][node] === 0);
    if (i === 0) {
      arrival = kind === 'pickup' ? firstArrival : 0;
      start = arrival;
    } else if (sameSpot) {
      arrival = prevAt;
    } else {
      const leg = durations[prev][node];
      drive += leg;
      arrival = clock + leg;
    }
    let at = arrival;
    if (kind === 'pickup') {
      at = Math.max(arrival, j.windowStart);
      late += Math.max(0, at - j.windowEnd);
      early += Math.max(0, (j.preferred ?? j.windowStart) - at);
      pickedAt.set(job, at);
      load += 1;
      if (load > capacity) return null;
    } else {
      const from = pickedAt.get(job);
      if (from === undefined) return null; // dropped before picked up
      overRide += Math.max(0, at - from - j.maxRide);
      load -= 1;
    }
    stops.push({ jobId: j.id, kind, at });
    clock = sameSpot ? Math.max(clock, at + serviceSeconds) : at + serviceSeconds;
    prev = node;
    prevAt = at;
  }
  const end = clock;
  // Total time on the road (waiting included) plus heavy penalties for broken promises.
  const cost = end - start + LATE_WEIGHT * late + OVER_RIDE_WEIGHT * overRide + EARLY_WEIGHT * early;
  return { stops, driveSeconds: drive, lateSeconds: late, overRideSeconds: overRide, start, end, cost };
}

/** The best place to put one job (pickup at i, drop-off at k > i) into a route. */
function bestInsertion(problem: Problem, route: Step[], job: number): { route: Step[]; cost: number } | null {
  let best: { route: Step[]; cost: number } | null = null;
  for (let i = 0; i <= route.length; i++) {
    for (let k = i + 1; k <= route.length + 1; k++) {
      const next = [...route];
      next.splice(i, 0, { job, kind: 'pickup' });
      next.splice(k, 0, { job, kind: 'dropoff' });
      const r = evaluate(problem, next);
      if (r && (!best || r.cost < best.cost)) best = { route: next, cost: r.cost };
    }
  }
  return best;
}

/**
 * Cheapest insertion in order of pick-up windows, then rounds of "take one rider out and put them
 * back in their best place" until no move helps. Deterministic: the same riders give the same run.
 */
export class BuiltinOptimizer implements Optimizer {
  readonly name = 'builtin';

  async solve(problem: Problem): Promise<Plan> {
    return solveBuiltin(problem);
  }
}

export function solveBuiltin(problem: Problem): Plan {
  const order = problem.jobs
    .map((j, idx) => ({ j, idx }))
    .sort((a, b) => a.j.windowStart - b.j.windowStart || a.j.id.localeCompare(b.j.id))
    .map((x) => x.idx);
  let route: Step[] = [];
  for (const job of order) {
    const ins = bestInsertion(problem, route, job);
    // Only a seat overflow makes every position fail; then the rider rides alone at the end.
    route = ins ? ins.route : [...route, { job, kind: 'pickup' }, { job, kind: 'dropoff' }];
  }
  let current = evaluate(problem, route);
  for (let round = 0; round < 25 && current; round++) {
    let improved = false;
    for (const job of order) {
      const without = route.filter((s) => s.job !== job);
      const ins = bestInsertion(problem, without, job);
      if (ins && ins.cost < current!.cost - 0.5) {
        route = ins.route;
        current = evaluate(problem, route);
        improved = true;
      }
    }
    if (!improved) break;
  }
  return withoutCost(current ?? evaluate(problem, [])!);
}

export function withoutCost(p: Plan & { cost: number }): Plan {
  return { stops: p.stops, driveSeconds: p.driveSeconds, lateSeconds: p.lateSeconds, overRideSeconds: p.overRideSeconds, start: p.start, end: p.end };
}
