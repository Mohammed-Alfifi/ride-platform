import { AppError } from './errors';
import { maskPhone, normalizeSaudiMobile } from './phone';

describe('normalizeSaudiMobile', () => {
  it.each([
    ['0501234567'],
    ['501234567'],
    ['966501234567'],
    ['+966501234567'],
    ['00966501234567'],
    ['050 123 4567'],
    ['050-123-4567'],
    ['٠٥٠١٢٣٤٥٦٧'],
  ])('accepts %s', (input) => {
    expect(normalizeSaudiMobile(input)).toBe('+966501234567');
  });

  it.each([['0112345678'], ['12345'], ['+201001234567'], ['abc'], ['']])('rejects %s', (input) => {
    expect(() => normalizeSaudiMobile(input)).toThrow(AppError);
  });

  it('masks the middle of a number', () => {
    expect(maskPhone('+966501234567')).toBe('+96650*****67');
  });
});
