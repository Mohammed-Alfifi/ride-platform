import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  HASH_PEPPER: 'y'.repeat(16),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({ ...base });
    expect(env.PORT).toBe(3000);
    expect(env.OTP_LENGTH).toBe(6);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('rejects an encryption key of the wrong size', () => {
    expect(() => loadEnv({ ...base, DATA_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it('parses compliance warning days', () => {
    expect(loadEnv({ ...base }).COMPLIANCE_WARN_DAYS).toEqual([30, 7, 1]);
    expect(loadEnv({ ...base, COMPLIANCE_WARN_DAYS: '14,3' }).COMPLIANCE_WARN_DAYS).toEqual([14, 3]);
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses the console SMS provider in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
  });

  it('accepts the free pilot setup in production: access codes and manual payments', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'production', SMS_PROVIDER: 'none', ACCESS_MODE: 'invite', PAYMENT_PROVIDER: 'manual' });
    expect(env.SMS_PROVIDER).toBe('none');
    expect(() => loadEnv({ ...base, SMS_PROVIDER: 'none' })).toThrow(/ACCESS_MODE=invite/);
    expect(() => loadEnv({ ...base, SMS_PROVIDER: 'taqnyat' })).toThrow(/TAQNYAT_TOKEN/);
  });

  it('checks the Firebase service account', () => {
    expect(() => loadEnv({ ...base, FCM_SERVICE_ACCOUNT: 'bm90IGpzb24=' })).toThrow(/FCM_SERVICE_ACCOUNT/);
    const sa = Buffer.from(JSON.stringify({ project_id: 'p', client_email: 'a@p.iam.gserviceaccount.com', private_key: 'k' })).toString('base64');
    expect(loadEnv({ ...base, FCM_SERVICE_ACCOUNT: sa }).FCM_SERVICE_ACCOUNT).toBe(sa);
  });

  it('keeps SMS codes shorter than access codes', () => {
    expect(() => loadEnv({ ...base, OTP_LENGTH: '8' })).toThrow(/OTP_LENGTH/);
  });

  it('requires a numeric test code when test phones are set', () => {
    expect(() => loadEnv({ ...base, OTP_TEST_PHONES: '+966500000000' })).toThrow(/OTP_TEST_CODE/);
    expect(loadEnv({ ...base, OTP_TEST_PHONES: '+966500000000', OTP_TEST_CODE: '1234' }).OTP_TEST_PHONES).toEqual([
      '+966500000000',
    ]);
  });
});
