import { and, eq } from 'drizzle-orm';
import { auditLogs } from '../src/database/schema';
import { bearer, createPartner, createStaff, createTestApp, newPhone, signIn, SignedIn, TestContext } from './helpers';

describe('Admin: partners and users (e2e)', () => {
  let ctx: TestContext;
  let p1: string;
  let p2: string;
  let superAdmin: SignedIn;
  let admin1: SignedIn;
  let admin2: SignedIn;
  let dispatcher1: SignedIn;
  let rider: SignedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
    p1 = await createPartner(ctx, 'Alpha');
    p2 = await createPartner(ctx, 'Beta');
    superAdmin = await signIn(ctx, (await createStaff(ctx, 'super_admin')).phone, 'admin');
    admin1 = await signIn(ctx, (await createStaff(ctx, 'partner_admin', p1)).phone, 'admin');
    admin2 = await signIn(ctx, (await createStaff(ctx, 'partner_admin', p2)).phone, 'admin');
    dispatcher1 = await signIn(ctx, (await createStaff(ctx, 'dispatcher', p1)).phone, 'admin');
    rider = await signIn(ctx, newPhone(), 'rider');
  });

  beforeEach(async () => {
    const keys = await ctx.redis.keys('throttle:*');
    if (keys.length) await ctx.redis.del(...keys);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('partners', () => {
    it('lets a super admin register a partner and records it in the audit log', async () => {
      const res = await ctx
        .http()
        .post('/v1/admin/partners')
        .set(bearer(superAdmin.accessToken))
        .send({ nameAr: 'شركة جاما', nameEn: 'Gamma Co', crNumber: '1010999888', commissionBps: 1200 })
        .expect(201);
      expect(res.body).toMatchObject({ nameEn: 'Gamma Co', status: 'active', commissionBps: 1200, staffCount: 0 });

      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'partner.create'), eq(auditLogs.entityId, res.body.id)));
      expect(logs).toHaveLength(1);
      expect(logs[0].actorId).toBe(superAdmin.userId);

      const dup = await ctx
        .http()
        .post('/v1/admin/partners')
        .set(bearer(superAdmin.accessToken))
        .send({ nameAr: 'مكرر', nameEn: 'Dup', crNumber: '1010999888' })
        .expect(409);
      expect(dup.body.error.code).toBe('PARTNER_CR_EXISTS');
    });

    it('validates partner input', async () => {
      const res = await ctx
        .http()
        .post('/v1/admin/partners')
        .set(bearer(superAdmin.accessToken))
        .send({ nameAr: 'س', nameEn: 'X', crNumber: '12', commissionBps: 20000 })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(Array.isArray(res.body.error.details)).toBe(true);
    });

    it('shows partner staff only their own partner', async () => {
      const list = await ctx.http().get('/v1/admin/partners').set(bearer(admin1.accessToken)).expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).toEqual([p1]);
      await ctx.http().get(`/v1/admin/partners/${p2}`).set(bearer(admin1.accessToken)).expect(404);

      const all = await ctx.http().get('/v1/admin/partners').set(bearer(superAdmin.accessToken)).expect(200);
      expect(all.body.length).toBeGreaterThanOrEqual(2);
    });

    it('allows only super admins to create or edit partners', async () => {
      await ctx
        .http()
        .post('/v1/admin/partners')
        .set(bearer(admin1.accessToken))
        .send({ nameAr: 'محاولة', nameEn: 'Try' })
        .expect(403);
      await ctx.http().patch(`/v1/admin/partners/${p1}`).set(bearer(admin1.accessToken)).send({ commissionBps: 0 }).expect(403);
    });

    it('keeps riders out of every admin route', async () => {
      await ctx.http().get('/v1/admin/partners').set(bearer(rider.accessToken)).expect(403);
      await ctx.http().get('/v1/admin/users').set(bearer(rider.accessToken)).expect(403);
    });
  });

  describe('staff', () => {
    it('lets a partner admin add a dispatcher to their own partner only', async () => {
      const phone = newPhone();
      const res = await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(admin1.accessToken))
        .send({ phone, name: 'منسق جديد', role: 'dispatcher' })
        .expect(201);
      expect(res.body).toMatchObject({ phone, role: 'dispatcher', partnerId: p1, audience: 'admin' });

      await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(admin1.accessToken))
        .send({ phone: newPhone(), name: 'خارج النطاق', role: 'dispatcher', partnerId: p2 })
        .expect(403);

      const signedIn = await signIn(ctx, phone, 'admin');
      expect(signedIn.body).toMatchObject({ user: { role: 'dispatcher', partnerId: p1 } });
    });

    it('refuses duplicates and privilege escalation', async () => {
      const phone = newPhone();
      await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(admin1.accessToken))
        .send({ phone, name: 'أول', role: 'dispatcher' })
        .expect(201);
      const dup = await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(admin1.accessToken))
        .send({ phone, name: 'ثاني', role: 'dispatcher' })
        .expect(409);
      expect(dup.body.error.code).toBe('USER_ALREADY_EXISTS');

      await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(admin1.accessToken))
        .send({ phone: newPhone(), name: 'مدير عام', role: 'super_admin' })
        .expect(403);
      await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(dispatcher1.accessToken))
        .send({ phone: newPhone(), name: 'منسق', role: 'dispatcher' })
        .expect(403);
    });

    it('requires a partner when a super admin adds partner staff', async () => {
      await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(superAdmin.accessToken))
        .send({ phone: newPhone(), name: 'بدون شريك', role: 'partner_admin' })
        .expect(400);
      const res = await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(superAdmin.accessToken))
        .send({ phone: newPhone(), name: 'مدير بيتا', role: 'partner_admin', partnerId: p2 })
        .expect(201);
      expect(res.body.partnerId).toBe(p2);
    });

    it('isolates user lists by partner', async () => {
      const mine = await ctx.http().get('/v1/admin/users').set(bearer(admin1.accessToken)).expect(200);
      expect(mine.body.total).toBeGreaterThan(0);
      expect(mine.body.items.every((u: { partnerId: string }) => u.partnerId === p1)).toBe(true);

      await ctx.http().get(`/v1/admin/users?partnerId=${p2}`).set(bearer(admin1.accessToken)).expect(403);
      await ctx.http().get(`/v1/admin/users/${admin2.userId}`).set(bearer(admin1.accessToken)).expect(404);

      const theirs = await ctx
        .http()
        .get(`/v1/admin/users?partnerId=${p2}`)
        .set(bearer(superAdmin.accessToken))
        .expect(200);
      expect(theirs.body.items.every((u: { partnerId: string }) => u.partnerId === p2)).toBe(true);
    });

    it('searches by name and phone and paginates', async () => {
      const phone = newPhone();
      await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(admin1.accessToken))
        .send({ phone, name: 'خالد البحث', role: 'dispatcher' })
        .expect(201);
      const byName = await ctx
        .http()
        .get(`/v1/admin/users?q=${encodeURIComponent('البحث')}`)
        .set(bearer(admin1.accessToken))
        .expect(200);
      expect(byName.body.items.map((u: { phone: string }) => u.phone)).toContain(phone);

      const local = '0' + phone.slice(4);
      const byPhone = await ctx.http().get(`/v1/admin/users?q=${local}`).set(bearer(admin1.accessToken)).expect(200);
      expect(byPhone.body.items.map((u: { phone: string }) => u.phone)).toContain(phone);

      const page = await ctx.http().get('/v1/admin/users?pageSize=1&page=1').set(bearer(admin1.accessToken)).expect(200);
      expect(page.body.items).toHaveLength(1);
      expect(page.body.pageSize).toBe(1);
    });

    it('suspends a user and cuts off their access at once', async () => {
      const staff = await createStaff(ctx, 'dispatcher', p1);
      const session = await signIn(ctx, staff.phone, 'admin');
      await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(200);

      await ctx
        .http()
        .patch(`/v1/admin/users/${staff.id}`)
        .set(bearer(admin1.accessToken))
        .send({ status: 'suspended' })
        .expect(200);

      await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(401);
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    });

    it('applies a role change on the next refresh and invalidates the old access token', async () => {
      const staff = await createStaff(ctx, 'dispatcher', p1);
      const session = await signIn(ctx, staff.phone, 'admin');
      await ctx
        .http()
        .patch(`/v1/admin/users/${staff.id}`)
        .set(bearer(admin1.accessToken))
        .send({ role: 'partner_admin' })
        .expect(200);

      await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(401);
      const refreshed = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(200);
      const me = await ctx.http().get('/v1/me').set(bearer(refreshed.body.accessToken)).expect(200);
      expect(me.body.role).toBe('partner_admin');
      // The new role can now add staff.
      await ctx
        .http()
        .post('/v1/admin/users')
        .set(bearer(refreshed.body.accessToken))
        .send({ phone: newPhone(), name: 'إضافة', role: 'dispatcher' })
        .expect(201);
    });

    it('stops users from changing their own role or status', async () => {
      const res = await ctx
        .http()
        .patch(`/v1/admin/users/${admin1.userId}`)
        .set(bearer(admin1.accessToken))
        .send({ status: 'suspended' })
        .expect(400);
      expect(res.body.error.code).toBe('USER_CANNOT_MODIFY_SELF');
    });
  });

  it('suspending a partner signs out its staff and blocks their sign-in', async () => {
    const p3 = await createPartner(ctx, 'Delta');
    const staff = await createStaff(ctx, 'partner_admin', p3);
    const session = await signIn(ctx, staff.phone, 'admin');

    await ctx
      .http()
      .patch(`/v1/admin/partners/${p3}`)
      .set(bearer(superAdmin.accessToken))
      .send({ status: 'suspended' })
      .expect(200);

    await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(401);
    await ctx.redis.del(`otp:cd:admin:${staff.phone}`);
    await ctx.http().post('/v1/auth/otp/request').send({ phone: staff.phone, app: 'admin' }).expect(200);
    const code = ctx.sms.lastCodeFor(staff.phone);
    const res = await ctx.http().post('/v1/auth/otp/verify').send({ phone: staff.phone, app: 'admin', code }).expect(403);
    expect(res.body.error.code).toBe('PARTNER_SUSPENDED');
  });
});
