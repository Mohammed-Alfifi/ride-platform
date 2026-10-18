import { and, eq } from 'drizzle-orm';
import { addDays } from '../src/common/saudi';
import { driverProfiles, notifications, tripPoints, trips, users, vehicles } from '../src/database/schema';
import { TripGenerator } from '../src/trips/trip.generator';
import { bearer, createPartner, createStaff, createTestApp, daysFromToday, newPhone, signIn, SignedIn, TestContext } from './helpers';

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
const HOME = { lat: 24.8675, lng: 46.8275 };
const SCHOOL = { lat: 24.872, lng: 46.831 };

describe('Trips, live tracking and dispatch (e2e)', () => {
  let ctx: TestContext;
  let partnerId: string;
  let admin: SignedIn;
  let otherAdmin: SignedIn;
  let rider: SignedIn;
  let driver: SignedIn;
  let pendingDriverId: string;
  let subId: string;

  const pathOf = (url: string) => new URL(url).pathname;
  const today = () => daysFromToday(0);

  async function makeDriver(partner: string, status: 'approved' | 'submitted', plate: string): Promise<{ id: string; phone: string }> {
    const phone = newPhone();
    const [u] = await ctx.db
      .insert(users)
      .values({ phone, role: 'driver', audience: 'driver', partnerId: partner, name: 'سائق', status: status === 'approved' ? 'active' : 'pending' })
      .returning({ id: users.id });
    await ctx.db.insert(driverProfiles).values({ userId: u.id, partnerId: partner, fullName: `سائق ${plate}`, status });
    await ctx.db.insert(vehicles).values({
      driverId: u.id,
      partnerId: partner,
      plateLetters: 'ABJ',
      plateNumbers: plate,
      make: 'Toyota',
      model: 'Hiace',
      year: new Date().getFullYear(),
      color: 'أبيض',
      seats: 10,
    });
    return { id: u.id, phone };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    partnerId = await createPartner(ctx, 'Alpha');
    const other = await createPartner(ctx, 'Beta');
    admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    otherAdmin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', other)).phone, 'admin');
    rider = await signIn(ctx, newPhone(), 'rider');
    const d = await makeDriver(partnerId, 'approved', '1234');
    driver = await signIn(ctx, d.phone, 'driver');
    pendingDriverId = (await makeDriver(partnerId, 'submitted', '5678')).id;

    const zone = await ctx.http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الرمال', nameEn: 'Rimal', area: RIMAL }).expect(201);
    const plan = await ctx.http().post('/v1/admin/plans').set(bearer(admin.accessToken))
      .send({ zoneId: zone.body.id, nameAr: 'كل يوم', nameEn: 'Every day', tripType: 'round_trip', daysPerWeek: 7, priceHalalas: 150000, maxDistanceKm: 5 })
      .expect(201);
    const place = (label: string, p: { lat: number; lng: number }) =>
      ctx.http().post('/v1/places').set(bearer(rider.accessToken)).send({ label, name: label === 'home' ? 'البيت' : 'المدرسة', ...p }).expect(201);
    const home = (await place('home', HOME)).body.id;
    const school = (await place('school', SCHOOL)).body.id;

    const res = await ctx.http().post('/v1/subscriptions').set(bearer(rider.accessToken))
      .send({ planId: plan.body.id, pickupPlaceId: home, dropoffPlaceId: school, days: [0, 1, 2, 3, 4, 5, 6], outboundTime: '06:30', returnTime: '13:30' })
      .expect(201);
    subId = res.body.subscription.id;
    await ctx.http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
    await ctx.http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(rider.accessToken)).expect(200);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates tomorrow\'s trips as soon as the subscription is paid, and never twice', async () => {
    const rows = await ctx.db.query.trips.findMany({ where: eq(trips.subscriptionId, subId) });
    expect(rows.map((t) => `${t.serviceDate} ${t.leg}`).sort()).toEqual([`${daysFromToday(1)} outbound`, `${daysFromToday(1)} return`]);
    const ret = rows.find((t) => t.leg === 'return')!;
    expect(ret.pickupName).toBe('المدرسة');
    expect(ret.dropoffName).toBe('البيت');
    // 06:30 Riyadh is 03:30 UTC.
    expect(rows.find((t) => t.leg === 'outbound')!.scheduledAt.toISOString()).toBe(`${daysFromToday(1)}T03:30:00.000Z`);

    expect(await ctx.app.get(TripGenerator).generate()).toBe(0);
  });

  it('lets the dispatcher set a regular driver, only an approved one from the same partner', async () => {
    const refused = await ctx.http().patch(`/v1/admin/subscriptions/${subId}/driver`).set(bearer(admin.accessToken)).send({ driverId: pendingDriverId }).expect(422);
    expect(refused.body.error.code).toBe('DRIVER_NOT_AVAILABLE');
    await ctx.http().patch(`/v1/admin/subscriptions/${subId}/driver`).set(bearer(otherAdmin.accessToken)).send({ driverId: driver.userId }).expect(404);

    await ctx.http().patch(`/v1/admin/subscriptions/${subId}/driver`).set(bearer(admin.accessToken)).send({ driverId: driver.userId }).expect(200);
    const rows = await ctx.db.query.trips.findMany({ where: eq(trips.subscriptionId, subId) });
    expect(rows.every((t) => t.driverId === driver.userId)).toBe(true);
    const note = await ctx.db.query.notifications.findFirst({ where: and(eq(notifications.userId, driver.userId), eq(notifications.kind, 'rider_assigned')) });
    expect(note).toBeTruthy();
  });

  let tripId: string;
  let laterId: string;

  it('runs a trip from start to drop-off, with the rider following the driver live', async () => {
    // Bring tomorrow's trips to today: one in 30 minutes, one in 3 hours.
    const rows = await ctx.db.query.trips.findMany({ where: eq(trips.subscriptionId, subId) });
    tripId = rows.find((t) => t.leg === 'outbound')!.id;
    laterId = rows.find((t) => t.leg === 'return')!.id;
    await ctx.db.update(trips).set({ serviceDate: today(), scheduledAt: new Date(Date.now() + 30 * 60_000) }).where(eq(trips.id, tripId));
    await ctx.db.update(trips).set({ serviceDate: today(), scheduledAt: new Date(Date.now() + 3 * 3600_000) }).where(eq(trips.id, laterId));

    const list = await ctx.http().get('/v1/driver/trips').set(bearer(driver.accessToken)).expect(200);
    expect(list.body.map((t: { id: string }) => t.id)).toEqual([tripId, laterId]);
    expect(list.body[0]).toMatchObject({ status: 'scheduled', pickup: { name: 'البيت', lat: HOME.lat }, rider: { id: rider.userId } });
    expect(list.body[0].driver.vehicle).toMatchObject({ plate: '1234 ABJ', model: 'Hiace' });

    const early = await ctx.http().post(`/v1/driver/trips/${laterId}/start`).set(bearer(driver.accessToken)).expect(409);
    expect(early.body.error.code).toBe('TRIP_TOO_EARLY');

    await ctx.http().post(`/v1/driver/trips/${tripId}/start`).set(bearer(driver.accessToken)).expect(200);
    const noLoc = await ctx.http().get(`/v1/trips/${tripId}/live`).set(bearer(rider.accessToken)).expect(200);
    expect(noLoc.body).toMatchObject({ trip: { status: 'en_route' }, driverLocation: null });
    expect(noLoc.body.trip.driver.phone).toBeTruthy();

    // Driver about 1.1 km south of the home.
    await ctx.http().post('/v1/driver/location').set(bearer(driver.accessToken))
      .send({ points: [{ lat: HOME.lat - 0.01, lng: HOME.lng, speedKmh: 40, at: new Date().toISOString() }] })
      .expect(200, { activeTripId: tripId });
    const moving = await ctx.http().get(`/v1/trips/${tripId}/live`).set(bearer(rider.accessToken)).expect(200);
    expect(moving.body.distanceMeters).toBeGreaterThan(1000);
    expect(moving.body.etaMinutes).toBeGreaterThanOrEqual(2);

    const far = await ctx.http().post(`/v1/driver/trips/${tripId}/arrive`).set(bearer(driver.accessToken)).expect(422);
    expect(far.body.error.code).toBe('TRIP_NOT_NEAR');

    await ctx.http().post('/v1/driver/location').set(bearer(driver.accessToken)).send({ points: [{ ...HOME, at: new Date().toISOString() }] }).expect(200);
    await ctx.http().post(`/v1/driver/trips/${tripId}/arrive`).set(bearer(driver.accessToken)).expect(200);
    const waiting = await ctx.http().get(`/v1/trips/${tripId}/live`).set(bearer(rider.accessToken)).expect(200);
    expect(waiting.body).toMatchObject({ trip: { status: 'arrived' }, etaMinutes: 0 });

    const tooSoon = await ctx.http().post(`/v1/driver/trips/${tripId}/no-show`).set(bearer(driver.accessToken)).expect(409);
    expect(tooSoon.body.error.code).toBe('TRIP_NO_SHOW_TOO_EARLY');

    await ctx.http().post(`/v1/driver/trips/${tripId}/pickup`).set(bearer(driver.accessToken)).expect(200);
    // A second tap does nothing harmful.
    await ctx.http().post(`/v1/driver/trips/${tripId}/pickup`).set(bearer(driver.accessToken)).expect(409);

    await ctx.http().post('/v1/driver/location').set(bearer(driver.accessToken)).send({ points: [{ ...SCHOOL, at: new Date().toISOString() }] }).expect(200);
    const done = await ctx.http().post(`/v1/driver/trips/${tripId}/complete`).set(bearer(driver.accessToken)).expect(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.completedAt).toBeTruthy();

    const kinds = (await ctx.db.query.notifications.findMany({ where: eq(notifications.userId, rider.userId) })).map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['trip_en_route', 'trip_arrived', 'trip_on_board', 'trip_completed']));
    const points = await ctx.db.query.tripPoints.findMany({ where: eq(tripPoints.tripId, tripId) });
    expect(points.length).toBe(3);

    // Location is only shared while a trip is active.
    const after = await ctx.http().get(`/v1/trips/${tripId}/live`).set(bearer(rider.accessToken)).expect(200);
    expect(after.body.driverLocation).toBeNull();
    expect(after.body.trip.driver.phone).toBeNull();
  });

  it('keeps trips private to their rider and driver', async () => {
    const stranger = await signIn(ctx, newPhone(), 'rider');
    await ctx.http().get(`/v1/trips/${tripId}/live`).set(bearer(stranger.accessToken)).expect(404);
    await ctx.http().get('/v1/driver/trips').set(bearer(rider.accessToken)).expect(403);
    await ctx.http().get(`/v1/admin/trips/${tripId}/live`).set(bearer(otherAdmin.accessToken)).expect(404);
    const live = await ctx.http().get(`/v1/admin/trips/${tripId}/live`).set(bearer(admin.accessToken)).expect(200);
    expect(live.body.route).toHaveLength(3);
  });

  it('lets the rider skip a trip they do not need, early enough', async () => {
    const upcoming = await ctx.http().get('/v1/trips').set(bearer(rider.accessToken)).expect(200);
    expect(upcoming.body.map((t: { id: string }) => t.id)).toContain(laterId);
    const skipped = await ctx.http().post(`/v1/trips/${laterId}/skip`).set(bearer(rider.accessToken)).expect(200);
    expect(skipped.body.status).toBe('skipped');
    const note = await ctx.db.query.notifications.findFirst({ where: and(eq(notifications.userId, driver.userId), eq(notifications.kind, 'trip_skipped')) });
    expect(note).toBeTruthy();
    const again = await ctx.http().post(`/v1/trips/${tripId}/skip`).set(bearer(rider.accessToken)).expect(409);
    expect(again.body.error.code).toBe('TRIP_SKIP_TOO_LATE');
  });

  it('shows the dispatcher the day: trips, counts and drivers on the map', async () => {
    const board = await ctx.http().get('/v1/admin/dispatch').set(bearer(admin.accessToken)).expect(200);
    expect(board.body.date).toBe(today());
    expect(board.body.summary).toMatchObject({ total: 2, completed: 1, skipped: 1, active: 0 });
    const d = board.body.drivers.find((x: { id: string }) => x.id === driver.userId);
    expect(d).toMatchObject({ plate: '1234 ABJ', tripsToday: 2, currentTripId: null });
    expect(d.location).toMatchObject({ lat: SCHOOL.lat, lng: SCHOOL.lng });
    expect(board.body.drivers.some((x: { id: string }) => x.id === pendingDriverId)).toBe(false);

    expect(board.body).toMatchObject({ view: 'all', tripsInView: 2 });
    expect(board.body.trips).toHaveLength(2);

    // A tab lists only its trips; the counters still cover the whole day.
    const done = await ctx.http().get('/v1/admin/dispatch?view=done').set(bearer(admin.accessToken)).expect(200);
    expect(done.body.summary.total).toBe(2);
    expect(done.body.tripsInView).toBe(2);
    const active = await ctx.http().get('/v1/admin/dispatch?view=active').set(bearer(admin.accessToken)).expect(200);
    expect(active.body.trips).toHaveLength(0);
    expect(active.body.tripsInView).toBe(0);
    await ctx.http().get('/v1/admin/dispatch?view=everything').set(bearer(admin.accessToken)).expect(400);

    const theirs = await ctx.http().get('/v1/admin/dispatch').set(bearer(otherAdmin.accessToken)).expect(200);
    expect(theirs.body.summary.total).toBe(0);
  });

  it('cancels trips on paused days and brings them back on resume', async () => {
    const tomorrow = daysFromToday(1);
    await ctx.app.get(TripGenerator).generate();
    const paused = await ctx.http().post(`/v1/subscriptions/${subId}/pause`).set(bearer(rider.accessToken)).send({ from: tomorrow, until: daysFromToday(3) });
    expect(paused.status).toBe(200);
    let rows = await ctx.db.query.trips.findMany({ where: and(eq(trips.subscriptionId, subId), eq(trips.serviceDate, tomorrow)) });
    expect(rows.length).toBe(2);
    expect(rows.every((t) => t.status === 'cancelled' && t.endedReason === 'paused')).toBe(true);

    await ctx.http().post(`/v1/subscriptions/${subId}/resume`).set(bearer(rider.accessToken)).expect(200);
    rows = await ctx.db.query.trips.findMany({ where: and(eq(trips.subscriptionId, subId), eq(trips.serviceDate, tomorrow)) });
    expect(rows.map((t) => t.status)).toEqual(['scheduled', 'scheduled']);
    expect(rows.every((t) => t.driverId === driver.userId)).toBe(true);
  });

  it('keeps drivers on compliance hold off the road, and lets the dispatcher hand a trip to a substitute', async () => {
    const tomorrowTrip = await ctx.db.query.trips.findFirst({
      where: and(eq(trips.subscriptionId, subId), eq(trips.serviceDate, daysFromToday(1)), eq(trips.leg, 'outbound')),
    });
    // Today's outbound trip is done; move it out of the way and bring tomorrow's into today.
    await ctx.db.update(trips).set({ serviceDate: daysFromToday(-1) }).where(eq(trips.id, tripId));
    await ctx.db.update(trips).set({ serviceDate: today(), scheduledAt: new Date(Date.now() + 10 * 60_000) }).where(eq(trips.id, tomorrowTrip!.id));
    await ctx.db.update(driverProfiles).set({ complianceHold: true }).where(eq(driverProfiles.userId, driver.userId));
    const held = await ctx.http().post(`/v1/driver/trips/${tomorrowTrip!.id}/start`).set(bearer(driver.accessToken)).expect(403);
    expect(held.body.error.code).toBe('DRIVER_ON_HOLD');
    const busy = await ctx.http().patch(`/v1/admin/trips/${tomorrowTrip!.id}/driver`).set(bearer(admin.accessToken)).send({ driverId: driver.userId }).expect(422);
    expect(busy.body.error.code).toBe('DRIVER_NOT_AVAILABLE');

    const sub = await makeDriver(partnerId, 'approved', '9999');
    const moved = await ctx.http().patch(`/v1/admin/trips/${tomorrowTrip!.id}/driver`).set(bearer(admin.accessToken)).send({ driverId: sub.id }).expect(200);
    expect(moved.body.driver).toMatchObject({ id: sub.id, vehicle: { plate: '9999 ABJ' } });
    await ctx.db.update(driverProfiles).set({ complianceHold: false }).where(eq(driverProfiles.userId, driver.userId));
  });

  it('cancels remaining trips when a subscription expires', async () => {
    const gen = ctx.app.get(TripGenerator);
    const n = await gen.cancelFuture(subId, { from: addDays(today(), 1), reason: 'subscription expired' });
    expect(n).toBeGreaterThan(0);
  });
});
