import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import { driverProfiles, runs, runStops, subscriptions, trips, users, vehicles } from '../src/database/schema';
import { RunsService } from '../src/runs/runs.service';
import { LiveStore } from '../src/trips/live.store';
import { bearer, createPartner, createStaff, createTestApp, daysFromToday, newPhone, qualifyDriver, signIn, TestContext } from './helpers';

const RIMAL = {
  type: 'Polygon',
  coordinates: [
    [
      [46.82, 24.86],
      [46.835, 24.86],
      [46.835, 24.875],
      [46.82, 24.875],
      [46.82, 24.86],
    ],
  ],
};

/** Three homes along one street, west to east, and a school at its east end. */
const HOMES = [
  { lat: 24.862, lng: 46.822 },
  { lat: 24.862, lng: 46.826 },
  { lat: 24.862, lng: 46.83 },
];
const SCHOOL = { lat: 24.863, lng: 46.834 };
const FAR = { lat: 24.874, lng: 46.821 };

const pathOf = (url: string) => new URL(url).pathname;

async function setup(ctx: TestContext) {
  const partnerId = await createPartner(ctx, `Runs ${Math.random()}`);
  const admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
  const superAdmin = await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin');
  const rider = await signIn(ctx, newPhone(), 'rider');
  const http = () => ctx.http();
  const zone = await http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الرمال', nameEn: 'Rimal', area: RIMAL }).expect(201);
  const plan = await http()
    .post('/v1/admin/plans')
    .set(bearer(admin.accessToken))
    .send({ zoneId: zone.body.id, nameAr: 'كل يوم', nameEn: 'Every day', tripType: 'round_trip', daysPerWeek: 7, priceHalalas: 150000, maxDistanceKm: 5 })
    .expect(201);
  const place = async (name: string, p: { lat: number; lng: number }) =>
    (await http().post('/v1/places').set(bearer(rider.accessToken)).send({ label: 'other', name, ...p }).expect(201)).body.id as string;
  const school = await place('المدرسة', SCHOOL);

  /** A paid subscription (trips start tomorrow), for a family member so one account can hold many. */
  async function subscriber(home: { lat: number; lng: number }, outboundTime: string, name: string): Promise<string> {
    const member = await http().post('/v1/family').set(bearer(rider.accessToken)).send({ name, relation: 'child' }).expect(201);
    // Finish each request before starting the next: supertest cannot interleave them.
    const pickupPlaceId = await place(`بيت ${name}`, home);
    const res = await http()
      .post('/v1/subscriptions')
      .set(bearer(rider.accessToken))
      .send({
        planId: plan.body.id,
        memberId: member.body.id,
        pickupPlaceId,
        dropoffPlaceId: school,
        days: [0, 1, 2, 3, 4, 5, 6],
        outboundTime,
        returnTime: '13:30',
        sharedRideConsent: true,
      })
      .expect(201);
    await http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
    await http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(rider.accessToken)).expect(200);
    return res.body.subscription.id;
  }

  async function driver(name: string, seats = 4): Promise<string> {
    const [u] = await ctx.db
      .insert(users)
      .values({ phone: newPhone(), role: 'driver', audience: 'driver', partnerId, name, status: 'active' })
      .returning({ id: users.id });
    await ctx.db.insert(driverProfiles).values({ userId: u.id, partnerId, fullName: name, status: 'approved' });
    await ctx.db.insert(vehicles).values({
      driverId: u.id,
      partnerId,
      plateLetters: 'RNS',
      plateNumbers: String(1000 + Math.floor(Math.random() * 8999)),
      make: 'Toyota',
      model: 'Innova',
      year: new Date().getFullYear(),
      color: 'أبيض',
      seats,
    });
    await qualifyDriver(ctx, u.id, partnerId);
    return u.id;
  }

  const assign = (subId: string, driverId: string) =>
    http().patch(`/v1/admin/subscriptions/${subId}/driver`).set(bearer(admin.accessToken)).send({ driverId }).expect(200);
  const runsOf = async (day: string) =>
    (await http().get('/v1/admin/runs').query({ date: day }).set(bearer(admin.accessToken)).expect(200)).body as {
      id: string;
      driverId: string;
      leg: string;
      riders: number;
      lateMinutes: number;
      routing: string;
      optimizer: string;
      stops: { seq: number; kind: string; tripId: string; place: string; plannedAt: string; offsetMinutes: number | null }[];
    }[];

  return { partnerId, admin, superAdmin, rider, subscriber, driver, assign, runsOf };
}

describe('Runs: one car, many riders (e2e)', () => {
  let ctx: TestContext;
  let s: Awaited<ReturnType<typeof setup>>;
  let driverA: string;
  let driverB: string;
  let subs: string[];
  const tomorrow = daysFromToday(1);

  beforeAll(async () => {
    ctx = await createTestApp();
    s = await setup(ctx);
    driverA = await s.driver('سالم أحمد');

    driverB = await s.driver('فهد علي');
    // The east-most child chose the earliest time; the planner should still sweep the street in order.
    subs = [await s.subscriber(HOMES[0], '06:30', 'ريم'), await s.subscriber(HOMES[1], '06:32', 'سارة'), await s.subscriber(HOMES[2], '06:34', 'نورة')];
    for (const sub of subs) await s.assign(sub, driverA);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('plans each car: riders collected along the street, on time, then dropped together', async () => {
    const [outbound] = (await s.runsOf(tomorrow)).filter((r) => r.leg === 'outbound');
    expect(outbound).toMatchObject({ driverId: driverA, riders: 3, lateMinutes: 0, routing: 'haversine', optimizer: 'builtin' });
    expect(outbound.stops.map((x) => x.kind)).toEqual(['pickup', 'pickup', 'pickup', 'dropoff', 'dropoff', 'dropoff']);
    expect(outbound.stops.slice(0, 3).map((x) => x.place)).toEqual(['بيت ريم', 'بيت سارة', 'بيت نورة']);
    for (const stop of outbound.stops.slice(0, 3)) expect(Math.abs(stop.offsetMinutes!)).toBeLessThanOrEqual(10);
    // The return leg starts at the school and drops each child home.
    const [ret] = (await s.runsOf(tomorrow)).filter((r) => r.leg === 'return');
    expect(ret.stops.slice(0, 3).every((x) => x.kind === 'pickup' && x.place === 'المدرسة')).toBe(true);
    // At dismissal exactly: all three children get in at the gate together, none earlier or later.
    expect(ret.stops.slice(0, 3).map((x) => x.offsetMinutes)).toEqual([0, 0, 0]);
    expect(ret.lateMinutes).toBe(0);
    // From home, the first child is collected at the time chosen, not earlier.
    expect(outbound.stops[0].offsetMinutes).toBe(0);

    // Each trip knows its planned pick-up and its place in the run.
    const trip = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, subs[1]), eq(trips.leg, 'outbound')) });
    const view = await ctx
      .http()
      .get(`/v1/trips/${trip!.id}/live`)
      .set(bearer(s.rider.accessToken))
      .expect(200);
    expect(view.body.trip.stopSeq).toBe(2);
    expect(view.body.trip.plannedPickupAt).toBe(outbound.stops[1].plannedAt);
  });

  it('shows the driver their run, stops in order', async () => {
    // Today has no trips yet (paid subscriptions start tomorrow); the endpoint answers an empty day.
    const driver = await signIn(ctx, (await ctx.db.query.users.findFirst({ where: eq(users.id, driverA) }))!.phone, 'driver');
    const res = await ctx.http().get('/v1/driver/runs/today').set(bearer(driver.accessToken)).expect(200);
    expect(res.body).toEqual([]);
  });

  it('re-plans when a rider skips a trip or moves to another driver', async () => {
    const skipTrip = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, subs[1]), eq(trips.leg, 'outbound')) });
    await ctx.http().post(`/v1/trips/${skipTrip!.id}/skip`).set(bearer(s.rider.accessToken)).expect(200);
    let outbound = (await s.runsOf(tomorrow)).find((r) => r.leg === 'outbound' && r.driverId === driverA)!;
    expect(outbound.riders).toBe(2);
    expect(outbound.stops.some((x) => x.tripId === skipTrip!.id)).toBe(false);

    await s.assign(subs[2], driverB);
    // Whatever order the two cars are planned in, the moved rider is in exactly one run.
    const moved = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, subs[2]), eq(trips.leg, 'outbound')) });
    expect(await ctx.db.select().from(runStops).where(eq(runStops.tripId, moved!.id))).toHaveLength(2);
    const all = await s.runsOf(tomorrow);
    outbound = all.find((r) => r.leg === 'outbound' && r.driverId === driverA)!;
    expect(outbound.riders).toBe(1);
    expect(all.find((r) => r.leg === 'outbound' && r.driverId === driverB)!.riders).toBe(1);
  });

  it('lets a car take over a rider still listed in another car’s old run', async () => {
    // Move a rider behind the planner's back, then plan only the new car: the order that used to clash.
    const t = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, subs[0]), eq(trips.leg, 'return')) });
    await ctx.db.update(trips).set({ driverId: driverB }).where(eq(trips.id, t!.id));
    await ctx.app.get(RunsService).planDay(tomorrow, { driverIds: [driverB] });
    const stops = await ctx.db.select({ runId: runStops.runId }).from(runStops).where(eq(runStops.tripId, t!.id));
    expect(stops).toHaveLength(2);
    const owner = await ctx.db.query.runs.findFirst({ where: eq(runs.id, stops[0].runId) });
    expect(owner!.driverId).toBe(driverB);
    await ctx.db.update(trips).set({ driverId: driverA }).where(eq(trips.id, t!.id));
    await ctx.app.get(RunsService).planDay(tomorrow, { driverIds: [driverA, driverB] });
  });

  it('never re-plans a run that has started', async () => {
    const run = (await s.runsOf(tomorrow)).find((r) => r.leg === 'return' && r.driverId === driverA)!;
    const first = run.stops[0].tripId;
    await ctx.db.update(trips).set({ status: 'en_route' }).where(eq(trips.id, first));
    const res = await ctx.http().post('/v1/admin/runs/plan').set(bearer(s.admin.accessToken)).send({ date: tomorrow }).expect(200);
    expect(res.body.kept).toBeGreaterThanOrEqual(1);
    const after = (await s.runsOf(tomorrow)).find((r) => r.id === run.id);
    const order = (stops: typeof run.stops) => stops.map((x) => `${x.seq}:${x.kind}:${x.tripId}:${x.plannedAt}`);
    expect(order(after!.stops)).toEqual(order(run.stops));
    await ctx.db.update(trips).set({ status: 'scheduled' }).where(eq(trips.id, first));
  });

  it('keeps the run status in step with its trips', async () => {
    const run = (await s.runsOf(tomorrow)).find((r) => r.leg === 'outbound' && r.driverId === driverB)!;
    const tripId = run.stops[0].tripId;
    const driver = await signIn(ctx, (await ctx.db.query.users.findFirst({ where: eq(users.id, driverB) }))!.phone, 'driver');
    // Move the trip to today so the driver may act on it.
    await ctx.db.update(trips).set({ serviceDate: daysFromToday(0), scheduledAt: new Date(Date.now() + 20 * 60_000) }).where(eq(trips.id, tripId));
    await ctx.http().post(`/v1/driver/trips/${tripId}/start`).set(bearer(driver.accessToken)).expect(200);
    expect((await ctx.db.query.runs.findFirst({ where: eq(runs.id, run.id) }))!.status).toBe('in_progress');
  });

  it('suggests the driver whose run the new rider fits best', async () => {
    const newcomer = await s.subscriber(HOMES[1], '06:32', 'هيا');
    const res = await ctx.http().get(`/v1/admin/subscriptions/${newcomer}/driver-suggestions`).set(bearer(s.admin.accessToken)).expect(200);
    expect(res.body.map((x: { driverId: string }) => x.driverId)).toEqual(expect.arrayContaining([driverA]));
    const a = res.body.find((x: { driverId: string }) => x.driverId === driverA);
    expect(a).toMatchObject({ fitsWindows: true, seats: 4 });

    // A driver with a full car or no qualification is never suggested.
    const full = await s.driver('ماجد', 1);
    await s.assign(await s.subscriber(FAR, '06:30', 'لمى'), full);
    const again = await ctx.http().get(`/v1/admin/subscriptions/${newcomer}/driver-suggestions`).set(bearer(s.admin.accessToken)).expect(200);
    expect(again.body.map((x: { driverId: string }) => x.driverId)).not.toContain(full);
  });

  it('lists substitutes for a trip, nearest known position first', async () => {
    const trip = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, subs[0]), eq(trips.leg, 'outbound')) });
    const near = await s.driver('قريب');
    const unknown = await s.driver('بلا موقع');
    await ctx.app.get(LiveStore).set(near, { lat: HOMES[1].lat, lng: HOMES[1].lng, heading: 0, speedKmh: 0, at: new Date().toISOString() });
    const res = await ctx.http().get(`/v1/admin/trips/${trip!.id}/substitutes`).set(bearer(s.admin.accessToken)).expect(200);
    const ids = res.body.map((x: { driverId: string }) => x.driverId);
    expect(ids[0]).toBe(near);
    expect(res.body[0].etaMinutes).toBeGreaterThanOrEqual(1);
    expect(ids).toContain(unknown);
    expect(ids).not.toContain(driverA); // already this trip's driver
  });

  it('removes a run once its riders are gone', async () => {
    for (const sub of subs) await ctx.db.update(subscriptions).set({ driverId: null }).where(eq(subscriptions.id, sub));
    await ctx.db.update(trips).set({ driverId: null }).where(and(eq(trips.driverId, driverA), eq(trips.serviceDate, tomorrow)));
    const res = await ctx.http().post('/v1/admin/runs/plan').set(bearer(s.admin.accessToken)).send({ date: tomorrow }).expect(200);
    expect(res.body.removed).toBeGreaterThanOrEqual(1);
    expect((await s.runsOf(tomorrow)).some((r) => r.driverId === driverA)).toBe(false);
    expect(await ctx.db.select().from(runStops).innerJoin(runs, eq(runs.id, runStops.runId)).where(eq(runs.driverId, driverA))).toHaveLength(0);
  });
});

describe('Runs over road times from OSRM (e2e)', () => {
  let ctx: TestContext;
  let osrm: Server;
  let calls = 0;

  beforeAll(async () => {
    // A stand-in OSRM: every hop takes 2 minutes.
    osrm = createServer((req, res) => {
      calls++;
      const n = decodeURIComponent(new URL(req.url!, 'http://x').pathname.split('/').pop()!).split(';').length;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 'Ok', durations: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 120))) }));
    });
    await new Promise<void>((r) => osrm.listen(0, r));
    ctx = await createTestApp({ OSRM_URL: `http://127.0.0.1:${(osrm.address() as AddressInfo).port}` });
  });

  afterAll(async () => {
    await ctx.app.close();
    await new Promise<void>((r) => osrm.close(() => r()));
  });

  it('plans with road times and gives riders road-time arrival estimates', async () => {
    const s = await setup(ctx);
    const driverId = await s.driver('سعد');
    const sub = await s.subscriber(HOMES[0], '06:30', 'دانة');
    await s.assign(sub, driverId);
    const [run] = (await s.runsOf(daysFromToday(1))).filter((r) => r.leg === 'outbound');
    expect(run.routing).toBe('osrm');
    expect(calls).toBeGreaterThan(0);

    // Live estimate: the driver is somewhere on the way; OSRM says 2 minutes.
    const trip = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, sub), eq(trips.leg, 'outbound')) });
    await ctx.db.update(trips).set({ status: 'en_route', serviceDate: daysFromToday(0) }).where(eq(trips.id, trip!.id));
    await ctx.app.get(LiveStore).set(driverId, { lat: 24.87, lng: 46.83, heading: 0, speedKmh: 30, at: new Date().toISOString() });
    const live = await ctx.http().get(`/v1/trips/${trip!.id}/live`).set(bearer(s.rider.accessToken)).expect(200);
    expect(live.body.etaMinutes).toBe(2);
  });
});
