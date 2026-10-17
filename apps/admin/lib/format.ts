/** +966501234567 -> 050 123 4567 (how Saudi users read their own numbers). */
export function formatSaudiPhone(e164: string): string {
  const m = /^\+966(5\d)(\d{3})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `0${m[1]} ${m[2]} ${m[3]}`;
}

/** Basis points to a percentage label: 1500 -> "15%", 1250 -> "12.5%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')}%`;
}

export function formatDate(iso: string | null, lang: 'ar' | 'en'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(iso));
}

/** 120000 halalas -> "1,200" (riyals, digits kept Latin for Saudi business use). */
export function formatSar(halalas: number, lang: 'ar' | 'en'): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-SA', {
    minimumFractionDigits: halalas % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(halalas / 100);
}

export function formatDay(iso: string | null, lang: 'ar' | 'en'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}
