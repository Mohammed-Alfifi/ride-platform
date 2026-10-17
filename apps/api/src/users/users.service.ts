import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { TokensService } from '../auth/tokens.service';
import { AppError } from '../common/errors';
import { normalizeSaudiMobile } from '../common/phone';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { DB, Database } from '../database/database.module';
import { partners, PARTNER_ROLES, User, users } from '../database/schema';
import { presentUser, UserView } from './user.presenter';
import { CreateStaffDto, ListUsersQuery, UpdateMeDto, UpdateUserDto, UserPage } from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
  ) {}

  async getMe(userId: string): Promise<UserView> {
    return presentUser(await this.findOrThrow(userId));
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<UserView> {
    const changes: Partial<Pick<User, 'name' | 'locale'>> = {};
    if (dto.name !== undefined) changes.name = dto.name.trim();
    if (dto.locale !== undefined) changes.locale = dto.locale;
    if (Object.keys(changes).length === 0) return this.getMe(userId);
    const [updated] = await this.db.update(users).set(changes).where(eq(users.id, userId)).returning();
    return presentUser(updated);
  }

  async list(actor: AuthUser, query: ListUsersQuery): Promise<UserPage> {
    const scope = partnerScope(actor, query.partnerId);
    const where: SQL[] = [isNull(users.deletedAt)];
    if (scope) where.push(eq(users.partnerId, scope));
    if (query.role) where.push(eq(users.role, query.role));
    if (query.q) {
      const term = query.q.trim();
      const digits = term.replace(/\D/g, '');
      const conditions: SQL[] = [ilike(users.name, `%${escapeLike(term)}%`)];
      if (digits.length >= 3) conditions.push(sql`${users.phone} LIKE ${'%' + digits.replace(/^0/, '') + '%'}`);
      where.push(or(...conditions) as SQL);
    }
    const condition = and(...where);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(condition)
        .orderBy(desc(users.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(users).where(condition),
    ]);
    return { items: items.map(presentUser), total, page: query.page, pageSize: query.pageSize };
  }

  async getForAdmin(actor: AuthUser, id: string): Promise<UserView> {
    const user = await this.findOrThrow(id);
    assertPartnerAccess(actor, user.partnerId);
    return presentUser(user);
  }

  async createStaff(actor: AuthUser, dto: CreateStaffDto, ip?: string): Promise<UserView> {
    const phone = normalizeSaudiMobile(dto.phone);
    let partnerId: string | null;

    if (dto.role === 'super_admin') {
      if (actor.role !== 'super_admin') throw new AppError('FORBIDDEN');
      if (dto.partnerId) throw new AppError('VALIDATION_FAILED', {}, ['partnerId must be empty for super_admin']);
      partnerId = null;
    } else if (actor.role === 'super_admin') {
      if (!dto.partnerId) throw new AppError('VALIDATION_FAILED', {}, ['partnerId is required']);
      partnerId = dto.partnerId;
    } else if (actor.role === 'partner_admin') {
      if (dto.partnerId && dto.partnerId !== actor.partnerId) throw new AppError('FORBIDDEN');
      partnerId = actor.partnerId;
    } else {
      throw new AppError('FORBIDDEN');
    }

    if (partnerId) {
      const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, partnerId) });
      if (!partner) throw new AppError('PARTNER_NOT_FOUND');
    }

    const existing = await this.db.query.users.findFirst({
      where: and(eq(users.phone, phone), eq(users.audience, 'admin'), isNull(users.deletedAt)),
    });
    if (existing) throw new AppError('USER_ALREADY_EXISTS');

    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({ phone, name: dto.name.trim(), role: dto.role, audience: 'admin', partnerId })
          .returning();
        await this.audit.record(
          {
            actorId: actor.id,
            partnerId,
            action: 'user.create',
            entity: 'user',
            entityId: created.id,
            after: presentUser(created),
            ip,
          },
          tx,
        );
        return presentUser(created);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('USER_ALREADY_EXISTS');
      throw err;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto, ip?: string): Promise<UserView> {
    const target = await this.findOrThrow(id);
    assertPartnerAccess(actor, target.partnerId);

    const changingAccess = dto.role !== undefined || dto.status !== undefined;
    if (changingAccess && target.id === actor.id) throw new AppError('USER_CANNOT_MODIFY_SELF');
    if (dto.role !== undefined && !PARTNER_ROLES.includes(target.role)) {
      throw new AppError('VALIDATION_FAILED', {}, ['role can only change between partner_admin and dispatcher']);
    }
    if (target.role === 'super_admin' && actor.role !== 'super_admin') throw new AppError('FORBIDDEN');

    const changes: Partial<User> = {};
    if (dto.name !== undefined) changes.name = dto.name.trim();
    if (dto.role !== undefined && dto.role !== target.role) changes.role = dto.role;
    if (dto.status !== undefined && dto.status !== target.status) changes.status = dto.status;
    if (Object.keys(changes).length === 0) return presentUser(target);

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx.update(users).set(changes).where(eq(users.id, id)).returning();
      await this.audit.record(
        {
          actorId: actor.id,
          partnerId: target.partnerId,
          action: 'user.update',
          entity: 'user',
          entityId: id,
          before: presentUser(target),
          after: presentUser(row),
          ip,
        },
        tx,
      );
      return row;
    });

    if (changes.status === 'suspended') {
      await this.tokens.revokeAllForUser(id);
    } else if (changes.role || changes.status) {
      // The role is carried in the access token; force a fresh one on the next refresh.
      await this.db
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, id));
      await this.tokens.invalidateSessionCache(id);
    }
    return presentUser(updated);
  }

  private async findOrThrow(id: string): Promise<User> {
    const user = await this.db.query.users.findFirst({
      where: and(eq(users.id, id), isNull(users.deletedAt)),
    });
    if (!user) throw new AppError('USER_NOT_FOUND');
    return user;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
