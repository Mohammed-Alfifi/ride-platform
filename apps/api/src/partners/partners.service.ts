import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { TokensService } from '../auth/tokens.service';
import { AppError } from '../common/errors';
import { assertPartnerAccess } from '../common/tenant';
import { DB, Database } from '../database/database.module';
import { Partner, partners, users } from '../database/schema';
import { isUniqueViolation } from '../users/users.service';
import { CreatePartnerDto, PartnerView, presentPartner, UpdatePartnerDto } from './partners.dto';

@Injectable()
export class PartnersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
  ) {}

  async list(actor: AuthUser): Promise<PartnerView[]> {
    if (actor.role !== 'super_admin' && !actor.partnerId) return [];
    const rows = await this.db
      .select()
      .from(partners)
      .where(actor.role === 'super_admin' ? undefined : eq(partners.id, actor.partnerId as string))
      .orderBy(asc(partners.nameAr));
    const counts = await this.staffCounts(rows.map((r) => r.id));
    return rows.map((r) => presentPartner(r, counts.get(r.id) ?? 0));
  }

  async get(actor: AuthUser, id: string): Promise<PartnerView> {
    assertPartnerAccess(actor, id);
    const partner = await this.findOrThrow(id);
    const counts = await this.staffCounts([id]);
    return presentPartner(partner, counts.get(id) ?? 0);
  }

  async create(actor: AuthUser, dto: CreatePartnerDto, ip?: string): Promise<PartnerView> {
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(partners).values(dto).returning();
        await this.audit.record(
          {
            actorId: actor.id,
            partnerId: created.id,
            action: 'partner.create',
            entity: 'partner',
            entityId: created.id,
            after: created,
            ip,
          },
          tx,
        );
        return presentPartner(created);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('PARTNER_CR_EXISTS');
      throw err;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdatePartnerDto, ip?: string): Promise<PartnerView> {
    const before = await this.findOrThrow(id);
    let updated: Partner;
    try {
      updated = await this.db.transaction(async (tx) => {
        const [row] = await tx.update(partners).set(dto).where(eq(partners.id, id)).returning();
        await this.audit.record(
          { actorId: actor.id, partnerId: id, action: 'partner.update', entity: 'partner', entityId: id, before, after: row, ip },
          tx,
        );
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('PARTNER_CR_EXISTS');
      throw err;
    }

    if (before.status !== 'suspended' && updated.status === 'suspended') {
      // Sign out every staff member of a suspended partner.
      const staff = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.partnerId, id), eq(users.audience, 'admin')));
      for (const s of staff) await this.tokens.revokeAllForUser(s.id);
    }
    return this.get(actor, id);
  }

  private async findOrThrow(id: string): Promise<Partner> {
    const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, id) });
    if (!partner) throw new AppError('PARTNER_NOT_FOUND');
    return partner;
  }

  private async staffCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ partnerId: users.partnerId, n: count() })
      .from(users)
      .where(and(inArray(users.partnerId, ids), eq(users.audience, 'admin'), isNull(users.deletedAt)))
      .groupBy(users.partnerId);
    return new Map(rows.map((r) => [r.partnerId as string, r.n]));
  }
}
