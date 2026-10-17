import type { AuthUser } from '../auth/auth.types';
import { AppError } from './errors';
import { assertPartnerAccess, partnerScope } from './tenant';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const user = (role: AuthUser['role'], partnerId: string | null): AuthUser => ({
  id: 'u',
  role,
  partnerId,
  audience: role === 'rider' || role === 'driver' ? role : 'admin',
});

describe('partnerScope', () => {
  it('lets a super admin see everything or pick a partner', () => {
    expect(partnerScope(user('super_admin', null))).toBeUndefined();
    expect(partnerScope(user('super_admin', null), P2)).toBe(P2);
  });

  it('pins partner staff to their own partner', () => {
    expect(partnerScope(user('partner_admin', P1))).toBe(P1);
    expect(partnerScope(user('dispatcher', P1), P1)).toBe(P1);
  });

  it('forbids partner staff from asking for another partner', () => {
    expect(() => partnerScope(user('partner_admin', P1), P2)).toThrow(AppError);
  });

  it('forbids riders and drivers', () => {
    expect(() => partnerScope(user('rider', null))).toThrow(AppError);
    expect(() => partnerScope(user('driver', P1))).toThrow(AppError);
  });
});

describe('assertPartnerAccess', () => {
  it('hides other partners’ records as not found', () => {
    expect(() => assertPartnerAccess(user('partner_admin', P1), P2)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => assertPartnerAccess(user('partner_admin', P1), null)).toThrow(AppError);
    expect(() => assertPartnerAccess(user('partner_admin', P1), P1)).not.toThrow();
    expect(() => assertPartnerAccess(user('super_admin', null), P2)).not.toThrow();
  });
});
