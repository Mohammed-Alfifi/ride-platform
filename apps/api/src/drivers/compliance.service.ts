import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, SQL, sql } from 'drizzle-orm';
import { ageOn, NEWLY_REQUIRED, requiredDocuments, rulesFor } from '../compliance/rules';
import { licensedClasses } from '../compliance/licenses.service';
import { addDays, daysBetween, riyadhToday, vehicleEligibleUntil } from '../common/saudi';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { documents, DocumentType, driverProfiles, EXPIRING_DOCUMENTS, partnerLicenses, Plan, ServiceClass, users, vehicles } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ExpiringItem } from './drivers.dto';

const DOC_NAMES: Record<DocumentType, { ar: string; en: string }> = {
  national_id: { ar: 'الهوية الوطنية', en: 'national ID' },
  driving_license: { ar: 'رخصة القيادة', en: 'driving licence' },
  driver_photo: { ar: 'الصورة الشخصية', en: 'photo' },
  vehicle_registration: { ar: 'استمارة المركبة', en: 'vehicle registration' },
  vehicle_insurance: { ar: 'تأمين المركبة', en: 'vehicle insurance' },
  periodic_inspection: { ar: 'الفحص الدوري', en: 'periodic inspection' },
  professional_driver_card: { ar: 'بطاقة السائق المهني', en: 'professional driver card' },
  criminal_record: { ar: 'شهادة خلو السوابق', en: 'criminal record certificate' },
  operating_card: { ar: 'بطاقة التشغيل', en: 'operating card' },
  first_aid_certificate: { ar: 'شهادة الإسعافات الأولية', en: 'first aid certificate' },
};

/** Reasons a driver may not serve a plan of a class (checked when assigning). */
export type QualificationIssue =
  | `document_missing:${DocumentType}`
  | `document_expired:${DocumentType}`
  | 'driver_too_young'
  | 'driver_not_saudi'
  | 'vehicle_missing'
  | 'vehicle_seats'
  | 'vehicle_too_old'
  | 'escort_missing';

export interface ComplianceIssue {
  code: 'document_expired' | 'document_missing' | 'vehicle_too_old';
  type?: DocumentType;
}

export interface ScanResult {
  warnings: number;
  holdsPlaced: number;
  holdsCleared: number;
}

/**
 * Keeps approved drivers within the transport authority's rules: warns before documents
 * expire, and holds a driver (no trips can be assigned) once a document expires or the
 * vehicle passes its age limit. The hold lifts by itself when the problem is fixed.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationsService,
  ) {}

  /** Re-checks one driver and updates their hold. Returns the issues found. */
  async evaluate(driverId: string, today = riyadhToday()): Promise<ComplianceIssue[]> {
    const profile = await this.db.query.driverProfiles.findFirst({ where: eq(driverProfiles.userId, driverId) });
    if (!profile || profile.status !== 'approved') return [];

    const issues: ComplianceIssue[] = [];
    const classes = await this.classesServed(driverId, profile.partnerId);
    const inGrace = Boolean(this.env.COMPLIANCE_GRACE_UNTIL) && today <= this.env.COMPLIANCE_GRACE_UNTIL;
    const current = await this.currentDocuments(driverId);
    for (const type of requiredDocuments(classes, this.env).filter((t) => EXPIRING_DOCUMENTS.includes(t))) {
      const doc = current.find((d) => d.type === type);
      if (!doc) {
        // A document this phase made mandatory: during the grace period, drivers keep working.
        if (inGrace && NEWLY_REQUIRED.includes(type)) continue;
        issues.push({ code: 'document_missing', type });
      } else if (doc.expiresAt && doc.expiresAt <= today) issues.push({ code: 'document_expired', type });
    }
    // The strictest age limit among the classes the driver serves.
    const maxAge = Math.min(...classes.map((c) => rulesFor(c, this.env).vehicleMaxAgeYears));
    const vehicle = await this.db.query.vehicles.findFirst({ where: eq(vehicles.driverId, driverId) });
    if (vehicle && vehicleEligibleUntil(vehicle.year, maxAge).toISOString().slice(0, 10) <= today) {
      issues.push({ code: 'vehicle_too_old' });
    }

    const hold = issues.length > 0;
    const reason = hold ? issues.map((i) => (i.type ? `${i.code}:${i.type}` : i.code)).join(',').slice(0, 200) : null;
    if (hold !== profile.complianceHold || reason !== profile.complianceReason) {
      await this.db
        .update(driverProfiles)
        .set({ complianceHold: hold, complianceReason: reason })
        .where(eq(driverProfiles.userId, driverId));
    }
    return issues;
  }

  /**
   * Whether the driver meets the rules of the plan's class, beyond the hold above:
   * their age, the documents of that class, the car's seats and age, and the escort.
   * Returns the issues; empty means qualified.
   */
  async qualify(driverId: string, plan: Pick<Plan, 'serviceClass' | 'requiresEscort'>, today = riyadhToday()): Promise<QualificationIssue[]> {
    const rules = rulesFor(plan.serviceClass, this.env);
    const out: QualificationIssue[] = [];
    const profile = await this.db.query.driverProfiles.findFirst({ where: eq(driverProfiles.userId, driverId) });
    if (!profile?.saudiConfirmed) out.push('driver_not_saudi');
    if (!profile?.dateOfBirth || ageOn(profile.dateOfBirth, today) < rules.minDriverAge) out.push('driver_too_young');
    const inGrace = Boolean(this.env.COMPLIANCE_GRACE_UNTIL) && today <= this.env.COMPLIANCE_GRACE_UNTIL;
    const current = await this.currentDocuments(driverId);
    for (const type of requiredDocuments([plan.serviceClass], this.env)) {
      const doc = current.find((d) => d.type === type);
      // Commute keeps the grace period for new papers; education never sells without them.
      if (!doc) {
        if (inGrace && plan.serviceClass === 'commute' && NEWLY_REQUIRED.includes(type)) continue;
        out.push(`document_missing:${type}`);
      } else if (doc.expiresAt && doc.expiresAt <= today) out.push(`document_expired:${type}`);
    }
    const vehicle = await this.db.query.vehicles.findFirst({ where: eq(vehicles.driverId, driverId) });
    if (!vehicle) out.push('vehicle_missing');
    else {
      if (vehicle.seats < rules.minSeats || vehicle.seats > rules.maxSeats) out.push('vehicle_seats');
      if (vehicleEligibleUntil(vehicle.year, rules.vehicleMaxAgeYears).toISOString().slice(0, 10) <= today) out.push('vehicle_too_old');
      if (plan.requiresEscort && !vehicle.escortName) out.push('escort_missing');
    }
    return out;
  }

  /** Classes the driver serves: those of the plans of riders assigned to them, else the partner's licences. */
  private async classesServed(driverId: string, partnerId: string | null): Promise<ServiceClass[]> {
    const rows = await this.db.execute<{ c: ServiceClass }>(sql`
      SELECT DISTINCT p.service_class AS c FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.driver_id = ${driverId} AND s.status IN ('active', 'past_due', 'paused', 'pending_payment')`);
    const assigned = rows.rows.map((r) => r.c);
    return assigned.length ? assigned : licensedClasses(this.db, partnerId);
  }

  private currentDocuments(driverId: string) {
    return this.db
      .select()
      .from(documents)
      .where(and(eq(documents.driverId, driverId), isNull(documents.supersededAt), ne(documents.status, 'rejected')));
  }

  /** The daily job. Safe to run more than once a day: notifications are de-duplicated. */
  async scan(now = new Date()): Promise<ScanResult> {
    const today = riyadhToday(now);
    const result: ScanResult = { warnings: 0, holdsPlaced: 0, holdsCleared: 0 };
    const thresholds = [...this.env.COMPLIANCE_WARN_DAYS].sort((a, b) => a - b);
    const horizon = addDays(today, Math.max(...thresholds));

    // 1. Warnings for documents about to expire.
    const expiring = await this.expiringRows(horizon, undefined);
    const adminCache = new Map<string, string[]>();
    for (const row of expiring) {
      const daysLeft = daysBetween(today, row.expiresAt);
      if (daysLeft <= 0) continue;
      const bucket = thresholds.find((t) => daysLeft <= t);
      if (bucket === undefined) continue;
      const name = DOC_NAMES[row.type];
      const input = {
        kind: 'document_expiring',
        titleAr: `${name.ar} تنتهي قريبا`,
        titleEn: `Your ${name.en} expires soon`,
        bodyAr: `تنتهي ${name.ar} بعد ${daysLeft} يوما (${row.expiresAt}). ارفع النسخة المجددة من التطبيق.`,
        bodyEn: `Your ${name.en} expires in ${daysLeft} days (${row.expiresAt}). Upload the renewed one in the app.`,
        data: { documentId: row.documentId, driverId: row.driverId, expiresAt: row.expiresAt },
        dedupeKey: `doc:${row.documentId}:warn:${bucket}`,
      };
      result.warnings += await this.notifications.notify([row.driverId], input);
      const admins = await this.adminsOf(row.partnerId, adminCache);
      await this.notifications.notify(admins, {
        ...input,
        titleAr: `وثيقة سائق تنتهي قريبا: ${row.driverName ?? row.phone}`,
        titleEn: `Driver document expiring: ${row.driverName ?? row.phone}`,
      });
    }

    // 2. Holds: re-evaluate every approved driver, placing and lifting holds.
    const approved = await this.db
      .select({ id: driverProfiles.userId, hold: driverProfiles.complianceHold, partnerId: driverProfiles.partnerId })
      .from(driverProfiles)
      .where(eq(driverProfiles.status, 'approved'));
    for (const driver of approved) {
      const issues = await this.evaluate(driver.id, today);
      const nowHeld = issues.length > 0;
      if (nowHeld && !driver.hold) {
        result.holdsPlaced++;
        const what = issues
          .map((i) => (i.type ? DOC_NAMES[i.type] : { ar: 'عمر المركبة', en: 'vehicle age' }))
          .map((n) => ({ ar: n.ar, en: n.en }));
        const input = {
          kind: 'compliance_hold',
          titleAr: 'تم إيقاف استلام الرحلات مؤقتا',
          titleEn: 'Trips paused for now',
          bodyAr: `يلزم تحديث: ${what.map((w) => w.ar).join('، ')}. ارفع الوثائق المحدثة لاستئناف العمل.`,
          bodyEn: `Needs updating: ${what.map((w) => w.en).join(', ')}. Upload the renewed documents to resume.`,
          data: { driverId: driver.id, issues },
          dedupeKey: `hold:${driver.id}:${today}`,
        };
        await this.notifications.notify([driver.id], input);
        if (driver.partnerId) await this.notifications.notify(await this.adminsOf(driver.partnerId, adminCache), input);
      } else if (!nowHeld && driver.hold) {
        result.holdsCleared++;
      }
    }

    // 3. Partner licences about to expire: once a licence lapses, its plans come off sale.
    const licences = await this.db
      .select()
      .from(partnerLicenses)
      .where(and(isNotNull(partnerLicenses.verifiedAt), lte(partnerLicenses.expiresAt, horizon)));
    for (const l of licences) {
      const daysLeft = daysBetween(today, l.expiresAt);
      const bucket = daysLeft <= 0 ? 0 : thresholds.find((t) => daysLeft <= t);
      if (bucket === undefined) continue;
      const cls = l.serviceClass === 'education' ? { ar: 'النقل التعليمي', en: 'education transport' } : { ar: 'نقل الموظفين', en: 'commute' };
      result.warnings += await this.notifications.notify(await this.adminsOf(l.partnerId, adminCache), {
        kind: 'license_expiring',
        titleAr: daysLeft <= 0 ? `انتهى ترخيص ${cls.ar}` : `ترخيص ${cls.ar} ينتهي بعد ${daysLeft} يوما`,
        titleEn: daysLeft <= 0 ? `Your ${cls.en} licence has expired` : `Your ${cls.en} licence expires in ${daysLeft} days`,
        bodyAr: 'تتوقف باقات هذه الفئة عن البيع عند انتهاء الترخيص. حدّث بيانات الترخيص بعد تجديده.',
        bodyEn: 'Plans of this class stop selling when the licence expires. Update the licence once renewed.',
        data: { licenseId: l.id, expiresAt: l.expiresAt },
        dedupeKey: `licence:${l.id}:${l.expiresAt}:${bucket}`,
      });
    }

    this.logger.log(`Compliance scan ${today}: ${JSON.stringify(result)}`);
    return result;
  }

  /** Current documents of approved drivers expiring on or before the given day (expired ones included). */
  async expiring(days: number, partnerId: string | undefined): Promise<ExpiringItem[]> {
    const today = riyadhToday();
    const rows = await this.expiringRows(addDays(today, days), partnerId);
    return rows.map((r) => ({
      documentId: r.documentId,
      driverId: r.driverId,
      driverName: r.driverName,
      phone: r.phone,
      type: r.type,
      expiresAt: r.expiresAt,
      daysLeft: daysBetween(today, r.expiresAt),
      complianceHold: r.complianceHold,
    }));
  }

  private expiringRows(until: string, partnerId: string | undefined) {
    const where: SQL[] = [
      isNull(documents.supersededAt),
      ne(documents.status, 'rejected'),
      lte(documents.expiresAt, until),
      eq(driverProfiles.status, 'approved'),
      inArray(documents.type, [...EXPIRING_DOCUMENTS]),
    ];
    if (partnerId) where.push(eq(documents.partnerId, partnerId));
    return this.db
      .select({
        documentId: documents.id,
        driverId: documents.driverId,
        partnerId: documents.partnerId,
        type: documents.type,
        expiresAt: documents.expiresAt,
        driverName: driverProfiles.fullName,
        phone: users.phone,
        complianceHold: driverProfiles.complianceHold,
      })
      .from(documents)
      .innerJoin(driverProfiles, eq(driverProfiles.userId, documents.driverId))
      .innerJoin(users, eq(users.id, documents.driverId))
      .where(and(...where))
      .orderBy(asc(documents.expiresAt))
      .then((rows) => rows.map((r) => ({ ...r, expiresAt: r.expiresAt as string })));
  }

  private async adminsOf(partnerId: string, cache: Map<string, string[]>): Promise<string[]> {
    if (!cache.has(partnerId)) cache.set(partnerId, await this.notifications.partnerAdminIds(partnerId));
    return cache.get(partnerId) as string[];
  }
}
