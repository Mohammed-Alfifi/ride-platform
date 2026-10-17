import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_PROVIDER, SmsProvider } from '../src/auth/sms/sms.provider';
import { configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env';
import { DB, Database } from '../src/database/database.module';
import { runMigrations } from '../src/database/migrate';
import { partners, users, type Role } from '../src/database/schema';
import { REDIS } from '../src/redis/redis.module';

/** Captures outgoing SMS so tests can read the code a real user would receive. */
export class CapturingSms implements SmsProvider {
  readonly sent: { to: string; message: string }[] = [];
  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message });
  }
  lastCodeFor(to: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === to);
    const code = msg?.message.match(/\d{4,8}/)?.[0];
    if (!code) throw new Error(`No SMS captured for ${to}`);
    return code;
  }
}

export interface TestContext {
  app: INestApplication;
  db: Database;
  redis: Redis;
  sms: CapturingSms;
  http: () => ReturnType<typeof request>;
}

let migrated = false;

export async function createTestApp(): Promise<TestContext> {
  const env = loadEnv();
  if (!migrated) {
    await runMigrations(env.DATABASE_URL);
    migrated = true;
  }
  const sms = new CapturingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, env);
  await app.init();

  const ctx: TestContext = {
    app,
    db: app.get(DB),
    redis: app.get(REDIS),
    sms,
    http: () => request(app.getHttpServer()),
  };
  await resetState(ctx);
  return ctx;
}

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.db.execute(sql`TRUNCATE audit_logs, refresh_tokens, users, partners RESTART IDENTITY CASCADE`);
  await ctx.redis.flushdb();
}

let phoneCounter = 1000;
/** A fresh valid Saudi mobile number per call, so rate limits never collide between tests. */
export function newPhone(): string {
  phoneCounter += 1;
  return `+9665012${String(phoneCounter).padStart(5, '0')}`;
}

export async function createPartner(ctx: TestContext, name = 'Partner'): Promise<string> {
  const [p] = await ctx.db
    .insert(partners)
    .values({ nameAr: `${name} ع`, nameEn: name })
    .returning({ id: partners.id });
  return p.id;
}

export async function createStaff(
  ctx: TestContext,
  role: Extract<Role, 'super_admin' | 'partner_admin' | 'dispatcher'>,
  partnerId: string | null = null,
): Promise<{ id: string; phone: string }> {
  const phone = newPhone();
  const [u] = await ctx.db
    .insert(users)
    .values({ phone, role, audience: 'admin', partnerId, name: role })
    .returning({ id: users.id });
  return { id: u.id, phone };
}

export interface SignedIn {
  accessToken: string;
  refreshToken: string;
  userId: string;
  body: Record<string, unknown>;
}

export async function signIn(
  ctx: TestContext,
  phone: string,
  app: 'rider' | 'driver' | 'admin',
): Promise<SignedIn> {
  await ctx.http().post('/v1/auth/otp/request').send({ phone, app }).expect(200);
  const code = ctx.sms.lastCodeFor(phone);
  const res = await ctx.http().post('/v1/auth/otp/verify').send({ phone, app, code }).expect(200);
  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
    body: res.body,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
