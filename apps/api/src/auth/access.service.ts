import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { numericCode, pepperedHash, safeEqualHex } from '../common/crypto';
import { AppError } from '../common/errors';
import { normalizeSaudiMobile } from '../common/phone';
import { partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { AccessInvite, accessInvites, type Audience, users } from '../database/schema';
import type { AuthUser } from './auth.types';
import { TokensService } from './tokens.service';

/** Access codes are 8 digits, so they never collide with the shorter SMS codes. */
export const ACCESS_CODE_LENGTH = 8;
const MAX_CODE_FAILURES = 5;

export interface InviteView {
  id: string;
  phone: string;
  audience: Audience;
  name: string | null;
  partnerId: string | null;
  hasCode: boolean;
  codeExpiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  /** Whether an account exists for this phone in that app. */
  signedUp: boolean;
}

export interface IssuedCode {
  invite: InviteView;
  /** Shown once: the code is stored hashed. */
  code: string;
  message: string;
  whatsappUrl: string;
}

/**
 * Who may use the apps during an invite-only pilot, and the access codes that let people sign in
 * without paid SMS. The team sends each code over WhatsApp from the dashboard.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
  ) {}

  get inviteOnly(): boolean {
    return this.env.ACCESS_MODE === 'invite';
  }

  /** Codes reach people by access code only (no SMS gateway configured). */
  get codesOnly(): boolean {
    return this.env.SMS_PROVIDER === 'none';
  }

  async activeInvite(phone: string, audience: Audience): Promise<AccessInvite | undefined> {
    return this.db.query.accessInvites.findFirst({
      where: and(eq(accessInvites.phone, phone), eq(accessInvites.audience, audience), isNull(accessInvites.revokedAt)),
    });
  }

  /** Riders and drivers need an invite while the pilot is invite-only. Admins are handled by their accounts. */
  async mayEnter(phone: string, audience: Audience): Promise<boolean> {
    if (audience === 'admin' || !this.inviteOnly) return true;
    return Boolean(await this.activeInvite(phone, audience));
  }

  /** Throws unless the code is the phone's current access code. On success the code is used up. */
  async verifyCode(phone: string, audience: Audience, code: string): Promise<void> {
    const invite = await this.activeInvite(phone, audience);
    if (!invite?.codeHash || !invite.codeExpiresAt) throw new AppError('AUTH_OTP_INVALID');
    if (invite.codeExpiresAt.getTime() < Date.now()) throw new AppError('AUTH_OTP_EXPIRED');
    if (!safeEqualHex(invite.codeHash, this.hash(invite.id, code))) {
      const failures = invite.codeFailures + 1;
      await this.db
        .update(accessInvites)
        .set(failures >= MAX_CODE_FAILURES ? { codeFailures: failures, codeHash: null } : { codeFailures: failures })
        .where(eq(accessInvites.id, invite.id));
      throw new AppError(failures >= MAX_CODE_FAILURES ? 'AUTH_OTP_TOO_MANY_ATTEMPTS' : 'AUTH_OTP_INVALID');
    }
    // Single use: only the request that clears the hash wins.
    const [used] = await this.db
      .update(accessInvites)
      .set({ codeHash: null, codeExpiresAt: null, codeFailures: 0, lastUsedAt: new Date() })
      .where(and(eq(accessInvites.id, invite.id), eq(accessInvites.codeHash, invite.codeHash)))
      .returning({ id: accessInvites.id });
    if (!used) throw new AppError('AUTH_OTP_EXPIRED');
  }

  async list(actor: AuthUser, q: { audience?: Audience; search?: string; partnerId?: string }): Promise<InviteView[]> {
    const scope = partnerScope(actor, q.partnerId);
    const where: SQL[] = [isNull(accessInvites.revokedAt)];
    if (scope) where.push(eq(accessInvites.partnerId, scope));
    if (q.audience) where.push(eq(accessInvites.audience, q.audience));
    if (q.search) {
      const term = `%${q.search.replace(/[%_]/g, '')}%`;
      where.push(or(ilike(accessInvites.name, term), ilike(accessInvites.phone, term)) as SQL);
    }
    const rows = await this.db
      .select({ invite: accessInvites, userId: users.id })
      .from(accessInvites)
      .leftJoin(
        users,
        and(eq(users.phone, accessInvites.phone), eq(users.audience, accessInvites.audience), isNull(users.deletedAt)),
      )
      .where(and(...where))
      .orderBy(desc(accessInvites.createdAt))
      .limit(500);
    return rows.map((r) => this.present(r.invite, Boolean(r.userId)));
  }

  /**
   * Invites a phone to an app and returns a fresh access code. Inviting a phone that already has
   * an invite just issues a new code.
   */
  async invite(
    actor: AuthUser,
    input: { phone: string; audience: Audience; name?: string | null; partnerId?: string | null; joinRequestId?: string | null },
    ip: string | null = null,
  ): Promise<IssuedCode> {
    const phone = normalizeSaudiMobile(input.phone);
    const partnerId = actor.role === 'super_admin' ? (input.partnerId ?? null) : (partnerScope(actor) as string);
    if (input.audience === 'admin') {
      const account = await this.db.query.users.findFirst({
        where: and(eq(users.phone, phone), eq(users.audience, 'admin'), isNull(users.deletedAt)),
      });
      // Admin codes only for people already on a team, and a partner can only reach its own team.
      if (!account || (actor.role !== 'super_admin' && account.partnerId !== actor.partnerId)) {
        throw new AppError('ACCESS_NO_ADMIN_ACCOUNT');
      }
    }

    let invite = await this.activeInvite(phone, input.audience);
    if (invite) {
      if (actor.role !== 'super_admin' && invite.partnerId && invite.partnerId !== actor.partnerId) {
        throw new AppError('ACCESS_INVITE_NOT_FOUND');
      }
      if (input.name && !invite.name) {
        [invite] = await this.db.update(accessInvites).set({ name: input.name }).where(eq(accessInvites.id, invite.id)).returning();
      }
    } else {
      [invite] = await this.db
        .insert(accessInvites)
        .values({
          phone,
          audience: input.audience,
          name: input.name?.trim() || null,
          partnerId,
          joinRequestId: input.joinRequestId ?? null,
          createdBy: actor.id,
        })
        .returning();
      await this.audit.record({
        actorId: actor.id,
        partnerId,
        action: 'access.invite',
        entity: 'access_invite',
        entityId: invite.id,
        after: { phone, audience: input.audience },
        ip,
      });
    }
    return this.issueCode(invite);
  }

  async newCode(actor: AuthUser, id: string): Promise<IssuedCode> {
    return this.issueCode(await this.findScoped(actor, id));
  }

  /** Removes the invite and signs the person out everywhere. */
  async revoke(actor: AuthUser, id: string, ip: string | null = null): Promise<void> {
    const invite = await this.findScoped(actor, id);
    await this.db.update(accessInvites).set({ revokedAt: new Date(), codeHash: null }).where(eq(accessInvites.id, invite.id));
    if (this.inviteOnly && invite.audience !== 'admin') {
      const user = await this.db.query.users.findFirst({
        where: and(eq(users.phone, invite.phone), eq(users.audience, invite.audience), isNull(users.deletedAt)),
      });
      if (user) await this.tokens.revokeAllForUser(user.id);
    }
    await this.audit.record({
      actorId: actor.id,
      partnerId: invite.partnerId,
      action: 'access.revoke',
      entity: 'access_invite',
      entityId: invite.id,
      before: { phone: invite.phone, audience: invite.audience },
      ip,
    });
  }

  /** For the server's command line: the first admin signs in with this before any dashboard exists. */
  async adminCodeFor(phone: string): Promise<string> {
    const normalized = normalizeSaudiMobile(phone);
    let invite = await this.activeInvite(normalized, 'admin');
    if (!invite) {
      [invite] = await this.db.insert(accessInvites).values({ phone: normalized, audience: 'admin' }).returning();
    }
    return (await this.issueCode(invite)).code;
  }

  // ------------------------------------------------------------------ internals

  private async findScoped(actor: AuthUser, id: string): Promise<AccessInvite> {
    const scope = partnerScope(actor);
    const invite = await this.db.query.accessInvites.findFirst({ where: and(eq(accessInvites.id, id), isNull(accessInvites.revokedAt)) });
    if (!invite || (scope && invite.partnerId !== scope)) throw new AppError('ACCESS_INVITE_NOT_FOUND');
    return invite;
  }

  private async issueCode(invite: AccessInvite): Promise<IssuedCode> {
    const code = numericCode(ACCESS_CODE_LENGTH);
    const expiresAt = new Date(Date.now() + this.env.ACCESS_CODE_TTL_DAYS * 86_400_000);
    const [updated] = await this.db
      .update(accessInvites)
      .set({ codeHash: this.hash(invite.id, code), codeExpiresAt: expiresAt, codeFailures: 0 })
      .where(eq(accessInvites.id, invite.id))
      .returning();
    const signedUp = Boolean(
      await this.db.query.users.findFirst({
        columns: { id: true },
        where: and(eq(users.phone, invite.phone), eq(users.audience, invite.audience), isNull(users.deletedAt)),
      }),
    );
    const message = this.message(updated, code);
    return {
      invite: this.present(updated, signedUp),
      code,
      message,
      whatsappUrl: `https://wa.me/${invite.phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`,
    };
  }

  /** The WhatsApp text the team sends: where to get the app, the phone to type, and the code. */
  private message(invite: AccessInvite, code: string): string {
    const local = invite.phone.replace(/^\+966/, '0');
    const hello = invite.name ? `أهلا ${invite.name.split(' ')[0]}،` : 'أهلا،';
    const web = this.env.RIDER_WEB_URL;
    const download = `${this.env.PUBLIC_WEB_URL}/download`;
    const lines =
      invite.audience === 'driver'
        ? [`${hello} تمت دعوتك للانضمام إلى سائقي مشوار.`, `حمّل تطبيق السائق: ${download}`]
        : invite.audience === 'admin'
          ? [`${hello} هذا رمز دخولك إلى لوحة تشغيل مشوار.`, `اللوحة: ${this.env.PUBLIC_WEB_URL}`]
          : [
              `${hello} تمت دعوتك لتجربة مشوار للتوصيل اليومي.`,
              `أندرويد: ${download}`,
              ...(web ? [`آيفون أو المتصفح: ${web}`] : []),
            ];
    return [
      ...lines,
      `رقم الجوال: ${local}`,
      `رمز الدخول: ${code}`,
      `الرمز صالح ${this.env.ACCESS_CODE_TTL_DAYS} أيام ولمرة واحدة. لا تشاركه مع أحد.`,
    ].join('\n');
  }

  private hash(inviteId: string, code: string): string {
    return pepperedHash(this.env.HASH_PEPPER, `access:${inviteId}:${code}`);
  }

  private present(i: AccessInvite, signedUp: boolean): InviteView {
    return {
      id: i.id,
      phone: i.phone,
      audience: i.audience,
      name: i.name,
      partnerId: i.partnerId,
      hasCode: Boolean(i.codeHash && i.codeExpiresAt && i.codeExpiresAt.getTime() > Date.now()),
      codeExpiresAt: i.codeExpiresAt ? i.codeExpiresAt.toISOString() : null,
      lastUsedAt: i.lastUsedAt ? i.lastUsedAt.toISOString() : null,
      createdAt: i.createdAt.toISOString(),
      signedUp,
    };
  }
}
