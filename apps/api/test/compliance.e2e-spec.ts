import { and, eq, sql } from 'drizzle-orm';
import { documents, driverProfiles, notifications, partnerLicenses, partners, subscriptions, trips, users, vehicles } from '../src/database/schema';
import { ComplianceService } from '../src/drivers/compliance.service';
import {
  bearer,
  createPartner,
  createStaff,
  createTestApp,
  daysFromToday,
  newPhone,
  qualifyDriver,
  signIn,
  SignedIn,
  TestContext,
} from './helpers';

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

/**
 * Phase 6: the rules of each regulated activity. Education plans sell only under a verified
 * education transport licence and an accepted guardian contract; every subscription records the
 * rider's consent to share the car; women-only riders share only with women; a driver serves a
 * class only when their age, papers and car meet its rules; education trips end with the
 * vehicle-empty check; and the authority's data can be exported for a period.
 */
describe('Regulatory compliance (e2e)', () => {
  let ctx: TestContext;
  let partnerId: string;
  let otherPartner: string;
  let admin: SignedIn;
  let dispatcher: SignedIn;
  let otherAdmin: SignedIn;
  let superAdmin: SignedIn;
  let zoneId: string;
  let commutePlan: string;
  let educationPlan: string;
  let escortPlan: string;
  let womenPlan: string;

  const http = () => ctx.http();
  const licence = (partner: string, cls: string) => `/v1/admin/partners/${partner}/licenses/${cls}`;
  const plan = (body: Record<string, unknown>) =>
    http()
      .post('/v1/admin/plans')
      .set(bearer(admin.accessToken))
      .send({ zoneId, tripType: 'round_trip', daysPerWeek: 5, maxDistanceKm: 5, nameAr: 'باقة', nameEn: 'Plan', ...body });

  // One parent account rides for several people, so the suite stays under the sign-in rate limit.
  let parent: { rider: SignedIn; home: string; school: string } | undefined;
  async function riderWithPlaces(): Promise<{ rider: SignedIn; home: string; school: string }> {
    if (parent) return parent;
    const rider = await signIn(ctx, newPhone(), 'rider');
    const add = (label: string, name: string, lat: number, lng: number) =>
      http().post('/v1/places').set(bearer(rider.accessToken)).send({ label, name, lat, lng }).expect(201);
    const home = (await add('home', 'البيت', 24.8675, 46.8275)).body.id;
    const school = (await add('school', 'المدرسة', 24.872, 46.831)).body.id;
    parent = { rider, home, school };
    return parent;
  }

  async function member(gender: 'male' | 'female' | null): Promise<string> {
    const { rider } = await riderWithPlaces();
    const res = await http()
      .post('/v1/family')
      .set(bearer(rider.accessToken))
      .send({ name: 'فرد', relation: 'child', ...(gender ? { gender } : {}) })
      .expect(201);
    return res.body.id;
  }

  const subscribe = (rider: SignedIn, body: Record<string, unknown>) =>
    http()
      .post('/v1/subscriptions')
      .set(bearer(rider.accessToken))
      .send({ days: [0, 1, 2, 3, 4], outboundTime: '06:30', returnTime: '13:30', sharedRideConsent: true, ...body });

  async function makeDriver(opts: { seats?: number; qualified?: boolean; escort?: string | null } = {}): Promise<string> {
    const [u] = await ctx.db
      .insert(users)
      .values({ phone: newPhone(), role: 'driver', audience: 'driver', partnerId, name: 'سائق', status: 'active' })
      .returning({ id: users.id });
    await ctx.db.insert(driverProfiles).values({ userId: u.id, partnerId, fullName: 'سائق', status: 'approved' });
    await ctx.db.insert(vehicles).values({
      driverId: u.id,
      partnerId,
      plateLetters: 'ABJ',
      plateNumbers: String(1000 + Math.floor(Math.random() * 8999)),
      make: 'Hyundai',
      model: 'Staria',
      year: new Date().getFullYear(),
      color: 'أبيض',
      seats: opts.seats ?? 8,
      escortName: opts.escort ?? null,
    });
    if (opts.qualified !== false) await qualifyDriver(ctx, u.id, partnerId);
    return u.id;
  }

  const assign = (subId: string, driverId: string) =>
    http().patch(`/v1/admin/subscriptions/${subId}/driver`).set(bearer(admin.accessToken)).send({ driverId });

  beforeAll(async () => {
    ctx = await createTestApp();
    partnerId = await createPartner(ctx, 'Alpha');
    otherPartner = await createPartner(ctx, 'Beta');
    await ctx.db.update(partners).set({ legalName: 'شركة ألفا للنقل', crNumber: '1010101010' }).where(eq(partners.id, partnerId));
    admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    dispatcher = await signIn(ctx, (await createStaff(ctx, 'dispatcher', partnerId)).phone, 'admin');
    otherAdmin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', otherPartner)).phone, 'admin');
    superAdmin = await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin');
    zoneId = (await http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الرمال', nameEn: 'Rimal', area: RIMAL }).expect(201)).body.id;
    commutePlan = (await plan({ nameEn: 'Commute', priceHalalas: 90000 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('licences and plans', () => {
    it('refuses an education plan until a verified licence covers it', async () => {
      const refused = await plan({ serviceClass: 'education', priceHalalas: 120000 }).expect(409);
      expect(refused.body.error.code).toBe('PARTNER_LICENSE_REQUIRED');

      const entered = await http()
        .put(licence(partnerId, 'education'))
        .set(bearer(admin.accessToken))
        .send({ licenseNumber: 'EDU-1001', unifiedCode: '700123', expiresAt: daysFromToday(300), minPriceHalalas: 80000, maxPriceHalalas: 150000, pricingReference: 'TGA-PR-7' })
        .expect(200);
      expect(entered.body).toMatchObject({ serviceClass: 'education', valid: false, verifiedAt: null });
      expect((await plan({ serviceClass: 'education', priceHalalas: 120000 }).expect(409)).body.error.code).toBe('PARTNER_LICENSE_REQUIRED');

      // Only the platform verifies; a partner cannot vouch for itself, and others cannot see it.
      await http().post(`${licence(partnerId, 'education')}/verify`).set(bearer(admin.accessToken)).expect(403);
      await http().get(`/v1/admin/partners/${partnerId}/licenses`).set(bearer(otherAdmin.accessToken)).expect(404);
      const verified = await http().post(`${licence(partnerId, 'education')}/verify`).set(bearer(superAdmin.accessToken)).expect(200);
      expect(verified.body.valid).toBe(true);

      const tooDear = await plan({ serviceClass: 'education', priceHalalas: 200000 }).expect(409);
      expect(tooDear.body.error.code).toBe('PRICE_NOT_APPROVED');
      educationPlan = (await plan({ serviceClass: 'education', priceHalalas: 120000, nameEn: 'School' }).expect(201)).body.id;
      escortPlan = (await plan({ serviceClass: 'education', requiresEscort: true, priceHalalas: 130000, nameEn: 'Primary' }).expect(201)).body.id;

      const listed = await http().get('/v1/admin/partners/' + partnerId + '/licenses').set(bearer(dispatcher.accessToken)).expect(200);
      expect(listed.body).toHaveLength(1);
    });

    it('keeps the escort rule to education plans and re-checks the price on edit', async () => {
      const wrong = await plan({ requiresEscort: true, priceHalalas: 90000 }).expect(400);
      expect(wrong.body.error.code).toBe('PLAN_RULES_INVALID');
      const edit = await http().patch(`/v1/admin/plans/${educationPlan}`).set(bearer(admin.accessToken)).send({ priceHalalas: 50000 }).expect(409);
      expect(edit.body.error.code).toBe('PRICE_NOT_APPROVED');
      // Taking a plan off sale is always allowed.
      await http().patch(`/v1/admin/plans/${educationPlan}`).set(bearer(admin.accessToken)).send({ active: false }).expect(200);
      await http().patch(`/v1/admin/plans/${educationPlan}`).set(bearer(admin.accessToken)).send({ active: true }).expect(200);
    });

    it('shows riders the licence code, and hides plans once the licence lapses', async () => {
      const { rider, home, school } = await riderWithPlaces();
      const cover = await http().get('/v1/coverage').set(bearer(rider.accessToken)).query({ lat: 24.8675, lng: 46.8275 }).expect(200);
      const mine = cover.body.find((z: { partnerId: string }) => z.partnerId === partnerId);
      expect(mine.licenseCodes).toEqual({ education: '700123' });
      expect(mine.plans.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([commutePlan, educationPlan]));

      await ctx.db.update(partnerLicenses).set({ expiresAt: daysFromToday(0) }).where(eq(partnerLicenses.partnerId, partnerId));
      const lapsed = await http().get('/v1/coverage').set(bearer(rider.accessToken)).query({ lat: 24.8675, lng: 46.8275 }).expect(200);
      const ids = lapsed.body.find((z: { partnerId: string }) => z.partnerId === partnerId).plans.map((p: { id: string }) => p.id);
      expect(ids).toContain(commutePlan);
      expect(ids).not.toContain(educationPlan);
      const quote = await http().post('/v1/quotes').set(bearer(rider.accessToken)).send({ planId: educationPlan, pickupPlaceId: home, dropoffPlaceId: school }).expect(409);
      expect(quote.body.error.code).toBe('PLAN_UNAVAILABLE');
      await ctx.db.update(partnerLicenses).set({ expiresAt: daysFromToday(300) }).where(eq(partnerLicenses.partnerId, partnerId));
    });

    it('warns partner admins before a licence expires', async () => {
      await ctx.db.update(partnerLicenses).set({ expiresAt: daysFromToday(5) }).where(eq(partnerLicenses.partnerId, partnerId));
      await ctx.app.get(ComplianceService).scan();
      const sent = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, admin.userId), eq(notifications.kind, 'license_expiring')));
      expect(sent).toHaveLength(1);
      await ctx.db.update(partnerLicenses).set({ expiresAt: daysFromToday(300) }).where(eq(partnerLicenses.partnerId, partnerId));
    });
  });

  describe('subscribing', () => {
    it('needs the rider’s consent to share the car', async () => {
      const { rider, home, school } = await riderWithPlaces();
      const res = await subscribe(rider, { planId: commutePlan, pickupPlaceId: home, dropoffPlaceId: school, sharedRideConsent: false }).expect(400);
      expect(res.body.error.code).toBe('SHARED_RIDE_CONSENT_REQUIRED');
      const ok = await subscribe(rider, { planId: commutePlan, pickupPlaceId: home, dropoffPlaceId: school }).expect(201);
      const [row] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.id, ok.body.subscription.id));
      expect(row.sharedRideConsentAt).toBeInstanceOf(Date);
      expect(row.contractVersion).toBeNull();
    });

    it('needs the guardian to accept the current contract for an education plan', async () => {
      const { rider, home, school } = await riderWithPlaces();
      const contract = await http().get(`/v1/plans/${educationPlan}/contract`).set(bearer(rider.accessToken)).expect(200);
      expect(contract.body.version).toBe('2026-11');
      expect(contract.body.clausesAr[0]).toContain('شركة ألفا للنقل');
      expect(contract.body.clausesAr[0]).toContain('700123');

      const none = await subscribe(rider, { planId: educationPlan, pickupPlaceId: home, dropoffPlaceId: school }).expect(400);
      expect(none.body.error.code).toBe('GUARDIAN_CONTRACT_REQUIRED');
      const old = await subscribe(rider, { planId: educationPlan, pickupPlaceId: home, dropoffPlaceId: school, guardianContractVersion: '2025-01' }).expect(400);
      expect(old.body.error.code).toBe('GUARDIAN_CONTRACT_REQUIRED');
      const ok = await subscribe(rider, { planId: educationPlan, pickupPlaceId: home, dropoffPlaceId: school, guardianContractVersion: contract.body.version }).expect(201);
      expect(ok.body.subscription).toMatchObject({ serviceClass: 'education', contractVersion: '2026-11' });
    });

    it('keeps women-only plans to women, saving the gender on the rider', async () => {
      womenPlan = (await plan({ womenOnly: true, priceHalalas: 95000, nameEn: 'Women' }).expect(201)).body.id;
      const { rider, home, school } = await riderWithPlaces();
      const base = { planId: womenPlan, pickupPlaceId: home, dropoffPlaceId: school };
      expect((await subscribe(rider, base).expect(400)).body.error.code).toBe('GENDER_REQUIRED');
      expect((await subscribe(rider, { ...base, memberId: await member('male') }).expect(409)).body.error.code).toBe('WOMEN_ONLY_PLAN');

      // Given at subscription, the gender is kept on whoever rides: here the account holder.
      const ok = await subscribe(rider, { ...base, passengerGender: 'female' }).expect(201);
      expect(ok.body.subscription.womenOnly).toBe(true);
      const me = await http().get('/v1/me').set(bearer(rider.accessToken)).expect(200);
      expect(me.body.gender).toBe('female');
      await http().patch('/v1/me').set(bearer(rider.accessToken)).send({ gender: 'male' }).expect(200);
    });
  });

  describe('assigning drivers', () => {
    async function educationSub(planId = educationPlan): Promise<string> {
      const { rider, home, school } = await riderWithPlaces();
      const res = await subscribe(rider, { planId, pickupPlaceId: home, dropoffPlaceId: school, guardianContractVersion: '2026-11' }).expect(201);
      return res.body.subscription.id;
    }

    it('serves an education plan only with a qualified driver and car', async () => {
      const subId = await educationSub();

      const noPapers = await makeDriver({ qualified: false });
      const r1 = await assign(subId, noPapers).expect(409);
      expect(r1.body.error.code).toBe('DRIVER_NOT_QUALIFIED');
      expect(r1.body.error.details).toEqual(expect.arrayContaining(['driver_not_saudi', 'document_missing:professional_driver_card']));

      const young = await makeDriver();
      await ctx.db.update(driverProfiles).set({ dateOfBirth: daysFromToday(-365 * 22) }).where(eq(driverProfiles.userId, young));
      expect((await assign(subId, young).expect(409)).body.error.details).toEqual(['driver_too_young']);

      const smallCar = await makeDriver({ seats: 4 });
      expect((await assign(subId, smallCar).expect(409)).body.error.details).toEqual(['vehicle_seats']);

      const expiredCard = await makeDriver();
      await ctx.db
        .update(documents)
        .set({ expiresAt: daysFromToday(-1) })
        .where(and(eq(documents.driverId, expiredCard), eq(documents.type, 'professional_driver_card')));
      expect((await assign(subId, expiredCard).expect(409)).body.error.details).toEqual(['document_expired:professional_driver_card']);

      await assign(subId, await makeDriver()).expect(200);
    });

    it('needs an escort on board for plans of young students', async () => {
      const subId = await educationSub(escortPlan);
      expect((await assign(subId, await makeDriver()).expect(409)).body.error.details).toEqual(['escort_missing']);
      await assign(subId, await makeDriver({ escort: 'نورة محمد' })).expect(200);
    });

    it('lets a commute driver in a small car serve commute plans', async () => {
      const { rider, home, school } = await riderWithPlaces();
      const sub = await subscribe(rider, { planId: commutePlan, pickupPlaceId: home, dropoffPlaceId: school }).expect(201);
      await assign(sub.body.subscription.id, await makeDriver({ seats: 3 })).expect(200);
    });

    it('never seats a women-only rider with a man', async () => {
      const driver = await makeDriver();
      const { rider, home, school } = await riderWithPlaces();
      const places = { pickupPlaceId: home, dropoffPlaceId: school };
      const w = await subscribe(rider, { planId: womenPlan, ...places, memberId: await member('female') }).expect(201);
      await assign(w.body.subscription.id, driver).expect(200);

      const m = await subscribe(rider, { planId: commutePlan, ...places, memberId: await member('male') }).expect(201);
      expect((await assign(m.body.subscription.id, driver).expect(409)).body.error.code).toBe('SEATING_RULES');
      // Unknown gender counts as not a woman.
      const u = await subscribe(rider, { planId: commutePlan, ...places, memberId: await member(null) }).expect(201);
      expect((await assign(u.body.subscription.id, driver).expect(409)).body.error.code).toBe('SEATING_RULES');

      const s = await subscribe(rider, { planId: commutePlan, ...places, memberId: await member('female') }).expect(201);
      await assign(s.body.subscription.id, driver).expect(200);
    });
  });

  describe('on the road', () => {
    it('ends an education trip only after the vehicle-empty check', async () => {
      const driverId = await makeDriver();
      const { rider, home, school } = await riderWithPlaces();
      const sub = await subscribe(rider, { planId: educationPlan, pickupPlaceId: home, dropoffPlaceId: school, guardianContractVersion: '2026-11' }).expect(201);
      const subId = sub.body.subscription.id;
      await assign(subId, driverId).expect(200);
      const [trip] = await ctx.db
        .insert(trips)
        .values({
          subscriptionId: subId,
          partnerId,
          riderId: rider.userId,
          driverId,
          serviceDate: daysFromToday(0),
          leg: 'outbound',
          scheduledAt: new Date(),
          pickup: sql`ST_SetSRID(ST_MakePoint(46.8275, 24.8675), 4326)` as unknown as string,
          pickupName: 'البيت',
          dropoff: sql`ST_SetSRID(ST_MakePoint(46.831, 24.872), 4326)` as unknown as string,
          dropoffName: 'المدرسة',
          status: 'on_board',
        })
        .returning();
      const driver = await signIn(ctx, (await ctx.db.query.users.findFirst({ where: eq(users.id, driverId) }))!.phone, 'driver');

      const refused = await http().post(`/v1/driver/trips/${trip.id}/complete`).set(bearer(driver.accessToken)).send({}).expect(400);
      expect(refused.body.error.code).toBe('CABIN_CHECK_REQUIRED');
      const done = await http().post(`/v1/driver/trips/${trip.id}/complete`).set(bearer(driver.accessToken)).send({ cabinChecked: true }).expect(200);
      expect(done.body.status).toBe('completed');
      const [row] = await ctx.db.select().from(trips).where(eq(trips.id, trip.id));
      expect(row.cabinCheckedAt).toBeInstanceOf(Date);
    });
  });

  describe('reporting to the authority', () => {
    it('exports drivers, licences and trips of a period to admins only', async () => {
      const q = { from: daysFromToday(-7), to: daysFromToday(0) };
      await http().get('/v1/admin/regulator/export').query(q).set(bearer(dispatcher.accessToken)).expect(403);
      await http().get('/v1/admin/regulator/export').query({ ...q, partnerId }).set(bearer(otherAdmin.accessToken)).expect(403);
      await http().get('/v1/admin/regulator/export').query({ from: daysFromToday(-60), to: daysFromToday(0) }).set(bearer(admin.accessToken)).expect(400);

      const batch = await http().get('/v1/admin/regulator/export').query(q).set(bearer(admin.accessToken)).expect(200);
      expect(batch.body.partner).toMatchObject({ id: partnerId, crNumber: '1010101010' });
      expect(batch.body.licenses).toEqual([expect.objectContaining({ serviceClass: 'education', licenseNumber: 'EDU-1001', verified: true })]);
      expect(batch.body.drivers.length).toBeGreaterThan(0);
      expect(batch.body.drivers.some((d: { documents: unknown[] }) => d.documents.length === 10)).toBe(true);
      expect(batch.body.trips).toEqual([expect.objectContaining({ serviceClass: 'education', status: 'completed' })]);

      const viaSuper = await http().get('/v1/admin/regulator/export').query({ ...q, partnerId }).set(bearer(superAdmin.accessToken)).expect(200);
      expect(viaSuper.body.trips).toHaveLength(1);
    });
  });
});

describe('Commute licence switched on (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ COMMUTE_LICENSE_REQUIRED: true });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('sells commute plans only under a verified mediation licence', async () => {
    const partnerId = await createPartner(ctx, 'Gamma');
    const admin = await signIn(ctx, (await createStaff(ctx, 'partner_admin', partnerId)).phone, 'admin');
    const superAdmin = await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin');
    const zone = await ctx.http().post('/v1/admin/zones').set(bearer(admin.accessToken)).send({ nameAr: 'الرمال', nameEn: 'Rimal', area: RIMAL }).expect(201);
    const body = { zoneId: zone.body.id, nameAr: 'دوام', nameEn: 'Work', tripType: 'round_trip', daysPerWeek: 5, priceHalalas: 90000, maxDistanceKm: 5 };
    expect((await ctx.http().post('/v1/admin/plans').set(bearer(admin.accessToken)).send(body).expect(409)).body.error.code).toBe('PARTNER_LICENSE_REQUIRED');

    await ctx.http()
      .put(`/v1/admin/partners/${partnerId}/licenses/commute`)
      .set(bearer(admin.accessToken))
      .send({ licenseNumber: 'RH-55', expiresAt: daysFromToday(200) })
      .expect(200);
    await ctx.http().post(`/v1/admin/partners/${partnerId}/licenses/commute/verify`).set(bearer(superAdmin.accessToken)).expect(200);
    await ctx.http().post('/v1/admin/plans').set(bearer(admin.accessToken)).send(body).expect(201);

    // Any edit sends the licence back for verification, and selling stops until then.
    await ctx.http()
      .put(`/v1/admin/partners/${partnerId}/licenses/commute`)
      .set(bearer(admin.accessToken))
      .send({ licenseNumber: 'RH-56', expiresAt: daysFromToday(400) })
      .expect(200);
    expect((await ctx.http().post('/v1/admin/plans').set(bearer(admin.accessToken)).send(body).expect(409)).body.error.code).toBe('PARTNER_LICENSE_REQUIRED');
  });
});
