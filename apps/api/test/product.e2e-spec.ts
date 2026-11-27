import { and, eq, sql } from 'drizzle-orm';
import { payments, subscriptions, trips, walletEntries } from '../src/database/schema';
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
const MOSQUE = { lat: 24.866, lng: 46.8275 };
const NEAR_HOME = { lat: 24.8675, lng: 46.8275 }; // about 170 m from the mosque
const FAR_HOME = { lat: 24.8745, lng: 46.8205 }; // about 1 km away
const WORK = { lat: 24.861, lng: 46.834 };

const pathOf = (url: string) => new URL(url).pathname;

/**
 * Phase 8: meeting points, short plans (weekly pass, trial) and the wallet: compensation for trips
 * the partner missed or ran late, credit used at the next payment, and cancelling now for credit.
 */
describe('Meeting points, short plans and wallet (e2e)', () => {
  let ctx: TestContext;
  let partnerId: string;
  let admin: SignedIn;
  let dispatcher: SignedIn;
  let superAdmin: SignedIn;
  let otherAdmin: SignedIn;
  let rider: SignedIn;
  let zoneId: string;
  let home: string;
  let farHome: string;
  let work: string;

  const http = () => ctx.http();
  const plan = (body: Record<string, unknown>) =>
    http()
      .post('/v1/admin/plans')
      .set(bearer(admin.accessToken))
      .send({ zoneId, nameAr: 'باقة', nameEn: 'Plan', tripType: 'round_trip', daysPerWeek: 7, priceHalalas: 70000, maxDistanceKm: 5, ...body });

  async function subscribeAndPay(planId: string, pickup = home, extra: Record<string, unknown> = {}): Promise<{ subId: string; paymentId: string }> {
    const res = await http()
      .post('/v1/subscriptions')
      .set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: pickup, dropoffPlaceId: work, days: [0, 1, 2, 3, 4, 5, 6], outboundTime: '07:00', returnTime: '15:00', sharedRideConsent: true, ...extra })
      .expect(201);
    await http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
    await http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(rider.accessToken)).expect(200);
    return { subId: res.body.subscription.id, paymentId: res.body.payment.id };
  }

  const subRow = async (id: string) => (await ctx.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, id) }))!;

  beforeAll(async () => {
    ctx = await createTestApp();
    partnerId = await createPartner(ctx, 'Product');
    const other = await createPartner(ctx, 'Other');
    admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    dispatcher = await signIn(ctx, (await createStaff(ctx, 'dispatcher', partnerId)).phone, 'admin');
    superAdmin = await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin');
    otherAdmin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', other)).phone, 'admin');
    rider = await signIn(ctx, newPhone(), 'rider');
    zoneId = (await http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الرمال', nameEn: 'Rimal', area: RIMAL }).expect(201)).body.id;
    const place = async (label: string, name: string, p: { lat: number; lng: number }) =>
      (await http().post('/v1/places').set(bearer(rider.accessToken)).send({ label, name, ...p }).expect(201)).body.id as string;
    home = await place('home', 'البيت', NEAR_HOME);
    farHome = await place('other', 'بيت بعيد', FAR_HOME);
    work = await place('work', 'العمل', WORK);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('meeting points', () => {
    let meetingPlan: string;

    it('keeps points inside the zone, and a meeting-point plan needs one', async () => {
      const refused = await plan({ pickupMode: 'meeting_point' }).expect(400);
      expect(refused.body.error.code).toBe('PLAN_RULES_INVALID');
      const outside = await http()
        .post('/v1/admin/meeting-points')
        .set(bearer(admin.accessToken))
        .send({ zoneId, nameAr: 'خارج', nameEn: 'Outside', lat: 24.9, lng: 46.9 })
        .expect(400);
      expect(outside.body.error.code).toBe('MEETING_POINT_OUTSIDE_ZONE');
      await http().post('/v1/admin/meeting-points').set(bearer(dispatcher.accessToken)).send({ zoneId, nameAr: 'جامع', nameEn: 'Mosque', ...MOSQUE }).expect(403);
      const point = await http()
        .post('/v1/admin/meeting-points')
        .set(bearer(admin.accessToken))
        .send({ zoneId, nameAr: 'موقف جامع الرمال', nameEn: 'Al Rimal mosque car park', ...MOSQUE })
        .expect(201);
      expect(point.body).toMatchObject({ nameAr: 'موقف جامع الرمال', active: true });
      expect(point.body.lat).toBeCloseTo(MOSQUE.lat, 5);
      const listed = await http().get('/v1/admin/meeting-points').query({ zoneId }).set(bearer(dispatcher.accessToken)).expect(200);
      expect(listed.body).toHaveLength(1);
      expect((await http().get('/v1/admin/meeting-points').set(bearer(otherAdmin.accessToken)).expect(200)).body).toHaveLength(0);
      meetingPlan = (await plan({ pickupMode: 'meeting_point', priceHalalas: 50000, nameEn: 'Meet' }).expect(201)).body.id;
    });

    it('sends the rider to the nearest point within walking distance', async () => {
      const far = await http().post('/v1/quotes').set(bearer(rider.accessToken)).send({ planId: meetingPlan, pickupPlaceId: farHome, dropoffPlaceId: work }).expect(200);
      expect(far.body).toMatchObject({ eligible: false, reason: 'NO_MEETING_POINT_NEARBY', meetingPoint: null });

      const near = await http().post('/v1/quotes').set(bearer(rider.accessToken)).send({ planId: meetingPlan, pickupPlaceId: home, dropoffPlaceId: work }).expect(200);
      expect(near.body.eligible).toBe(true);
      expect(near.body.meetingPoint).toMatchObject({ nameAr: 'موقف جامع الرمال' });
      expect(near.body.meetingPoint.walkMeters).toBeGreaterThan(100);
      expect(near.body.meetingPoint.walkMeters).toBeLessThan(300);
    });

    it('picks up at the point and drops back there on the way home', async () => {
      const { subId } = await subscribeAndPay(meetingPlan);
      expect((await subRow(subId)).meetingPointId).not.toBeNull();
      const out = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, subId), eq(trips.leg, 'outbound')) });
      const back = await ctx.db.query.trips.findFirst({ where: and(eq(trips.subscriptionId, subId), eq(trips.leg, 'return')) });
      expect(out).toMatchObject({ pickupName: 'موقف جامع الرمال', dropoffName: 'العمل' });
      expect(back).toMatchObject({ pickupName: 'العمل', dropoffName: 'موقف جامع الرمال' });
      const [pt] = await ctx.db.execute<{ lat: number }>(sql`SELECT ST_Y(pickup) AS lat FROM trips WHERE id = ${out!.id}`).then((r) => r.rows);
      expect(Number(pt.lat)).toBeCloseTo(MOSQUE.lat, 5);
    });
  });

  describe('weekly pass and trial', () => {
    it('runs a weekly pass for seven days', async () => {
      const weekly = (await plan({ periodDays: 7, priceHalalas: 25000, nameEn: 'Week' }).expect(201)).body.id;
      const { subId } = await subscribeAndPay(weekly);
      const row = await subRow(subId);
      expect(row).toMatchObject({ status: 'active', periodDays: 7, currentPeriodStart: daysFromToday(1), currentPeriodEnd: daysFromToday(7), autoRenew: true });
    });

    it('sells a trial once, for a period that contains a chosen day', async () => {
      const trial = (await plan({ periodDays: 3, renewable: false, oncePerRider: true, daysPerWeek: 1, priceHalalas: 3000, nameEn: 'Trial' }).expect(201)).body.id;
      const quote = await http().post('/v1/quotes').set(bearer(rider.accessToken)).send({ planId: trial, pickupPlaceId: home, dropoffPlaceId: work }).expect(200);
      expect(quote.body).toMatchObject({ periodDays: 3, renewable: false });

      // Today's weekday is not in tomorrow..+2: nothing would run.
      const todayDow = new Date(`${daysFromToday(0)}T00:00:00Z`).getUTCDay();
      const base = { planId: trial, pickupPlaceId: home, dropoffPlaceId: work, outboundTime: '07:00', returnTime: '15:00', sharedRideConsent: true };
      const empty = await http().post('/v1/subscriptions').set(bearer(rider.accessToken)).send({ ...base, days: [todayDow] }).expect(400);
      expect(empty.body.error.code).toBe('TRIAL_NO_SERVICE_DAY');

      const tomorrowDow = new Date(`${daysFromToday(1)}T00:00:00Z`).getUTCDay();
      const res = await http().post('/v1/subscriptions').set(bearer(rider.accessToken)).send({ ...base, days: [tomorrowDow] }).expect(201);
      await http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
      await http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(rider.accessToken)).expect(200);
      const row = await subRow(res.body.subscription.id);
      expect(row).toMatchObject({ status: 'active', autoRenew: false, cancelAtPeriodEnd: true, currentPeriodEnd: daysFromToday(3) });

      const again = await http().post('/v1/subscriptions').set(bearer(rider.accessToken)).send({ ...base, days: [tomorrowDow] }).expect(409);
      expect(again.body.error.code).toBe('TRIAL_ALREADY_USED');
    });
  });

  describe('wallet', () => {
    let monthly: string;
    let subId: string;

    it('credits trips the partner missed or ran late, once', async () => {
      monthly = (await plan({ priceHalalas: 60000, nameEn: 'Month' }).expect(201)).body.id;
      subId = (await subscribeAndPay(monthly)).subId;
      const sub = await subRow(subId);
      const yesterday = daysFromToday(-1);
      const at = (h: number, m = 0) => new Date(`${yesterday}T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
      const point = sql`ST_SetSRID(ST_MakePoint(46.8275, 24.8675), 4326)` as unknown as string;
      const base = { subscriptionId: subId, partnerId, riderId: rider.userId, serviceDate: yesterday, pickup: point, pickupName: 'البيت', dropoff: point, dropoffName: 'العمل' };
      await ctx.db.insert(trips).values([
        // Never came.
        { ...base, leg: 'outbound' as const, scheduledAt: at(7), status: 'scheduled' as const },
        // Came 30 minutes late.
        { ...base, leg: 'return' as const, scheduledAt: at(15), status: 'completed' as const, arrivedAt: at(15, 30), pickedUpAt: at(15, 32), completedAt: at(15, 50) },
      ]);
      const res = await http().post(`/v1/admin/wallet/compensate/${yesterday}`).set(bearer(superAdmin.accessToken)).expect(201);
      expect(res.body).toMatchObject({ missed: 1, late: 1 });
      const value = Math.round(sub.priceHalalas / (Math.round((7 * 30) / 7) * 2));
      expect(res.body.credited).toBe(2 * value);
      // Running it again changes nothing.
      expect((await http().post(`/v1/admin/wallet/compensate/${yesterday}`).set(bearer(superAdmin.accessToken)).expect(201)).body.credited).toBe(0);

      const wallet = await http().get('/v1/wallet').set(bearer(rider.accessToken)).expect(200);
      expect(wallet.body.balances).toEqual([expect.objectContaining({ partnerId, balanceHalalas: 2 * value })]);
      expect(wallet.body.entries.map((e: { kind: string }) => e.kind)).toEqual(['compensation', 'compensation']);
    });

    it('lets the team add credit, within its partner', async () => {
      await http().post('/v1/admin/wallet/adjust').set(bearer(dispatcher.accessToken)).send({ riderId: rider.userId, amountHalalas: 500, note: 'لفتة تقدير' }).expect(403);
      await http().post('/v1/admin/wallet/adjust').set(bearer(admin.accessToken)).send({ riderId: rider.userId, amountHalalas: 500, note: 'لفتة تقدير' }).expect(201);
      const tooMuch = await http().post('/v1/admin/wallet/adjust').set(bearer(admin.accessToken)).send({ riderId: rider.userId, amountHalalas: -999_999, note: 'تصحيح' }).expect(400);
      expect(tooMuch.body.error.code).toBe('VALIDATION_FAILED');
      const seen = await http().get('/v1/admin/wallet').query({ riderId: rider.userId }).set(bearer(otherAdmin.accessToken)).expect(200);
      expect(seen.body).toEqual({ balances: [], entries: [] });
    });

    it('takes the credit off the next payment and records its use', async () => {
      const before = (await http().get('/v1/wallet').set(bearer(rider.accessToken)).expect(200)).body.balances[0].balanceHalalas;
      const another = (await plan({ priceHalalas: 40000, nameEn: 'Other' }).expect(201)).body.id;
      const quote = await http().post('/v1/quotes').set(bearer(rider.accessToken)).send({ planId: another, pickupPlaceId: home, dropoffPlaceId: work }).expect(200);
      expect(quote.body).toMatchObject({ walletHalalas: before, firstPaymentHalalas: 40000 - before });

      const { paymentId } = await subscribeAndPay(another);
      const pay = await ctx.db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
      expect(pay).toMatchObject({ status: 'paid', walletHalalas: before, amountHalalas: 40000 - before });
      const redeem = await ctx.db.select().from(walletEntries).where(and(eq(walletEntries.paymentId, paymentId), eq(walletEntries.kind, 'redeem')));
      expect(redeem).toEqual([expect.objectContaining({ amountHalalas: -before })]);
      expect((await http().get('/v1/wallet').set(bearer(rider.accessToken)).expect(200)).body.balances).toEqual([]);
    });

    it('cancels now and credits the trips left, after showing what each choice gives', async () => {
      const preview = await http().get(`/v1/subscriptions/${subId}/cancel-preview`).set(bearer(rider.accessToken)).expect(200);
      expect(preview.body.canCancelNow).toBe(true);
      expect(preview.body.lastServiceDay).toBe((await subRow(subId)).currentPeriodEnd);
      expect(preview.body.remainingTrips).toBeGreaterThan(20);
      expect(preview.body.creditHalalas).toBeGreaterThan(0);
      expect(preview.body.creditHalalas).toBeLessThanOrEqual(60000);

      const res = await http().post(`/v1/subscriptions/${subId}/cancel`).set(bearer(rider.accessToken)).send({ mode: 'now' }).expect(200);
      expect(res.body.status).toBe('cancelled');
      const future = await ctx.db.select().from(trips).where(and(eq(trips.subscriptionId, subId), eq(trips.serviceDate, daysFromToday(1))));
      expect(future.every((t) => t.status === 'cancelled')).toBe(true);
      const wallet = await http().get('/v1/wallet').set(bearer(rider.accessToken)).expect(200);
      expect(wallet.body.entries[0]).toMatchObject({ kind: 'refund', amountHalalas: preview.body.creditHalalas });
      // Cancelling at period end stays as before.
      const keep = (await subscribeAndPay(monthly)).subId;
      const later = await http().post(`/v1/subscriptions/${keep}/cancel`).set(bearer(rider.accessToken)).send({}).expect(200);
      expect(later.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    });
  });
});
