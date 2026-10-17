import { bearer, createPartner, createStaff, createTestApp, newPhone, signIn, SignedIn, TestContext } from './helpers';

/** A small square in north Riyadh (about 1.5 x 1.5 km). */
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
const INSIDE = { lat: 24.8675, lng: 46.8275 };
const OUTSIDE = { lat: 24.7, lng: 46.6 };

describe('Zones, plans and coverage (e2e)', () => {
  let ctx: TestContext;
  let p1: string;
  let admin1: SignedIn;
  let admin2: SignedIn;
  let dispatcher1: SignedIn;
  let rider: SignedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
    p1 = await createPartner(ctx, 'Alpha');
    const p2 = await createPartner(ctx, 'Beta');
    admin1 = await signIn(ctx, (await createStaff(ctx, 'partner_admin', p1)).phone, 'admin');
    admin2 = await signIn(ctx, (await createStaff(ctx, 'partner_admin', p2)).phone, 'admin');
    dispatcher1 = await signIn(ctx, (await createStaff(ctx, 'dispatcher', p1)).phone, 'admin');
    rider = await signIn(ctx, newPhone(), 'rider');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates a service area, plans in it, and answers coverage questions', async () => {
    const zone = await ctx
      .http()
      .post('/v1/admin/zones')
      .set(bearer(admin1.accessToken))
      .send({ nameAr: 'حي الرمال', nameEn: 'Al Rimal', area: RIMAL })
      .expect(201);
    expect(zone.body).toMatchObject({ partnerId: p1, nameAr: 'حي الرمال', active: true, planCount: 0 });
    expect(zone.body.areaKm2).toBeGreaterThan(2);
    expect(zone.body.areaKm2).toBeLessThan(3);
    expect(zone.body.area.type).toBe('Polygon');

    const plan = await ctx
      .http()
      .post('/v1/admin/plans')
      .set(bearer(admin1.accessToken))
      .send({
        zoneId: zone.body.id,
        nameAr: 'ذهاب وعودة - 5 أيام',
        nameEn: 'Round trip - 5 days',
        tripType: 'round_trip',
        daysPerWeek: 5,
        priceHalalas: 120000,
        maxDistanceKm: 15,
      })
      .expect(201);
    expect(plan.body).toMatchObject({ partnerId: p1, priceHalalas: 120000, active: true });

    const inside = await ctx.http().get('/v1/coverage').query(INSIDE).set(bearer(rider.accessToken)).expect(200);
    expect(inside.body).toHaveLength(1);
    expect(inside.body[0]).toMatchObject({ zoneNameEn: 'Al Rimal', partnerNameEn: 'Alpha' });
    expect(inside.body[0].plans.map((p: { id: string }) => p.id)).toEqual([plan.body.id]);

    const outside = await ctx.http().get('/v1/coverage').query(OUTSIDE).set(bearer(rider.accessToken)).expect(200);
    expect(outside.body).toEqual([]);

    // Inactive plans and zones drop out of coverage.
    await ctx.http().patch(`/v1/admin/plans/${plan.body.id}`).set(bearer(admin1.accessToken)).send({ active: false }).expect(200);
    const noPlans = await ctx.http().get('/v1/coverage').query(INSIDE).set(bearer(rider.accessToken)).expect(200);
    expect(noPlans.body[0].plans).toEqual([]);
    await ctx.http().patch(`/v1/admin/zones/${zone.body.id}`).set(bearer(admin1.accessToken)).send({ active: false }).expect(200);
    const gone = await ctx.http().get('/v1/coverage').query(INSIDE).set(bearer(rider.accessToken)).expect(200);
    expect(gone.body).toEqual([]);
  });

  it('rejects areas that cross themselves, lie outside Saudi Arabia, or are too large', async () => {
    const bowtie = {
      type: 'Polygon',
      coordinates: [[[46.82, 24.86], [46.835, 24.875], [46.835, 24.86], [46.82, 24.875], [46.82, 24.86]]],
    };
    const crossed = await ctx
      .http()
      .post('/v1/admin/zones')
      .set(bearer(admin1.accessToken))
      .send({ nameAr: 'خطأ', nameEn: 'Bad', area: bowtie })
      .expect(400);
    expect(crossed.body.error.code).toBe('ZONE_INVALID');

    const swapped = { type: 'Polygon', coordinates: [RIMAL.coordinates[0].map(([x, y]) => [y, x])] };
    await ctx.http().post('/v1/admin/zones').set(bearer(admin1.accessToken)).send({ nameAr: 'خطأ', nameEn: 'Bad', area: swapped }).expect(400);

    const huge = { type: 'Polygon', coordinates: [[[45, 23], [48, 23], [48, 26], [45, 26], [45, 23]]] };
    await ctx.http().post('/v1/admin/zones').set(bearer(admin1.accessToken)).send({ nameAr: 'كبير', nameEn: 'Huge', area: huge }).expect(400);

    // An open ring is closed automatically.
    const open = { type: 'Polygon', coordinates: [RIMAL.coordinates[0].slice(0, 4)] };
    await ctx.http().post('/v1/admin/zones').set(bearer(admin1.accessToken)).send({ nameAr: 'مفتوح', nameEn: 'Open', area: open }).expect(201);
  });

  it('keeps zones and plans within their partner', async () => {
    const zone = await ctx
      .http()
      .post('/v1/admin/zones')
      .set(bearer(admin1.accessToken))
      .send({ nameAr: 'حي خاص', nameEn: 'Private', area: RIMAL })
      .expect(201);

    await ctx.http().post('/v1/admin/zones').set(bearer(dispatcher1.accessToken)).send({ nameAr: 'منسق', nameEn: 'Disp', area: RIMAL }).expect(403);
    const seen = await ctx.http().get('/v1/admin/zones').set(bearer(admin2.accessToken)).expect(200);
    expect(seen.body.map((z: { id: string }) => z.id)).not.toContain(zone.body.id);
    await ctx.http().patch(`/v1/admin/zones/${zone.body.id}`).set(bearer(admin2.accessToken)).send({ active: false }).expect(404);

    await ctx
      .http()
      .post('/v1/admin/plans')
      .set(bearer(admin2.accessToken))
      .send({ zoneId: zone.body.id, nameAr: 'تسلل', nameEn: 'Sneak', tripType: 'one_way', daysPerWeek: 5, priceHalalas: 50000, maxDistanceKm: 10 })
      .expect(404);

    const plans = await ctx.http().get('/v1/admin/plans').set(bearer(dispatcher1.accessToken)).expect(200);
    expect(plans.body.every((p: { partnerId: string }) => p.partnerId === p1)).toBe(true);
  });

  it('validates plan values', async () => {
    const zone = await ctx
      .http()
      .post('/v1/admin/zones')
      .set(bearer(admin1.accessToken))
      .send({ nameAr: 'تحقق', nameEn: 'Check', area: RIMAL })
      .expect(201);
    const res = await ctx
      .http()
      .post('/v1/admin/plans')
      .set(bearer(admin1.accessToken))
      .send({ zoneId: zone.body.id, nameAr: 'خطأ', nameEn: 'Bad', tripType: 'daily', daysPerWeek: 9, priceHalalas: 0, maxDistanceKm: 0 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
