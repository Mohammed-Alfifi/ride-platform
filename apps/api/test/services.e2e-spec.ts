import { and, eq } from 'drizzle-orm';
import { driverProfiles, notifications, promoCodes, trips, users, vehicles } from '../src/database/schema';
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

describe('Family, promo codes, shared tracking, ratings, support and reports (e2e)', () => {
  let ctx: TestContext;
  let partnerId: string;
  let admin: SignedIn;
  let otherAdmin: SignedIn;
  let parent: SignedIn;
  let driverId: string;
  let planId: string;
  let home: string;
  let school: string;
  let subId: string;
  let tripId: string;

  const pathOf = (url: string) => new URL(url).pathname;

  beforeAll(async () => {
    ctx = await createTestApp();
    partnerId = await createPartner(ctx, 'Alpha');
    const other = await createPartner(ctx, 'Beta');
    admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    otherAdmin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', other)).phone, 'admin');
    parent = await signIn(ctx, newPhone(), 'rider');
    await ctx.http().patch('/v1/me').set(bearer(parent.accessToken)).send({ name: 'أبو سارة' }).expect(200);

    const [d] = await ctx.db.insert(users).values({ phone: newPhone(), role: 'driver', audience: 'driver', partnerId, status: 'active' }).returning();
    driverId = d.id;
    await ctx.db.insert(driverProfiles).values({ userId: d.id, partnerId, fullName: 'سعد محمد الغامدي', status: 'approved' });
    await ctx.db.insert(vehicles).values({ driverId: d.id, partnerId, plateLetters: 'KHD', plateNumbers: '7341', make: 'Hyundai', model: 'Staria', year: new Date().getFullYear(), color: 'فضي', seats: 8 });

    const zone = await ctx.http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الرمال', nameEn: 'Rimal', area: RIMAL }).expect(201);
    const plan = await ctx.http().post('/v1/admin/plans').set(bearer(admin.accessToken))
      .send({ zoneId: zone.body.id, nameAr: 'كل يوم', nameEn: 'Every day', tripType: 'round_trip', daysPerWeek: 7, priceHalalas: 120000, maxDistanceKm: 5 })
      .expect(201);
    planId = plan.body.id;
    home = (await ctx.http().post('/v1/places').set(bearer(parent.accessToken)).send({ label: 'home', name: 'البيت', lat: 24.8675, lng: 46.8275 }).expect(201)).body.id;
    school = (await ctx.http().post('/v1/places').set(bearer(parent.accessToken)).send({ label: 'school', name: 'المدرسة', lat: 24.872, lng: 46.831 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('lets a partner create discount codes; codes are unique and private to the partner', async () => {
    const created = await ctx.http().post('/v1/admin/promo-codes').set(bearer(admin.accessToken))
      .send({ code: 'school25', kind: 'percent', value: 25, maxUses: 1 }).expect(201);
    expect(created.body).toMatchObject({ code: 'SCHOOL25', usedCount: 0, active: true, partnerId });
    const dup = await ctx.http().post('/v1/admin/promo-codes').set(bearer(otherAdmin.accessToken)).send({ code: 'SCHOOL25', kind: 'amount', value: 100 }).expect(409);
    expect(dup.body.error.code).toBe('PROMO_CODE_TAKEN');
    await ctx.http().post('/v1/admin/promo-codes').set(bearer(otherAdmin.accessToken)).send({ code: 'BETA10', kind: 'percent', value: 10 }).expect(201);
    const mine = await ctx.http().get('/v1/admin/promo-codes').set(bearer(admin.accessToken)).expect(200);
    expect(mine.body.map((p: { code: string }) => p.code)).toEqual(['SCHOOL25']);
    await ctx.http().post('/v1/admin/promo-codes').set(bearer(admin.accessToken)).send({ code: 'TOO', kind: 'percent', value: 120 }).expect(400);
  });

  it('subscribes a child with a discount on the first month', async () => {
    const member = await ctx.http().post('/v1/family').set(bearer(parent.accessToken)).send({ name: 'سارة', relation: 'child', note: 'الصف الرابع' }).expect(201);
    const fam = await ctx.http().get('/v1/family').set(bearer(parent.accessToken)).expect(200);
    expect(fam.body).toHaveLength(1);

    const wrong = await ctx.http().post('/v1/quotes').set(bearer(parent.accessToken)).send({ planId, pickupPlaceId: home, dropoffPlaceId: school, promoCode: 'BETA10' }).expect(422);
    expect(wrong.body.error.code).toBe('PROMO_INVALID');
    const quote = await ctx.http().post('/v1/quotes').set(bearer(parent.accessToken)).send({ planId, pickupPlaceId: home, dropoffPlaceId: school, promoCode: ' school25 ' }).expect(200);
    expect(quote.body).toMatchObject({ promoCode: 'SCHOOL25', discountHalalas: 30000, firstPaymentHalalas: 90000 });

    const res = await ctx.http().post('/v1/subscriptions').set(bearer(parent.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: school, days: [0, 1, 2, 3, 4, 5, 6], outboundTime: '06:30', returnTime: '13:30', promoCode: 'SCHOOL25', memberId: member.body.id })
      .expect(201);
    subId = res.body.subscription.id;
    expect(res.body.subscription.member).toMatchObject({ name: 'سارة' });
    await ctx.http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
    const paid = await ctx.http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(parent.accessToken)).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', amountHalalas: 90000 });

    const promo = await ctx.db.query.promoCodes.findFirst({ where: eq(promoCodes.code, 'SCHOOL25') });
    expect(promo?.usedCount).toBe(1);
    // Single-use code is now spent.
    const spent = await ctx.http().post('/v1/quotes').set(bearer(parent.accessToken)).send({ planId, pickupPlaceId: home, dropoffPlaceId: school, promoCode: 'SCHOOL25' }).expect(422);
    expect(spent.body.error.code).toBe('PROMO_INVALID');

    const inv = await ctx.http().get('/v1/invoices').set(bearer(parent.accessToken)).expect(200);
    expect(inv.body[0].totalHalalas).toBe(90000);

    // The child's name is on the trips the driver sees.
    await ctx.http().patch(`/v1/admin/subscriptions/${subId}/driver`).set(bearer(admin.accessToken)).send({ driverId }).expect(200);
    const rows = await ctx.db.query.trips.findMany({ where: eq(trips.subscriptionId, subId) });
    expect(rows.every((t) => t.passengerName === 'سارة')).toBe(true);
    tripId = rows.find((t) => t.leg === 'outbound')!.id;
  });

  it('shares a live tracking link that shows no phone numbers and can be turned off', async () => {
    const link = await ctx.http().post(`/v1/trips/${tripId}/share`).set(bearer(parent.accessToken)).expect(200);
    expect(link.body.url).toMatch(/\/t\/[A-Za-z0-9_-]{20,}$/);
    const token = link.body.url.split('/t/')[1];
    const view = await ctx.http().get(`/v1/shared/${token}`).expect(200);
    expect(view.body).toMatchObject({ passenger: 'سارة', status: 'scheduled', driver: { name: 'سعد', plate: '7341 KHD' } });
    expect(JSON.stringify(view.body)).not.toMatch(/\+9665/);

    await ctx.http().get('/v1/shared/not-a-real-token').expect(404);
    const stranger = await signIn(ctx, newPhone(), 'rider');
    await ctx.http().post(`/v1/trips/${tripId}/share`).set(bearer(stranger.accessToken)).expect(404);

    await ctx.http().delete(`/v1/trips/${tripId}/share`).set(bearer(parent.accessToken)).expect(204);
    const gone = await ctx.http().get(`/v1/shared/${token}`).expect(404);
    expect(gone.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('takes ratings of completed trips and flags low ones to the partner', async () => {
    const early = await ctx.http().post(`/v1/trips/${tripId}/rating`).set(bearer(parent.accessToken)).send({ stars: 5 }).expect(409);
    expect(early.body.error.code).toBe('RATING_NOT_ALLOWED');
    await ctx.db.update(trips).set({ status: 'completed', serviceDate: daysFromToday(0), completedAt: new Date() }).where(eq(trips.id, tripId));

    await ctx.http().post(`/v1/trips/${tripId}/rating`).set(bearer(parent.accessToken)).send({ stars: 6 }).expect(400);
    await ctx.http().post(`/v1/trips/${tripId}/rating`).set(bearer(parent.accessToken)).send({ stars: 2, tags: ['late'], comment: 'تأخر 15 دقيقة' }).expect(200);
    const adminId = (await ctx.db.query.users.findFirst({ where: and(eq(users.partnerId, partnerId), eq(users.role, 'partner_admin')) }))!.id;
    const flag = await ctx.db.query.notifications.findFirst({ where: and(eq(notifications.userId, adminId), eq(notifications.kind, 'low_rating')) });
    expect(flag?.bodyAr).toBe('تأخر 15 دقيقة');

    // Changing your mind replaces the rating.
    await ctx.http().post(`/v1/trips/${tripId}/rating`).set(bearer(parent.accessToken)).send({ stars: 4, tags: ['safe_driving'] }).expect(200);
    const report = await ctx.http().get('/v1/admin/ratings').set(bearer(admin.accessToken)).expect(200);
    expect(report.body.items).toHaveLength(1);
    expect(report.body.drivers[0]).toMatchObject({ driverName: 'سعد محمد الغامدي', average: 4, count: 1 });
    const theirs = await ctx.http().get('/v1/admin/ratings').set(bearer(otherAdmin.accessToken)).expect(200);
    expect(theirs.body.items).toHaveLength(0);
  });

  it('routes support requests to the right partner and keeps the conversation', async () => {
    const opened = await ctx.http().post('/v1/support/tickets').set(bearer(parent.accessToken))
      .send({ category: 'trip', subject: 'تأخر السائق', message: 'السائق تأخر اليوم 15 دقيقة.', tripId })
      .expect(201);
    expect(opened.body).toMatchObject({ status: 'open', partnerId, category: 'trip' });
    expect(opened.body.messages).toHaveLength(1);
    const id = opened.body.id;

    const inbox = await ctx.http().get('/v1/admin/support/tickets').set(bearer(admin.accessToken)).expect(200);
    expect(inbox.body.map((t: { id: string }) => t.id)).toContain(id);
    expect(inbox.body[0].requester.name).toBe('أبو سارة');
    await ctx.http().get(`/v1/admin/support/tickets/${id}`).set(bearer(otherAdmin.accessToken)).expect(404);

    const answered = await ctx.http().post(`/v1/admin/support/tickets/${id}/reply`).set(bearer(admin.accessToken)).send({ body: 'نعتذر، تواصلنا مع السائق.' }).expect(201);
    expect(answered.body.status).toBe('answered');
    const note = await ctx.db.query.notifications.findFirst({ where: and(eq(notifications.userId, parent.userId), eq(notifications.kind, 'ticket_answered')) });
    expect(note).toBeTruthy();

    const mine = await ctx.http().get(`/v1/support/tickets/${id}`).set(bearer(parent.accessToken)).expect(200);
    expect(mine.body.messages.map((m: { fromStaff: boolean }) => m.fromStaff)).toEqual([false, true]);
    expect(mine.body.messages[1].authorName).toBeNull();

    const back = await ctx.http().post(`/v1/support/tickets/${id}/messages`).set(bearer(parent.accessToken)).send({ body: 'شكرا' }).expect(201);
    expect(back.body.status).toBe('open');
    await ctx.http().post(`/v1/support/tickets/${id}/close`).set(bearer(parent.accessToken)).expect(200);
    const closed = await ctx.http().post(`/v1/support/tickets/${id}/messages`).set(bearer(parent.accessToken)).send({ body: 'مرة أخرى' }).expect(409);
    expect(closed.body.error.code).toBe('TICKET_CLOSED');
  });

  it('reports revenue, trips, punctuality and ratings, and exports payments for the accountant', async () => {
    const report = await ctx.http().get('/v1/admin/analytics').set(bearer(admin.accessToken)).expect(200);
    expect(report.body.totals).toMatchObject({
      collectedHalalas: 90000,
      payments: 1,
      newSubscriptions: 1,
      activeSubscriptions: 1,
      tripsCompleted: 1,
      averageRating: 4,
    });
    expect(report.body.series.revenue).toHaveLength(30);
    expect(report.body.series.revenue.at(-1)).toEqual({ date: daysFromToday(0), value: 90000 });

    const other = await ctx.http().get('/v1/admin/analytics').set(bearer(otherAdmin.accessToken)).expect(200);
    expect(other.body.totals.collectedHalalas).toBe(0);

    const csv = await ctx.http().get('/v1/admin/payments.csv').set(bearer(admin.accessToken)).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toMatch(/INV-\d{4}-\d{6}/);
    expect(csv.text).toContain('900.00');
    expect(csv.text).toContain('300.00');
  });
});
