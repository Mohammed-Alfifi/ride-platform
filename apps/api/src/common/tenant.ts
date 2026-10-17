import type { AuthUser } from '../auth/auth.types';
import { PARTNER_ROLES } from '../database/schema';
import { AppError } from './errors';

/**
 * Decides which partner's data a request may touch.
 * - super_admin: the partner they asked for, or every partner when they did not ask.
 * - partner_admin / dispatcher: always their own partner; asking for another is forbidden.
 * - anyone else: forbidden.
 * Returns undefined only for a super admin who asked for no specific partner.
 */
export function partnerScope(user: AuthUser, requested?: string | null): string | undefined {
  if (user.role === 'super_admin') return requested ?? undefined;
  if (PARTNER_ROLES.includes(user.role) && user.partnerId) {
    if (requested && requested !== user.partnerId) throw new AppError('FORBIDDEN');
    return user.partnerId;
  }
  throw new AppError('FORBIDDEN');
}

/** Throws unless the user may act on a record that belongs to partnerId. */
export function assertPartnerAccess(user: AuthUser, partnerId: string | null): void {
  if (user.role === 'super_admin') return;
  if (!partnerId || partnerId !== user.partnerId) throw new AppError('NOT_FOUND');
}
