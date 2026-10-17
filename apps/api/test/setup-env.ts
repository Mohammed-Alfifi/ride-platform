// Test configuration. CI may override any of these through real environment variables.
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://ride:ride@localhost:5432/ride_test',
  REDIS_URL: 'redis://localhost:6379/1',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-1234567890',
  HASH_PEPPER: 'test-pepper-1234567890',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  OTP_TTL_SECONDS: '300',
  OTP_MAX_ATTEMPTS: '3',
  OTP_RESEND_COOLDOWN_SECONDS: '60',
  OTP_MAX_PER_HOUR: '5',
  OTP_TEST_PHONES: '+966500000099',
  OTP_TEST_CODE: '246810',
  CORS_ORIGINS: 'http://localhost:3001',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
