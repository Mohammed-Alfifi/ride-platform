import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, notInArray, SQL, sql } from 'drizzle-orm';
import { AccessService, IssuedCode } from '../auth/access.service';
import type { AuthUser } from '../auth/auth.types';
import { TokensService } from '../auth/tokens.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { normalizeSaudiMobile } from '../common/phone';
import { riyadhToday } from '../common/saudi';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  deviceTokens,
  familyMembers,
  JoinRequest,
  joinRequests,
  subscriptions,
  trips,
  users,
} from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { TripGenerator } from '../trips/trip.generator';

export interface JoinInput {
  kind: 'rider' | 'driver';
  name: string;
  phone: string;
  city: string;
  district?: string;
  destination?: string;
  morningTime?: string;
  returnTime?: string;
  riders?: number;
  car?: string;
  note?: string;
  /** Honeypot: people never see this field, bots fill it. */
  website?: string;
}

/** What the apps need to know about how this server runs, before anyone signs in. */
export interface AppConfigView {
  accessMode: 'open' | 'invite';
  signIn: 'sms' | 'access_code';
  paymentMode: 'online' | 'manual';
  paymentInstructions: { ar: string; en: string };
  supportWhatsapp: string | null;
  termsVersion: string;
  links: { terms: string; privacy: string; join: string; download: string; deleteAccount: string };
  pushEnabled: boolean;
  emergencyNumber: string;
}

@Injectable()
export class PilotService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly tripGenerator: TripGenerator,
  ) {}

  appConfig(): AppConfigView {
    const web = this.env.PUBLIC_WEB_URL;
    return {
      accessMode: this.env.ACCESS_MODE,
      signIn: this.env.SMS_PROVIDER === 'none' ? 'access_code' : 'sms',
      paymentMode: this.env.PAYMENT_PROVIDER === 'manual' ? 'manual' : 'online',
      paymentInstructions: {
        ar:
          this.env.PAYMENT_INSTRUCTIONS_AR ||
          'ادفع بالتحويل البنكي أو نقدا، وأرسل صورة الإيصال للدعم. يُفعَّل اشتراكك بعد تأكيد الاستلام.',
        en:
          this.env.PAYMENT_INSTRUCTIONS_EN ||
          'Pay by bank transfer or cash and send the receipt to support. Your subscription starts once we confirm it.',
      },
      supportWhatsapp: this.env.SUPPORT_WHATSAPP ? normalizeSaudiMobile(this.env.SUPPORT_WHATSAPP) : null,
      termsVersion: this.env.TERMS_VERSION,
      links: {
        terms: `${web}/terms`,
        privacy: `${web}/privacy`,
        join: `${web}/join`,
        download: `${web}/download`,
        deleteAccount: `${web}/delete-account`,
      },
      pushEnabled: this.push.enabled,
      emergencyNumber: '911',
    };
  }

  // ------------------------------------------------------------------ join requests

  /** Public form. A repeat from the same phone updates the open request instead of adding another. */
  async submitJoin(input: JoinInput): Promise<{ received: true }> {
    if (input.website) return { received: true };
    const phone = normalizeSaudiMobile(input.phone);
    const values = {
      kind: input.kind,
      name: input.name.trim(),
      phone,
      city: input.city.trim(),
      district: input.district?.trim() || null,
      destination: input.destination?.trim() || null,
      morningTime: input.morningTime || null,
      returnTime: input.returnTime || null,
      riders: input.kind === 'rider' ? (input.riders ?? 1) : null,
      car: input.kind === 'driver' ? input.car?.trim() || null : null,
      note: input.note?.trim() || null,
    };
    const open = await this.db.query.joinRequests.findFirst({
      where: and(eq(joinRequests.phone, phone), eq(joinRequests.kind, input.kind), eq(joinRequests.status, 'new')),
    });
    if (open) {
      await this.db.update(joinRequests).set(values).where(eq(joinRequests.id, open.id));
      return { received: true };
    }
    const [row] = await this.db.insert(joinRequests).values(values).returning();
    const admins = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ['super_admin', 'partner_admin']), eq(users.status, 'active'), isNull(users.deletedAt)));
    await this.notifications.notify(
      admins.map((a) => a.id),
      {
        kind: 'join_request',
        titleAr: row.kind === 'driver' ? 'طلب انضمام سائق' : 'طلب انضمام جديد',
        titleEn: row.kind === 'driver' ? 'New driver application' : 'New join request',
        bodyAr: `${row.name}، ${row.city}${row.district ? `، ${row.district}` : ''}`,
        bodyEn: `${row.name}, ${row.city}${row.district ? `, ${row.district}` : ''}`,
        data: { joinRequestId: row.id },
      },
    );
    return { received: true };
  }

  async joinRequests(actor: AuthUser, q: { status?: 'new' | 'invited' | 'declined'; kind?: 'rider' | 'driver' }) {
    this.assertReviewer(actor);
    const where: SQL[] = [];
    if (q.status) where.push(eq(joinRequests.status, q.status));
    if (q.kind) where.push(eq(joinRequests.kind, q.kind));
    const rows = await this.db
      .select()
      .from(joinRequests)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(joinRequests.createdAt))
      .limit(500);
    return rows.map((r) => this.presentJoin(r));
  }

  /** Approves an application: invites the phone and returns the WhatsApp message with the access code. */
  async inviteFromRequest(actor: AuthUser, id: string, ip: string | null): Promise<IssuedCode> {
    this.assertReviewer(actor);
    const req = await this.findJoin(id);
    if (req.status === 'declined') throw new AppError('JOIN_REQUEST_HANDLED');
    const issued = await this.access.invite(
      actor,
      { phone: req.phone, audience: req.kind, name: req.name, joinRequestId: req.id },
      ip,
    );
    await this.db
      .update(joinRequests)
      .set({ status: 'invited', handledBy: actor.id, handledAt: new Date() })
      .where(eq(joinRequests.id, req.id));
    return issued;
  }

  async declineRequest(actor: AuthUser, id: string): Promise<void> {
    this.assertReviewer(actor);
    const req = await this.findJoin(id);
    if (req.status !== 'new') throw new AppError('JOIN_REQUEST_HANDLED');
    await this.db
      .update(joinRequests)
      .set({ status: 'declined', handledBy: actor.id, handledAt: new Date() })
      .where(eq(joinRequests.id, req.id));
  }

  // ------------------------------------------------------------------ the signed-in user

  async acceptTerms(userId: string, version: string): Promise<void> {
    await this.db.update(users).set({ termsVersion: version, termsAcceptedAt: new Date() }).where(eq(users.id, userId));
  }

  /**
   * Deletes a rider or driver account. Personal details are removed; payments and invoices are kept
   * because the law requires it, linked to the phone number only.
   */
  async deleteAccount(actor: AuthUser, ip: string | null): Promise<void> {
    const today = riyadhToday();
    if (actor.role === 'rider') {
      const running = await this.db.query.subscriptions.findFirst({
        columns: { id: true },
        where: and(eq(subscriptions.riderId, actor.id), inArray(subscriptions.status, ['active', 'past_due', 'paused'])),
      });
      if (running) throw new AppError('ACCOUNT_HAS_ACTIVE_SUBSCRIPTION');
      await this.db
        .update(subscriptions)
        .set({ status: 'cancelled' })
        .where(and(eq(subscriptions.riderId, actor.id), eq(subscriptions.status, 'pending_payment')));
      await this.db.update(familyMembers).set({ deletedAt: new Date() }).where(eq(familyMembers.ownerId, actor.id));
    } else if (actor.role === 'driver') {
      const busy = await this.db.query.trips.findFirst({
        columns: { id: true },
        where: and(
          eq(trips.driverId, actor.id),
          eq(trips.serviceDate, today),
          notInArray(trips.status, ['completed', 'no_show', 'skipped', 'cancelled']),
        ),
      });
      if (busy) throw new AppError('ACCOUNT_HAS_TRIPS_TODAY');
      // Hand the driver's riders back to the operator to reassign.
      const subs = await this.db
        .update(subscriptions)
        .set({ driverId: null })
        .where(eq(subscriptions.driverId, actor.id))
        .returning({ id: subscriptions.id, partnerId: subscriptions.partnerId });
      for (const s of subs) await this.tripGenerator.reassignFuture(s.id, null);
      const partners = [...new Set(subs.map((s) => s.partnerId))];
      for (const p of partners) {
        await this.notifications.notify(await this.notifications.partnerAdminIds(p), {
          kind: 'driver_left',
          titleAr: 'سائق حذف حسابه',
          titleEn: 'A driver deleted their account',
          bodyAr: 'عيّن سائقا آخر لاشتراكاته من شاشة الاشتراكات.',
          bodyEn: 'Assign another driver to their subscriptions.',
        });
      }
    } else {
      throw new AppError('FORBIDDEN');
    }
    await this.db
      .update(users)
      .set({ deletedAt: new Date(), name: null, status: 'suspended', tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, actor.id));
    await this.db.delete(deviceTokens).where(eq(deviceTokens.userId, actor.id));
    await this.tokens.revokeAllForUser(actor.id);
    await this.audit.record({ actorId: actor.id, partnerId: null, action: 'account.delete', entity: 'user', entityId: actor.id, ip });
  }

  /** Active subscriptions right now, for the pilot cap. */
  async activeSubscriptions(): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ['active', 'past_due', 'paused']));
    return row?.n ?? 0;
  }

  /** Requests over the last N days, for the overview. */
  async newJoinCount(days = 30): Promise<number> {
    const since = new Date(Date.now() - days * 86_400_000);
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(joinRequests)
      .where(and(eq(joinRequests.status, 'new'), gte(joinRequests.createdAt, since)));
    return row?.n ?? 0;
  }

  // ------------------------------------------------------------------ internals

  private assertReviewer(actor: AuthUser): void {
    if (actor.role !== 'super_admin' && actor.role !== 'partner_admin') throw new AppError('FORBIDDEN');
  }

  private async findJoin(id: string): Promise<JoinRequest> {
    const req = await this.db.query.joinRequests.findFirst({ where: eq(joinRequests.id, id) });
    if (!req) throw new AppError('JOIN_REQUEST_NOT_FOUND');
    return req;
  }

  private presentJoin(r: JoinRequest) {
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      phone: r.phone,
      city: r.city,
      district: r.district,
      destination: r.destination,
      morningTime: r.morningTime,
      returnTime: r.returnTime,
      riders: r.riders,
      car: r.car,
      note: r.note,
      status: r.status,
      handledAt: r.handledAt ? r.handledAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
