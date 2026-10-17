import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { TokensService } from '../auth/tokens.service';
import { decryptField } from '../common/crypto';
import { AppError } from '../common/errors';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { DOCUMENT_TYPES, documents, driverProfiles, users, vehicles } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ComplianceService } from './compliance.service';
import { DocumentsService } from './documents.service';
import { DriverDetail, DriverPage, ListDriversQuery, RejectDriverDto, ReviewDocumentDto } from './drivers.dto';
import { maskNationalId, presentDocument, presentVehicle } from './presenters';

/** The partner's side: reviewing applications and documents. */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly docs: DocumentsService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokensService,
  ) {}

  async list(actor: AuthUser, q: ListDriversQuery): Promise<DriverPage> {
    const scope = partnerScope(actor, q.partnerId);
    const where: SQL[] = [eq(users.role, 'driver'), isNull(users.deletedAt)];
    if (scope) where.push(eq(driverProfiles.partnerId, scope));
    if (q.status) where.push(eq(driverProfiles.status, q.status));
    if (q.hold) where.push(eq(driverProfiles.complianceHold, q.hold === 'true'));
    if (q.q) {
      const term = q.q.trim();
      const digits = term.replace(/\D/g, '').replace(/^0/, '');
      const conds: SQL[] = [ilike(driverProfiles.fullName, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)];
      if (digits.length >= 3) conds.push(sql`${users.phone} LIKE ${'%' + digits + '%'}`);
      where.push(or(...conds) as SQL);
    }
    const condition = and(...where);

    const pending = this.db
      .select({ driverId: documents.driverId, n: count().as('n') })
      .from(documents)
      .where(and(isNull(documents.supersededAt), eq(documents.status, 'pending')))
      .groupBy(documents.driverId)
      .as('pending');

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          phone: users.phone,
          accountStatus: users.status,
          fullName: driverProfiles.fullName,
          onboardingStatus: driverProfiles.status,
          partnerId: driverProfiles.partnerId,
          complianceHold: driverProfiles.complianceHold,
          submittedAt: driverProfiles.submittedAt,
          plateLetters: vehicles.plateLetters,
          plateNumbers: vehicles.plateNumbers,
          make: vehicles.make,
          model: vehicles.model,
          year: vehicles.year,
          pendingDocuments: pending.n,
        })
        .from(users)
        .innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
        .leftJoin(vehicles, eq(vehicles.driverId, users.id))
        .leftJoin(pending, eq(pending.driverId, users.id))
        .where(condition)
        // Waiting applications first, oldest first: the order a reviewer works in.
        .orderBy(sql`CASE ${driverProfiles.status} WHEN 'submitted' THEN 0 ELSE 1 END`, driverProfiles.submittedAt, desc(users.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: count() })
        .from(users)
        .innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
        .where(condition),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        phone: r.phone,
        fullName: r.fullName,
        accountStatus: r.accountStatus,
        onboardingStatus: r.onboardingStatus,
        partnerId: r.partnerId,
        vehicle: r.make ? `${r.make} ${r.model} ${r.year} · ${r.plateLetters} ${r.plateNumbers}` : null,
        complianceHold: r.complianceHold,
        submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
        pendingDocuments: Number(r.pendingDocuments ?? 0),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(actor: AuthUser, driverId: string): Promise<DriverDetail> {
    const { user, profile } = await this.load(actor, driverId);
    const vehicle = await this.db.query.vehicles.findFirst({ where: eq(vehicles.driverId, driverId) });
    const current = await this.docs.current(driverId);
    const fullId =
      actor.role !== 'dispatcher' && profile.nationalIdEncrypted
        ? decryptField(this.env.DATA_ENCRYPTION_KEY, profile.nationalIdEncrypted)
        : maskNationalId(profile.nationalIdLast4);

    return {
      id: user.id,
      phone: user.phone,
      accountStatus: user.status,
      onboardingStatus: profile.status,
      partnerId: profile.partnerId,
      fullName: profile.fullName,
      nationalId: fullId,
      dateOfBirth: profile.dateOfBirth,
      vehicle: vehicle ? presentVehicle(vehicle, this.env.VEHICLE_MAX_AGE_YEARS) : null,
      documents: current.map(presentDocument),
      rejectionReason: profile.rejectionReason,
      submittedAt: profile.submittedAt ? profile.submittedAt.toISOString() : null,
      reviewedAt: profile.reviewedAt ? profile.reviewedAt.toISOString() : null,
      complianceHold: profile.complianceHold,
      complianceReason: profile.complianceReason,
    };
  }

  /** Approves the application, accepting its pending documents. The driver can then receive trips. */
  async approve(actor: AuthUser, driverId: string, ip?: string): Promise<DriverDetail> {
    const { profile } = await this.load(actor, driverId);
    if (profile.status !== 'submitted') throw new AppError('DRIVER_NOT_REVIEWABLE');
    const current = await this.docs.current(driverId);
    if (current.some((d) => d.status === 'rejected')) throw new AppError('DRIVER_DOCUMENTS_REJECTED');
    const missingTypes = DOCUMENT_TYPES.filter((t) => !current.some((d) => d.type === t));
    if (missingTypes.length > 0) throw new AppError('DRIVER_INCOMPLETE', {}, missingTypes.map((t) => `document.${t}`));

    const now = new Date();
    await this.db.transaction(async (tx) => {
      const pendingIds = current.filter((d) => d.status === 'pending').map((d) => d.id);
      if (pendingIds.length) {
        await tx
          .update(documents)
          .set({ status: 'accepted', reviewedBy: actor.id, reviewedAt: now })
          .where(inArray(documents.id, pendingIds));
      }
      await tx
        .update(driverProfiles)
        .set({ status: 'approved', reviewedAt: now, reviewedBy: actor.id, rejectionReason: null })
        .where(eq(driverProfiles.userId, driverId));
      await tx.update(users).set({ status: 'active' }).where(eq(users.id, driverId));
      await this.audit.record(
        { actorId: actor.id, partnerId: profile.partnerId, action: 'driver.approve', entity: 'driver', entityId: driverId, ip },
        tx,
      );
    });
    await this.tokens.invalidateSessionCache(driverId);
    await this.compliance.evaluate(driverId);
    await this.notifications.notify([driverId], {
      kind: 'driver_approved',
      titleAr: 'تم اعتمادك سائقا',
      titleEn: 'You are approved to drive',
      bodyAr: 'اكتملت مراجعة وثائقك. ستظهر مساراتك في التطبيق عند إسنادها لك.',
      bodyEn: 'Your documents are approved. Your routes will appear in the app once assigned.',
      data: { driverId },
    });
    return this.detail(actor, driverId);
  }

  /** Sends the application back with a reason; individual documents can be rejected with their own reason. */
  async reject(actor: AuthUser, driverId: string, dto: RejectDriverDto, ip?: string): Promise<DriverDetail> {
    const { profile } = await this.load(actor, driverId);
    if (profile.status !== 'submitted') throw new AppError('DRIVER_NOT_REVIEWABLE');
    const current = await this.docs.current(driverId);
    const rejections = dto.documents ?? [];
    for (const r of rejections) {
      if (!current.some((d) => d.id === r.documentId)) throw new AppError('DOCUMENT_NOT_FOUND');
    }

    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const r of rejections) {
        await tx
          .update(documents)
          .set({ status: 'rejected', rejectionReason: r.reason, reviewedBy: actor.id, reviewedAt: now })
          .where(eq(documents.id, r.documentId));
      }
      await tx
        .update(driverProfiles)
        .set({ status: 'rejected', rejectionReason: dto.reason, reviewedAt: now, reviewedBy: actor.id })
        .where(eq(driverProfiles.userId, driverId));
      await this.audit.record(
        {
          actorId: actor.id,
          partnerId: profile.partnerId,
          action: 'driver.reject',
          entity: 'driver',
          entityId: driverId,
          after: { reason: dto.reason, documents: rejections },
          ip,
        },
        tx,
      );
    });
    await this.notifications.notify([driverId], {
      kind: 'driver_rejected',
      titleAr: 'طلبك يحتاج تعديلا',
      titleEn: 'Your application needs changes',
      bodyAr: dto.reason,
      bodyEn: dto.reason,
      data: { driverId, documents: rejections.map((r) => r.documentId) },
    });
    return this.detail(actor, driverId);
  }

  /** Reviews a single document, typically a renewal uploaded by an approved driver. */
  async reviewDocument(actor: AuthUser, documentId: string, dto: ReviewDocumentDto, ip?: string): Promise<DriverDetail> {
    const doc = await this.db.query.documents.findFirst({ where: eq(documents.id, documentId) });
    if (!doc || doc.supersededAt) throw new AppError('DOCUMENT_NOT_FOUND');
    assertPartnerAccess(actor, doc.partnerId);
    if (dto.status === 'rejected' && !dto.rejectionReason) {
      throw new AppError('VALIDATION_FAILED', {}, ['rejectionReason is required when rejecting']);
    }
    await this.db
      .update(documents)
      .set({
        status: dto.status,
        rejectionReason: dto.status === 'rejected' ? (dto.rejectionReason as string) : null,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    await this.audit.record({
      actorId: actor.id,
      partnerId: doc.partnerId,
      action: `document.${dto.status}`,
      entity: 'document',
      entityId: documentId,
      before: { status: doc.status },
      after: { status: dto.status, reason: dto.rejectionReason ?? null },
      ip,
    });
    await this.compliance.evaluate(doc.driverId);
    if (dto.status === 'rejected') {
      await this.notifications.notify([doc.driverId], {
        kind: 'document_rejected',
        titleAr: 'وثيقة مرفوضة',
        titleEn: 'A document was rejected',
        bodyAr: dto.rejectionReason as string,
        bodyEn: dto.rejectionReason as string,
        data: { documentId },
      });
    }
    return this.detail(actor, doc.driverId);
  }

  private async load(actor: AuthUser, driverId: string) {
    const user = await this.db.query.users.findFirst({
      where: and(eq(users.id, driverId), eq(users.role, 'driver'), isNull(users.deletedAt)),
    });
    const profile = user
      ? await this.db.query.driverProfiles.findFirst({ where: eq(driverProfiles.userId, driverId) })
      : undefined;
    if (!user || !profile) throw new AppError('USER_NOT_FOUND');
    try {
      assertPartnerAccess(actor, profile.partnerId);
    } catch {
      throw new AppError('USER_NOT_FOUND');
    }
    return { user, profile };
  }
}
