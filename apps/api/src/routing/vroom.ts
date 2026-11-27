import { Logger } from '@nestjs/common';
import { evaluate, Optimizer, Plan, Problem, solveBuiltin, withoutCost } from './optimizer';

interface VroomStep {
  type: 'start' | 'job' | 'pickup' | 'delivery' | 'break' | 'end';
  id?: number;
  arrival: number;
}
interface VroomResponse {
  code: number;
  error?: string;
  routes?: { steps: VroomStep[] }[];
  unassigned?: { id: number }[];
}

/**
 * Hands the problem to a VROOM server (open source, self-hosted next to OSRM). VROOM treats time
 * windows as hard limits; when it cannot place every rider, or is unreachable, the built-in
 * optimizer plans the run instead, which bends a window rather than leave a rider out.
 * The longest-ride limit is checked on VROOM's answer: a worse answer than ours is not used.
 */
export class VroomOptimizer implements Optimizer {
  readonly name = 'vroom';
  private readonly logger = new Logger('Vroom');

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async solve(problem: Problem): Promise<Plan & { solvedBy?: string }> {
    const builtin = solveBuiltin(problem);
    if (problem.jobs.length === 0) return builtin;
    try {
      // VROOM works in non-negative integer times; shift the plan's epoch to the earliest window.
      const base = Math.min(...problem.jobs.map((j) => j.windowStart));
      const body = {
        vehicles: [{ id: 1, capacity: [problem.capacity] }],
        shipments: problem.jobs.map((j, i) => ({
          amount: [1],
          pickup: { id: 2 * i + 1, location_index: j.pickup, service: problem.serviceSeconds, time_windows: [[j.windowStart - base, j.windowEnd - base]] },
          delivery: { id: 2 * i + 2, location_index: j.dropoff, service: problem.serviceSeconds },
        })),
        matrices: { car: { durations: problem.durations } },
      };
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = (await res.json()) as VroomResponse;
      if (out.code !== 0 || !out.routes?.length) throw new Error(out.error ?? `code ${out.code}`);
      if (out.unassigned?.length) throw new Error(`${out.unassigned.length} riders left out`);
      const steps = out.routes[0].steps.filter((s) => s.type === 'pickup' || s.type === 'delivery');
      const route = steps.map((s) => ({ job: Math.floor((s.id! - 1) / 2), kind: s.type === 'pickup' ? ('pickup' as const) : ('dropoff' as const) }));
      const vroom = evaluate(problem, route);
      if (!vroom) throw new Error('answer overflows the seats');
      const ours = builtinCost(problem, builtin);
      // Prefer VROOM's order unless ours is clearly better (it also weighs ride length).
      if (ours !== null && ours < vroom.cost - 0.5) return { ...builtin, solvedBy: 'builtin' };
      return { ...withoutCost(vroom), solvedBy: 'vroom' };
    } catch (err) {
      this.logger.warn(`VROOM not used (${(err as Error).message}); built-in plan kept`);
      return { ...builtin, solvedBy: 'builtin' };
    }
  }
}

function builtinCost(problem: Problem, plan: Plan): number | null {
  const byJob = new Map(problem.jobs.map((j, i) => [j.id, i]));
  const r = evaluate(
    problem,
    plan.stops.map((s) => ({ job: byJob.get(s.jobId)!, kind: s.kind })),
  );
  return r ? r.cost : null;
}
