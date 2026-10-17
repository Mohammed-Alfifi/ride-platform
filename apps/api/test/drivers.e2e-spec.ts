import { and, eq, isNull } from 'drizzle-orm';
import { documents, notifications, partners } from '../src/database/schema';
import { ComplianceService } from '../src/drivers/compliance.service';
import {
  bearer,
  createPartner,
  createStaff,
  createTestApp,
  daysFromToday,
  FILES,
  newPhone,
  signIn,
  SignedIn,
  TestContext,
  withCheckDigit,
} from './helpers';

const DOC_TYPES = [
  'national_id',
  'driving_license',
  'driver_photo',
  'vehicle_registration',
  'vehicle_insurance',
  'periodic_inspection',
] as const;

let idCounter = 100000;
const nextNationalId = () => withCheckDigit(`10${String(idCounter++).padStart(7, '0')}`);
const thisYear = new Date().getUTCFullYear();

describe('Drivers: onboarding, review and compliance (e2e)', () => {
  let ctx: TestContext;
  let p1: string;
  let p2: string;
  let code1: string;
  let admin1: SignedIn;
  let admin2: SignedIn;
  let dispatcher1: SignedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
    p1 = await createPartner(ctx, 'Alpha');
    p2 = await createPartner(ctx, 'Beta');
    const row = await ctx.db.query.partners.findFirst({ where: eq(partners.id, p1) });
    code1 = row!.joinCode;
    admin1 = await signIn(ctx, (await createStaff(ctx, 'partner_admin', p1)).phone, 'admin');
    admin2 = await signIn(ctx, (await createStaff(ctx, 'partner_admin', p2)).phone, 'admin');
    dispatcher1 = await signIn(ctx, (await createStaff(ctx, 'dispatcher', p1)).phone, 'admin');
  });

  beforeEach(async () => {
    const keys = await ctx.redis.keys('throttle:*');
    if (keys.length) await ctx.redis.del(...keys);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const onboarding = (d: SignedIn) => ctx.http().get('/v1/driver/onboarding').set(bearer(d.accessToken));

  function upload(d: SignedIn, type: string, file: Buffer, expiresAt?: string) {
    const req = ctx.http().post('/v1/driver/documents').set(bearer(d.accessToken)).field('type', type);
    if (expiresAt) req.field('expiresAt', expiresAt);
    return req.attach('file', file, { filename: 'doc.bin', contentType: 'application/octet-stream' });
  }

  /** A driver who has joined partner 1 and filled in everything, ready to submit. */
  async function completeDriver(): Promise<SignedIn> {
    const d = await signIn(ctx, newPhone(), 'driver');
    await ctx.http().post('/v1/driver/onboarding/join').set(bearer(d.accessToken)).send({ code: code1 }).expect(200);
    await ctx
      .http()
      .put('/v1/driver/onboarding/profile')
      .set(bearer(d.accessToken))
      .send({ fullName: 'سائق تجريبي للاختبار', nationalId: nextNationalId(), dateOfBirth: '1990-05-01', saudiConfirmed: true })
      .expect(200);
    await ctx
      .http()
      .put('/v1/driver/onboarding/vehicle')
      .set(bearer(d.accessToken))
      .send({
        plateLetters: 'ا ب ح',
        plateNumbers: String(1000 + (idCounter % 9000)),
        make: 'Toyota',
        model: 'Camry',
        year: thisYear - 1,
        color: 'أبيض',
        seats: 4,
      })
      .expect(200);
    for (const type of DOC_TYPES) {
      await upload(d, type, FILES.jpeg, type === 'driver_photo' ? undefined : daysFromToday(200)).expect(201);
    }
    return d;
  }

  describe('driver side', () => {
    it('walks a new driver from sign-up to a submitted application', async () => {
      const d = await signIn(ctx, newPhone(), 'driver');
      const start = await onboarding(d).expect(200);
      expect(start.body).toMatchObject({ status: 'not_joined', missing: ['partner'], canSubmit: false });

      const early = await upload(d, 'driver_photo', FILES.jpeg).expect(409);
      expect(early.body.error.code).toBe('DRIVER_NOT_JOINED');

      await ctx.http().post('/v1/driver/onboarding/join').set(bearer(d.accessToken)).send({ code: 'NOPE99' }).expect(404);
      const joined = await ctx
        .http()
        .post('/v1/driver/onboarding/join')
        .set(bearer(d.accessToken))
        .send({ code: code1.toLowerCase() })
        .expect(200);
      expect(joined.body).toMatchObject({ status: 'draft', partner: { id: p1, nameEn: 'Alpha' } });
      expect(joined.body.missing).toEqual(expect.arrayContaining(['profile', 'vehicle', 'document.national_id']));

      const notReady = await ctx.http().post('/v1/driver/onboarding/submit').set(bearer(d.accessToken)).expect(422);
      expect(notReady.body.error.code).toBe('DRIVER_INCOMPLETE');
      expect(notReady.body.error.details).toContain('vehicle');

      const nationalId = nextNationalId();
      const badId = await ctx
        .http()
        .put('/v1/driver/onboarding/profile')
        .set(bearer(d.accessToken))
        .send({ fullName: 'محمد عبدالله', nationalId: '2' + nationalId.slice(1), dateOfBirth: '1990-01-01', saudiConfirmed: true })
        .expect(400);
      expect(badId.body.error.code).toBe('DRIVER_NATIONAL_ID_INVALID');
      await ctx
        .http()
        .put('/v1/driver/onboarding/profile')
        .set(bearer(d.accessToken))
        .send({ fullName: 'محمد عبدالله', nationalId, dateOfBirth: '1990-01-01', saudiConfirmed: false })
        .expect(400);
      const minor = await ctx
        .http()
        .put('/v1/driver/onboarding/profile')
        .set(bearer(d.accessToken))
        .send({ fullName: 'محمد عبدالله', nationalId, dateOfBirth: daysFromToday(-365 * 16), saudiConfirmed: true })
        .expect(400);
      expect(minor.body.error.code).toBe('VALIDATION_FAILED');
      const saved = await ctx
        .http()
        .put('/v1/driver/onboarding/profile')
        .set(bearer(d.accessToken))
        .send({ fullName: 'محمد عبدالله الشهري', nationalId, dateOfBirth: '1990-01-01', saudiConfirmed: true })
        .expect(200);
      expect(saved.body.profile).toEqual({
        fullName: 'محمد عبدالله الشهري',
        nationalIdLast4: nationalId.slice(-4),
        dateOfBirth: '1990-01-01',
        saudiConfirmed: true,
      });

      const old = await ctx
        .http()
        .put('/v1/driver/onboarding/vehicle')
        .set(bearer(d.accessToken))
        .send({ plateLetters: 'ABJ', plateNumbers: '1', make: 'Toyota', model: 'Corolla', year: thisYear - 6, color: 'أبيض', seats: 4 })
        .expect(400);
      expect(old.body.error.code).toBe('VEHICLE_TOO_OLD');
      expect(old.body.error.message).toContain('5');
      await ctx
        .http()
        .put('/v1/driver/onboarding/vehicle')
        .set(bearer(d.accessToken))
        .send({ plateLetters: 'QQQ', plateNumbers: '1', make: 'Toyota', model: 'Corolla', year: thisYear, color: 'أبيض', seats: 4 })
        .expect(400);
      const vehicle = await ctx
        .http()
        .put('/v1/driver/onboarding/vehicle')
        .set(bearer(d.accessToken))
        .send({ plateLetters: 'ر س ص', plateNumbers: '777', make: 'Hyundai', model: 'Sonata', year: thisYear - 2, color: 'فضي', seats: 4 })
        .expect(200);
      expect(vehicle.body.vehicle).toMatchObject({ plateLetters: 'RSX', plateNumbers: '777', eligibleUntil: `${thisYear + 3}-01-01` });

      const badType = await upload(d, 'driving_license', FILES.text, daysFromToday(100)).expect(415);
      expect(badType.body.error.code).toBe('DOCUMENT_FILE_UNSUPPORTED');
      const noExpiry = await upload(d, 'driving_license', FILES.jpeg).expect(400);
      expect(noExpiry.body.error.code).toBe('DOCUMENT_EXPIRY_REQUIRED');
      const expired = await upload(d, 'driving_license', FILES.jpeg, daysFromToday(0)).expect(400);
      expect(expired.body.error.code).toBe('DOCUMENT_EXPIRED');
      await upload(d, 'driver_photo', FILES.pdf).expect(415);

      for (const type of DOC_TYPES) {
        const file = type === 'vehicle_insurance' ? FILES.pdf : type === 'driver_photo' ? FILES.png : FILES.jpeg;
        const res = await upload(d, type, file, type === 'driver_photo' ? undefined : daysFromToday(300)).expect(201);
        expect(res.body).toMatchObject({ type, status: 'pending' });
      }
      // Replacing a document keeps one current copy and the history.
      await upload(d, 'driving_license', FILES.png, daysFromToday(400)).expect(201);
      const all = await ctx.db.select().from(documents).where(eq(documents.driverId, d.userId));
      const current = all.filter((x) => x.supersededAt === null);
      expect(all).toHaveLength(7);
      expect(current).toHaveLength(6);

      const ready = await onboarding(d).expect(200);
      expect(ready.body).toMatchObject({ missing: [], canSubmit: true });

      const submitted = await ctx.http().post('/v1/driver/onboarding/submit').set(bearer(d.accessToken)).expect(200);
      expect(submitted.body).toMatchObject({ status: 'submitted', canSubmit: false });

      const locked = await ctx
        .http()
        .put('/v1/driver/onboarding/vehicle')
        .set(bearer(d.accessToken))
        .send({ plateLetters: 'ABJ', plateNumbers: '778', make: 'Hyundai', model: 'Sonata', year: thisYear, color: 'فضي', seats: 4 })
        .expect(409);
      expect(locked.body.error.code).toBe('DRIVER_LOCKED');

      const inbox = await ctx.db.select().from(notifications).where(eq(notifications.userId, admin1.userId));
      expect(inbox.some((n) => n.kind === 'driver_submitted')).toBe(true);
    });

    it('refuses a national ID or plate already registered by another driver', async () => {
      const first = await completeDriver();
      const firstView = await onboarding(first).expect(200);
      const second = await signIn(ctx, newPhone(), 'driver');
      await ctx.http().post('/v1/driver/onboarding/join').set(bearer(second.accessToken)).send({ code: code1 }).expect(200);

      const detail = await ctx.http().get(`/v1/admin/drivers/${first.userId}`).set(bearer(admin1.accessToken)).expect(200);
      const takenId = await ctx
        .http()
        .put('/v1/driver/onboarding/profile')
        .set(bearer(second.accessToken))
        .send({ fullName: 'شخص آخر', nationalId: detail.body.nationalId, dateOfBirth: '1991-01-01', saudiConfirmed: true })
        .expect(409);
      expect(takenId.body.error.code).toBe('DRIVER_NATIONAL_ID_TAKEN');

      const v = firstView.body.vehicle;
      const takenPlate = await ctx
        .http()
        .put('/v1/driver/onboarding/vehicle')
        .set(bearer(second.accessToken))
        .send({ plateLetters: v.plateLetters, plateNumbers: v.plateNumbers, make: 'Kia', model: 'K5', year: thisYear, color: 'أسود', seats: 4 })
        .expect(409);
      expect(takenPlate.body.error.code).toBe('VEHICLE_PLATE_TAKEN');
    });

    it('serves document files only to the driver, their partner and platform admins', async () => {
      const d = await completeDriver();
      const docId = (await onboarding(d)).body.documents[0].id;
      const own = await ctx.http().get(`/v1/documents/${docId}/file`).set(bearer(d.accessToken)).expect(200);
      expect(own.headers['content-type']).toBe('image/jpeg');
      expect(own.headers['cache-control']).toBe('private, no-store');
      await ctx.http().get(`/v1/documents/${docId}/file`).set(bearer(admin1.accessToken)).expect(200);
      await ctx.http().get(`/v1/documents/${docId}/file`).set(bearer(admin2.accessToken)).expect(404);
      const stranger = await signIn(ctx, newPhone(), 'driver');
      await ctx.http().get(`/v1/documents/${docId}/file`).set(bearer(stranger.accessToken)).expect(404);
      const rider = await signIn(ctx, newPhone(), 'rider');
      await ctx.http().get(`/v1/documents/${docId}/file`).set(bearer(rider.accessToken)).expect(404);
    });

    it('keeps riders out of driver routes', async () => {
      const rider = await signIn(ctx, newPhone(), 'rider');
      await onboarding(rider).expect(403);
    });
  });

  describe('partner review', () => {
    it('lists applications to the right partner, waiting ones first', async () => {
      const d = await completeDriver();
      await ctx.http().post('/v1/driver/onboarding/submit').set(bearer(d.accessToken)).expect(200);

      const mine = await ctx.http().get('/v1/admin/drivers').set(bearer(admin1.accessToken)).expect(200);
      expect(mine.body.items[0].onboardingStatus).toBe('submitted');
      expect(mine.body.items.map((i: { id: string }) => i.id)).toContain(d.userId);
      const item = mine.body.items.find((i: { id: string }) => i.id === d.userId);
      expect(item.pendingDocuments).toBe(6);
      expect(item.vehicle).toContain('Toyota Camry');

      const theirs = await ctx.http().get('/v1/admin/drivers').set(bearer(admin2.accessToken)).expect(200);
      expect(theirs.body.items.map((i: { id: string }) => i.id)).not.toContain(d.userId);
      await ctx.http().get(`/v1/admin/drivers/${d.userId}`).set(bearer(admin2.accessToken)).expect(404);
    });

    it('shows the full national ID to partner admins and a masked one to dispatchers', async () => {
      const d = await completeDriver();
      const full = await ctx.http().get(`/v1/admin/drivers/${d.userId}`).set(bearer(admin1.accessToken)).expect(200);
      expect(full.body.nationalId).toMatch(/^1\d{9}$/);
      const masked = await ctx.http().get(`/v1/admin/drivers/${d.userId}`).set(bearer(dispatcher1.accessToken)).expect(200);
      expect(masked.body.nationalId).toBe(`******${full.body.nationalId.slice(-4)}`);
    });

    it('rejects with reasons, lets the driver fix it, then approves', async () => {
      const d = await completeDriver();
      await ctx.http().post('/v1/driver/onboarding/submit').set(bearer(d.accessToken)).expect(200);
      const detail = await ctx.http().get(`/v1/admin/drivers/${d.userId}`).set(bearer(admin1.accessToken)).expect(200);
      const license = detail.body.documents.find((x: { type: string }) => x.type === 'driving_license');

      await ctx.http().post(`/v1/admin/drivers/${d.userId}/approve`).set(bearer(dispatcher1.accessToken)).expect(403);
      await ctx
        .http()
        .post(`/v1/admin/drivers/${d.userId}/reject`)
        .set(bearer(admin1.accessToken))
        .send({ reason: 'صورة الرخصة غير واضحة', documents: [{ documentId: license.id, reason: 'غير واضحة' }] })
        .expect(200);

      const back = await onboarding(d).expect(200);
      expect(back.body).toMatchObject({ status: 'rejected', rejectionReason: 'صورة الرخصة غير واضحة', canSubmit: false });
      expect(back.body.missing).toEqual(['document.driving_license']);
      const notified = await ctx.db.select().from(notifications).where(eq(notifications.userId, d.userId));
      expect(notified.some((n) => n.kind === 'driver_rejected')).toBe(true);

      await ctx.http().post(`/v1/admin/drivers/${d.userId}/approve`).set(bearer(admin1.accessToken)).expect(409);

      await upload(d, 'driving_license', FILES.jpeg, daysFromToday(500)).expect(201);
      await ctx.http().post('/v1/driver/onboarding/submit').set(bearer(d.accessToken)).expect(200);
      const approved = await ctx.http().post(`/v1/admin/drivers/${d.userId}/approve`).set(bearer(admin1.accessToken)).expect(200);
      expect(approved.body).toMatchObject({ onboardingStatus: 'approved', accountStatus: 'active', complianceHold: false });
      expect(approved.body.documents.every((x: { status: string }) => x.status === 'accepted')).toBe(true);

      const me = await ctx.http().get('/v1/me').set(bearer(d.accessToken)).expect(200);
      expect(me.body.status).toBe('active');
      await ctx.http().post(`/v1/admin/drivers/${d.userId}/approve`).set(bearer(admin1.accessToken)).expect(409);
    });
  });

  describe('compliance', () => {
    async function approvedDriver(): Promise<SignedIn> {
      const d = await completeDriver();
      await ctx.http().post('/v1/driver/onboarding/submit').set(bearer(d.accessToken)).expect(200);
      await ctx.http().post(`/v1/admin/drivers/${d.userId}/approve`).set(bearer(admin1.accessToken)).expect(200);
      return d;
    }

    async function setExpiry(driverId: string, type: string, date: string) {
      await ctx.db
        .update(documents)
        .set({ expiresAt: date })
        .where(and(eq(documents.driverId, driverId), eq(documents.type, type as 'driving_license'), isNull(documents.supersededAt)));
    }

    it('warns before expiry once per threshold', async () => {
      const d = await approvedDriver();
      await setExpiry(d.userId, 'vehicle_insurance', daysFromToday(5));
      const compliance = ctx.app.get(ComplianceService);

      const first = await compliance.scan();
      expect(first.warnings).toBeGreaterThanOrEqual(1);
      const again = await compliance.scan();
      expect(again.warnings).toBe(0);

      const inbox = await ctx.db.select().from(notifications).where(eq(notifications.userId, d.userId));
      const warnings = inbox.filter((n) => n.kind === 'document_expiring');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].bodyAr).toContain('5');

      const list = await ctx.http().get('/v1/admin/compliance/expiring?days=30').set(bearer(admin1.accessToken)).expect(200);
      const row = list.body.find((r: { driverId: string }) => r.driverId === d.userId);
      expect(row).toMatchObject({ type: 'vehicle_insurance', daysLeft: 5 });
      const other = await ctx.http().get('/v1/admin/compliance/expiring?days=30').set(bearer(admin2.accessToken)).expect(200);
      expect(other.body.find((r: { driverId: string }) => r.driverId === d.userId)).toBeUndefined();
    });

    it('holds a driver whose document expired and releases them after an accepted renewal', async () => {
      const d = await approvedDriver();
      await setExpiry(d.userId, 'driving_license', daysFromToday(-1));

      const result = await ctx.http().post('/v1/admin/compliance/scan').set(bearer(admin1.accessToken)).expect(403);
      expect(result.body.error.code).toBe('FORBIDDEN');
      const compliance = ctx.app.get(ComplianceService);
      const scan = await compliance.scan();
      expect(scan.holdsPlaced).toBeGreaterThanOrEqual(1);

      const held = await ctx.http().get(`/v1/admin/drivers/${d.userId}`).set(bearer(admin1.accessToken)).expect(200);
      expect(held.body).toMatchObject({ complianceHold: true, complianceReason: 'document_expired:driving_license' });
      const view = await onboarding(d).expect(200);
      expect(view.body.complianceHold).toBe(true);
      const heldList = await ctx.http().get('/v1/admin/drivers?hold=true').set(bearer(admin1.accessToken)).expect(200);
      expect(heldList.body.items.map((i: { id: string }) => i.id)).toContain(d.userId);

      const renewal = await upload(d, 'driving_license', FILES.jpeg, daysFromToday(700)).expect(201);
      const reviewed = await ctx
        .http()
        .patch(`/v1/admin/documents/${renewal.body.id}`)
        .set(bearer(admin1.accessToken))
        .send({ status: 'accepted' })
        .expect(200);
      expect(reviewed.body.complianceHold).toBe(false);

      const missingReason = await ctx
        .http()
        .patch(`/v1/admin/documents/${renewal.body.id}`)
        .set(bearer(admin1.accessToken))
        .send({ status: 'rejected' })
        .expect(400);
      expect(missingReason.body.error.code).toBe('VALIDATION_FAILED');
      await ctx
        .http()
        .patch(`/v1/admin/documents/${renewal.body.id}`)
        .set(bearer(admin2.accessToken))
        .send({ status: 'accepted' })
        .expect(404);
    });
  });

  it('lists the signed-in user’s notifications in their language and marks them read', async () => {
    const res = await ctx.http().get('/v1/notifications').set(bearer(admin1.accessToken)).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('title');
    await ctx.http().post(`/v1/notifications/${res.body[0].id}/read`).set(bearer(admin1.accessToken)).expect(204);
    await ctx.http().post('/v1/notifications/read-all').set(bearer(admin1.accessToken)).expect(204);
    const after = await ctx.http().get('/v1/notifications').set(bearer(admin1.accessToken)).expect(200);
    expect(after.body.every((n: { read: boolean }) => n.read)).toBe(true);
  });
});
