import { and, eq, isNull, sql } from 'drizzle-orm';
import { organizationCredits, organizationInvoices, subscriptions, trips, walletEntries } from '../src/database/schema';
import { bearer, createPartner, createStaff, createTestApp, daysFromToday, newPhone, signIn, SignedIn, TestContext } from './helpers';

const AREA = {
  type: 'Polygon',
  coordinates: [
    [
      [46.6, 24.6],
      [46.8, 24.6],
      [46.8, 24.8],
      [46.6, 24.8],
      [46.6, 24.6],
    ],
  ],
};
const PRICE = 63000;
// Five days a week, both ways: round(5 * 30 / 7) * 2 = 42 trips a period.
const TRIPS = 42;

const pathOf = (url: string) => new URL(url).pathname;
const thisMonth = () => daysFromToday(0).slice(0, 7);

/**
 * Phase 10: the organization is owed its share back when the partner misses or is late for a trip,
 * or when a member cancels at once; the credit comes off its next invoice. And it can pay online.
 */
describe('Organization credits and online payment (e2e)', () => {
  let ctx: TestContext;
  let partnerId: string;
  let admin: SignedIn;
  let planId: string;
  let fullOrg: string;
  let halfOrg: string;
  let fullAdmin: SignedIn;
  let halfAdmin: SignedIn;
  let fullSub: string;
  let halfSub: string;
  let halfRider: SignedIn;

  const http = () => ctx.http();

  async function org(nameEn: string, coverageBps: number): Promise<{ id: string; admin: SignedIn }> {
    const id = (
      await http()
        .post('/v1/admin/organizations')
        .set(bearer(admin.accessToken))
        .send({ kind: 'company', nameAr: `جهة ${nameEn}`, nameEn, legalName: `${nameEn} LLC`, coverageBps, planIds: [planId] })
        .expect(201)
    ).body.id;
    const phone = (await http().post(`/v1/admin/organizations/${id}/admins`).set(bearer(admin.accessToken)).send({ phone: newPhone(), name: 'مسؤول' }).expect(201)).body.phone;
    return { id, admin: await signIn(ctx, phone, 'admin') };
  }

  async function member(orgAdmin: SignedIn): Promise<{ rider: SignedIn; subId: string }> {
    const phone = newPhone();
    await http().post('/v1/org/members').set(bearer(orgAdmin.accessToken)).send({ phone, name: 'عضو' }).expect(201);
    const rider = await signIn(ctx, phone, 'rider');
    const place = async (label: string, lat: number) =>
      (await http().post('/v1/places').set(bearer(rider.accessToken)).send({ label, name: label, lat, lng: 46.7 }).expect(201)).body.id as string;
    const home = await place('home', 24.7);
    const work = await place('work', 24.72);
    const res = await http()
      .post('/v1/subscriptions')
      .set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: work, days: [0, 1, 2, 3, 4], outboundTime: '07:00', returnTime: '16:00', sharedRideConsent: true })
      .expect(201);
    if (res.body.payment.status !== 'paid') {
      await http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
      await http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(rider.accessToken)).expect(200);
    }
    return { rider, subId: res.body.subscription.id };
  }

  async function missedYesterday(subId: string): Promise<string> {
    const sub = (await ctx.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, subId) }))!;
    const day = daysFromToday(-1);
    const p = sql`ST_SetSRID(ST_MakePoint(46.7, 24.7), 4326)` as unknown as string;
    const [t] = await ctx.db
      .insert(trips)
      .values({ subscriptionId: subId, partnerId, riderId: sub.riderId, serviceDate: day, leg: 'outbound', scheduledAt: new Date(`${day}T07:00:00+03:00`), status: 'scheduled', pickup: p, pickupName: 'home', dropoff: p, dropoffName: 'work' })
      .returning();
    return t.id;
  }

  const compensate = async () => {
    const su = await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin');
    return (await http().post(`/v1/admin/wallet/compensate/${daysFromToday(-1)}`).set(bearer(su.accessToken)).expect(201)).body;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    partnerId = await createPartner(ctx, 'Billing');
    await ctx.db.execute(sql`UPDATE partners SET vat_number = '300000000000003', legal_name = 'شركة النقل' WHERE id = ${partnerId}`);
    admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    const zone = (await http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الوسط', nameEn: 'Central', area: AREA }).expect(201)).body.id;
    planId = (
      await http()
        .post('/v1/admin/plans')
        .set(bearer(admin.accessToken))
        .send({ zoneId: zone, nameAr: 'موظفين', nameEn: 'Staff', tripType: 'round_trip', daysPerWeek: 5, priceHalalas: PRICE, maxDistanceKm: 20 })
        .expect(201)
    ).body.id;
    ({ id: fullOrg, admin: fullAdmin } = await org('Full', 10000));
    ({ id: halfOrg, admin: halfAdmin } = await org('Half', 5000));
    fullSub = (await member(fullAdmin)).subId;
    ({ rider: halfRider, subId: halfSub } = await member(halfAdmin));
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('credits', () => {
    it('splits a missed trip between the member and the organization by who paid, once', async () => {
      const fullTrip = await missedYesterday(fullSub);
      const halfTrip = await missedYesterday(halfSub);
      const first = await compensate();
      expect(first.missed).toBe(2);
      // The member who paid nothing gets nothing; their organization gets the whole trip.
      expect(await ctx.db.select().from(walletEntries).where(eq(walletEntries.tripId, fullTrip))).toEqual([]);
      const credit = await ctx.db.select().from(organizationCredits).where(eq(organizationCredits.tripId, fullTrip));
      expect(credit).toEqual([expect.objectContaining({ organizationId: fullOrg, kind: 'compensation', amountHalalas: Math.round(PRICE / TRIPS) })]);
      // Half and half.
      const share = Math.round(PRICE / 2 / TRIPS);
      expect(await ctx.db.select().from(walletEntries).where(eq(walletEntries.tripId, halfTrip))).toEqual([expect.objectContaining({ amountHalalas: share })]);
      expect(await ctx.db.select().from(organizationCredits).where(eq(organizationCredits.tripId, halfTrip))).toEqual([
        expect.objectContaining({ organizationId: halfOrg, amountHalalas: share }),
      ]);

      const again = await compensate();
      expect(again).toMatchObject({ missed: 0, credited: 0 });
      expect(await ctx.db.select().from(organizationCredits)).toHaveLength(2);
      expect((await http().get('/v1/org').set(bearer(fullAdmin.accessToken)).expect(200)).body).toMatchObject({ openCreditHalalas: Math.round(PRICE / TRIPS), payOnline: true });
    });

    it('gives the organization its share of the trips left when a member cancels at once', async () => {
      const preview = (await http().get(`/v1/subscriptions/${halfSub}/cancel-preview`).set(bearer(halfRider.accessToken)).expect(200)).body;
      await http().post(`/v1/subscriptions/${halfSub}/cancel`).set(bearer(halfRider.accessToken)).send({ mode: 'now' }).expect(200);
      const credit = await ctx.db.select().from(organizationCredits).where(and(eq(organizationCredits.organizationId, halfOrg), eq(organizationCredits.kind, 'cancellation')));
      expect(credit).toHaveLength(1);
      expect(credit[0].amountHalalas).toBe(Math.min(PRICE / 2, preview.remainingTrips * Math.round(PRICE / 2 / TRIPS)));
      expect(credit[0].amountHalalas).toBeGreaterThan(0);
    });

    it('takes the credits off the next invoice, and keeps what does not fit for later', async () => {
      const res = await http().post(`/v1/admin/organizations/${fullOrg}/invoices`).set(bearer(admin.accessToken)).send({ month: thisMonth() }).expect(201);
      const credit = Math.round(PRICE / TRIPS);
      expect(res.body).toMatchObject({ grossHalalas: PRICE, creditHalalas: credit, totalHalalas: PRICE - credit, status: 'issued' });
      expect(res.body.vatHalalas).toBe(Math.round(((PRICE - credit) * 1500) / 11500));
      expect(res.body.credits).toEqual([expect.objectContaining({ kind: 'compensation', amountHalalas: credit })]);
      const html = await http().get(`/v1/org/invoices/${res.body.id}/html`).set(bearer(fullAdmin.accessToken)).expect(200);
      expect(html.text).toContain('خصم مستحق للجهة');
      expect((await http().get('/v1/org').set(bearer(fullAdmin.accessToken)).expect(200)).body.openCreditHalalas).toBe(0);

      // A credit bigger than the bill waits; the ones that fit are used.
      await ctx.db.insert(organizationCredits).values({ organizationId: halfOrg, partnerId, kind: 'compensation', amountHalalas: PRICE, key: 'test:big', noteAr: 'كبير', noteEn: 'Big' });
      const half = await http().post(`/v1/admin/organizations/${halfOrg}/invoices`).set(bearer(admin.accessToken)).send({ month: thisMonth() }).expect(201);
      const used = half.body.credits.reduce((a: number, c: { amountHalalas: number }) => a + c.amountHalalas, 0);
      expect(half.body).toMatchObject({ grossHalalas: PRICE / 2, creditHalalas: used, totalHalalas: PRICE / 2 - used });
      expect(half.body.credits.map((c: { kind: string }) => c.kind).sort()).toEqual(['cancellation', 'compensation']);
      const waiting = await ctx.db.select().from(organizationCredits).where(and(eq(organizationCredits.organizationId, halfOrg), isNull(organizationCredits.orgInvoiceId)));
      expect(waiting).toEqual([expect.objectContaining({ key: 'test:big' })]);
    });
  });

  describe('paying online', () => {
    const invoiceOf = async (orgId: string) => (await ctx.db.query.organizationInvoices.findFirst({ where: eq(organizationInvoices.organizationId, orgId) }))!;

    it('opens the gateway page, settles the invoice on return, and refuses a second payment', async () => {
      const inv = await invoiceOf(fullOrg);
      await http().post(`/v1/org/invoices/${inv.id}/checkout`).set(bearer(halfAdmin.accessToken)).expect(404);
      await http().post(`/v1/org/invoices/${inv.id}/checkout`).set(bearer(admin.accessToken)).expect(403);
      const co = await http().post(`/v1/org/invoices/${inv.id}/checkout`).set(bearer(fullAdmin.accessToken)).expect(201);
      expect(co.body).toMatchObject({ amountHalalas: inv.totalHalalas, checkoutUrl: expect.stringContaining('/v1/sandbox/checkout/') });
      // Asking again soon after offers the same page.
      expect((await http().post(`/v1/org/invoices/${inv.id}/checkout`).set(bearer(fullAdmin.accessToken)).expect(201)).body.paymentId).toBe(co.body.paymentId);

      const paid = await http().post(`${pathOf(co.body.checkoutUrl)}/pay`).expect(303);
      expect(paid.headers.location).toContain(`/v1/org-payments/${co.body.paymentId}/return`);
      const back = await http().get(pathOf(paid.headers.location)).expect(200);
      expect(back.text).toContain('data-status="paid"');
      expect(back.text).toContain('/org/invoices');
      expect(await invoiceOf(fullOrg)).toMatchObject({ status: 'paid', method: 'online' });
      const again = await http().post(`/v1/org/invoices/${inv.id}/checkout`).set(bearer(fullAdmin.accessToken)).expect(409);
      expect(again.body.error.code).toBe('ORG_INVOICE_PAID');
      const notes = await http().get('/v1/notifications').set(bearer(fullAdmin.accessToken)).expect(200);
      const items = notes.body.items ?? notes.body;
      expect(items.some((n: { kind: string }) => n.kind === 'organization_invoice_paid')).toBe(true);
    });

    it('leaves the invoice open after a declined card, and settles it from the webhook alone', async () => {
      const inv = await invoiceOf(halfOrg);
      const first = await http().post(`/v1/org/invoices/${inv.id}/checkout`).set(bearer(halfAdmin.accessToken)).expect(201);
      const declined = await http().post(`${pathOf(first.body.checkoutUrl)}/decline`).expect(303);
      expect((await http().get(pathOf(declined.headers.location)).expect(200)).text).toContain('data-status="failed"');
      expect((await invoiceOf(halfOrg)).status).toBe('issued');

      const second = await http().post(`/v1/org/invoices/${inv.id}/checkout`).set(bearer(halfAdmin.accessToken)).expect(201);
      expect(second.body.paymentId).not.toBe(first.body.paymentId);
      const providerId = pathOf(second.body.checkoutUrl).split('/').pop() as string;
      await http().post(`${pathOf(second.body.checkoutUrl)}/pay`).expect(303);
      // No return visit: the gateway's webhook is enough, and it is read back from the gateway.
      await http().post('/v1/webhooks/payments/sandbox').send({ id: providerId }).expect(200);
      expect(await invoiceOf(halfOrg)).toMatchObject({ status: 'paid', method: 'online', reference: providerId });
    });
  });
});
