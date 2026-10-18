import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { pepperedHash, numericCode, safeEqualHex } from '../common/crypto';
import { AppError } from '../common/errors';
import { maskPhone } from '../common/phone';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import type { Audience } from '../database/schema';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from './sms/sms.provider';

export interface OtpRequestResult {
  expiresIn: number;
  resendAfter: number;
}

/**
 * One-time codes live only in Redis, hashed with the server pepper.
 * Limits: one code per cooldown window per phone and app, a cap per phone per hour,
 * and a fixed number of wrong guesses per code. A code works once.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /**
   * @param deliver false when the phone may not sign in to this app (unknown admin).
   *   Limits still apply and the response is identical, so the endpoint does not reveal
   *   which phones have admin accounts.
   */
  async request(phone: string, audience: Audience, deliver: boolean, locale: 'ar' | 'en'): Promise<OtpRequestResult> {
    const cooldownKey = `otp:cd:${audience}:${phone}`;
    const hourKey = `otp:hr:${phone}`;

    const cooldownTtl = await this.redis.ttl(cooldownKey);
    if (cooldownTtl > 0) {
      throw new AppError('AUTH_OTP_RATE_LIMITED', { retryAfter: cooldownTtl });
    }

    const [[, count], [, hourTtl]] = (await this.redis
      .multi()
      .incr(hourKey)
      .ttl(hourKey)
      .exec()) as [[null, number], [null, number]];
    if (hourTtl < 0) await this.redis.expire(hourKey, 3600);
    if (count > this.env.OTP_MAX_PER_HOUR) {
      throw new AppError('AUTH_OTP_RATE_LIMITED', { retryAfter: hourTtl > 0 ? hourTtl : 3600 });
    }

    if (this.env.OTP_RESEND_COOLDOWN_SECONDS > 0) {
      await this.redis.set(cooldownKey, '1', 'EX', this.env.OTP_RESEND_COOLDOWN_SECONDS);
    }

    const result = {
      expiresIn: this.env.OTP_TTL_SECONDS,
      resendAfter: this.env.OTP_RESEND_COOLDOWN_SECONDS,
    };
    if (!deliver) return result;

    const isTestPhone = this.env.OTP_TEST_PHONES.includes(phone);
    const code = isTestPhone ? this.env.OTP_TEST_CODE : numericCode(this.env.OTP_LENGTH);

    await this.redis
      .multi()
      .hset(this.codeKey(audience, phone), { h: this.hash(audience, phone, code), a: '0' })
      .expire(this.codeKey(audience, phone), this.env.OTP_TTL_SECONDS)
      .exec();

    if (!isTestPhone) {
      await this.sms.send(phone, this.message(code, locale));
    } else {
      this.logger.warn(`OTP for test phone ${maskPhone(phone)} uses the fixed test code`);
    }
    return result;
  }

  /** Throws unless the code matches. On success the code is consumed. */
  async verify(phone: string, audience: Audience, code: string): Promise<void> {
    const key = this.codeKey(audience, phone);
    const stored = await this.redis.hgetall(key);
    if (!stored.h) throw new AppError('AUTH_OTP_EXPIRED');

    const attempts = Number(stored.a ?? 0);
    if (attempts >= this.env.OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new AppError('AUTH_OTP_TOO_MANY_ATTEMPTS');
    }

    if (!safeEqualHex(stored.h, this.hash(audience, phone, code))) {
      const used = await this.redis.hincrby(key, 'a', 1);
      if (used >= this.env.OTP_MAX_ATTEMPTS) {
        await this.redis.del(key);
        throw new AppError('AUTH_OTP_TOO_MANY_ATTEMPTS');
      }
      throw new AppError('AUTH_OTP_INVALID');
    }

    // Single use: only the caller that actually deletes the key wins a race.
    const deleted = await this.redis.del(key);
    if (deleted !== 1) throw new AppError('AUTH_OTP_EXPIRED');
  }

  /** The fixed code of a configured test phone (OTP_TEST_PHONES / OTP_TEST_CODE). */
  isTestCode(phone: string, code: string): boolean {
    const expected = this.env.OTP_TEST_CODE;
    if (!expected || !this.env.OTP_TEST_PHONES.includes(phone)) return false;
    return safeEqualHex(this.hash('admin', phone, code), this.hash('admin', phone, expected));
  }

  private codeKey(audience: Audience, phone: string): string {
    return `otp:code:${audience}:${phone}`;
  }

  private hash(audience: Audience, phone: string, code: string): string {
    return pepperedHash(this.env.HASH_PEPPER, `otp:${audience}:${phone}:${code}`);
  }

  private message(code: string, locale: 'ar' | 'en'): string {
    const minutes = Math.round(this.env.OTP_TTL_SECONDS / 60);
    return locale === 'en'
      ? `Your verification code is ${code}. Valid for ${minutes} minutes. Do not share it.`
      : `رمز التحقق: ${code}\nصالح لمدة ${minutes} دقائق. لا تشاركه مع أحد.`;
  }
}
