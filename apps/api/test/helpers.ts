import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_PROVIDER, SmsProvider } from '../src/auth/sms/sms.provider';
import { configureApp } from '../src/bootstrap';
import { joinCode } from '../src/common/crypto';
import { isValidSaudiNationalId } from '../src/common/saudi';
import { ENV } from '../src/config/config.module';
import { Env, loadEnv } from '../src/config/env';
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

/** @param overrides settings for this app only, e.g. an invite-only pilot with manual payments. */
export async function createTestApp(overrides: Partial<Env> = {}): Promise<TestContext> {
  const env = { ...loadEnv(), ...overrides };
  if (!migrated) {
    await runMigrations(env.DATABASE_URL);
    migrated = true;
  }
  const sms = new CapturingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(ENV)
    .useValue(env)
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
    .values({ nameAr: `${name} ع`, nameEn: name, joinCode: joinCode() })
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

/** Smallest byte sequences each format is recognised by, padded to look like a real file. */
export const FILES = {
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 2)]),
  pdf: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 3)]),
  text: Buffer.from('this is not a document'),
};

/** A date N days from today in Riyadh, as YYYY-MM-DD. */
export function daysFromToday(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Builds a valid Saudi national ID from 9 leading digits by computing the check digit. */
export function withCheckDigit(first9: string): string {
  for (let d = 0; d <= 9; d++) {
    if (isValidSaudiNationalId(first9 + d)) return first9 + d;
  }
  throw new Error('no check digit');
}
