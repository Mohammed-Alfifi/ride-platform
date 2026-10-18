import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { riyadhToday } from '../common/saudi';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { DB, Database } from '../database/database.module';
import { PromoCode, promoCodes } from '../database/schema';

/** The smallest first payment after a discount: a gateway cannot charge zero. */
export const MIN_CHARGE_HALALAS = 100;

export interface PromoView {
  id: string;
  partnerId: string;
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  maxUses: number | null;
  usedCount: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function discountFor(promo: Pick<PromoCode, 'kind' | 'value'>, priceHalalas: number): number {
  const raw = promo.kind === 'percent' ? Math.round((priceHalalas * promo.value) / 100) : promo.value;
  return Math.max(0, Math.min(raw, priceHalalas - MIN_CHARGE_HALALAS));
}

@Injectable()
export class PromosService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The code a rider typed, if it can be used on this partner's plan today. */
  async resolve(code: string, partnerId: string, today = riyadhToday()): Promise<PromoCode> {
    const promo = await this.db.query.promoCodes.findFirst({ where: eq(promoCodes.code, normalizeCode(code)) });
    const usable =
      promo &&
      promo.active &&
      promo.partnerId === partnerId &&
      (!promo.validFrom || promo.validFrom <= today) &&
      (!promo.validUntil || promo.validUntil >= today) &&
      (promo.maxUses === null || promo.usedCount < promo.maxUses);
    if (!usable) throw new AppError('PROMO_INVALID');
    return promo;
  }

  /** Counted once the discounted payment is actually paid. */
  async markUsed(promoId: string): Promise<void> {
    await this.db
      .update(promoCodes)
      .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
      .where(eq(promoCodes.id, promoId));
  }

  async list(actor: AuthUser, partnerId?: string): Promise<PromoView[]> {
    const scope = partnerScope(actor, partnerId);
    const rows = await this.db
      .select()
      .from(promoCodes)
      .where(scope ? eq(promoCodes.partnerId, scope) : undefined)
      .orderBy(desc(promoCodes.createdAt));
    return rows.map(present);
  }

  async create(
    actor: AuthUser,
    dto: { partnerId?: string; code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number; validFrom?: string; validUntil?: string },
  ): Promise<PromoView> {
    if (dto.kind === 'percent' && dto.value > 100) throw new AppError('VALIDATION_FAILED', {}, ['a percentage discount is at most 100']);
    if (dto.validFrom && dto.validUntil && dto.validUntil < dto.validFrom) {
      throw new AppError('VALIDATION_FAILED', {}, ['validUntil must not be before validFrom']);
    }
    const partnerId = actor.role === 'super_admin' ? dto.partnerId : actor.partnerId;
    if (!partnerId) throw new AppError('VALIDATION_FAILED', {}, ['partnerId is required']);
    assertPartnerAccess(actor, partnerId);
    const code = normalizeCode(dto.code);
    const taken = await this.db.query.promoCodes.findFirst({ columns: { id: true }, where: eq(promoCodes.code, code) });
    if (taken) throw new AppError('PROMO_CODE_TAKEN');
    const [row] = await this.db
      .insert(promoCodes)
      .values({
        partnerId,
        code,
        kind: dto.kind,
        value: dto.value,
        maxUses: dto.maxUses ?? null,
        validFrom: dto.validFrom ?? null,
        validUntil: dto.validUntil ?? null,
      })
      .returning();
    return present(row);
  }

  async setActive(actor: AuthUser, id: string, active: boolean): Promise<PromoView> {
    const promo = await this.db.query.promoCodes.findFirst({ where: eq(promoCodes.id, id) });
    if (!promo) throw new AppError('NOT_FOUND');
    assertPartnerAccess(actor, promo.partnerId);
    const [row] = await this.db.update(promoCodes).set({ active }).where(and(eq(promoCodes.id, id))).returning();
    return present(row);
  }
}

function present(p: PromoCode): PromoView {
  return {
    id: p.id,
    partnerId: p.partnerId,
    code: p.code,
    kind: p.kind,
    value: p.value,
    maxUses: p.maxUses,
    usedCount: p.usedCount,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
    active: p.active,
  };
}
