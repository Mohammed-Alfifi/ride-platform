import {
  addDays,
  daysBetween,
  isValidSaudiNationalId,
  monthlyPeriodEnd,
  normalizePlateLetters,
  riyadhToday,
  vehicleEligibleUntil,
} from './saudi';

/** Builds a valid ID from 9 leading digits by computing the check digit. */
function withCheckDigit(first9: string): string {
  for (let d = 0; d <= 9; d++) {
    if (isValidSaudiNationalId(first9 + d)) return first9 + d;
  }
  throw new Error('no check digit');
}

describe('isValidSaudiNationalId', () => {
  it('accepts IDs with a correct check digit', () => {
    const id = withCheckDigit('101234567');
    expect(isValidSaudiNationalId(id)).toBe(true);
  });

  it('rejects a wrong check digit, residence permits and bad formats', () => {
    const id = withCheckDigit('101234567');
    const wrong = id.slice(0, 9) + String((Number(id[9]) + 1) % 10);
    expect(isValidSaudiNationalId(wrong)).toBe(false);
    expect(isValidSaudiNationalId('2' + id.slice(1))).toBe(false);
    expect(isValidSaudiNationalId('12345')).toBe(false);
    expect(isValidSaudiNationalId('1abcdefghi')).toBe(false);
  });
});

describe('vehicleEligibleUntil', () => {
  it('counts from January of the model year', () => {
    expect(vehicleEligibleUntil(2022, 5).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('normalizePlateLetters', () => {
  it('maps Arabic plate letters to Latin', () => {
    expect(normalizePlateLetters('ا ب ح')).toBe('ABJ');
    expect(normalizePlateLetters('abj')).toBe('ABJ');
  });
  it('rejects letters that are not used on plates', () => {
    expect(normalizePlateLetters('QWE')).toBeNull();
    expect(normalizePlateLetters('ABCD')).toBeNull();
    expect(normalizePlateLetters('')).toBeNull();
  });
});

describe('dates', () => {
  it('uses the Riyadh calendar day', () => {
    // 22:30 UTC is already the next day in Riyadh (UTC+3).
    expect(riyadhToday(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18');
    expect(daysBetween('2026-10-18', '2026-11-17')).toBe(30);
  });
});

describe('billing periods', () => {
  it('ends the day before the same date next month', () => {
    expect(monthlyPeriodEnd('2026-03-15')).toBe('2026-04-14');
    expect(monthlyPeriodEnd('2026-01-31')).toBe('2026-02-27');
    expect(monthlyPeriodEnd('2028-01-31')).toBe('2028-02-28');
    expect(monthlyPeriodEnd('2026-12-01')).toBe('2026-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
