import { Inject, Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { deviceTokens, users } from '../database/schema';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushMessage {
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  kind: string;
  data?: Record<string, unknown> | null;
}

/**
 * Push notifications through Firebase Cloud Messaging (free, no message limits).
 * Off when FCM_SERVICE_ACCOUNT is empty: notifications then live only in the in-app inbox.
 * Delivery is best effort and never fails the action that caused it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly account: ServiceAccount | null;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) env: Env,
  ) {
    this.account = env.FCM_SERVICE_ACCOUNT
      ? (JSON.parse(Buffer.from(env.FCM_SERVICE_ACCOUNT, 'base64').toString('utf8')) as ServiceAccount)
      : null;
  }

  get enabled(): boolean {
    return this.account !== null;
  }

  /** Sends to every registered device of these users, each in the user's language. */
  async toUsers(userIds: string[], msg: PushMessage): Promise<void> {
    if (!this.account || userIds.length === 0) return;
    try {
      const rows = await this.db
        .select({ token: deviceTokens.token, userId: deviceTokens.userId })
        .from(deviceTokens)
        .where(inArray(deviceTokens.userId, userIds));
      if (rows.length === 0) return;
      const locales = await this.db
        .select({ id: users.id, locale: users.locale })
        .from(users)
        .where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]));
      const en = new Set(locales.filter((l) => l.locale === 'en').map((l) => l.id));
      await Promise.all(
        rows.map((r) =>
          this.send(r.token, en.has(r.userId) ? msg.titleEn : msg.titleAr, en.has(r.userId) ? msg.bodyEn : msg.bodyAr, {
            kind: msg.kind,
            ...(msg.data ?? {}),
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`Push failed: ${(err as Error).message}`);
    }
  }

  private async send(token: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
    const account = this.account as ServiceAccount;
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          // FCM data values must be strings.
          data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
          android: { priority: 'high', notification: { channel_id: 'trips', sound: 'default' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return;
    const text = await res.text();
    // The app was uninstalled or the token rotated: forget it.
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/.test(text)) {
      await this.db.delete(deviceTokens).where(inArray(deviceTokens.token, [token]));
      return;
    }
    this.logger.warn(`FCM ${res.status}: ${text.slice(0, 200)}`);
  }

  /** OAuth token for the service account (signed JWT exchanged at Google), cached for its lifetime. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const account = this.account as ServiceAccount;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google token ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}
