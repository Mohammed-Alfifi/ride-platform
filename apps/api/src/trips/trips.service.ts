import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, gte, inArray, lte, sql, SQL } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { riyadhToday } from '../common/saudi';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { DB, Database } from '../database/database.module';
import { driverProfiles, subscriptions, Trip, tripPoints, trips, TripStatus, users, vehicles } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { distanceMeters, etaMinutes } from './geo';
import { LivePosition, LiveStore } from './live.store';
import { TripGenerator } from './trip.generator';

/** A driver may start a trip this long before its time. */
export const START_WINDOW_MINUTES = 90;
/** How close the driver must be to mark "arrived" or "completed" (when their location is known). */
export const ARRIVE_RADIUS_M = 300;
export const COMPLETE_RADIUS_M = 500;
/** How long a driver waits at the door before a no-show can be recorded. */
export const NO_SHOW_WAIT_MINUTES = 5;
/** Riders can cancel a single trip up to this long before it. */
export const SKIP_DEADLINE_MINUTES = 30;

export const BOARD_VIEWS = ['all', 'unassigned', 'late', 'active', 'done', 'problems'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
const BOARD_LIMIT = 300;

const ACTIVE: TripStatus[] = ['en_route', 'arrived', 'on_board'];

export interface Spot {
  lat: number;
  lng: number;
  name: string;
}

export interface TripView {
  id: string;
  subscriptionId: string;
  serviceDate: string;
  leg: 'outbound' | 'return';
  scheduledAt: string;
  status: TripStatus;
  pickup: Spot;
  dropoff: Spot;
  rider: { id: string; name: string | null; phone: string };
  /** Who rides when it is not the account holder (a child); shown to the driver first. */
  passengerName: string | null;
  driver: {
    id: string;
    name: string | null;
    phone: string | null;
    vehicle: { plate: string; make: string; model: string; color: string } | null;
  } | null;
  startedAt: string | null;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
  endedReason: string | null;
}

export interface LiveView {
  trip: TripView;
  driverLocation: LivePosition | null;
  /** Minutes until the driver reaches the next stop (pick-up, or drop-off once on board). */
  etaMinutes: number | null;
  distanceMeters: number | null;
}

interface TripRow {
  trip: Trip;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  riderName: string | null;
  riderPhone: string;
  driverName: string | null;
  driverPhone: string | null;
  plateLetters: string | null;
  plateNumbers: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
}

const riderUser = aliasedTable(users, 'rider_user');
const driverUser = aliasedTable(users, 'driver_user');

@Injectable()
export class TripsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly live: LiveStore,
    private readonly generator: TripGenerator,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ reading

  private select() {
    return this.db
      .select({
        trip: trips,
        pickupLat: sql<number>`ST_Y(${trips.pickup})`,
        pickupLng: sql<number>`ST_X(${trips.pickup})`,
        dropoffLat: sql<number>`ST_Y(${trips.dropoff})`,
        dropoffLng: sql<number>`ST_X(${trips.dropoff})`,
        riderName: riderUser.name,
        riderPhone: riderUser.phone,
        driverName: sql<string | null>`coalesce(${driverProfiles.fullName}, ${driverUser.name})`,
        driverPhone: driverUser.phone,
        plateLetters: vehicles.plateLetters,
        plateNumbers: vehicles.plateNumbers,
        make: vehicles.make,
        model: vehicles.model,
        color: vehicles.color,
      })
      .from(trips)
      .innerJoin(riderUser, eq(riderUser.id, trips.riderId))
      .leftJoin(driverUser, eq(driverUser.id, trips.driverId))
      .leftJoin(driverProfiles, eq(driverProfiles.userId, trips.driverId))
      .leftJoin(vehicles, eq(vehicles.driverId, trips.driverId));
  }

  private async rows(where: SQL | undefined, limit?: number): Promise<TripRow[]> {
    const q = this.select().where(where).orderBy(asc(trips.scheduledAt));
    return (await (limit ? q.limit(limit) : q)) as unknown as TripRow[];
  }

  private present(r: TripRow, opts: { driverPhone: boolean }): TripView {
    const t = r.trip;
    return {
      id: t.id,
      subscriptionId: t.subscriptionId,
      serviceDate: t.serviceDate,
      leg: t.leg,
      scheduledAt: t.scheduledAt.toISOString(),
      status: t.status,
      pickup: { lat: Number(r.pickupLat), lng: Number(r.pickupLng), name: t.pickupName },
      dropoff: { lat: Number(r.dropoffLat), lng: Number(r.dropoffLng), name: t.dropoffName },
      rider: { id: t.riderId, name: r.riderName, phone: r.riderPhone },
      passengerName: t.passengerName,
      driver: t.driverId
        ? {
            id: t.driverId,
            name: r.driverName,
            phone: opts.driverPhone ? r.driverPhone : null,
            vehicle: r.plateNumbers
              ? { plate: `${r.plateNumbers} ${r.plateLetters}`, make: r.make!, model: r.model!, color: r.color! }
              : null,
          }
        : null,
      startedAt: t.startedAt?.toISOString() ?? null,
      arrivedAt: t.arrivedAt?.toISOString() ?? null,
      pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      endedReason: t.endedReason,
    };
  }

  private async one(where: SQL | undefined, opts = { driverPhone: true }): Promise<TripView> {
    const [row] = await this.rows(where, 1);
    if (!row) throw new AppError('TRIP_NOT_FOUND');
    return this.present(row, opts);
  }

  // ------------------------------------------------------------------ driver

  async driverTrips(driverId: string, date = riyadhToday()): Promise<TripView[]> {
    const rows = await this.rows(and(eq(trips.driverId, driverId), eq(trips.serviceDate, date)));
    return rows.map((r) => this.present(r, { driverPhone: true }));
  }

  async start(driver: AuthUser, tripId: string, now = new Date()): Promise<TripView> {
    await this.assertCanDrive(driver.id);
    const trip = await this.ownTrip(driver.id, tripId);
    if (trip.status !== 'scheduled' || trip.serviceDate !== riyadhToday(now)) throw new AppError('TRIP_INVALID_STATE');
    if (now.getTime() < trip.scheduledAt.getTime() - START_WINDOW_MINUTES * 60_000) {
      throw new AppError('TRIP_TOO_EARLY', { minutes: START_WINDOW_MINUTES });
    }
    await this.move(trip, 'scheduled', { status: 'en_route', startedAt: now });
    await this.tell(trip, 'trip_en_route', 'السائق في الطريق إليك', 'Your driver is on the way', 'تابع موقعه على الخريطة حتى يصل.', 'Follow them on the map until they arrive.');
    return this.one(eq(trips.id, trip.id));
  }

  async arrive(driver: AuthUser, tripId: string, now = new Date()): Promise<TripView> {
    const trip = await this.ownTrip(driver.id, tripId);
    if (trip.status !== 'en_route') throw new AppError('TRIP_INVALID_STATE');
    await this.assertNear(driver.id, trip.pickup, ARRIVE_RADIUS_M);
    await this.move(trip, 'en_route', { status: 'arrived', arrivedAt: now });
    await this.tell(trip, 'trip_arrived', 'السائق وصل', 'Your driver has arrived', `السائق ينتظرك عند ${trip.pickupName}.`, `Your driver is waiting at ${trip.pickupName}.`);
    return this.one(eq(trips.id, trip.id));
  }

  async pickUp(driver: AuthUser, tripId: string, now = new Date()): Promise<TripView> {
    const trip = await this.ownTrip(driver.id, tripId);
    if (trip.status !== 'arrived') throw new AppError('TRIP_INVALID_STATE');
    await this.move(trip, 'arrived', { status: 'on_board', pickedUpAt: now });
    await this.tell(trip, 'trip_on_board', 'بدأت الرحلة', 'Trip started', `في الطريق إلى ${trip.dropoffName}.`, `On the way to ${trip.dropoffName}.`);
    return this.one(eq(trips.id, trip.id));
  }

  async complete(driver: AuthUser, tripId: string, now = new Date()): Promise<TripView> {
    const trip = await this.ownTrip(driver.id, tripId);
    if (trip.status !== 'on_board') throw new AppError('TRIP_INVALID_STATE');
    await this.assertNear(driver.id, trip.dropoff, COMPLETE_RADIUS_M);
    await this.move(trip, 'on_board', { status: 'completed', completedAt: now });
    await this.tell(trip, 'trip_completed', 'وصل بالسلامة', 'Arrived safely', `تم الوصول إلى ${trip.dropoffName}.`, `Arrived at ${trip.dropoffName}.`);
    return this.one(eq(trips.id, trip.id));
  }

  async noShow(driver: AuthUser, tripId: string, now = new Date()): Promise<TripView> {
    const trip = await this.ownTrip(driver.id, tripId);
    if (trip.status !== 'arrived' || !trip.arrivedAt) throw new AppError('TRIP_INVALID_STATE');
    if (now.getTime() - trip.arrivedAt.getTime() < NO_SHOW_WAIT_MINUTES * 60_000) {
      throw new AppError('TRIP_NO_SHOW_TOO_EARLY', { minutes: NO_SHOW_WAIT_MINUTES });
    }
    await this.move(trip, 'arrived', { status: 'no_show', completedAt: now, endedReason: 'rider did not come out' });
    await this.tell(trip, 'trip_no_show', 'فاتتك الرحلة', 'You missed your ride', 'انتظرك السائق ولم تحضر. تواصل مع الشريك إن كان هناك خطأ.', 'Your driver waited but you did not come out. Contact the operator if this is a mistake.');
    return this.one(eq(trips.id, trip.id));
  }

  /** Location updates from the driver app, every few seconds while it is open. */
  async report(driverId: string, points: { lat: number; lng: number; heading?: number; speedKmh?: number; at?: string }[]): Promise<{ activeTripId: string | null }> {
    if (points.length === 0) return { activeTripId: null };
    const sorted = [...points].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    const last = sorted[sorted.length - 1];
    await this.live.set(driverId, {
      lat: last.lat,
      lng: last.lng,
      heading: last.heading ?? null,
      speedKmh: last.speedKmh ?? null,
      at: last.at ?? new Date().toISOString(),
    });
    const [active] = await this.db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.driverId, driverId), inArray(trips.status, ACTIVE)))
      .limit(1);
    if (active) {
      await this.db.insert(tripPoints).values(
        sorted.map((p) => ({
          tripId: active.id,
          location: sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)` as unknown as string,
          speedKmh: p.speedKmh ?? null,
          recordedAt: p.at ? new Date(p.at) : new Date(),
        })),
      );
    }
    return { activeTripId: active?.id ?? null };
  }

  // ------------------------------------------------------------------ rider

  async riderTrips(riderId: string, from = riyadhToday(), days = 7): Promise<TripView[]> {
    const to = new Date(`${from}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + days - 1);
    const rows = await this.rows(
      and(eq(trips.riderId, riderId), gte(trips.serviceDate, from), lte(trips.serviceDate, to.toISOString().slice(0, 10))),
    );
    return rows.map((r) => this.present(r, { driverPhone: ACTIVE.includes(r.trip.status) }));
  }

  /** What the rider's map shows: the trip, where the driver is, and how far away. */
  async riderLive(riderId: string, tripId: string): Promise<LiveView> {
    const [row] = await this.rows(and(eq(trips.id, tripId), eq(trips.riderId, riderId)), 1);
    if (!row) throw new AppError('TRIP_NOT_FOUND');
    const active = ACTIVE.includes(row.trip.status);
    const view = this.present(row, { driverPhone: active });
    return this.withLocation(view, active);
  }

  async skip(riderId: string, tripId: string, now = new Date()): Promise<TripView> {
    const trip = await this.db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.riderId, riderId)) });
    if (!trip) throw new AppError('TRIP_NOT_FOUND');
    if (trip.status !== 'scheduled' || now.getTime() > trip.scheduledAt.getTime() - SKIP_DEADLINE_MINUTES * 60_000) {
      throw new AppError('TRIP_SKIP_TOO_LATE', { minutes: SKIP_DEADLINE_MINUTES });
    }
    await this.move(trip, 'scheduled', { status: 'skipped', endedReason: 'rider does not need this trip' });
    if (trip.driverId) {
      const time = this.timeOf(trip);
      await this.notifications.notify([trip.driverId], {
        kind: 'trip_skipped',
        titleAr: 'ألغى الراكب رحلة',
        titleEn: 'A rider cancelled a trip',
        bodyAr: `لا حاجة لرحلة ${time} من ${trip.pickupName}.`,
        bodyEn: `The ${time} trip from ${trip.pickupName} is not needed.`,
        data: { tripId: trip.id },
        dedupeKey: `skip:${trip.id}`,
      });
    }
    return this.one(eq(trips.id, trip.id), { driverPhone: false });
  }

  // ------------------------------------------------------------------ dispatch

  /**
   * The dispatch board. Counters and per-driver numbers are computed in the database; only the trips
   * of the selected view travel to the browser (at most BOARD_LIMIT), so a partner with thousands of
   * trips a day still gets a small, fast answer every 10 seconds.
   */
  async board(actor: AuthUser, opts: { partnerId?: string; date?: string; view?: BoardView }) {
    const scope = partnerScope(actor, opts.partnerId);
    const date = opts.date ?? riyadhToday();
    const view = opts.view ?? 'all';
    const day = and(eq(trips.serviceDate, date), scope ? eq(trips.partnerId, scope) : undefined) as SQL;
    const now = new Date().toISOString();
    const late = sql`${trips.status} = 'scheduled' AND ${trips.scheduledAt} < ${now}::timestamptz`;
    const viewWhere: Record<BoardView, SQL | undefined> = {
      all: undefined,
      unassigned: sql`${trips.driverId} IS NULL AND ${trips.status} = 'scheduled'`,
      late,
      active: inArray(trips.status, ACTIVE),
      done: inArray(trips.status, ['completed', 'skipped', 'cancelled']),
      problems: sql`(${trips.status} = 'no_show' OR (${late} AND ${trips.scheduledAt} < ${now}::timestamptz - interval '10 minutes'))`,
    };
    const where = viewWhere[view] ? (and(day, viewWhere[view]) as SQL) : day;

    const [counts, list, perDriver, drivers] = await Promise.all([
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          unassigned: sql<number>`count(*) FILTER (WHERE ${trips.driverId} IS NULL AND ${trips.status} = 'scheduled')::int`,
          upcoming: sql<number>`count(*) FILTER (WHERE ${trips.status} = 'scheduled')::int`,
          active: sql<number>`count(*) FILTER (WHERE ${inArray(trips.status, ACTIVE)})::int`,
          completed: sql<number>`count(*) FILTER (WHERE ${trips.status} = 'completed')::int`,
          problems: sql<number>`count(*) FILTER (WHERE ${trips.status} = 'no_show')::int`,
          skipped: sql<number>`count(*) FILTER (WHERE ${trips.status} IN ('skipped', 'cancelled'))::int`,
          late: sql<number>`count(*) FILTER (WHERE ${late})::int`,
          inView: viewWhere[view] ? sql<number>`count(*) FILTER (WHERE ${viewWhere[view]})::int` : sql<number>`count(*)::int`,
        })
        .from(trips)
        .where(day),
      this.rows(where, BOARD_LIMIT),
      this.db
        .select({
          driverId: trips.driverId,
          n: sql<number>`count(*)::int`,
          current: sql<string | null>`(array_agg(${trips.id}) FILTER (WHERE ${inArray(trips.status, ACTIVE)}))[1]`,
        })
        .from(trips)
        .where(and(day, sql`${trips.driverId} IS NOT NULL`))
        .groupBy(trips.driverId),
      // Approved drivers of the partner(s), with their live position.
      this.db
        .select({
          id: driverProfiles.userId,
          name: driverProfiles.fullName,
          phone: users.phone,
          partnerId: driverProfiles.partnerId,
          hold: driverProfiles.complianceHold,
          plateLetters: vehicles.plateLetters,
          plateNumbers: vehicles.plateNumbers,
          seats: vehicles.seats,
        })
        .from(driverProfiles)
        .innerJoin(users, eq(users.id, driverProfiles.userId))
        .leftJoin(vehicles, eq(vehicles.driverId, driverProfiles.userId))
        .where(and(eq(driverProfiles.status, 'approved'), scope ? eq(driverProfiles.partnerId, scope) : undefined))
        .orderBy(asc(driverProfiles.fullName)),
    ]);
    const positions = await this.live.many(drivers.map((d) => d.id));
    const byDriver = new Map(perDriver.map((r) => [r.driverId as string, r]));
    const { inView, ...summary } = counts[0];

    return {
      date,
      view,
      summary,
      trips: list.map((r) => this.present(r, { driverPhone: true })),
      /** Trips matching the view; more than trips.length when the list was cut at the limit. */
      tripsInView: inView,
      drivers: drivers.map((d) => ({
        id: d.id,
        name: d.name,
        phone: d.phone,
        onHold: d.hold,
        plate: d.plateNumbers ? `${d.plateNumbers} ${d.plateLetters}` : null,
        seats: d.seats,
        tripsToday: byDriver.get(d.id)?.n ?? 0,
        currentTripId: byDriver.get(d.id)?.current ?? null,
        location: positions.get(d.id) ?? null,
      })),
    };
  }

  /** Changes the driver of one trip (a substitute for the day). */
  async assignTrip(actor: AuthUser, tripId: string, driverId: string | null): Promise<TripView> {
    const trip = await this.db.query.trips.findFirst({ where: eq(trips.id, tripId) });
    if (!trip) throw new AppError('TRIP_NOT_FOUND');
    assertPartnerAccess(actor, trip.partnerId);
    if (trip.status !== 'scheduled') throw new AppError('TRIP_INVALID_STATE');
    if (driverId) {
      await this.assertAssignable(driverId, trip.partnerId);
      await this.assertTripSeat(driverId, trip);
    }
    await this.db.update(trips).set({ driverId }).where(eq(trips.id, trip.id));
    if (driverId && driverId !== trip.driverId) {
      await this.notifications.notify([driverId], {
        kind: 'trip_assigned',
        titleAr: 'رحلة جديدة',
        titleEn: 'New trip',
        bodyAr: `أُسندت إليك رحلة ${this.timeOf(trip)} يوم ${trip.serviceDate} من ${trip.pickupName}.`,
        bodyEn: `You have a ${this.timeOf(trip)} trip on ${trip.serviceDate} from ${trip.pickupName}.`,
        data: { tripId: trip.id },
      });
    }
    return this.one(eq(trips.id, trip.id));
  }

  /** Sets the rider's regular driver; trips that have not started move to them. */
  async assignSubscription(actor: AuthUser, subscriptionId: string, driverId: string | null): Promise<{ subscriptionId: string; driverId: string | null }> {
    const sub = await this.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, subscriptionId) });
    if (!sub) throw new AppError('SUBSCRIPTION_NOT_FOUND');
    assertPartnerAccess(actor, sub.partnerId);
    if (driverId) {
      await this.assertAssignable(driverId, sub.partnerId);
      if (driverId !== sub.driverId) await this.assertSubscriptionSeat(driverId, sub);
    }
    await this.db.update(subscriptions).set({ driverId }).where(eq(subscriptions.id, sub.id));
    await this.generator.reassignFuture(sub.id, driverId);
    if (driverId && driverId !== sub.driverId) {
      await this.notifications.notify([driverId], {
        kind: 'rider_assigned',
        titleAr: 'راكب جديد في جدولك',
        titleEn: 'New rider on your schedule',
        bodyAr: `أُضيف راكب جديد لرحلاتك اليومية (ذهاب ${sub.outboundTime}${sub.returnTime ? `، عودة ${sub.returnTime}` : ''}).`,
        bodyEn: `A new rider joined your daily trips (pick-up ${sub.outboundTime}${sub.returnTime ? `, return ${sub.returnTime}` : ''}).`,
        data: { subscriptionId: sub.id },
      });
    }
    return { subscriptionId: sub.id, driverId };
  }

  async adminLive(actor: AuthUser, tripId: string): Promise<LiveView> {
    const [row] = await this.rows(eq(trips.id, tripId), 1);
    if (!row) throw new AppError('TRIP_NOT_FOUND');
    assertPartnerAccess(actor, row.trip.partnerId);
    const view = this.present(row, { driverPhone: true });
    const route = await this.db
      .select({ lat: sql<number>`ST_Y(${tripPoints.location})`, lng: sql<number>`ST_X(${tripPoints.location})` })
      .from(tripPoints)
      .where(eq(tripPoints.tripId, tripId))
      .orderBy(asc(tripPoints.recordedAt));
    return { ...(await this.withLocation(view, ACTIVE.includes(view.status))), route } as LiveView & { route: { lat: number; lng: number }[] };
  }

  // ------------------------------------------------------------------ helpers

  private async withLocation(view: TripView, active: boolean): Promise<LiveView> {
    const loc = active && view.driver ? await this.live.get(view.driver.id) : null;
    if (!loc) return { trip: view, driverLocation: null, etaMinutes: null, distanceMeters: null };
    const target = view.status === 'on_board' ? view.dropoff : view.pickup;
    const meters = distanceMeters(loc, target);
    return {
      trip: view,
      driverLocation: loc,
      distanceMeters: meters,
      etaMinutes: view.status === 'arrived' ? 0 : etaMinutes(meters),
    };
  }

  private async ownTrip(driverId: string, tripId: string): Promise<Trip & { pickup: Spot; dropoff: Spot }> {
    const [row] = await this.db
      .select({
        trip: trips,
        pickupLat: sql<number>`ST_Y(${trips.pickup})`,
        pickupLng: sql<number>`ST_X(${trips.pickup})`,
        dropoffLat: sql<number>`ST_Y(${trips.dropoff})`,
        dropoffLng: sql<number>`ST_X(${trips.dropoff})`,
      })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.driverId, driverId)))
      .limit(1);
    if (!row) throw new AppError('TRIP_NOT_FOUND');
    return {
      ...row.trip,
      pickup: { lat: Number(row.pickupLat), lng: Number(row.pickupLng), name: row.trip.pickupName },
      dropoff: { lat: Number(row.dropoffLat), lng: Number(row.dropoffLng), name: row.trip.dropoffName },
    } as unknown as Trip & { pickup: Spot; dropoff: Spot };
  }

  /** Moves a trip on only if it is still where the caller saw it (two taps never apply twice). */
  private async move(trip: { id: string }, from: TripStatus, set: Partial<typeof trips.$inferInsert>): Promise<void> {
    const rows = await this.db
      .update(trips)
      .set(set)
      .where(and(eq(trips.id, trip.id), eq(trips.status, from)))
      .returning({ id: trips.id });
    if (rows.length === 0) throw new AppError('TRIP_INVALID_STATE');
  }

  private async assertNear(driverId: string, target: Spot, radius: number): Promise<void> {
    const loc = await this.live.get(driverId);
    // Without a recent location (GPS off, poor signal) the driver is trusted; the trip record shows it.
    if (!loc || Date.now() - Date.parse(loc.at) > 2 * 60_000) return;
    const meters = distanceMeters(loc, target);
    if (meters > radius) throw new AppError('TRIP_NOT_NEAR', { meters });
  }

  private async assertCanDrive(driverId: string): Promise<void> {
    const p = await this.db.query.driverProfiles.findFirst({ where: eq(driverProfiles.userId, driverId) });
    if (!p || p.status !== 'approved') throw new AppError('FORBIDDEN');
    if (p.complianceHold) throw new AppError('DRIVER_ON_HOLD');
  }

  private async assertAssignable(driverId: string, partnerId: string): Promise<void> {
    const p = await this.db.query.driverProfiles.findFirst({ where: eq(driverProfiles.userId, driverId) });
    if (!p || p.status !== 'approved' || p.partnerId !== partnerId || p.complianceHold) {
      throw new AppError('DRIVER_NOT_AVAILABLE');
    }
  }

  private async seatsOf(driverId: string): Promise<number> {
    const v = await this.db.query.vehicles.findFirst({ columns: { seats: true }, where: eq(vehicles.driverId, driverId) });
    return v?.seats ?? 0;
  }

  /**
   * A regular rider takes a seat on every day they share with the driver's other riders, at pick-ups
   * within 30 minutes of each other (the same school run). The car must have a seat for each.
   */
  private async assertSubscriptionSeat(driverId: string, sub: typeof subscriptions.$inferSelect): Promise<void> {
    const seats = await this.seatsOf(driverId);
    const near = (col: string, time: string | null) =>
      time ? sql`(${sql.raw(col)} IS NOT NULL AND abs(extract(epoch from (${sql.raw(col)}::time - ${time}::time))) <= 1800)` : sql`false`;
    const [row] = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM subscriptions
      WHERE driver_id = ${driverId} AND id <> ${sub.id}
        AND status IN ('active', 'past_due', 'paused', 'pending_payment')
        AND days && ${sql.raw(`ARRAY[${sub.days.map(Number).join(',')}]::int[]`)}
        AND (${near('outbound_time', sub.outboundTime)} OR ${near('return_time', sub.returnTime)})`).then((r) => r.rows);
    if ((row?.n ?? 0) + 1 > seats) throw new AppError('DRIVER_FULL', { seats });
  }

  /** A substitute for one trip needs a free seat at that time on that day. */
  private async assertTripSeat(driverId: string, trip: Trip): Promise<void> {
    const seats = await this.seatsOf(driverId);
    const [row] = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM trips
      WHERE driver_id = ${driverId} AND id <> ${trip.id} AND service_date = ${trip.serviceDate}
        AND status NOT IN ('cancelled', 'skipped', 'no_show', 'completed')
        AND abs(extract(epoch from (scheduled_at - ${trip.scheduledAt.toISOString()}::timestamptz))) <= 1800`).then((r) => r.rows);
    if ((row?.n ?? 0) + 1 > seats) throw new AppError('DRIVER_FULL', { seats });
  }

  private timeOf(trip: Pick<Trip, 'scheduledAt'>): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(trip.scheduledAt);
  }

  private async tell(trip: Trip, kind: string, titleAr: string, titleEn: string, bodyAr: string, bodyEn: string): Promise<void> {
    await this.notifications.notify([trip.riderId], {
      kind,
      titleAr,
      titleEn,
      bodyAr,
      bodyEn,
      data: { tripId: trip.id },
      dedupeKey: `${kind}:${trip.id}`,
    });
  }
}
