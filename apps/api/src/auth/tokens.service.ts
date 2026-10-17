import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { pepperedHash, randomToken, safeEqualHex } from '../common/crypto';
import { AppError } from '../common/errors';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { refreshTokens, User, users } from '../database/schema';
import { REDIS } from '../redis/redis.module';
import type { AccessTokenClaims, AuthUser, RequestMeta } from './auth.types';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

const ISSUER = 'ride-api';
const SESSION_CACHE_TTL = 300;

/**
 * Access tokens: short-lived JWTs carrying the user's token version.
 * Bumping the version (logout everywhere, suspension) invalidates them at once.
 *
 * Refresh tokens: opaque "<id>.<secret>", stored hashed, rotated on every use.
 * Presenting an already-rotated token is treated as theft and ends the whole session family.
 */
@Injectable()
export class TokensService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly jwt: JwtService,
  ) {}

  async issuePair(user: User, meta: RequestMeta, familyId: string = randomUUID()): Promise<TokenPair> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      role: user.role,
      pid: user.partnerId,
      tv: user.tokenVersion,
    };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      audience: user.audience,
      algorithm: 'HS256',
    });

    const secret = randomToken(32);
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const [row] = await this.db
      .insert(refreshTokens)
      .values({
        userId: user.id,
        familyId,
        tokenHash: this.hashRefresh(secret),
        expiresAt,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
      })
      .returning({ id: refreshTokens.id });

    return {
      accessToken,
      accessTokenExpiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: `${row.id}.${secret}`,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  /** Verifies an access token and that the session it belongs to is still valid. */
  async verifyAccess(token: string): Promise<AuthUser> {
    let claims: AccessTokenClaims & { aud: string };
    try {
      claims = await this.jwt.verifyAsync(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        issuer: ISSUER,
        algorithms: ['HS256'],
      });
    } catch {
      throw new AppError('AUTH_TOKEN_INVALID');
    }

    const session = await this.sessionState(claims.sub);
    if (!session || session.status === 'suspended' || session.tokenVersion !== claims.tv) {
      throw new AppError('AUTH_TOKEN_INVALID');
    }
    return {
      id: claims.sub,
      role: claims.role,
      audience: claims.aud as AuthUser['audience'],
      partnerId: claims.pid,
    };
  }

  /** Exchanges a refresh token for a new pair. Returns the user so callers can re-check status. */
  async rotate(raw: string, meta: RequestMeta): Promise<{ user: User; tokens: TokenPair }> {
    const { id, secret } = this.parseRefresh(raw);
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.id, id) });
    if (!row || !safeEqualHex(row.tokenHash, this.hashRefresh(secret))) {
      throw new AppError('AUTH_REFRESH_INVALID');
    }
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw new AppError('AUTH_REFRESH_REUSED');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new AppError('AUTH_REFRESH_INVALID');
    }

    // Claim the token atomically; a concurrent second use finds nothing to update.
    const claimed = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (claimed.length === 0) {
      await this.revokeFamily(row.familyId);
      throw new AppError('AUTH_REFRESH_REUSED');
    }

    const user = await this.db.query.users.findFirst({
      where: and(eq(users.id, row.userId), isNull(users.deletedAt)),
    });
    if (!user) throw new AppError('AUTH_REFRESH_INVALID');
    if (user.status === 'suspended') {
      await this.revokeFamily(row.familyId);
      throw new AppError('AUTH_ACCOUNT_SUSPENDED');
    }

    const tokens = await this.issuePair(user, meta, row.familyId);
    const newId = tokens.refreshToken.split('.')[0];
    await this.db
      .update(refreshTokens)
      .set({ replacedById: newId })
      .where(eq(refreshTokens.id, row.id));
    return { user, tokens };
  }

  /** Ends the session the refresh token belongs to. Unknown tokens are ignored. */
  async revokeByToken(raw: string): Promise<void> {
    let parsed: { id: string; secret: string };
    try {
      parsed = this.parseRefresh(raw);
    } catch {
      return;
    }
    const row = await this.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.id, parsed.id),
    });
    if (row && safeEqualHex(row.tokenHash, this.hashRefresh(parsed.secret))) {
      await this.revokeFamily(row.familyId);
    }
  }

  /** Ends every session of the user and invalidates all their access tokens immediately. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    await this.db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId));
    await this.invalidateSessionCache(userId);
  }

  async invalidateSessionCache(userId: string): Promise<void> {
    await this.redis.del(this.sessionKey(userId));
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  private async sessionState(userId: string): Promise<{ tokenVersion: number; status: string } | null> {
    const key = this.sessionKey(userId);
    const cached = await this.redis.get(key);
    if (cached) {
      if (cached === 'gone') return null;
      const [tv, status] = cached.split(':');
      return { tokenVersion: Number(tv), status };
    }
    const user = await this.db.query.users.findFirst({
      columns: { tokenVersion: true, status: true, deletedAt: true },
      where: eq(users.id, userId),
    });
    if (!user || user.deletedAt) {
      await this.redis.set(key, 'gone', 'EX', SESSION_CACHE_TTL);
      return null;
    }
    await this.redis.set(key, `${user.tokenVersion}:${user.status}`, 'EX', SESSION_CACHE_TTL);
    return { tokenVersion: user.tokenVersion, status: user.status };
  }

  private sessionKey(userId: string): string {
    return `session:${userId}`;
  }

  private parseRefresh(raw: string): { id: string; secret: string } {
    const [id, secret, extra] = (raw ?? '').split('.');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !secret || extra !== undefined || !uuid.test(id)) {
      throw new AppError('AUTH_REFRESH_INVALID');
    }
    return { id, secret };
  }

  private hashRefresh(secret: string): string {
    return pepperedHash(this.env.HASH_PEPPER, `refresh:${secret}`);
  }
}
