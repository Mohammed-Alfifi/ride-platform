import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { addDays, riyadhToday } from '../common/saudi';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { driverProfiles, places, plans, runs, runStops, subscriptions, trips, users, vehicles } from '../database/schema';
import { ComplianceService } from '../drivers/compliance.service';
import { BuiltinOptimizer, Job, Optimizer, Plan, Problem, solveBuiltin } from '../routing/optimizer';
import { LatLng, RoutingService } from '../routing/routing';
import { VroomOptimizer } from '../routing/vroom';
import { LiveStore } from '../trips/live.store';
import { TripGenerator } from '../trips/trip.generator';
import { TripsService } from '../trips/trips.service';
import { DriverSuggestionView, RunView, SubstituteView } from './runs.dto';

type Leg = 'outbound' | 'return';

/** A trip as the planner sees it: where, when, and whether it has started. */
interface PlanTrip {
  id: string;
  driverId: string;
  partnerId: string;
  leg: Leg;
  status: string;
  scheduledAt: Date;
  pickup: LatLng;
  dropoff: LatLng;
}

const DEFAULT_SEATS = 4;

/**
 * Runs: one car carrying several riders on one leg of a day, in a planned order.
 *
 * Every night after the trips are generated, and whenever a rider joins or leaves a driver, the
 * planner orders each driver's pick-ups and drop-offs with the route optimizer (VROOM when
 * configured, else the built-in one) over road travel times (OSRM when configured, else the
 * straight-line estimate). A run is never re-planned once one of its trips has started.
 */
@Injectable()
export class RunsService {
  private readonly logger = new Logger('Runs');
  private readonly optimizer: Optimizer;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly routing: RoutingService,
    private readonly compliance: ComplianceService,
    private readonly tripsService: TripsService,
    private readonly live: LiveStore,
    generator: TripGenerator,
  ) {
    this.optimizer = env.VROOM_URL ? new VroomOptimizer(env.VROOM_URL, env.ROUTING_TIMEOUT_MS) : new BuiltinOptimizer();
    // A rider joined, left, paused or skipped: re-plan that driver's runs for today and tomorrow.
    generator.onDriversChanged((driverIds) => this.planUpcoming({ driverIds }));
  }

  // ------------------------------------------------------------------ planning

  /** Plans today and tomorrow (the nightly job), optionally for some drivers only. */
  async planUpcoming(opts: { driverIds?: string[]; partnerId?: string } = {}): Promise<{ planned: number; kept: number; removed: number }> {
    const today = riyadhToday();
    const a = await this.planDay(today, opts);
    const b = await this.planDay(addDays(today, 1), opts);
    return { planned: a.planned + b.planned, kept: a.kept + b.kept, removed: a.removed + b.removed };
  }

  async planDay(day: string, opts: { driverIds?: string[]; partnerId?: string } = {}): Promise<{ planned: number; kept: number; removed: number }> {
    if (opts.driverIds && opts.driverIds.length === 0) return { planned: 0, kept: 0, removed: 0 };
    const rows = await this.db
      .select({
        id: trips.id,
        driverId: trips.driverId,
        partnerId: trips.partnerId,
        leg: trips.leg,
        status: trips.status,
        scheduledAt: trips.scheduledAt,
        pLat: sql<number>`ST_Y(${trips.pickup})`,
        pLng: sql<number>`ST_X(${trips.pickup})`,
        dLat: sql<number>`ST_Y(${trips.dropoff})`,
        dLng: sql<number>`ST_X(${trips.dropoff})`,
      })
      .from(trips)
      .where(
        and(
          eq(trips.serviceDate, day),
          isNotNull(trips.driverId),
          opts.driverIds ? inArray(trips.driverId, opts.driverIds) : undefined,
          opts.partnerId ? eq(trips.partnerId, opts.partnerId) : undefined,
        ),
      )
      .orderBy(asc(trips.scheduledAt), asc(trips.id));
    const groups = new Map<string, PlanTrip[]>();
    for (const r of rows) {
      const key = `${r.driverId}|${r.leg}`;
      const list = groups.get(key) ?? [];
      list.push({
        id: r.id,
        driverId: r.driverId!,
        partnerId: r.partnerId,
        leg: r.leg,
        status: r.status,
        scheduledAt: r.scheduledAt,
        pickup: { lat: Number(r.pLat), lng: Number(r.pLng) },
        dropoff: { lat: Number(r.dLat), lng: Number(r.dLng) },
      });
      groups.set(key, list);
    }

    // Runs that no longer have any trip for their driver (rider moved away) are removed.
    const existing = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.serviceDate, day),
          opts.driverIds ? inArray(runs.driverId, opts.driverIds) : undefined,
          opts.partnerId ? eq(runs.partnerId, opts.partnerId) : undefined,
        ),
      );
    let planned = 0;
    let kept = 0;
    let removed = 0;
    for (const run of existing) {
      const group = groups.get(`${run.driverId}|${run.leg}`);
      if (!group?.some((t) => t.status === 'scheduled') && run.status === 'planned') {
        const gone = await this.db.delete(runs).where(and(eq(runs.id, run.id), eq(runs.status, 'planned'))).returning({ id: runs.id });
        removed += gone.length;
      }
    }

    for (const [, group] of groups) {
      const started = group.some((t) => t.status !== 'scheduled' && t.status !== 'cancelled' && t.status !== 'skipped');
      const waiting = group.filter((t) => t.status === 'scheduled');
      if (started) {
        kept++;
        continue;
      }
      if (waiting.length === 0) continue;
      await this.planGroup(day, waiting);
      planned++;
    }
    if (planned + removed > 0) this.logger.log(`Runs ${day}: ${planned} planned, ${kept} kept (started), ${removed} removed`);
    return { planned, kept, removed };
  }

  private async planGroup(day: string, group: PlanTrip[]): Promise<void> {
    const { driverId, partnerId, leg } = group[0];
    const seats = (await this.db.query.vehicles.findFirst({ columns: { seats: true }, where: eq(vehicles.driverId, driverId) }))?.seats ?? DEFAULT_SEATS;
    const epoch = Math.min(...group.map((t) => t.scheduledAt.getTime()));
    const { problem, source } = await this.problem(
      group.map((t) => ({ id: t.id, pickup: t.pickup, dropoff: t.dropoff, at: t.scheduledAt.getTime() })),
      epoch,
      seats,
      leg,
    );
    const plan = (await this.optimizer.solve(problem)) as Plan & { solvedBy?: string };
    const at = (s: number) => new Date(epoch + s * 1000);

    await this.db.transaction(async (tx) => {
      // One planner per car and leg at a time (the nightly job, a dispatcher, a rider change).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`run:${driverId}:${day}:${leg}`}))`);
      // The driver may have set off while we were computing: then the run stays as it is.
      const [moved] = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(inArray(trips.id, group.map((t) => t.id)), ne(trips.status, 'scheduled')))
        .limit(1);
      if (moved) return;
      await tx.delete(runs).where(and(eq(runs.driverId, driverId), eq(runs.serviceDate, day), eq(runs.leg, leg)));
      // A rider who moved here from another car may still be listed in that car's old run; this
      // run takes them over (the other car is re-planned in the same pass, or the next one).
      await tx.delete(runStops).where(inArray(runStops.tripId, group.map((t) => t.id)));
      const [run] = await tx
        .insert(runs)
        .values({
          partnerId,
          driverId,
          serviceDate: day,
          leg,
          plannedStartAt: at(plan.start),
          plannedEndAt: at(plan.end),
          driveSeconds: plan.driveSeconds,
          lateMinutes: Math.round(plan.lateSeconds / 60),
          optimizer: plan.solvedBy ?? this.optimizer.name,
          routing: source,
        })
        .returning({ id: runs.id });
      await tx.insert(runStops).values(
        plan.stops.map((s, i) => ({ runId: run.id, seq: i + 1, tripId: s.jobId, kind: s.kind, plannedAt: at(s.at) })),
      );
    });
  }

  /** Builds the optimizer's problem for riders of one car, times in seconds from `epoch`. */
  private async problem(
    items: { id: string; pickup: LatLng; dropoff: LatLng; at: number }[],
    epoch: number,
    capacity: number,
    leg: Leg,
  ): Promise<{ problem: Problem; source: string }> {
    const points = items.flatMap((t) => [t.pickup, t.dropoff]);
    const matrix = await this.routing.matrix(points);
    // From home a rider can be ready a little early; at school or work they leave at their time.
    const early = leg === 'outbound' ? this.env.RUN_PICKUP_EARLY_MINUTES * 60 : 0;
    const lateBy = this.env.RUN_PICKUP_LATE_MINUTES * 60;
    const jobs: Job[] = items.map((t, i) => {
      const chosen = Math.round((t.at - epoch) / 1000);
      const direct = matrix.durations[2 * i][2 * i + 1];
      return {
        id: t.id,
        pickup: 2 * i,
        dropoff: 2 * i + 1,
        windowStart: chosen - early,
        windowEnd: chosen + lateBy,
        preferred: chosen,
        maxRide: Math.round(direct * this.env.RUN_MAX_RIDE_FACTOR) + this.env.RUN_MAX_RIDE_EXTRA_MINUTES * 60,
      };
    });
    return { problem: { jobs, durations: matrix.durations, capacity, serviceSeconds: this.env.RUN_STOP_SECONDS }, source: matrix.source };
  }

  // ------------------------------------------------------------------ reading

  async list(actor: AuthUser, day: string, requestedPartner?: string, driverId?: string): Promise<RunView[]> {
    const partnerId = partnerScope(actor, requestedPartner);
    const rows = await this.db
      .select({ run: runs, driverName: driverProfiles.fullName })
      .from(runs)
      .leftJoin(driverProfiles, eq(driverProfiles.userId, runs.driverId))
      .where(
        and(
          eq(runs.serviceDate, day),
          partnerId ? eq(runs.partnerId, partnerId) : undefined,
          driverId ? eq(runs.driverId, driverId) : undefined,
        ),
      )
      .orderBy(asc(runs.plannedStartAt));
    return this.withStops(rows.map((r) => ({ ...r.run, driverName: r.driverName })));
  }

  /** The driver's runs today, stops in order: what the driver app follows. */
  async forDriver(driver: AuthUser, day = riyadhToday()): Promise<RunView[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.driverId, driver.id), eq(runs.serviceDate, day), ne(runs.status, 'cancelled')))
      .orderBy(asc(runs.plannedStartAt));
    return this.withStops(rows.map((r) => ({ ...r, driverName: null })));
  }

  private async withStops(list: (typeof runs.$inferSelect & { driverName: string | null })[]): Promise<RunView[]> {
    if (list.length === 0) return [];
    const stops = await this.db
      .select({
        runId: runStops.runId,
        seq: runStops.seq,
        kind: runStops.kind,
        plannedAt: runStops.plannedAt,
        tripId: trips.id,
        status: trips.status,
        scheduledAt: trips.scheduledAt,
        place: sql<string>`CASE WHEN ${runStops.kind} = 'pickup' THEN ${trips.pickupName} ELSE ${trips.dropoffName} END`,
        lat: sql<number>`ST_Y(CASE WHEN ${runStops.kind} = 'pickup' THEN ${trips.pickup} ELSE ${trips.dropoff} END)`,
        lng: sql<number>`ST_X(CASE WHEN ${runStops.kind} = 'pickup' THEN ${trips.pickup} ELSE ${trips.dropoff} END)`,
        rider: sql<string | null>`coalesce(${trips.passengerName}, ${users.name})`,
      })
      .from(runStops)
      .innerJoin(trips, eq(trips.id, runStops.tripId))
      .innerJoin(users, eq(users.id, trips.riderId))
      .where(inArray(runStops.runId, list.map((r) => r.id)))
      .orderBy(asc(runStops.runId), asc(runStops.seq));
    return list.map((r) => ({
      id: r.id,
      driverId: r.driverId,
      driverName: r.driverName,
      serviceDate: r.serviceDate,
      leg: r.leg,
      status: r.status,
      plannedStartAt: r.plannedStartAt.toISOString(),
      plannedEndAt: r.plannedEndAt.toISOString(),
      driveMinutes: Math.round(r.driveSeconds / 60),
      lateMinutes: r.lateMinutes,
      optimizer: r.optimizer,
      routing: r.routing,
      riders: stops.filter((s) => s.runId === r.id && s.kind === 'pickup').length,
      stops: stops
        .filter((s) => s.runId === r.id)
        .map((s) => ({
          seq: s.seq,
          kind: s.kind,
          tripId: s.tripId,
          tripStatus: s.status,
          place: s.place,
          rider: s.rider,
          lat: Number(s.lat),
          lng: Number(s.lng),
          plannedAt: s.plannedAt.toISOString(),
          // For pick-ups: minutes from the time the rider chose (negative = earlier).
          offsetMinutes: s.kind === 'pickup' ? Math.round((s.plannedAt.getTime() - s.scheduledAt.getTime()) / 60_000) : null,
        })),
    }));
  }

  // ------------------------------------------------------------------ dispatch help

  /**
   * Which drivers suit a subscription best: those who may serve it (qualified for its class, a
   * free seat, seating rules), ranked by how many minutes its rider adds to their usual run.
   */
  async suggestDrivers(actor: AuthUser, subscriptionId: string, limit = 3): Promise<DriverSuggestionView[]> {
    const [sub] = await this.db
      .select({
        sub: subscriptions,
        plan: plans,
        pLat: sql<number>`ST_Y(${places.location})`,
        pLng: sql<number>`ST_X(${places.location})`,
        dLat: sql<number>`(SELECT ST_Y(q.location) FROM places q WHERE q.id = ${subscriptions.dropoffPlaceId})`,
        dLng: sql<number>`(SELECT ST_X(q.location) FROM places q WHERE q.id = ${subscriptions.dropoffPlaceId})`,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(places, eq(places.id, subscriptions.pickupPlaceId))
      .where(eq(subscriptions.id, subscriptionId));
    if (!sub) throw new AppError('SUBSCRIPTION_NOT_FOUND');
    assertPartnerAccess(actor, sub.sub.partnerId);
    const me = { pickup: { lat: Number(sub.pLat), lng: Number(sub.pLng) }, dropoff: { lat: Number(sub.dLat), lng: Number(sub.dLng) } };

    const candidates = await this.db
      .select({ id: driverProfiles.userId, name: driverProfiles.fullName, seats: vehicles.seats })
      .from(driverProfiles)
      .innerJoin(vehicles, eq(vehicles.driverId, driverProfiles.userId))
      .where(and(eq(driverProfiles.partnerId, sub.sub.partnerId), eq(driverProfiles.status, 'approved'), eq(driverProfiles.complianceHold, false)));

    const out: DriverSuggestionView[] = [];
    for (const c of candidates) {
      if (c.id === sub.sub.driverId) continue;
      if ((await this.compliance.qualify(c.id, sub.plan)).length > 0) continue;
      if (!(await this.tripsService.canSeat(c.id, sub.sub))) continue;
      const legs: { leg: Leg; time: string | null }[] = [
        { leg: 'outbound', time: sub.sub.outboundTime },
        { leg: 'return', time: sub.sub.returnTime },
      ];
      let added = 0;
      let late = 0;
      let riders = 0;
      for (const { leg, time } of legs) {
        if (!time) continue;
        const others = await this.usualRiders(c.id, leg, sub.sub.id);
        riders = Math.max(riders, others.length);
        const mine = leg === 'outbound' ? me : { pickup: me.dropoff, dropoff: me.pickup };
        const at = minutesOfDay(time);
        const items = [...others, { id: 'new', ...mine, at }];
        const epoch = Math.min(...items.map((i) => i.at));
        const toMs = (list: typeof items) => list.map((i) => ({ ...i, at: i.at * 60_000 }));
        const before = others.length ? solveBuiltin((await this.problem(toMs(others), epoch * 60_000, c.seats, leg)).problem) : null;
        const after = solveBuiltin((await this.problem(toMs(items), epoch * 60_000, c.seats, leg)).problem);
        const span = (p: Plan | null) => (p ? p.end - p.start : 0);
        added += span(after) - span(before);
        late += after.lateSeconds - (before?.lateSeconds ?? 0) + after.overRideSeconds - (before?.overRideSeconds ?? 0);
      }
      out.push({
        driverId: c.id,
        name: c.name,
        seats: c.seats,
        riders,
        addedMinutes: Math.max(0, Math.round(added / 60)),
        fitsWindows: late <= 0,
      });
    }
    // Riders' promises first, then the smallest detour, then the emptier car.
    out.sort((a, b) => Number(b.fitsWindows) - Number(a.fitsWindows) || a.addedMinutes - b.addedMinutes || a.riders - b.riders);
    return out.slice(0, limit);
  }

  /** The riders a driver usually carries on a leg, as minutes of the day and places. */
  private async usualRiders(driverId: string, leg: Leg, except: string): Promise<{ id: string; pickup: LatLng; dropoff: LatLng; at: number }[]> {
    const rows = await this.db.execute<{ id: string; t: string; plat: number; plng: number; dlat: number; dlng: number }>(sql`
      SELECT s.id, ${leg === 'outbound' ? sql.raw('s.outbound_time') : sql.raw('s.return_time')}::text AS t,
             ST_Y(p.location) AS plat, ST_X(p.location) AS plng, ST_Y(q.location) AS dlat, ST_X(q.location) AS dlng
      FROM subscriptions s
      JOIN places p ON p.id = s.pickup_place_id
      JOIN places q ON q.id = s.dropoff_place_id
      WHERE s.driver_id = ${driverId} AND s.id <> ${except}
        AND s.status IN ('active', 'past_due', 'paused', 'pending_payment')
        AND ${leg === 'outbound' ? sql.raw('s.outbound_time') : sql.raw('s.return_time')} IS NOT NULL`);
    return rows.rows.map((r) => {
      const home = { lat: Number(r.plat), lng: Number(r.plng) };
      const away = { lat: Number(r.dlat), lng: Number(r.dlng) };
      return { id: r.id, pickup: leg === 'outbound' ? home : away, dropoff: leg === 'outbound' ? away : home, at: minutesOfDay(r.t) };
    });
  }

  /**
   * Who can take a trip now that its driver is late or away: qualified drivers of the partner
   * with a free seat at that time, nearest first by road time from where they are.
   */
  async substitutes(actor: AuthUser, tripId: string, limit = 5): Promise<SubstituteView[]> {
    const [row] = await this.db
      .select({
        trip: trips,
        plan: plans,
        pLat: sql<number>`ST_Y(${trips.pickup})`,
        pLng: sql<number>`ST_X(${trips.pickup})`,
      })
      .from(trips)
      .innerJoin(subscriptions, eq(subscriptions.id, trips.subscriptionId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(trips.id, tripId));
    if (!row) throw new AppError('TRIP_NOT_FOUND');
    assertPartnerAccess(actor, row.trip.partnerId);
    const pickup = { lat: Number(row.pLat), lng: Number(row.pLng) };
    const candidates = await this.db
      .select({ id: driverProfiles.userId, name: driverProfiles.fullName, phone: users.phone })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .where(and(eq(driverProfiles.partnerId, row.trip.partnerId), eq(driverProfiles.status, 'approved'), eq(driverProfiles.complianceHold, false)));
    const out: SubstituteView[] = [];
    for (const c of candidates) {
      if (c.id === row.trip.driverId) continue;
      if ((await this.compliance.qualify(c.id, row.plan)).length > 0) continue;
      if (!(await this.tripsService.canTakeTrip(c.id, row.trip))) continue;
      const loc = await this.live.get(c.id);
      const fresh = loc && Date.now() - Date.parse(loc.at) < 15 * 60_000;
      out.push({
        driverId: c.id,
        name: c.name,
        phone: c.phone,
        etaMinutes: fresh ? await this.routing.etaMinutes(loc, pickup) : null,
        locationAt: loc?.at ?? null,
      });
    }
    // Known positions first, nearest first; drivers without a recent position after them.
    out.sort((a, b) => (a.etaMinutes ?? Infinity) - (b.etaMinutes ?? Infinity) || (a.name ?? '').localeCompare(b.name ?? ''));
    return out.slice(0, limit);
  }
}

/** '06:30' or '06:30:00' to minutes after midnight. */
function minutesOfDay(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
