import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { AppError } from './errors';

/**
 * Normalises a Saudi mobile number to E.164 (+9665XXXXXXXX).
 * Accepts 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX and 009665XXXXXXXX,
 * with spaces or dashes, and Arabic-Indic digits.
 */
export function normalizeSaudiMobile(input: string): string {
  const ascii = toAsciiDigits(input).replace(/[\s\-().]/g, '');
  const prepared = ascii.startsWith('00') ? `+${ascii.slice(2)}` : ascii;
  const parsed = parsePhoneNumberFromString(prepared, 'SA');
  if (!parsed || parsed.country !== 'SA' || !parsed.isValid()) {
    throw new AppError('AUTH_PHONE_INVALID');
  }
  const type = parsed.getType();
  if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') {
    throw new AppError('AUTH_PHONE_INVALID');
  }
  return parsed.number;
}

/** +966501234567 -> +966 50 *** **67, for logs and audit trails. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return '***';
  return `${e164.slice(0, 6)}*****${e164.slice(-2)}`;
}

function toAsciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
