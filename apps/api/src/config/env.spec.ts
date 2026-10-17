import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  HASH_PEPPER: 'y'.repeat(16),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({ ...base });
    expect(env.PORT).toBe(3000);
    expect(env.OTP_LENGTH).toBe(6);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses the console SMS provider in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
  });

  it('requires a numeric test code when test phones are set', () => {
    expect(() => loadEnv({ ...base, OTP_TEST_PHONES: '+966500000000' })).toThrow(/OTP_TEST_CODE/);
    expect(loadEnv({ ...base, OTP_TEST_PHONES: '+966500000000', OTP_TEST_CODE: '1234' }).OTP_TEST_PHONES).toEqual([
      '+966500000000',
    ]);
  });
});
