import { and, eq, sql } from 'drizzle-orm';
import { payments, subscriptions, trips } from '../src/database/schema';
import { splitPrice } from '../src/organizations/organizations.service';
import { RenewalsService } from '../src/subscriptions/renewals.service';
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
const HOME = { lat: 24.7, lng: 46.68 };
const OFFICE = { lat: 24.72, lng: 46.7 };
const PRICE = 60000;

const pathOf = (url: string) => new URL(url).pathname;
const thisMonth = () => daysFromToday(0).slice(0, 7);

/**
 * Phase 9: companies and schools pay for their people. The partner sets the agreement up, the
 * organization's admin adds members, members subscribe in the app and pay only their share, and
 * the organization gets one tax invoice a month and an attendance report.
 */
describe('Organizations (e2e)', () => {
  let ctx: TestContext;
  let partnerId: string;
  let admin: SignedIn;
  let dispatcher: SignedIn;
  let otherAdmin: SignedIn;
  let planId: string;
  let otherPlanId: string;
  let company: string;
  let halfOrg: string;
  let orgAdmin: SignedIn;
  let orgAdminPhone: string;
  const memberPhone = newPhone();
  const halfPhone = newPhone();
  let member: SignedIn;
  let fullSubId: string;

  const http = () => ctx.http();

  async function riderWithPlaces(phone: string): Promise<{ rider: SignedIn; home: string; office: string }> {
    const rider = await signIn(ctx, phone, 'rider');
    const place = async (label: string, p: { lat: number; lng: number }) =>
      (await http().post('/v1/places').set(bearer(rider.accessToken)).send({ label, name: label, ...p }).expect(201)).body.id as string;
    return { rider, home: await place('home', HOME), office: await place('work', OFFICE) };
  }

  const subscribe = (rider: SignedIn, home: string, office: string) =>
    http()
      .post('/v1/subscriptions')
      .set(bearer(rider.accessToken))
      .send({ planId, pickupPlaceId: home, dropoffPlaceId: office, days: [0, 1, 2, 3, 4], outboundTime: '07:00', returnTime: '16:00', sharedRideConsent: true })
      .expect(201);

  beforeAll(async () => {
    ctx = await createTestApp();
    partnerId = await createPartner(ctx, 'Fleet');
    const other = await createPartner(ctx, 'Elsewhere');
    await ctx.db.execute(sql`UPDATE partners SET vat_number = '300000000000003', legal_name = 'شركة الأسطول', commission_bps = 1000 WHERE id = ${partnerId}`);
    admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    dispatcher = await signIn(ctx, (await createStaff(ctx, 'dispatcher', partnerId)).phone, 'admin');
    otherAdmin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', other)).phone, 'admin');
    const zone = (await http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الشمال', nameEn: 'North', area: AREA }).expect(201)).body.id;
    planId = (
      await http()
        .post('/v1/admin/plans')
        .set(bearer(admin.accessToken))
        .send({ zoneId: zone, nameAr: 'موظفين', nameEn: 'Staff', tripType: 'round_trip', daysPerWeek: 5, priceHalalas: PRICE, maxDistanceKm: 20 })
        .expect(201)
    ).body.id;
    const otherZone = (await http().post('/v1/admin/zones').set(bearer(otherAdmin.accessToken)).send({ nameAr: 'الجنوب', nameEn: 'South', area: AREA }).expect(201)).body.id;
    otherPlanId = (
      await http()
        .post('/v1/admin/plans')
        .set(bearer(otherAdmin.accessToken))
        .send({ zoneId: otherZone, nameAr: 'باقة أخرى', nameEn: 'Other plan', tripType: 'one_way', daysPerWeek: 5, priceHalalas: 30000, maxDistanceKm: 20 })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('splits a price, leaving the member nothing below the gateway minimum', () => {
    expect(splitPrice(60000, 10000)).toEqual({ org: 60000, member: 0 });
    expect(splitPrice(60000, 5000)).toEqual({ org: 30000, member: 30000 });
    expect(splitPrice(60000, 9990)).toEqual({ org: 60000, member: 0 });
    expect(splitPrice(60000, 0)).toEqual({ org: 0, member: 60000 });
  });

  describe('the partner sets up the agreement', () => {
    it('creates an organization on its own plans only', async () => {
      const base = { kind: 'company', nameAr: 'شركة النخبة', nameEn: 'Elite Co', legalName: 'شركة النخبة المحدودة', vatNumber: '310000000000003', crNumber: '1010101010', coverageBps: 10000 };
      const bad = await http().post('/v1/admin/organizations').set(bearer(admin.accessToken)).send({ ...base, planIds: [otherPlanId] }).expect(400);
      expect(bad.body.error.code).toBe('ORG_PLAN_INVALID');
      await http().post('/v1/admin/organizations').set(bearer(dispatcher.accessToken)).send({ ...base, planIds: [planId] }).expect(403);
      const res = await http().post('/v1/admin/organizations').set(bearer(admin.accessToken)).send({ ...base, planIds: [planId] }).expect(201);
      company = res.body.id;
      expect(res.body).toMatchObject({ kind: 'company', coverageBps: 10000, members: 0, seats: 0, status: 'active' });
      halfOrg = (
        await http()
          .post('/v1/admin/organizations')
          .set(bearer(admin.accessToken))
          .send({ ...base, nameAr: 'مدرسة الرواد', nameEn: 'Pioneers School', kind: 'school', coverageBps: 5000, planIds: [planId], vatNumber: undefined })
          .expect(201)
      ).body.id;
      await http().get(`/v1/admin/organizations/${company}`).set(bearer(otherAdmin.accessToken)).expect(404);
      expect((await http().get('/v1/admin/organizations').set(bearer(dispatcher.accessToken)).expect(200)).body).toHaveLength(2);
    });

    it('gives the organization its own dashboard account, walled off from the partner', async () => {
      orgAdminPhone = newPhone();
      await http().post(`/v1/admin/organizations/${company}/admins`).set(bearer(admin.accessToken)).send({ phone: orgAdminPhone, name: 'الموارد البشرية' }).expect(201);
      const taken = await http().post(`/v1/admin/organizations/${halfOrg}/admins`).set(bearer(admin.accessToken)).send({ phone: orgAdminPhone, name: 'مكرر' }).expect(409);
      expect(taken.body.error.code).toBe('USER_ALREADY_EXISTS');
      orgAdmin = await signIn(ctx, orgAdminPhone, 'admin');
      expect((orgAdmin.body.user as { role: string }).role).toBe('org_admin');
      const me = await http().get('/v1/me').set(bearer(orgAdmin.accessToken)).expect(200);
      expect(me.body).toMatchObject({ role: 'org_admin', organizationId: company, partnerId: null });

      const profile = await http().get('/v1/org').set(bearer(orgAdmin.accessToken)).expect(200);
      expect(profile.body).toMatchObject({ nameAr: 'شركة النخبة', coverageBps: 10000 });
      expect(profile.body.plans).toEqual([expect.objectContaining({ id: planId, orgHalalas: PRICE, memberHalalas: 0 })]);

      for (const path of ['/v1/admin/organizations', '/v1/admin/subscriptions', '/v1/admin/users', '/v1/admin/plans', '/v1/admin/drivers', '/v1/admin/runs?date=2026-01-01']) {
        const res = await http().get(path).set(bearer(orgAdmin.accessToken));
        expect([403, 404]).toContain(res.status);
      }
      await http().get('/v1/org').set(bearer(admin.accessToken)).expect(403);
    });
  });

  describe('members', () => {
    it('adds members one by one or pasted in bulk, once per partner', async () => {
      const one = await http().post('/v1/org/members').set(bearer(orgAdmin.accessToken)).send({ phone: memberPhone, name: 'سارة', reference: 'E-1' }).expect(201);
      expect(one.body).toMatchObject({ name: 'سارة', joined: false, subscriptionStatus: null });
      const bulk = await http()
        .post('/v1/org/members/bulk')
        .set(bearer(orgAdmin.accessToken))
        .send({
          members: [
            { phone: memberPhone, name: 'سارة' },
            { phone: '0512', name: 'رقم ناقص' },
            { phone: newPhone(), name: 'خالد', reference: '=cmd' },
            { phone: newPhone(), name: 'منى' },
          ],
        })
        .expect(200);
      expect(bulk.body).toMatchObject({ added: 2, existing: 1, errors: [{ row: 2, code: 'AUTH_PHONE_INVALID' }] });

      const schoolAdminPhone = (await http().post(`/v1/admin/organizations/${halfOrg}/admins`).set(bearer(admin.accessToken)).send({ phone: newPhone(), name: 'وكيل' }).expect(201)).body.phone;
      const schoolAdmin = await signIn(ctx, schoolAdminPhone, 'admin');
      const elsewhere = await http().post('/v1/org/members').set(bearer(schoolAdmin.accessToken)).send({ phone: memberPhone, name: 'سارة' }).expect(409);
      expect(elsewhere.body.error.code).toBe('ORG_MEMBER_ELSEWHERE');
      await http().post('/v1/org/members').set(bearer(schoolAdmin.accessToken)).send({ phone: halfPhone, name: 'ولي أمر ريم', reference: 'الصف الرابع' }).expect(201);

      const found = await http().get('/v1/org/members').query({ q: 'خال' }).set(bearer(orgAdmin.accessToken)).expect(200);
      expect(found.body.map((m: { name: string }) => m.name)).toEqual(['خالد']);
      expect((await http().get(`/v1/admin/organizations/${company}/members`).set(bearer(dispatcher.accessToken)).expect(200)).body).toHaveLength(3);
    });
  });

  describe('members subscribe and pay only their share', () => {
    it('activates a fully paid subscription without a payment page or a rider invoice', async () => {
      const { rider, home, office } = await riderWithPlaces(memberPhone);
      member = rider;
      const quote = await http().post('/v1/quotes').set(bearer(rider.accessToken)).send({ planId, pickupPlaceId: home, dropoffPlaceId: office }).expect(200);
      expect(quote.body).toMatchObject({ eligible: true, firstPaymentHalalas: 0, sponsor: { organizationId: company, nameAr: 'شركة النخبة', coverageBps: 10000, orgHalalas: PRICE } });

      const res = await subscribe(rider, home, office);
      expect(res.body.payment).toMatchObject({ status: 'paid', checkoutUrl: null });
      fullSubId = res.body.subscription.id;
      const sub = await http().get(`/v1/subscriptions/${fullSubId}`).set(bearer(rider.accessToken)).expect(200);
      expect(sub.body).toMatchObject({ status: 'active', sponsor: { nameAr: 'شركة النخبة' } });
      const pay = await ctx.db.query.payments.findFirst({ where: eq(payments.subscriptionId, fullSubId) });
      expect(pay).toMatchObject({ amountHalalas: 0, orgHalalas: PRICE, organizationId: company, method: 'organization', platformFeeHalalas: 0 });
      expect((await http().get('/v1/invoices').set(bearer(rider.accessToken)).expect(200)).body).toEqual([]);

      const list = await http().get('/v1/org/members').set(bearer(orgAdmin.accessToken)).expect(200);
      expect(list.body.find((m: { phone: string }) => m.phone === memberPhone)).toMatchObject({ joined: true, subscriptionStatus: 'active', planNameAr: 'موظفين' });
      expect((await http().get('/v1/org').set(bearer(orgAdmin.accessToken)).expect(200)).body.seats).toBe(1);
    });

    it('charges a member of a half-paying school half, and anyone else the full price', async () => {
      const { rider, home, office } = await riderWithPlaces(halfPhone);
      const res = await subscribe(rider, home, office);
      expect(res.body.payment.status).toBe('initiated');
      await http().post(`${pathOf(res.body.payment.checkoutUrl)}/pay`).expect(303);
      const paid = await http().get(`/v1/payments/${res.body.payment.id}`).set(bearer(rider.accessToken)).expect(200);
      expect(paid.body).toMatchObject({ status: 'paid', amountHalalas: PRICE / 2 });
      const row = await ctx.db.query.payments.findFirst({ where: eq(payments.id, res.body.payment.id) });
      expect(row).toMatchObject({ orgHalalas: PRICE / 2, organizationId: halfOrg, platformFeeHalalas: 3000 });
      const sub = await ctx.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, res.body.subscription.id) });
      expect(sub).toMatchObject({ organizationId: halfOrg, orgShareBps: 5000 });
      // Cancelling now gives back the rider's own half only; the school's half is not theirs.
      const preview = await http().get(`/v1/subscriptions/${sub!.id}/cancel-preview`).set(bearer(rider.accessToken)).expect(200);
      expect(preview.body.creditHalalas).toBeGreaterThan(0);
      expect(preview.body.creditHalalas).toBeLessThanOrEqual(PRICE / 2);

      const stranger = await riderWithPlaces(newPhone());
      const q = await http().post('/v1/quotes').set(bearer(stranger.rider.accessToken)).send({ planId, pickupPlaceId: stranger.home, dropoffPlaceId: stranger.office }).expect(200);
      expect(q.body).toMatchObject({ sponsor: null, firstPaymentHalalas: PRICE });
    });
  });

  describe('attendance', () => {
    it('counts rides, absences and the partner’s misses per member, and exports every trip', async () => {
      const yesterday = daysFromToday(-1);
      const at = (h: number, m = 0) => new Date(`${yesterday}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
      const p = sql`ST_SetSRID(ST_MakePoint(46.68, 24.7), 4326)` as unknown as string;
      const base = { subscriptionId: fullSubId, partnerId, riderId: member.userId, serviceDate: yesterday, pickup: p, pickupName: 'home', dropoff: p, dropoffName: 'work' };
      await ctx.db.insert(trips).values([
        { ...base, leg: 'outbound' as const, scheduledAt: at(7), status: 'completed' as const, arrivedAt: at(7, 25), pickedUpAt: at(7, 27), completedAt: at(7, 50) },
        { ...base, leg: 'return' as const, scheduledAt: at(16), status: 'scheduled' as const },
      ]);
      const two = daysFromToday(-2);
      await ctx.db.insert(trips).values([
        { ...base, serviceDate: two, leg: 'outbound' as const, scheduledAt: new Date(`${two}T07:00:00+03:00`), status: 'no_show' as const },
        { ...base, serviceDate: two, leg: 'return' as const, scheduledAt: new Date(`${two}T16:00:00+03:00`), status: 'skipped' as const },
      ]);
      const res = await http().get('/v1/org/attendance').query({ from: two, to: yesterday }).set(bearer(orgAdmin.accessToken)).expect(200);
      expect(res.body.rows).toEqual([expect.objectContaining({ name: 'سارة', reference: 'E-1', planned: 4, rode: 1, late: 1, missed: 1, noShow: 1, excused: 1 })]);
      expect(res.body.totals).toMatchObject({ planned: 4, rode: 1 });

      const csv = await http().get('/v1/org/attendance.csv').query({ from: two, to: yesterday }).set(bearer(orgAdmin.accessToken)).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text).toContain('"لم يحضر السائق"');
      expect(csv.text).toContain('"25"');
      expect(csv.text.trim().split('\r\n')).toHaveLength(5);

      const tooLong = await http().get('/v1/org/attendance').query({ from: '2026-01-01', to: '2026-12-31' }).set(bearer(orgAdmin.accessToken)).expect(400);
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('one invoice a month', () => {
    let invoiceId: string;

    it('bills the organization its share once, as a tax invoice to it by name and VAT number', async () => {
      await http().post(`/v1/admin/organizations/${company}/invoices`).set(bearer(otherAdmin.accessToken)).send({ month: thisMonth() }).expect(404);
      const res = await http().post(`/v1/admin/organizations/${company}/invoices`).set(bearer(admin.accessToken)).send({ month: thisMonth() }).expect(201);
      invoiceId = res.body.id;
      expect(res.body).toMatchObject({ lines: 1, totalHalalas: PRICE, status: 'issued', overdue: false, number: expect.stringMatching(/^ORG-\d{4}-\d{5}$/) });
      expect(res.body.vatHalalas).toBe(Math.round((PRICE * 1500) / 11500));
      expect(res.body.items).toEqual([expect.objectContaining({ memberName: 'سارة', reference: 'E-1', amountHalalas: PRICE })]);
      // Asking again gives the same invoice; nothing is billed twice.
      expect((await http().post(`/v1/admin/organizations/${company}/invoices`).set(bearer(admin.accessToken)).send({ month: thisMonth() }).expect(201)).body.id).toBe(invoiceId);

      const html = await http().get(`/v1/org/invoices/${invoiceId}/html`).set(bearer(orgAdmin.accessToken)).expect(200);
      expect(html.text).toContain('فاتورة ضريبية');
      expect(html.text).toContain('310000000000003');
      expect(html.text).toContain('شركة النخبة المحدودة');
      expect((await http().get('/v1/org/invoices').set(bearer(orgAdmin.accessToken)).expect(200)).body).toHaveLength(1);
      expect((await http().get('/v1/org').set(bearer(orgAdmin.accessToken)).expect(200)).body.unpaidHalalas).toBe(PRICE);
    });

    it('records the transfer once', async () => {
      await http().post(`/v1/admin/organization-invoices/${invoiceId}/pay`).set(bearer(dispatcher.accessToken)).send({ method: 'bank_transfer' }).expect(403);
      const paid = await http().post(`/v1/admin/organization-invoices/${invoiceId}/pay`).set(bearer(admin.accessToken)).send({ method: 'bank_transfer', reference: 'TRX-1' }).expect(200);
      expect(paid.body).toMatchObject({ status: 'paid', reference: 'TRX-1' });
      const again = await http().post(`/v1/admin/organization-invoices/${invoiceId}/pay`).set(bearer(admin.accessToken)).send({ method: 'cash' }).expect(409);
      expect(again.body.error.code).toBe('ORG_INVOICE_PAID');
    });

    it('runs monthly for everyone with something new, and only that', async () => {
      const su = await superToken();
      const r = await http().post(`/v1/admin/organization-invoices/run/${thisMonth()}`).set(bearer(su)).expect(201);
      expect(r.body).toEqual({ issued: 1 });
      const school = await http().get(`/v1/admin/organizations/${halfOrg}/invoices`).set(bearer(admin.accessToken)).expect(200);
      expect(school.body).toEqual([expect.objectContaining({ totalHalalas: PRICE / 2, lines: 1, vatHalalas: Math.round((PRICE / 2) * 1500 / 11500) })]);
      expect((await http().post(`/v1/admin/organization-invoices/run/${thisMonth()}`).set(bearer(su)).expect(201)).body).toEqual({ issued: 0 });
    });
  });

  describe('renewals', () => {
    it('renews a fully paid member without a card, and stops paying once the member is removed', async () => {
      const renewals = ctx.app.get(RenewalsService);
      await ctx.db.update(subscriptions).set({ currentPeriodEnd: daysFromToday(0) }).where(eq(subscriptions.id, fullSubId));
      const r = await renewals.run();
      expect(r.renewed).toBeGreaterThanOrEqual(1);
      const renewal = await ctx.db.query.payments.findFirst({ where: and(eq(payments.subscriptionId, fullSubId), eq(payments.purpose, 'renewal')) });
      expect(renewal).toMatchObject({ status: 'paid', amountHalalas: 0, orgHalalas: PRICE, periodStart: daysFromToday(1) });
      const sub = await ctx.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, fullSubId) });
      expect(sub?.status).toBe('active');

      const m = (await http().get('/v1/org/members').set(bearer(orgAdmin.accessToken)).expect(200)).body.find((x: { phone: string }) => x.phone === memberPhone);
      await http().delete(`/v1/org/members/${m.id}`).set(bearer(orgAdmin.accessToken)).expect(204);
      await http().delete(`/v1/org/members/${m.id}`).set(bearer(orgAdmin.accessToken)).expect(404);
      const end = sub!.currentPeriodEnd as string;
      const r2 = await renewals.run(new Date(`${end}T09:00:00+03:00`));
      expect(r2.linksSent).toBeGreaterThanOrEqual(1);
      const link = await ctx.db.query.payments.findFirst({
        where: and(eq(payments.subscriptionId, fullSubId), eq(payments.status, 'initiated')),
      });
      expect(link).toMatchObject({ amountHalalas: PRICE, orgHalalas: 0, organizationId: null });
      const notes = await http().get('/v1/notifications').set(bearer(member.accessToken)).expect(200);
      const items = notes.body.items ?? notes.body;
      expect(items.some((n: { kind: string }) => n.kind === 'organization_member_removed')).toBe(true);
    });
  });

  let superCache: string | null = null;
  async function superToken(): Promise<string> {
    if (!superCache) superCache = (await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin')).accessToken;
    return superCache;
  }
});
