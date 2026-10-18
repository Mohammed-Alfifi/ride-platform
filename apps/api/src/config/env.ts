import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: csv,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SWAGGER_ENABLED: bool,

    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    HASH_PEPPER: z.string().min(16, 'HASH_PEPPER must be at least 16 characters'),

    // Up to 7 digits: 8-digit codes are access codes issued by the team.
    OTP_LENGTH: z.coerce.number().int().min(4).max(7).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
    OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).default(5),
    /**
     * console: codes go to the log (development). none: no SMS at all; people sign in with access
     * codes the team issues from the dashboard (free, needs ACCESS_MODE=invite). taqnyat: Taqnyat SMS.
     */
    SMS_PROVIDER: z.enum(['console', 'none', 'taqnyat']).default('console'),
    TAQNYAT_TOKEN: z.string().optional().default(''),
    SMS_SENDER: z.string().optional().default(''),
    /** open: anyone may create a rider or driver account. invite: only phones the team invited. */
    ACCESS_MODE: z.enum(['open', 'invite']).default('open'),
    ACCESS_CODE_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    OTP_TEST_PHONES: csv,
    OTP_TEST_CODE: z.string().optional().default(''),

    SUPER_ADMIN_PHONE: z.string().optional().default(''),
    SUPER_ADMIN_NAME: z.string().optional().default('Platform Owner'),

    SENTRY_DSN: z.string().optional().default(''),

    // Encrypts identity numbers at rest (AES-256-GCM). 32 bytes, base64.
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes in base64'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_DIR: z.string().default('./var/uploads'),
    S3_BUCKET: z.string().optional().default(''),
    S3_REGION: z.string().optional().default('me-central-1'),
    S3_ENDPOINT: z.string().optional().default(''),
    S3_ACCESS_KEY_ID: z.string().optional().default(''),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
    UPLOAD_MAX_MB: z.coerce.number().positive().default(10),

    /** TGA rule: a private car may serve for this many years from January of its model year. */
    VEHICLE_MAX_AGE_YEARS: z.coerce.number().int().min(1).default(5),
    COMPLIANCE_WARN_DAYS: csv.transform((v) => (v.length ? v.map(Number) : [30, 7, 1])),
    /** Public base URL of this API; payment pages return here and gateways send webhooks here. */
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    /** Where the dashboard is served; shared trip links point here (/t/<token>). */
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3001'),
    /** manual: no gateway; riders pay by transfer or cash and an admin records the payment. */
    PAYMENT_PROVIDER: z.enum(['sandbox', 'tap', 'moyasar', 'manual']).default('sandbox'),
    PAYMENT_INSTRUCTIONS_AR: z.string().optional().default(''),
    PAYMENT_INSTRUCTIONS_EN: z.string().optional().default(''),
    /** Saudi mobile the apps open in WhatsApp for help, e.g. 0500000000. */
    SUPPORT_WHATSAPP: z.string().optional().default(''),
    /** Firebase service account JSON, base64. Empty: notifications stay in the app inbox only. */
    FCM_SERVICE_ACCOUNT: z.string().optional().default(''),
    /** Stop new subscriptions above this many active ones (0: no limit). Keeps a pilot small. */
    PILOT_MAX_ACTIVE_SUBSCRIPTIONS: z.coerce.number().int().min(0).default(0),
    /** Driver location history is deleted after this many days. */
    LOCATION_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
    /** Bump when the terms or privacy policy change; users accept the new version in the app. */
    TERMS_VERSION: z.string().max(20).default('2026-10'),
    /** Alert the team when a driver has not set off this many minutes before pick-up. */
    LATE_ALERT_MINUTES: z.coerce.number().int().min(1).default(10),
    /** Where riders without the Android app open the web version (shown in invites). */
    RIDER_WEB_URL: z.string().optional().default(''),
    TAP_SECRET_KEY: z.string().optional().default(''),
    TAP_MERCHANT_ID: z.string().optional().default(''),
    TAP_API_URL: z.string().url().default('https://api.tap.company'),
    MOYASAR_SECRET_KEY: z.string().optional().default(''),
    MOYASAR_API_URL: z.string().url().default('https://api.moyasar.com'),
    VAT_RATE_BPS: z.coerce.number().int().min(0).max(10000).default(1500),
    RENEWAL_GRACE_DAYS: z.coerce.number().int().min(0).max(14).default(3),
    JOBS_ENABLED: z
      .string()
      .optional()
      .transform((v) => v !== 'false' && v !== '0'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'The console SMS provider prints codes to logs and is not allowed in production',
      });
    }
    if (env.SMS_PROVIDER === 'none' && env.ACCESS_MODE !== 'invite') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'SMS_PROVIDER=none works only with ACCESS_MODE=invite (people sign in with access codes)',
      });
    }
    if (env.SMS_PROVIDER === 'taqnyat' && !env.TAQNYAT_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['TAQNYAT_TOKEN'], message: 'TAQNYAT_TOKEN is required when SMS_PROVIDER=taqnyat' });
    }
    if (env.FCM_SERVICE_ACCOUNT) {
      try {
        const sa = JSON.parse(Buffer.from(env.FCM_SERVICE_ACCOUNT, 'base64').toString('utf8')) as Record<string, unknown>;
        if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('fields');
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['FCM_SERVICE_ACCOUNT'],
          message: 'FCM_SERVICE_ACCOUNT must be the Firebase service account JSON file, base64 encoded',
        });
      }
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'sandbox') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'The sandbox payment provider is not allowed in production' });
    }
    if (env.PAYMENT_PROVIDER === 'tap' && !env.TAP_SECRET_KEY) {
      ctx.addIssue({ code: 'custom', path: ['TAP_SECRET_KEY'], message: 'TAP_SECRET_KEY is required when PAYMENT_PROVIDER=tap' });
    }
    if (env.PAYMENT_PROVIDER === 'moyasar' && !env.MOYASAR_SECRET_KEY) {
      ctx.addIssue({ code: 'custom', path: ['MOYASAR_SECRET_KEY'], message: 'MOYASAR_SECRET_KEY is required when PAYMENT_PROVIDER=moyasar' });
    }
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET is required when STORAGE_DRIVER=s3' });
    }
    if (env.OTP_TEST_PHONES.length > 0 && !/^\d{4,8}$/.test(env.OTP_TEST_CODE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_TEST_CODE'],
        message: 'OTP_TEST_CODE must be 4-8 digits when OTP_TEST_PHONES is set',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
