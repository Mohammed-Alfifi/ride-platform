import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { riyadhToday } from '../common/saudi';
import { assertPartnerAccess } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { PartnerLicense, partnerLicenses, ServiceClass } from '../database/schema';
import { LicenseView, UpsertLicenseDto } from './compliance.dto';

/** Classes a partner holds a licence for (verified or not). No licence at all reads as commute. */
export async function licensedClasses(db: Database, partnerId: string | null | undefined): Promise<ServiceClass[]> {
  if (!partnerId) return ['commute'];
  const rows = await db
    .select({ c: partnerLicenses.serviceClass })
    .from(partnerLicenses)
    .where(eq(partnerLicenses.partnerId, partnerId));
  return rows.length ? rows.map((r) => r.c) : ['commute'];
}

/** True when the licence lets the partner sell today: checked by the platform and not expired. */
export function isValid(l: Pick<PartnerLicense, 'verifiedAt' | 'expiresAt'> | undefined, today = riyadhToday()): boolean {
  return Boolean(l && l.verifiedAt && l.expiresAt > today);
}

/**
 * Partner licences from the Transport General Authority, one per service class, and the gate
 * that keeps a class from being sold without one.
 */
@Injectable()
export class LicensesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, partnerId: string): Promise<LicenseView[]> {
    assertPartnerAccess(actor, partnerId);
    const rows = await this.db
      .select()
      .from(partnerLicenses)
      .where(eq(partnerLicenses.partnerId, partnerId))
      .orderBy(asc(partnerLicenses.serviceClass));
    return rows.map((r) => this.present(r));
  }

  /** Partner admins enter or renew their licence; every change waits for platform verification again. */
  async upsert(actor: AuthUser, partnerId: string, serviceClass: ServiceClass, dto: UpsertLicenseDto, ip?: string): Promise<LicenseView> {
    assertPartnerAccess(actor, partnerId);
    if (dto.minPriceHalalas != null && dto.maxPriceHalalas != null && dto.minPriceHalalas > dto.maxPriceHalalas) {
      throw new AppError('VALIDATION_FAILED', {}, ['minPriceHalalas must not exceed maxPriceHalalas']);
    }
    const before = await this.find(partnerId, serviceClass);
    const values = {
      partnerId,
      serviceClass,
      licenseNumber: dto.licenseNumber.trim(),
      unifiedCode: dto.unifiedCode?.trim() || null,
      expiresAt: dto.expiresAt,
      minPriceHalalas: dto.minPriceHalalas ?? null,
      maxPriceHalalas: dto.maxPriceHalalas ?? null,
      pricingReference: dto.pricingReference?.trim() || null,
      verifiedAt: null,
      verifiedBy: null,
    };
    const [row] = await this.db
      .insert(partnerLicenses)
      .values(values)
      .onConflictDoUpdate({ target: [partnerLicenses.partnerId, partnerLicenses.serviceClass], set: values })
      .returning();
    await this.audit.record({ actorId: actor.id, partnerId, action: 'license.upsert', entity: 'partner_license', entityId: row.id, before: before ?? null, after: row, ip });
    return this.present(row);
  }

  /** A platform admin confirms the licence against the authority's records. */
  async verify(actor: AuthUser, partnerId: string, serviceClass: ServiceClass, ip?: string): Promise<LicenseView> {
    const before = await this.find(partnerId, serviceClass);
    if (!before) throw new AppError('LICENSE_NOT_FOUND');
    const [row] = await this.db
      .update(partnerLicenses)
      .set({ verifiedAt: new Date(), verifiedBy: actor.id })
      .where(eq(partnerLicenses.id, before.id))
      .returning();
    await this.audit.record({ actorId: actor.id, partnerId, action: 'license.verify', entity: 'partner_license', entityId: row.id, before, after: row, ip });
    return this.present(row);
  }

  find(partnerId: string, serviceClass: ServiceClass): Promise<PartnerLicense | undefined> {
    return this.db.query.partnerLicenses.findFirst({
      where: and(eq(partnerLicenses.partnerId, partnerId), eq(partnerLicenses.serviceClass, serviceClass)),
    });
  }

  /** Whether the class needs a licence at all: education always; commute when the setting says so. */
  licenceRequired(serviceClass: ServiceClass): boolean {
    return serviceClass === 'education' || this.env.COMMUTE_LICENSE_REQUIRED;
  }

  /**
   * Throws unless a plan of this class and price may be sold by the partner today.
   * The approved price range applies whenever a licence records one.
   */
  async assertCanSell(partnerId: string, serviceClass: ServiceClass, priceHalalas: number): Promise<void> {
    const licence = await this.find(partnerId, serviceClass);
    if (this.licenceRequired(serviceClass) && !isValid(licence)) {
      throw new AppError('PARTNER_LICENSE_REQUIRED', { serviceClass });
    }
    if (licence) {
      const min = licence.minPriceHalalas;
      const max = licence.maxPriceHalalas;
      if ((min != null && priceHalalas < min) || (max != null && priceHalalas > max)) {
        throw new AppError('PRICE_NOT_APPROVED', { min: min ?? 0, max: max ?? '∞' });
      }
    }
  }

  /** For listing many plans at once: which (partner, class) pairs may sell, and their public codes. */
  async sellable(pairs: { partnerId: string; serviceClass: ServiceClass }[]): Promise<{
    canSell: (partnerId: string, serviceClass: ServiceClass, priceHalalas: number) => boolean;
    codeOf: (partnerId: string, serviceClass: ServiceClass) => string | null;
  }> {
    const ids = [...new Set(pairs.map((p) => p.partnerId))];
    const rows = ids.length ? await this.db.select().from(partnerLicenses).where(inArray(partnerLicenses.partnerId, ids)) : [];
    const key = (p: string, c: string) => `${p}:${c}`;
    const byKey = new Map(rows.map((r) => [key(r.partnerId, r.serviceClass), r]));
    const today = riyadhToday();
    return {
      canSell: (partnerId, serviceClass, price) => {
        const l = byKey.get(key(partnerId, serviceClass));
        if (this.licenceRequired(serviceClass) && !isValid(l, today)) return false;
        if (l && ((l.minPriceHalalas != null && price < l.minPriceHalalas) || (l.maxPriceHalalas != null && price > l.maxPriceHalalas))) return false;
        return true;
      },
      codeOf: (partnerId, serviceClass) => {
        const l = byKey.get(key(partnerId, serviceClass));
        return isValid(l, today) ? (l!.unifiedCode ?? l!.licenseNumber) : null;
      },
    };
  }

  /** Verified licences expiring on or before a day, for the daily warnings. */
  expiringBy(day: string): Promise<PartnerLicense[]> {
    return this.db
      .select()
      .from(partnerLicenses)
      .where(and(isNotNull(partnerLicenses.verifiedAt), lte(partnerLicenses.expiresAt, day)));
  }

  present(r: PartnerLicense): LicenseView {
    return {
      id: r.id,
      partnerId: r.partnerId,
      serviceClass: r.serviceClass,
      licenseNumber: r.licenseNumber,
      unifiedCode: r.unifiedCode,
      expiresAt: r.expiresAt,
      minPriceHalalas: r.minPriceHalalas,
      maxPriceHalalas: r.maxPriceHalalas,
      pricingReference: r.pricingReference,
      verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
      valid: isValid(r),
    };
  }
}
