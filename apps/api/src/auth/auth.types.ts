import type { Audience, Role } from '../database/schema';

/** The authenticated principal attached to every request after the JWT guard. */
export interface AuthUser {
  id: string;
  role: Role;
  audience: Audience;
  partnerId: string | null;
}

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  pid: string | null;
  tv: number;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
