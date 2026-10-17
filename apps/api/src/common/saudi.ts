/**
 * Saudi national ID (هوية وطنية): 10 digits, starts with 1, last digit is a check digit
 * (Luhn-style: double the digits in odd positions, sum the digits of each result).
 * Residence permits (إقامة) start with 2 and are refused, since only Saudis may drive
 * their private cars on ride apps.
 */
export function isValidSaudiNationalId(id: string): boolean {
  if (!/^1\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = Number(id[i]);
    if (i % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  return sum % 10 === 0;
}

/** The date until which a vehicle of this model year may serve (TGA: N years from January of the model year). */
export function vehicleEligibleUntil(modelYear: number, maxAgeYears: number): Date {
  return new Date(Date.UTC(modelYear + maxAgeYears, 0, 1));
}

/** Arabic plate letters as printed, mapped to the Latin letters on the same plate. */
const PLATE_LETTERS: Record<string, string> = {
  ا: 'A', ب: 'B', ح: 'J', د: 'D', ر: 'R', س: 'S', ص: 'X', ط: 'T', ع: 'E', ق: 'G', ك: 'K', ل: 'L', م: 'Z', ن: 'N', ه: 'H', و: 'U', ى: 'V', ي: 'V',
};
const LATIN_PLATE = new Set(Object.values(PLATE_LETTERS));

/** Normalises plate letters given in Arabic or Latin to the Latin form ("ا ب ح" -> "ABJ"). */
export function normalizePlateLetters(input: string): string | null {
  const chars = input.replace(/[\s-]/g, '').toUpperCase().split('');
  const out = chars.map((c) => PLATE_LETTERS[c] ?? (LATIN_PLATE.has(c) ? c : null));
  if (out.length < 1 || out.length > 3 || out.some((c) => c === null)) return null;
  return out.join('');
}

/** Today's date in Riyadh as YYYY-MM-DD; expiry dates are compared as calendar days there. */
export function riyadhToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
}

export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  return Math.round((Date.parse(toIsoDate) - Date.parse(fromIsoDate)) / 86_400_000);
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last day of a one-month period starting on `start` (Jan 31 -> Feb 28/29, Mar 15 -> Apr 14). */
export function monthlyPeriodEnd(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const lastDayNextMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, Math.min(d, lastDayNextMonth)));
  return addDays(next.toISOString().slice(0, 10), -1);
}
