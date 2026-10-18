import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { normalizeSaudiMobile } from '../common/phone';
import { DB, Database } from '../database/database.module';
import { partners, User, users, type Audience } from '../database/schema';
import { presentUser } from '../users/user.presenter';
import type { RequestMeta } from './auth.types';
import { AuthResponse, OtpRequestResponse, TokenPairView } from './auth.dto';
import { ACCESS_CODE_LENGTH, AccessService } from './access.service';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly access: AccessService,
  ) {}

  async requestOtp(rawPhone: string, app: Audience, locale: 'ar' | 'en'): Promise<OtpRequestResponse> {
    const phone = normalizeSaudiMobile(rawPhone);
    // During an invite-only pilot, only invited phones may use the rider and driver apps.
    if (!(await this.access.mayEnter(phone, app))) throw new AppError('AUTH_NOT_INVITED');
    // No SMS gateway: the person types the access code the team sent them.
    if (this.access.codesOnly) return { sent: true, channel: 'access_code', expiresIn: 0, resendAfter: 0 };
    // Riders and drivers may sign up; the admin app only serves accounts created by an admin.
    const deliver = app === 'admin' ? Boolean(await this.findActiveAccount(phone, app)) : true;
    const result = await this.otp.request(phone, app, deliver, locale);
    return { sent: true, channel: 'sms', ...result };
  }

  async verifyOtp(rawPhone: string, app: Audience, code: string, meta: RequestMeta): Promise<AuthResponse> {
    const phone = normalizeSaudiMobile(rawPhone);
    if (!(await this.access.mayEnter(phone, app))) throw new AppError('AUTH_NOT_INVITED');
    // Eight digits: an access code from the team. Shorter: an SMS code.
    if (code.length === ACCESS_CODE_LENGTH) await this.access.verifyCode(phone, app, code);
    else if (this.access.codesOnly) {
      // No SMS: only the fixed test code of OTP_TEST_PHONES (store reviewers, the first admin of a demo).
      if (!this.otp.isTestCode(phone, code)) throw new AppError('AUTH_OTP_INVALID');
    }
    else await this.otp.verify(phone, app, code);

    let user = await this.findAccount(phone, app);
    let isNewUser = false;
    if (!user) {
      if (app === 'admin') throw new AppError('AUTH_OTP_INVALID');
      user = await this.createSelfServeAccount(phone, app);
      isNewUser = true;
    }

    await this.assertCanSignIn(user);
    const [updated] = await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    const tokens = await this.tokens.issuePair(updated, meta);
    return { ...tokens, user: presentUser(updated), isNewUser };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPairView> {
    const { user, tokens } = await this.tokens.rotate(refreshToken, meta);
    try {
      await this.assertPartnerActive(user);
    } catch (err) {
      await this.tokens.revokeByToken(tokens.refreshToken);
      throw err;
    }
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeByToken(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }

  private async assertCanSignIn(user: User): Promise<void> {
    if (user.status === 'suspended') throw new AppError('AUTH_ACCOUNT_SUSPENDED');
    await this.assertPartnerActive(user);
  }

  private async assertPartnerActive(user: User): Promise<void> {
    if (!user.partnerId || user.audience !== 'admin') return;
    const partner = await this.db.query.partners.findFirst({
      columns: { status: true },
      where: eq(partners.id, user.partnerId),
    });
    if (!partner || partner.status !== 'active') throw new AppError('PARTNER_SUSPENDED');
  }

  private findAccount(phone: string, audience: Audience): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: and(eq(users.phone, phone), eq(users.audience, audience), isNull(users.deletedAt)),
    });
  }

  private async findActiveAccount(phone: string, audience: Audience): Promise<User | undefined> {
    const user = await this.findAccount(phone, audience);
    return user && user.status !== 'suspended' ? user : undefined;
  }

  private async createSelfServeAccount(phone: string, app: 'rider' | 'driver'): Promise<User> {
    // Drivers stay pending until a partner reviews their documents (phase 2 onboarding).
    const [created] = await this.db
      .insert(users)
      .values({
        phone,
        audience: app,
        role: app,
        status: app === 'driver' ? 'pending' : 'active',
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Another request created it a moment ago.
    const existing = await this.findAccount(phone, app);
    if (!existing) throw new AppError('INTERNAL');
    return existing;
  }
}
