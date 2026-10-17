import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 hex digest keyed with the server pepper. Used for OTP codes and refresh tokens. */
export function pepperedHash(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Uniformly random numeric code of the given length, leading zeros allowed. */
export function numericCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += String(randomInt(0, 10));
  return code;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
