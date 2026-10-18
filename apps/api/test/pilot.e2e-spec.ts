import { and, eq, sql } from 'drizzle-orm';
import { AccessService } from '../src/auth/access.service';
import { deviceTokens, driverProfiles, joinRequests, notifications, payments, subscriptions, trips, users, vehicles } from '../src/database/schema';
import { TripWatch } from '../src/trips/trip.watch';
import { bearer, createPartner, createStaff, createTestApp, newPhone, SignedIn, TestContext } from './helpers';

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

/** An invite-only pilot with no SMS and no payment gateway: the free setup. */
describe('Invite-only pilot: access codes, join requests, manual payments, safety (e2e)', () => {
  let ctx: TestContext;
  let access: AccessService;
  let partnerId: string;
  let otherPartner: string;
  let admin: SignedIn;
  let otherAdmin: SignedIn;
  let superAdmin: SignedIn;
  let planId: string;
  let driverId: string;

  const http = () => ctx.http();

  /** Signs an admin in with an access code from the server's command line. */
  async function adminIn(phone: string): Promise<SignedIn> {
    const code = await access.adminCodeFor(phone);
    const res = await http().post('/v1/auth/otp/verify').send({ phone, app: 'admin', code }).expect(200);
    return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, userId: res.body.user.id, body: res.body };
  }

  async function invitedRider(name: string): Promise<SignedIn & { phone: string }> {
    const phone = newPhone();
    // The sign-in endpoints are rate limited per address; tests share one address.
    const limits = await ctx.redis.keys('*throttl*');
    if (limits.length) await ctx.redis.del(...limits);
    const inv = await http().post('/v1/admin/access').set(bearer(admin.accessToken)).send({ phone, audience: 'rider', name }).expect(200);
    const res = await http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: inv.body.code }).expect(200);
    return { phone, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, userId: res.body.user.id, body: res.body };
  }

  async function subscribe(rider: SignedIn, status: number, outboundTime = '06:30', returnTime = '13:30') {
    const home = (await http().post('/v1/places').set(bearer(rider.accessToken)).send({ label: 'home', name: 'البيت', lat: 24.8675, lng: 46.8275 }).expect(201)).body.id;
    const school = (await http().post('/v1/places').set(bearer(rider.accessToken)).send({ label: 'school', name: 'المدرسة', lat: 24.872, lng: 46.831 }).expect(201)).body.id;
    return http()
      .post('/v1/subscriptions')
      .set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: school, days: [0, 1, 2, 3, 4, 5, 6], outboundTime, returnTime })
      .expect(status);
  }

  beforeAll(async () => {
    ctx = await createTestApp({
      ACCESS_MODE: 'invite',
      SMS_PROVIDER: 'none',
      PAYMENT_PROVIDER: 'manual',
      PILOT_MAX_ACTIVE_SUBSCRIPTIONS: 2,
      SUPPORT_WHATSAPP: '0500000000',
      RIDER_WEB_URL: 'https://api.example.sa/app/',
    });
    access = ctx.app.get(AccessService);
    partnerId = await createPartner(ctx, 'Alpha');
    otherPartner = await createPartner(ctx, 'Beta');
    admin = await adminIn((await createStaff(ctx, 'partner_admin', partnerId)).phone);
    otherAdmin = await adminIn((await createStaff(ctx, 'partner_admin', otherPartner)).phone);
    superAdmin = await adminIn((await createStaff(ctx, 'super_admin')).phone);

    const [d] = await ctx.db.insert(users).values({ phone: newPhone(), role: 'driver', audience: 'driver', partnerId, status: 'active', name: 'سعد' }).returning();
    driverId = d.id;
    await ctx.db.insert(driverProfiles).values({ userId: d.id, partnerId, fullName: 'سعد محمد', status: 'approved' });
    // A small car: one passenger seat, so the capacity rule shows.
    await ctx.db.insert(vehicles).values({ driverId: d.id, partnerId, plateLetters: 'KHD', plateNumbers: '7341', make: 'Toyota', model: 'Camry', year: new Date().getFullYear(), color: 'أبيض', seats: 1 });

    const zone = await http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الرمال', nameEn: 'Rimal', area: RIMAL }).expect(201);
    const plan = await http().post('/v1/admin/plans').set(bearer(admin.accessToken))
      .send({ zoneId: zone.body.id, nameAr: 'كل يوم', nameEn: 'Every day', tripType: 'round_trip', daysPerWeek: 7, priceHalalas: 120000, maxDistanceKm: 5 })
      .expect(201);
    planId = plan.body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('tells the apps how this server runs', async () => {
    const res = await http().get('/v1/app-config').expect(200);
    expect(res.body).toMatchObject({
      accessMode: 'invite',
      signIn: 'access_code',
      paymentMode: 'manual',
      supportWhatsapp: '+966500000000',
      emergencyNumber: '911',
      pushEnabled: false,
    });
    expect(res.body.links.join).toMatch(/\/join$/);
    expect(res.body.paymentInstructions.ar.length).toBeGreaterThan(10);
  });

  it('keeps people without an invite out, and sends no SMS', async () => {
    const res = await http().post('/v1/auth/otp/request').send({ phone: newPhone(), app: 'rider' }).expect(403);
    expect(res.body.error.code).toBe('AUTH_NOT_INVITED');
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('takes join requests from the public form and turns one into an invite with a WhatsApp message', async () => {
    const phone = newPhone();
    await http().post('/v1/join').send({ kind: 'rider', name: 'أم خالد', phone: phone.replace('+966', '0'), city: 'الرياض', district: 'الرمال', destination: 'مدرسة الرواد', morningTime: '06:30', returnTime: '13:15', riders: 2 }).expect(200);
    // Same phone again: updates the open request rather than adding a second one.
    await http().post('/v1/join').send({ kind: 'rider', name: 'أم خالد', phone, city: 'الرياض', riders: 3 }).expect(200);
    // A bot filling the hidden field is accepted silently and stored nowhere.
    await http().post('/v1/join').send({ kind: 'driver', name: 'bot', phone: newPhone(), city: 'x1', website: 'http://spam' }).expect(200);
    await http().post('/v1/join').send({ kind: 'rider', name: 'x', phone: 'abc', city: 'الرياض' }).expect(400);

    const list = await http().get('/v1/admin/join-requests?status=new').set(bearer(admin.accessToken)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ name: 'أم خالد', riders: 3, status: 'new', phone });
    const alerted = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, superAdmin.userId), eq(notifications.kind, 'join_request')));
    expect(alerted).toHaveLength(1);

    const inv = await http().post(`/v1/admin/join-requests/${list.body[0].id}/invite`).set(bearer(admin.accessToken)).expect(200);
    expect(inv.body.code).toMatch(/^\d{8}$/);
    expect(inv.body.whatsappUrl).toMatch(new RegExp(`^https://wa.me/${phone.slice(1)}\\?text=`));
    expect(inv.body.message).toContain(inv.body.code);
    expect(inv.body.message).toContain('https://api.example.sa/app/');
    expect(inv.body.invite).toMatchObject({ audience: 'rider', name: 'أم خالد', partnerId, hasCode: true, signedUp: false });
    const [row] = await ctx.db.select().from(joinRequests).where(eq(joinRequests.id, list.body[0].id));
    expect(row.status).toBe('invited');

    // The code: no SMS, the app asks for the access code; wrong codes fail; the right one works once.
    const req = await http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(200);
    expect(req.body.channel).toBe('access_code');
    await http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: '123456' }).expect(401);
    await http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: '00000000' }).expect(401);
    const ok = await http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: inv.body.code }).expect(200);
    expect(ok.body.isNewUser).toBe(true);
    await http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: inv.body.code }).expect(401);

    // Another partner's team does not see this invite; a new code works again.
    const others = await http().get('/v1/admin/access').set(bearer(otherAdmin.accessToken)).expect(200);
    expect(others.body).toHaveLength(0);
    await http().post(`/v1/admin/access/${inv.body.invite.id}/code`).set(bearer(otherAdmin.accessToken)).expect(404);
    const again = await http().post(`/v1/admin/access/${inv.body.invite.id}/code`).set(bearer(admin.accessToken)).expect(200);
    expect(again.body.invite.signedUp).toBe(true);
    await http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: again.body.code }).expect(200);
  });

  it('locks an access code after five wrong tries', async () => {
    const phone = newPhone();
    const inv = await http().post('/v1/admin/access').set(bearer(admin.accessToken)).send({ phone, audience: 'driver' }).expect(200);
    for (let i = 0; i < 4; i++) await http().post('/v1/auth/otp/verify').send({ phone, app: 'driver', code: '11111111' }).expect(401);
    await http().post('/v1/auth/otp/verify').send({ phone, app: 'driver', code: '11111111' }).expect(429);
    await http().post('/v1/auth/otp/verify').send({ phone, app: 'driver', code: inv.body.code }).expect(401);
  });

  it('only gives admin codes to people on the team', async () => {
    const res = await http().post('/v1/admin/access').set(bearer(admin.accessToken)).send({ phone: newPhone(), audience: 'admin' }).expect(422);
    expect(res.body.error.code).toBe('ACCESS_NO_ADMIN_ACCOUNT');
    const staff = await createStaff(ctx, 'dispatcher', otherPartner);
    await http().post('/v1/admin/access').set(bearer(admin.accessToken)).send({ phone: staff.phone, audience: 'admin' }).expect(422);
    const ok = await http().post('/v1/admin/access').set(bearer(otherAdmin.accessToken)).send({ phone: staff.phone, audience: 'admin' }).expect(200);
    await http().post('/v1/auth/otp/verify').send({ phone: staff.phone, app: 'admin', code: ok.body.code }).expect(200);
  });

  it('records the accepted terms version', async () => {
    const rider = await invitedRider('سارة');
    expect(rider.body.user).toMatchObject({ termsVersion: null });
    await http().post('/v1/me/terms').set(bearer(rider.accessToken)).send({ version: '2026-10' }).expect(204);
    const me = await http().get('/v1/me').set(bearer(rider.accessToken)).expect(200);
    expect(me.body.termsVersion).toBe('2026-10');
  });

  let rider1: SignedIn & { phone: string };
  let sub1: string;

  it('activates a subscription when the team records a bank transfer, with an invoice and trips', async () => {
    rider1 = await invitedRider('أبو فهد');
    const res = await subscribe(rider1, 201);
    sub1 = res.body.subscription.id;
    expect(res.body.payment).toMatchObject({ status: 'initiated', checkoutUrl: null });
    // Asking to pay again does not pile up payments.
    const again = await http().post(`/v1/subscriptions/${sub1}/pay`).set(bearer(rider1.accessToken)).expect(200);
    expect(again.body.id).toBe(res.body.payment.id);

    await http().post(`/v1/admin/subscriptions/${sub1}/payments/manual`).set(bearer(otherAdmin.accessToken)).send({ method: 'cash' }).expect(404);
    await http().post(`/v1/admin/subscriptions/${sub1}/payments/manual`).set(bearer(admin.accessToken)).send({ method: 'cheque' }).expect(400);
    const paid = await http()
      .post(`/v1/admin/subscriptions/${sub1}/payments/manual`)
      .set(bearer(admin.accessToken))
      .send({ method: 'bank_transfer', reference: 'TRX-5512' })
      .expect(200);
    expect(paid.body).toMatchObject({ id: res.body.payment.id, status: 'paid', purpose: 'start', amountHalalas: 120000 });
    expect(paid.body.invoiceId).toBeTruthy();

    const [row] = await ctx.db.select().from(payments).where(eq(payments.id, paid.body.id));
    expect(row).toMatchObject({ method: 'bank_transfer', reference: 'TRX-5512', recordedBy: admin.userId, provider: 'manual' });
    const sub = await http().get(`/v1/subscriptions/${sub1}`).set(bearer(rider1.accessToken)).expect(200);
    expect(sub.body.status).toBe('active');
    const tripRows = await ctx.db.select().from(trips).where(eq(trips.subscriptionId, sub1));
    expect(tripRows.length).toBeGreaterThan(0);
    const told = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, rider1.userId), eq(notifications.kind, 'payment_paid')));
    expect(told).toHaveLength(1);

    // Paying ahead records the next month.
    const next = await http().post(`/v1/admin/subscriptions/${sub1}/payments/manual`).set(bearer(admin.accessToken)).send({ method: 'cash' }).expect(200);
    expect(next.body.purpose).toBe('renewal');
  });

  it('refuses a driver whose car is full at that time', async () => {
    await http().patch(`/v1/admin/subscriptions/${sub1}/driver`).set(bearer(admin.accessToken)).send({ driverId }).expect(200);
    const rider2 = await invitedRider('أم ريم');
    const res = await subscribe(rider2, 201, '06:45', '13:30');
    const sub2 = res.body.subscription.id;
    const full = await http().patch(`/v1/admin/subscriptions/${sub2}/driver`).set(bearer(admin.accessToken)).send({ driverId }).expect(409);
    expect(full.body.error.code).toBe('DRIVER_FULL');
    expect(full.body.error.message).toContain('1');
    await http().post(`/v1/admin/subscriptions/${sub2}/payments/manual`).set(bearer(admin.accessToken)).send({ method: 'cash' }).expect(200);
  });

  it('stops new subscriptions when the pilot is full', async () => {
    const rider3 = await invitedRider('محمد');
    const res = await subscribe(rider3, 409);
    expect(res.body.error.code).toBe('PILOT_FULL');
  });

  it('raises an emergency report to the operator and the platform team', async () => {
    const [trip] = await ctx.db.select().from(trips).where(eq(trips.subscriptionId, sub1)).limit(1);
    const res = await http()
      .post('/v1/support/tickets/sos')
      .set(bearer(rider1.accessToken))
      .send({ tripId: trip.id, lat: 24.8675, lng: 46.8275 })
      .expect(200);
    expect(res.body.emergencyNumber).toBe('911');
    for (const who of [admin.userId, superAdmin.userId]) {
      const n = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, who), eq(notifications.kind, 'sos')));
      expect(n).toHaveLength(1);
    }
    await http().post('/v1/support/tickets').set(bearer(rider1.accessToken)).send({ category: 'app', subject: 'سؤال عادي', message: 'كيف أغير الموعد؟' }).expect(201);
    const inbox = await http().get('/v1/admin/support/tickets').set(bearer(admin.accessToken)).expect(200);
    expect(inbox.body[0]).toMatchObject({ urgent: true, subject: 'بلاغ طوارئ' });
    const detail = await http().get(`/v1/admin/support/tickets/${res.body.ticketId}`).set(bearer(admin.accessToken)).expect(200);
    expect(detail.body.messages[0].body).toContain('https://maps.google.com/?q=24.8675,46.8275');
  });

  it('warns about late drivers, late pick-ups and trips without a driver, once each', async () => {
    const watch = ctx.app.get(TripWatch);
    const now = new Date();
    const [a, b, c] = await ctx.db.select().from(trips).limit(3);
    await ctx.db.update(trips).set({ scheduledAt: new Date(now.getTime() + 5 * 60_000), driverId, status: 'scheduled' }).where(eq(trips.id, a.id));
    await ctx.db.update(trips).set({ scheduledAt: new Date(now.getTime() - 15 * 60_000), driverId, status: 'en_route' }).where(eq(trips.id, b.id));
    await ctx.db.update(trips).set({ scheduledAt: new Date(now.getTime() + 2 * 3600_000), driverId: null, status: 'scheduled' }).where(eq(trips.id, c.id));

    const first = await watch.run(now);
    expect(first).toMatchObject({ lateStart: 1, overdue: 1, unassignedPartners: 1 });
    const second = await watch.run(now);
    expect(second).toMatchObject({ lateStart: 0, overdue: 0, unassignedPartners: 0 });

    const kinds = async (userId: string) =>
      (await ctx.db.select({ kind: notifications.kind }).from(notifications).where(eq(notifications.userId, userId))).map((n) => n.kind);
    expect(await kinds(admin.userId)).toEqual(expect.arrayContaining(['trip_not_started', 'trip_overdue', 'trips_unassigned']));
    expect(await kinds(driverId)).toContain('trip_reminder');
    expect(await kinds(rider1.userId)).toContain('trip_delayed');
  });

  it('deletes location history after the retention period', async () => {
    const [t] = await ctx.db.select().from(trips).where(eq(trips.subscriptionId, sub1)).limit(1);
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await ctx.db.execute(sql`INSERT INTO trip_points (trip_id, location, recorded_at) VALUES
      (${t.id}, ST_SetSRID(ST_MakePoint(46.83, 24.87), 4326), ${old}::timestamptz),
      (${t.id}, ST_SetSRID(ST_MakePoint(46.83, 24.87), 4326), now())`);
    const res = await ctx.app.get(TripWatch).purge();
    expect(res.points).toBe(1);
    const left = await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM trip_points WHERE trip_id = ${t.id}`);
    expect(left.rows[0].n).toBe(1);
  });

  it('registers phones for push notifications', async () => {
    const token = 'fcm-token-'.padEnd(60, 'x');
    await http().post('/v1/notifications/devices').set(bearer(rider1.accessToken)).send({ token, platform: 'android' }).expect(204);
    await http().post('/v1/notifications/devices').set(bearer(rider1.accessToken)).send({ token, platform: 'android' }).expect(204);
    expect(await ctx.db.select().from(deviceTokens).where(eq(deviceTokens.token, token))).toHaveLength(1);
    await http().delete('/v1/notifications/devices').set(bearer(rider1.accessToken)).send({ token }).expect(204);
    expect(await ctx.db.select().from(deviceTokens).where(eq(deviceTokens.token, token))).toHaveLength(0);
  });

  it('lets people delete their account, but not in the middle of a running subscription', async () => {
    const blocked = await http().delete('/v1/me').set(bearer(rider1.accessToken)).expect(409);
    expect(blocked.body.error.code).toBe('ACCOUNT_HAS_ACTIVE_SUBSCRIPTION');

    const rider = await invitedRider('حساب للحذف');
    await http().delete('/v1/me').set(bearer(rider.accessToken)).expect(204);
    const [row] = await ctx.db.select().from(users).where(eq(users.id, rider.userId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.name).toBeNull();
    await http().get('/v1/me').set(bearer(rider.accessToken)).expect(401);
    await http().post('/v1/auth/refresh').send({ refreshToken: rider.refreshToken }).expect(401);
  });

  it('removing an invite signs the person out and keeps them out', async () => {
    const rider = await invitedRider('مؤقت');
    const list = await http().get('/v1/admin/access?audience=rider').set(bearer(admin.accessToken)).expect(200);
    const inv = list.body.find((i: { phone: string }) => i.phone === rider.phone);
    await http().delete(`/v1/admin/access/${inv.id}`).set(bearer(admin.accessToken)).expect(204);
    await http().post('/v1/auth/refresh').send({ refreshToken: rider.refreshToken }).expect(401);
    const res = await http().post('/v1/auth/otp/request').send({ phone: rider.phone, app: 'rider' }).expect(403);
    expect(res.body.error.code).toBe('AUTH_NOT_INVITED');
  });

  it('keeps an active subscription count for the pilot cap', async () => {
    const active = await ctx.db.select().from(subscriptions).where(eq(subscriptions.status, 'active'));
    expect(active).toHaveLength(2);
  });
});
