import { eq } from 'drizzle-orm';
import { decodeZatcaQr } from '../src/payments/zatca';
import { invoices, partners, paymentMethods, subscriptions } from '../src/database/schema';
import { RenewalsService } from '../src/subscriptions/renewals.service';
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

describe('Places, quotes, subscriptions and payments (e2e, sandbox gateway)', () => {
  let ctx: TestContext;
  let partnerId: string;
  let admin: SignedIn;
  let superAdmin: SignedIn;
  let rider: SignedIn;
  let other: SignedIn;
  let planId: string;
  let home: string;
  let school: string;
  let far: string;

  const pathOf = (url: string) => new URL(url).pathname;

  beforeAll(async () => {
    ctx = await createTestApp();
    partnerId = await createPartner(ctx, 'Alpha');
    await ctx.db.update(partners).set({ vatNumber: '310123456700003', legalName: 'Alpha Transport Co.' }).where(eq(partners.id, partnerId));
    admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    superAdmin = await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin');
    rider = await signIn(ctx, newPhone(), 'rider');
    other = await signIn(ctx, newPhone(), 'rider');

    const zone = await ctx.http().post('/v1/admin/zones').set(bearer(admin.accessToken))
      .send({ nameAr: 'حي الرمال', nameEn: 'Al Rimal', area: RIMAL }).expect(201);
    const plan = await ctx.http().post('/v1/admin/plans').set(bearer(admin.accessToken))
      .send({ zoneId: zone.body.id, nameAr: 'ذهاب وعودة', nameEn: 'Round trip', tripType: 'round_trip', daysPerWeek: 5, priceHalalas: 115000, maxDistanceKm: 5 })
      .expect(201);
    planId = plan.body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('saves the rider’s places and keeps them private', async () => {
    const add = (label: string, name: string, lat: number, lng: number) =>
      ctx.http().post('/v1/places').set(bearer(rider.accessToken)).send({ label, name, lat, lng }).expect(201);
    home = (await add('home', 'البيت', 24.8675, 46.8275)).body.id;
    school = (await add('school', 'المدرسة', 24.872, 46.831)).body.id;
    far = (await add('other', 'بعيد', 24.95, 46.9)).body.id;

    const list = await ctx.http().get('/v1/places').set(bearer(rider.accessToken)).expect(200);
    expect(list.body).toHaveLength(3);
    expect(list.body.find((p: { id: string }) => p.id === home)).toMatchObject({ label: 'home', lat: 24.8675, lng: 46.8275 });

    const theirs = await ctx.http().get('/v1/places').set(bearer(other.accessToken)).expect(200);
    expect(theirs.body).toEqual([]);
    await ctx.http().post('/v1/quotes').set(bearer(other.accessToken)).send({ planId, pickupPlaceId: home, dropoffPlaceId: school }).expect(404);
  });

  it('quotes a plan: price with VAT, eligibility by zone and distance', async () => {
    const ok = await ctx.http().post('/v1/quotes').set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: school }).expect(200);
    expect(ok.body).toMatchObject({ eligible: true, reason: null, priceHalalas: 115000, vatHalalas: 15000, distanceKm: 1 });

    const outside = await ctx.http().post('/v1/quotes').set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: far, dropoffPlaceId: school }).expect(200);
    expect(outside.body).toMatchObject({ eligible: false, reason: 'PLACE_OUTSIDE_ZONE' });

    const tooFar = await ctx.http().post('/v1/quotes').set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: far }).expect(200);
    expect(tooFar.body).toMatchObject({ eligible: false, reason: 'PLAN_DISTANCE_EXCEEDED' });

    const refused = await ctx.http().post('/v1/subscriptions').set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: far, days: [0, 1, 2, 3, 4], outboundTime: '06:30', returnTime: '13:30' })
      .expect(422);
    expect(refused.body.error.code).toBe('PLAN_DISTANCE_EXCEEDED');
  });

  it('checks the weekly schedule against the plan', async () => {
    const base = { planId, pickupPlaceId: home, dropoffPlaceId: school, outboundTime: '06:30', returnTime: '13:30' };
    const wrongDays = await ctx.http().post('/v1/subscriptions').set(bearer(rider.accessToken)).send({ ...base, days: [0, 1, 2] });
    expect(wrongDays.body.error.code).toBe('SUBSCRIPTION_SCHEDULE_INVALID');
    const noReturn = await ctx.http().post('/v1/subscriptions').set(bearer(rider.accessToken))
      .send({ ...base, returnTime: undefined, days: [0, 1, 2, 3, 4] });
    expect(noReturn.body.error.code).toBe('SUBSCRIPTION_SCHEDULE_INVALID');
    await ctx.http().post('/v1/subscriptions').set(bearer(rider.accessToken)).send({ ...base, days: [0, 1, 2, 3, 9] }).expect(400);
  });

  let subId: string;

  it('subscribes, pays on the hosted page, saves the card and issues a tax invoice', async () => {
    const res = await ctx.http().post('/v1/subscriptions').set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: school, days: [4, 0, 1, 2, 3], outboundTime: '06:30', returnTime: '13:30' })
      .expect(201);
    subId = res.body.subscription.id;
    expect(res.body.subscription).toMatchObject({ status: 'pending_payment', days: [0, 1, 2, 3, 4], priceHalalas: 115000 });
    expect(res.body.payment.checkoutUrl).toMatch(/\/v1\/sandbox\/checkout\/sbx_/);
    const paymentId = res.body.payment.id;

    // Not paid yet.
    const pending = await ctx.http().get(`/v1/payments/${paymentId}`).set(bearer(rider.accessToken)).expect(200);
    expect(pending.body.status).toBe('initiated');

    // The rider opens the payment page and pays.
    const page = await ctx.http().get(pathOf(res.body.payment.checkoutUrl)).expect(200);
    expect(page.text).toContain('1150.00 SAR');
    const done = await ctx.http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
    expect(pathOf(done.headers.location)).toBe(`/v1/payments/${paymentId}/return`);
    const back = await ctx.http().get(pathOf(done.headers.location)).expect(200);
    expect(back.text).toContain('data-status="paid"');

    const paid = await ctx.http().get(`/v1/payments/${paymentId}`).set(bearer(rider.accessToken)).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', amountHalalas: 115000 });
    expect(paid.body.invoiceId).toBeTruthy();

    const sub = await ctx.http().get(`/v1/subscriptions/${subId}`).set(bearer(rider.accessToken)).expect(200);
    expect(sub.body).toMatchObject({ status: 'active', currentPeriodStart: daysFromToday(1), autoRenew: true });
    expect(sub.body.card).toMatchObject({ brand: 'MADA', last4: '4242' });
    expect(sub.body.currentPeriodEnd > sub.body.currentPeriodStart).toBe(true);

    const cards = await ctx.http().get('/v1/payment-methods').set(bearer(rider.accessToken)).expect(200);
    expect(cards.body).toHaveLength(1);

    const inv = await ctx.http().get('/v1/invoices').set(bearer(rider.accessToken)).expect(200);
    expect(inv.body).toHaveLength(1);
    expect(inv.body[0]).toMatchObject({
      kind: 'simplified_tax_invoice',
      totalHalalas: 115000,
      vatHalalas: 15000,
      sellerVatNumber: '310123456700003',
    });
    expect(inv.body[0].number).toMatch(/^INV-\d{4}-\d{6}$/);
    const row = await ctx.db.query.invoices.findFirst({ where: eq(invoices.id, inv.body[0].id) });
    const tlv = decodeZatcaQr(row!.qrTlv as string);
    expect(tlv[0]).toBe('Alpha Transport Co.');
    expect(tlv[1]).toBe('310123456700003');
    expect(tlv.slice(3)).toEqual(['1150.00', '150.00']);

    // Printable invoice: rider and partner staff yes, another rider no.
    const html = await ctx.http().get(`/v1/invoices/${inv.body[0].id}`).set(bearer(rider.accessToken)).expect(200);
    expect(html.text).toContain(inv.body[0].number);
    await ctx.http().get(`/v1/invoices/${inv.body[0].id}`).set(bearer(admin.accessToken)).expect(200);
    await ctx.http().get(`/v1/invoices/${inv.body[0].id}`).set(bearer(other.accessToken)).expect(404);

    // Paying twice is harmless: the page refuses a second sync from changing anything.
    await ctx.http().get(pathOf(done.headers.location)).expect(200);
    const again = await ctx.http().get('/v1/invoices').set(bearer(rider.accessToken)).expect(200);
    expect(again.body).toHaveLength(1);
  });

  it('pauses and resumes, extending and restoring the period', async () => {
    const before = (await ctx.http().get(`/v1/subscriptions/${subId}`).set(bearer(rider.accessToken))).body.currentPeriodEnd;
    const paused = await ctx.http().post(`/v1/subscriptions/${subId}/pause`).set(bearer(rider.accessToken))
      .send({ from: daysFromToday(3), until: daysFromToday(7) }).expect(200);
    expect(paused.body.pausedFrom).toBe(daysFromToday(3));
    expect(paused.body.currentPeriodEnd > before).toBe(true);

    const second = await ctx.http().post(`/v1/subscriptions/${subId}/pause`).set(bearer(rider.accessToken))
      .send({ from: daysFromToday(10), until: daysFromToday(11) }).expect(400);
    expect(second.body.error.code).toBe('PAUSE_INVALID');

    const resumed = await ctx.http().post(`/v1/subscriptions/${subId}/resume`).set(bearer(rider.accessToken)).expect(200);
    expect(resumed.body).toMatchObject({ pausedFrom: null, pausedUntil: null, currentPeriodEnd: before });

    const tooLong = await ctx.http().post(`/v1/subscriptions/${subId}/pause`).set(bearer(rider.accessToken))
      .send({ from: daysFromToday(2), until: daysFromToday(40) }).expect(400);
    expect(tooLong.body.error.code).toBe('PAUSE_INVALID');
  });

  it('cancels at period end and can be kept', async () => {
    const cancelled = await ctx.http().post(`/v1/subscriptions/${subId}/cancel`).set(bearer(rider.accessToken)).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, autoRenew: false });
    const kept = await ctx.http().post(`/v1/subscriptions/${subId}/keep`).set(bearer(rider.accessToken)).expect(200);
    expect(kept.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, autoRenew: true });
  });

  it('renews with the saved card, falls back to a payment link, and expires after the grace days', async () => {
    const renewals = ctx.app.get(RenewalsService);
    const today = daysFromToday(0);

    // Last day of the period: the saved card is charged for the next month.
    await ctx.db.update(subscriptions).set({ currentPeriodEnd: today }).where(eq(subscriptions.id, subId));
    const r1 = await renewals.run();
    expect(r1).toMatchObject({ renewed: 1, failed: 0 });
    const renewed = await ctx.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, subId) });
    expect(renewed).toMatchObject({ status: 'active', currentPeriodStart: daysFromToday(1) });
    // Running again the same day does nothing.
    expect(await renewals.run()).toMatchObject({ renewed: 0, failed: 0, linksSent: 0 });

    // Next month, with a declined card: past due with a payment link, service continues.
    const end = renewed!.currentPeriodEnd as string;
    const atEnd = new Date(`${end}T09:00:00+03:00`);
    await ctx.db.update(paymentMethods).set({ last4: '0002' }).where(eq(paymentMethods.riderId, rider.userId));
    const r2 = await renewals.run(atEnd);
    expect(r2).toMatchObject({ renewed: 0, failed: 1, linksSent: 1 });
    const due = await ctx.http().get(`/v1/subscriptions/${subId}`).set(bearer(rider.accessToken)).expect(200);
    expect(due.body.status).toBe('past_due');
    expect(due.body.payUrl).toMatch(/sandbox\/checkout/);
    // Same day again: no second charge attempt, no duplicate notification.
    expect(await renewals.run(atEnd)).toMatchObject({ renewed: 0, linksSent: 0 });

    const notes = await ctx.http().get('/v1/notifications').set(bearer(rider.accessToken)).expect(200);
    const items = notes.body.items ?? notes.body;
    expect(items.some((n: { kind: string }) => n.kind === 'renewal_due')).toBe(true);

    // The rider pays the link: active again, the new period starts the day after the old one.
    await ctx.http().post(`${pathOf(due.body.payUrl)}/pay`).expect(303);
    await ctx.http().get(`/v1/payments/${due.body.pendingPaymentId}`).set(bearer(rider.accessToken)).expect(200);
    const back = await ctx.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, subId) });
    expect(back).toMatchObject({ status: 'active' });
    expect(back!.currentPeriodStart! > end).toBe(true);

    // Declined again and never paid: expired after the grace days.
    await ctx.db.update(subscriptions).set({ currentPeriodEnd: daysFromToday(-4), status: 'past_due' }).where(eq(subscriptions.id, subId));
    const r3 = await renewals.run();
    expect(r3.expired).toBe(1);
    const ended = await ctx.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, subId) });
    expect(ended?.status).toBe('expired');
  });

  it('shows partners their subscriptions and payments with the commission split', async () => {
    const subs = await ctx.http().get('/v1/admin/subscriptions').set(bearer(admin.accessToken)).expect(200);
    expect(subs.body.total).toBe(1);
    const pays = await ctx.http().get('/v1/admin/payments').set(bearer(admin.accessToken)).query({ status: 'paid' }).expect(200);
    expect(pays.body.totals.paidCount).toBe(3);
    expect(pays.body.totals.collectedHalalas).toBe(3 * 115000);
    expect(pays.body.totals.platformFeeHalalas + pays.body.totals.partnerShareHalalas).toBe(3 * 115000);

    const all = await ctx.http().get('/v1/admin/payments').set(bearer(superAdmin.accessToken)).expect(200);
    expect(all.body.total).toBeGreaterThanOrEqual(4);

    await ctx.http().get('/v1/admin/payments').set(bearer(rider.accessToken)).expect(403);
  });

  it('accepts webhooks without trusting them', async () => {
    await ctx.http().post('/v1/webhooks/payments/tap').send({ id: 'chg_fake' }).expect(200);
    await ctx.http().post('/v1/webhooks/payments/sandbox').send({ id: 'sbx_unknown' }).expect(200);
    const pays = await ctx.http().get('/v1/admin/payments').set(bearer(admin.accessToken)).query({ status: 'paid' }).expect(200);
    expect(pays.body.totals.paidCount).toBe(3);
  });

  it('abandons an unpaid subscription by cancelling it', async () => {
    const res = await ctx.http().post('/v1/subscriptions').set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: school, days: [0, 1, 2, 3, 4], outboundTime: '07:00', returnTime: '14:00', saveCard: false })
      .expect(201);
    await ctx.http().post(`${pathOf(res.body.payment.checkoutUrl)}/decline`).expect(303);
    const failed = await ctx.http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(rider.accessToken)).expect(200);
    expect(failed.body.status).toBe('failed');
    const retry = await ctx.http().post(`/v1/subscriptions/${res.body.subscription.id}/pay`).set(bearer(rider.accessToken)).expect(200);
    expect(retry.body.checkoutUrl).toMatch(/sandbox\/checkout/);
    const cancelled = await ctx.http().post(`/v1/subscriptions/${res.body.subscription.id}/cancel`).set(bearer(rider.accessToken)).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
  });
});
