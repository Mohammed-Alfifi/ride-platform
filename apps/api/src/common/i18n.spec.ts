import { resolveLocale, translate } from './i18n';

describe('i18n', () => {
  it('defaults to Arabic', () => {
    expect(resolveLocale(undefined)).toBe('ar');
    expect(resolveLocale('fr-FR')).toBe('ar');
    expect(resolveLocale('ar-SA,ar;q=0.9')).toBe('ar');
  });

  it('switches to English when asked', () => {
    expect(resolveLocale('en-US,en;q=0.9')).toBe('en');
  });

  it('fills parameters', () => {
    expect(translate('AUTH_OTP_RATE_LIMITED', 'en', { retryAfter: 42 })).toContain('42 seconds');
    expect(translate('AUTH_OTP_RATE_LIMITED', 'ar', { retryAfter: 42 })).toContain('42');
  });
});
