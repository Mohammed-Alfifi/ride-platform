import { eq } from 'drizzle-orm';
import { users } from '../src/database/schema';
import { bearer, createStaff, createTestApp, newPhone, signIn, TestContext } from './helpers';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    const keys = await ctx.redis.keys('throttle:*');
    if (keys.length) await ctx.redis.del(...keys);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('sign-up and sign-in', () => {
    it('creates a rider account on first sign-in and reuses it after', async () => {
      const phone = newPhone();
      const first = await signIn(ctx, phone, 'rider');
      expect(first.body).toMatchObject({
        isNewUser: true,
        accessTokenExpiresIn: 900,
        user: { phone, role: 'rider', audience: 'rider', status: 'active', locale: 'ar' },
      });
      expect(ctx.sms.sent.at(-1)?.message).toContain('رمز التحقق');

      await ctx.redis.del(`otp:cd:rider:${phone}`);
      const second = await signIn(ctx, phone, 'rider');
      expect(second.body.isNewUser).toBe(false);
      expect(second.userId).toBe(first.userId);
    });

    it('creates drivers as pending until a partner approves them', async () => {
      const res = await signIn(ctx, newPhone(), 'driver');
      expect(res.body).toMatchObject({ isNewUser: true, user: { role: 'driver', status: 'pending' } });
    });

    it('treats every common phone format as the same number', async () => {
      await ctx.http().post('/v1/auth/otp/request').send({ phone: '050 777 1234', app: 'rider' }).expect(200);
      const code = ctx.sms.lastCodeFor('+966507771234');
      const res = await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .send({ phone: '+966507771234', app: 'rider', code })
        .expect(200);
      expect(res.body.user.phone).toBe('+966507771234');
    });

    it('keeps rider, driver and admin accounts separate for the same phone', async () => {
      const phone = newPhone();
      const rider = await signIn(ctx, phone, 'rider');
      const driver = await signIn(ctx, phone, 'driver');
      expect(rider.userId).not.toBe(driver.userId);
    });

    it('sends the SMS in English when the app asks for English', async () => {
      const phone = newPhone();
      await ctx
        .http()
        .post('/v1/auth/otp/request')
        .set('Accept-Language', 'en')
        .send({ phone, app: 'rider' })
        .expect(200);
      expect(ctx.sms.sent.at(-1)?.message).toMatch(/^Your verification code is \d{6}/);
    });

    it('accepts the fixed code for configured test phones without sending an SMS', async () => {
      const before = ctx.sms.sent.length;
      await ctx.http().post('/v1/auth/otp/request').send({ phone: '+966500000099', app: 'rider' }).expect(200);
      expect(ctx.sms.sent.length).toBe(before);
      await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .send({ phone: '+966500000099', app: 'rider', code: '246810' })
        .expect(200);
    });
  });

  describe('validation and errors', () => {
    it('rejects an invalid phone with a localised message', async () => {
      const ar = await ctx.http().post('/v1/auth/otp/request').send({ phone: '12345', app: 'rider' }).expect(400);
      expect(ar.body.error.code).toBe('AUTH_PHONE_INVALID');
      expect(ar.body.error.message).toContain('رقم الجوال');
      expect(ar.body.requestId).toBeDefined();

      const en = await ctx
        .http()
        .post('/v1/auth/otp/request')
        .set('Accept-Language', 'en-US')
        .send({ phone: '12345', app: 'rider' })
        .expect(400);
      expect(en.body.error.message).toMatch(/Invalid phone number/);
    });

    it('rejects unknown fields and bad app values', async () => {
      const res = await ctx
        .http()
        .post('/v1/auth/otp/request')
        .send({ phone: '0501234567', app: 'rider', role: 'super_admin' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      await ctx.http().post('/v1/auth/otp/request').send({ phone: '0501234567', app: 'root' }).expect(400);
    });
  });

  describe('one-time codes', () => {
    it('rejects a wrong code, then locks the code after too many attempts', async () => {
      const phone = newPhone();
      await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(200);
      const code = ctx.sms.lastCodeFor(phone);
      const wrong = code === '000000' ? '111111' : '000000';

      const r1 = await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: wrong }).expect(401);
      expect(r1.body.error.code).toBe('AUTH_OTP_INVALID');
      await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: wrong }).expect(401);
      const r3 = await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code: wrong }).expect(429);
      expect(r3.body.error.code).toBe('AUTH_OTP_TOO_MANY_ATTEMPTS');

      const after = await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code }).expect(401);
      expect(after.body.error.code).toBe('AUTH_OTP_EXPIRED');
    });

    it('works only once', async () => {
      const phone = newPhone();
      await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(200);
      const code = ctx.sms.lastCodeFor(phone);
      await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code }).expect(200);
      const again = await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code }).expect(401);
      expect(again.body.error.code).toBe('AUTH_OTP_EXPIRED');
    });

    it('cannot be used to sign in to a different app', async () => {
      const phone = newPhone();
      await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(200);
      const code = ctx.sms.lastCodeFor(phone);
      await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'driver', code }).expect(401);
    });

    it('enforces the resend cooldown with Retry-After', async () => {
      const phone = newPhone();
      await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(200);
      const res = await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(429);
      expect(res.body.error.code).toBe('AUTH_OTP_RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('caps codes per phone per hour', async () => {
      const phone = newPhone();
      for (let i = 0; i < 5; i++) {
        await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(200);
        await ctx.redis.del(`otp:cd:rider:${phone}`); // simulate the cooldown passing
      }
      const res = await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(429);
      expect(res.body.error.code).toBe('AUTH_OTP_RATE_LIMITED');
    });
  });

  describe('admin sign-in', () => {
    it('answers identically for unknown phones but sends nothing and never signs in', async () => {
      const phone = newPhone();
      const before = ctx.sms.sent.length;
      const res = await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'admin' }).expect(200);
      expect(res.body).toEqual({ sent: true, expiresIn: 300, resendAfter: 60 });
      expect(ctx.sms.sent.length).toBe(before);
      await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'admin', code: '123456' }).expect(401);
      const rows = await ctx.db.select().from(users).where(eq(users.phone, phone));
      expect(rows).toHaveLength(0);
    });

    it('signs in staff created by an admin', async () => {
      const staff = await createStaff(ctx, 'super_admin');
      const res = await signIn(ctx, staff.phone, 'admin');
      expect(res.body).toMatchObject({ isNewUser: false, user: { role: 'super_admin', partnerId: null } });
    });

    it('does not send codes to suspended staff', async () => {
      const staff = await createStaff(ctx, 'super_admin');
      await ctx.db.update(users).set({ status: 'suspended' }).where(eq(users.id, staff.id));
      const before = ctx.sms.sent.length;
      await ctx.http().post('/v1/auth/otp/request').send({ phone: staff.phone, app: 'admin' }).expect(200);
      expect(ctx.sms.sent.length).toBe(before);
    });
  });

  it('refuses suspended riders at sign-in', async () => {
    const phone = newPhone();
    const first = await signIn(ctx, phone, 'rider');
    await ctx.db.update(users).set({ status: 'suspended' }).where(eq(users.id, first.userId));
    await ctx.redis.del(`otp:cd:rider:${phone}`);
    await ctx.http().post('/v1/auth/otp/request').send({ phone, app: 'rider' }).expect(200);
    const code = ctx.sms.lastCodeFor(phone);
    const res = await ctx.http().post('/v1/auth/otp/verify').send({ phone, app: 'rider', code }).expect(403);
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_SUSPENDED');
  });

  describe('tokens and sessions', () => {
    it('protects routes with the access token', async () => {
      const s = await signIn(ctx, newPhone(), 'rider');
      await ctx.http().get('/v1/me').set(bearer(s.accessToken)).expect(200);
      await ctx.http().get('/v1/me').expect(401);
      const bad = await ctx.http().get('/v1/me').set(bearer('not.a.jwt')).expect(401);
      expect(bad.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('rotates refresh tokens and ends the session when an old one is replayed', async () => {
      const s = await signIn(ctx, newPhone(), 'rider');
      const r1 = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
      expect(r1.body.refreshToken).not.toBe(s.refreshToken);
      await ctx.http().get('/v1/me').set(bearer(r1.body.accessToken)).expect(200);

      // Replaying the first token looks like theft: both tokens of the family die.
      const replay = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
      expect(replay.body.error.code).toBe('AUTH_REFRESH_REUSED');
      const after = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
      expect(after.body.error.code).toBe('AUTH_REFRESH_REUSED');
    });

    it('rejects malformed and forged refresh tokens', async () => {
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: 'garbage' }).expect(401);
      const s = await signIn(ctx, newPhone(), 'rider');
      const [id] = s.refreshToken.split('.');
      const forged = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: `${id}.forged` }).expect(401);
      expect(forged.body.error.code).toBe('AUTH_REFRESH_INVALID');
    });

    it('logs out one session', async () => {
      const s = await signIn(ctx, newPhone(), 'rider');
      await ctx.http().post('/v1/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('logs out everywhere and kills live access tokens immediately', async () => {
      const phone = newPhone();
      const a = await signIn(ctx, phone, 'rider');
      await ctx.redis.del(`otp:cd:rider:${phone}`);
      const b = await signIn(ctx, phone, 'rider');

      await ctx.http().post('/v1/auth/logout-all').set(bearer(a.accessToken)).expect(204);
      await ctx.http().get('/v1/me').set(bearer(a.accessToken)).expect(401);
      await ctx.http().get('/v1/me').set(bearer(b.accessToken)).expect(401);
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
    });
  });

  describe('profile', () => {
    it('updates name and language', async () => {
      const s = await signIn(ctx, newPhone(), 'rider');
      const res = await ctx
        .http()
        .patch('/v1/me')
        .set(bearer(s.accessToken))
        .send({ name: '  سارة  ', locale: 'en' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'سارة', locale: 'en' });
    });
  });

  it('rate-limits code requests per client', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await ctx.http().post('/v1/auth/otp/request').send({ phone: newPhone(), app: 'rider' });
      last = res.status;
      if (i < 10) expect(res.status).toBe(200);
    }
    expect(last).toBe(429);
  });

  it('reports health of its dependencies', async () => {
    const res = await ctx.http().get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });
});
