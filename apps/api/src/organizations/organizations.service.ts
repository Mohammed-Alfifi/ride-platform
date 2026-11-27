import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { normalizeSaudiMobile } from '../common/phone';
import { addDays, riyadhToday } from '../common/saudi';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { Organization, organizationMembers, organizations, partners, plans, users } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AddMemberDto,
  AttendanceQuery,
  AttendanceRow,
  AttendanceView,
  BulkMembersDto,
  BulkResultView,
  CreateOrgAdminDto,
  CreateOrganizationDto,
  MemberQuery,
  MemberView,
  OrgAdminView,
  OrganizationQuery,
  OrganizationView,
  OrgProfileView,
  SponsorView,
  UpdateOrganizationDto,
} from './organizations.dto';

/** The gateway's smallest charge: a member's share below it is paid by the organization instead. */
export const MIN_MEMBER_CHARGE_HALALAS = 100;
const MAX_ATTENDANCE_DAYS = 92;

/** Splits a period's price between the organization and the member. */
export function splitPrice(priceHalalas: number, coverageBps: number): { org: number; member: number } {
  if (coverageBps <= 0) return { org: 0, member: priceHalalas };
  let org = Math.round((priceHalalas * coverageBps) / 10_000);
  let member = priceHalalas - org;
  if (member > 0 && member < MIN_MEMBER_CHARGE_HALALAS) {
    org = priceHalalas;
    member = 0;
  }
  return { org, member };
}

/**
 * Companies and schools that pay for their people's rides with a partner.
 * The partner's team sets the agreement up (who is covered, which plans, what share) and creates
 * the organization's admins; those admins add and remove members, follow attendance and see invoices.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ partner side

  async list(actor: AuthUser, q: OrganizationQuery): Promise<OrganizationView[]> {
    const scope = partnerScope(actor, q.partnerId);
    const rows = await this.db
      .select()
      .from(organizations)
      .where(scope ? eq(organizations.partnerId, scope) : undefined)
      .orderBy(asc(organizations.nameAr));
    return this.present(rows);
  }

  async getForPartner(actor: AuthUser, id: string): Promise<Organization> {
    const org = await this.db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw new AppError('ORGANIZATION_NOT_FOUND');
    try {
      assertPartnerAccess(actor, org.partnerId);
    } catch {
      throw new AppError('ORGANIZATION_NOT_FOUND');
    }
    return org;
  }

  async view(actor: AuthUser, id: string): Promise<OrganizationView> {
    return (await this.present([await this.getForPartner(actor, id)]))[0];
  }

  async create(actor: AuthUser, dto: CreateOrganizationDto, ip?: string): Promise<OrganizationView> {
    const partnerId = actor.role === 'super_admin' ? dto.partnerId : actor.partnerId;
    if (!partnerId) throw new AppError('VALIDATION_FAILED', {}, ['partnerId is required']);
    assertPartnerAccess(actor, partnerId);
    await this.assertPlans(partnerId, dto.planIds);
    const [org] = await this.db
      .insert(organizations)
      .values({
        partnerId,
        kind: dto.kind,
        nameAr: dto.nameAr.trim(),
        nameEn: dto.nameEn.trim(),
        legalName: dto.legalName.trim(),
        crNumber: dto.crNumber ?? null,
        vatNumber: dto.vatNumber ?? null,
        address: dto.address?.trim() || null,
        contactPhone: dto.contactPhone ? normalizeSaudiMobile(dto.contactPhone) : null,
        coverageBps: dto.coverageBps,
        planIds: [...new Set(dto.planIds)],
      })
      .returning();
    await this.audit.record({ actorId: actor.id, partnerId, action: 'organization.create', entity: 'organization', entityId: org.id, after: org, ip });
    return this.view(actor, org.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateOrganizationDto, ip?: string): Promise<OrganizationView> {
    const before = await this.getForPartner(actor, id);
    if (dto.partnerId && dto.partnerId !== before.partnerId) throw new AppError('VALIDATION_FAILED', {}, ['partnerId cannot change']);
    if (dto.planIds) await this.assertPlans(before.partnerId, dto.planIds);
    const patch = Object.fromEntries(
      Object.entries({
        kind: dto.kind,
        nameAr: dto.nameAr?.trim(),
        nameEn: dto.nameEn?.trim(),
        legalName: dto.legalName?.trim(),
        crNumber: dto.crNumber,
        vatNumber: dto.vatNumber,
        address: dto.address === undefined ? undefined : dto.address?.trim() || null,
        contactPhone: dto.contactPhone === undefined ? undefined : dto.contactPhone ? normalizeSaudiMobile(dto.contactPhone) : null,
        coverageBps: dto.coverageBps,
        planIds: dto.planIds ? [...new Set(dto.planIds)] : undefined,
        status: dto.status,
      }).filter(([, v]) => v !== undefined),
    );
    const [after] = await this.db.update(organizations).set(patch).where(eq(organizations.id, id)).returning();
    await this.audit.record({ actorId: actor.id, partnerId: before.partnerId, action: 'organization.update', entity: 'organization', entityId: id, before, after, ip });
    return this.view(actor, id);
  }

  async admins(actor: AuthUser, id: string): Promise<OrgAdminView[]> {
    await this.getForPartner(actor, id);
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, id), eq(users.role, 'org_admin'), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt));
    return rows.map((u) => ({ id: u.id, phone: u.phone, name: u.name, status: u.status, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }));
  }

  /** An account that signs in to the dashboard for this organization only. */
  async addAdmin(actor: AuthUser, id: string, dto: CreateOrgAdminDto, ip?: string): Promise<OrgAdminView> {
    const org = await this.getForPartner(actor, id);
    const phone = normalizeSaudiMobile(dto.phone);
    const existing = await this.db.query.users.findFirst({
      where: and(eq(users.phone, phone), eq(users.audience, 'admin'), isNull(users.deletedAt)),
    });
    if (existing) throw new AppError('USER_ALREADY_EXISTS');
    const [u] = await this.db
      .insert(users)
      .values({ phone, name: dto.name.trim(), role: 'org_admin', audience: 'admin', partnerId: null, organizationId: org.id })
      .returning();
    await this.audit.record({
      actorId: actor.id,
      partnerId: org.partnerId,
      action: 'organization.admin_add',
      entity: 'user',
      entityId: u.id,
      after: { organizationId: org.id, name: u.name },
      ip,
    });
    return { id: u.id, phone: u.phone, name: u.name, status: u.status, lastLoginAt: null };
  }

  private async assertPlans(partnerId: string, planIds: string[]): Promise<void> {
    const ids = [...new Set(planIds)];
    const found = await this.db.select({ id: plans.id }).from(plans).where(and(inArray(plans.id, ids), eq(plans.partnerId, partnerId)));
    if (found.length !== ids.length) throw new AppError('ORG_PLAN_INVALID');
  }

  private async present(rows: Organization[]): Promise<OrganizationView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const idList = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const stats = await this.db.execute<{ id: string; members: number; seats: number; unpaid: number; overdue: number; credits: number }>(sql`
      SELECT o.id,
        (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id AND m.removed_at IS NULL)::int AS members,
        (SELECT count(*) FROM subscriptions s WHERE s.organization_id = o.id AND s.status IN ('active','past_due','paused'))::int AS seats,
        (SELECT coalesce(sum(i.total_halalas), 0) FROM organization_invoices i WHERE i.organization_id = o.id AND i.status = 'issued')::int AS unpaid,
        (SELECT count(*) FROM organization_invoices i WHERE i.organization_id = o.id AND i.status = 'issued' AND i.due_date < ${riyadhToday()})::int AS overdue,
        (SELECT coalesce(sum(c.amount_halalas), 0) FROM organization_credits c WHERE c.organization_id = o.id AND c.org_invoice_id IS NULL)::int AS credits
      FROM organizations o WHERE o.id IN (${idList})`);
    const partnerRows = await this.db
      .select({ id: partners.id, nameAr: partners.nameAr, nameEn: partners.nameEn })
      .from(partners)
      .where(inArray(partners.id, [...new Set(rows.map((r) => r.partnerId))]));
    return rows.map((o) => {
      const s = stats.rows.find((x) => x.id === o.id);
      const p = partnerRows.find((x) => x.id === o.partnerId);
      return {
        id: o.id,
        partnerId: o.partnerId,
        partnerNameAr: p?.nameAr ?? '',
        partnerNameEn: p?.nameEn ?? '',
        kind: o.kind,
        nameAr: o.nameAr,
        nameEn: o.nameEn,
        legalName: o.legalName,
        crNumber: o.crNumber,
        vatNumber: o.vatNumber,
        address: o.address,
        contactPhone: o.contactPhone,
        coverageBps: o.coverageBps,
        planIds: o.planIds,
        status: o.status,
        members: Number(s?.members ?? 0),
        seats: Number(s?.seats ?? 0),
        unpaidHalalas: Number(s?.unpaid ?? 0),
        overdue: Number(s?.overdue ?? 0),
        openCreditHalalas: Number(s?.credits ?? 0),
      };
    });
  }

  // ------------------------------------------------------------------ the organization's own admins

  /** The organization an org_admin manages; everything they see is limited to it. */
  async orgOf(user: AuthUser): Promise<Organization> {
    if (user.role !== 'org_admin') throw new AppError('FORBIDDEN');
    const row = await this.db
      .select({ org: organizations })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(eq(users.id, user.id))
      .then((r) => r[0]);
    if (!row) throw new AppError('FORBIDDEN');
    return row.org;
  }

  async profile(user: AuthUser): Promise<OrgProfileView> {
    const org = await this.orgOf(user);
    const [view] = await this.present([org]);
    const planRows = await this.db.select().from(plans).where(inArray(plans.id, org.planIds)).orderBy(asc(plans.priceHalalas));
    return {
      id: org.id,
      kind: org.kind,
      nameAr: org.nameAr,
      nameEn: org.nameEn,
      partnerNameAr: view.partnerNameAr,
      partnerNameEn: view.partnerNameEn,
      coverageBps: org.coverageBps,
      status: org.status,
      plans: planRows.map((p) => {
        const split = splitPrice(p.priceHalalas, org.coverageBps);
        return { id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, priceHalalas: p.priceHalalas, orgHalalas: split.org, memberHalalas: split.member };
      }),
      members: view.members,
      seats: view.seats,
      unpaidHalalas: view.unpaidHalalas,
      openCreditHalalas: view.openCreditHalalas,
      payOnline: this.env.PAYMENT_PROVIDER !== 'manual',
    };
  }

  async members(orgId: string, q: MemberQuery = {}): Promise<MemberView[]> {
    const like = q.q ? `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db.execute<{
      id: string;
      phone: string;
      name: string;
      reference: string | null;
      rider_id: string | null;
      status: string | null;
      plan_ar: string | null;
      plan_en: string | null;
      period_end: string | null;
      created_at: Date;
    }>(sql`
      SELECT m.id, m.phone, m.name, m.reference, u.id AS rider_id, s.status, p.name_ar AS plan_ar, p.name_en AS plan_en,
             s.current_period_end::text AS period_end, m.created_at
      FROM organization_members m
      LEFT JOIN users u ON u.phone = m.phone AND u.audience = 'rider' AND u.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions s
        WHERE s.rider_id = u.id AND s.organization_id = m.organization_id
        ORDER BY (s.status IN ('active','past_due','paused')) DESC, s.created_at DESC
        LIMIT 1
      ) s ON true
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE m.organization_id = ${orgId} AND m.removed_at IS NULL
        ${like ? sql`AND (m.name ILIKE ${like} OR m.phone ILIKE ${like} OR m.reference ILIKE ${like})` : sql``}
      ORDER BY m.name`);
    return rows.rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      name: r.name,
      reference: r.reference,
      joined: r.rider_id !== null,
      subscriptionStatus: r.status,
      planNameAr: r.plan_ar,
      planNameEn: r.plan_en,
      currentPeriodEnd: r.period_end,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async addMember(user: AuthUser, dto: AddMemberDto): Promise<MemberView> {
    const org = await this.orgOf(user);
    const result = await this.insertMembers(org, user.id, [dto]);
    if (result.errors.length) throw new AppError(result.errors[0].code as 'AUTH_PHONE_INVALID' | 'ORG_MEMBER_ELSEWHERE');
    const phone = normalizeSaudiMobile(dto.phone);
    return (await this.members(org.id)).find((m) => m.phone === phone) as MemberView;
  }

  async bulk(user: AuthUser, dto: BulkMembersDto): Promise<BulkResultView> {
    return this.insertMembers(await this.orgOf(user), user.id, dto.members);
  }

  private async insertMembers(org: Organization, actorId: string, input: AddMemberDto[]): Promise<BulkResultView> {
    const result: BulkResultView = { added: 0, existing: 0, errors: [] };
    const seen = new Set<string>();
    const clean: { row: number; phone: string; name: string; reference: string | null }[] = [];
    input.forEach((m, i) => {
      let phone: string;
      try {
        phone = normalizeSaudiMobile(m.phone);
      } catch {
        result.errors.push({ row: i + 1, phone: m.phone, code: 'AUTH_PHONE_INVALID' });
        return;
      }
      if (seen.has(phone)) {
        result.errors.push({ row: i + 1, phone, code: 'DUPLICATE' });
        return;
      }
      seen.add(phone);
      clean.push({ row: i + 1, phone, name: m.name.trim(), reference: m.reference?.trim() || null });
    });
    if (clean.length === 0) return result;

    const current = await this.db
      .select({ phone: organizationMembers.phone, organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.partnerId, org.partnerId),
          isNull(organizationMembers.removedAt),
          inArray(
            organizationMembers.phone,
            clean.map((c) => c.phone),
          ),
        ),
      );
    const fresh = clean.filter((c) => {
      const hit = current.find((x) => x.phone === c.phone);
      if (!hit) return true;
      if (hit.organizationId === org.id) result.existing++;
      else result.errors.push({ row: c.row, phone: c.phone, code: 'ORG_MEMBER_ELSEWHERE' });
      return false;
    });
    if (fresh.length) {
      const inserted = await this.db
        .insert(organizationMembers)
        .values(fresh.map((c) => ({ phone: c.phone, name: c.name, reference: c.reference, organizationId: org.id, partnerId: org.partnerId, addedBy: actorId })))
        .onConflictDoNothing()
        .returning({ phone: organizationMembers.phone });
      result.added = inserted.length;
      // Members who already use the app hear about it; the others see it when they subscribe.
      const riders = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.audience, 'rider'),
            isNull(users.deletedAt),
            inArray(
              users.phone,
              inserted.map((r) => r.phone),
            ),
          ),
        );
      const share = org.coverageBps === 10_000 ? { ar: 'كامل', en: 'all of' } : { ar: `${org.coverageBps / 100}% من`, en: `${org.coverageBps / 100}% of` };
      await this.notifications.notify(
        riders.map((r) => r.id),
        {
          kind: 'organization_member',
          titleAr: `${org.nameAr} تتحمل اشتراكك`,
          titleEn: `${org.nameEn} pays for your rides`,
          bodyAr: `أضافتك ${org.nameAr}، وتتحمل ${share.ar} قيمة اشتراكك. اشترك من التطبيق في إحدى باقاتها.`,
          bodyEn: `${org.nameEn} added you and pays ${share.en} your subscription. Subscribe in the app to one of its plans.`,
          data: { organizationId: org.id },
          dedupeKey: `org-member:${org.id}`,
        },
      );
    }
    return result;
  }

  /** The organization stops paying from the member's next period; the current one runs to its end. */
  async removeMember(user: AuthUser, memberId: string): Promise<void> {
    const org = await this.orgOf(user);
    const [m] = await this.db
      .update(organizationMembers)
      .set({ removedAt: new Date() })
      .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, org.id), isNull(organizationMembers.removedAt)))
      .returning();
    if (!m) throw new AppError('ORG_MEMBER_NOT_FOUND');
    const rider = await this.db.query.users.findFirst({
      columns: { id: true },
      where: and(eq(users.phone, m.phone), eq(users.audience, 'rider'), isNull(users.deletedAt)),
    });
    if (rider) {
      await this.notifications.notify([rider.id], {
        kind: 'organization_member_removed',
        titleAr: `لم تعد ${org.nameAr} تتحمل اشتراكك`,
        titleEn: `${org.nameEn} no longer pays for your rides`,
        bodyAr: 'تستمر رحلاتك حتى نهاية الفترة الحالية، ثم يتجدد الاشتراك على حسابك إن رغبت.',
        bodyEn: 'Your rides continue to the end of the current period; after that the subscription renews on your account if you keep it.',
        data: { organizationId: org.id },
      });
    }
  }

  // ------------------------------------------------------------------ attendance

  async attendance(orgId: string, q: AttendanceQuery): Promise<AttendanceView> {
    this.assertRange(q);
    const rows = await this.db.execute<{
      member_id: string;
      name: string;
      reference: string | null;
      planned: number;
      rode: number;
      excused: number;
      no_show: number;
      missed: number;
      late: number;
    }>(sql`
      ${this.tripsFor(orgId, q)}
      SELECT member_id, name, reference,
        count(*) FILTER (WHERE status <> 'cancelled')::int AS planned,
        count(*) FILTER (WHERE status = 'completed')::int AS rode,
        count(*) FILTER (WHERE status = 'skipped')::int AS excused,
        count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
        count(*) FILTER (WHERE missed)::int AS missed,
        count(*) FILTER (WHERE late_minutes > ${this.env.COMPENSATION_LATE_MINUTES})::int AS late
      FROM t GROUP BY member_id, name, reference ORDER BY name`);
    const out: AttendanceRow[] = rows.rows.map((r) => ({
      memberId: r.member_id,
      name: r.name,
      reference: r.reference,
      planned: Number(r.planned),
      rode: Number(r.rode),
      excused: Number(r.excused),
      noShow: Number(r.no_show),
      missed: Number(r.missed),
      late: Number(r.late),
    }));
    const sum = (k: keyof AttendanceRow) => out.reduce((a, r) => a + (r[k] as number), 0);
    return {
      from: q.from,
      to: q.to,
      rows: out,
      totals: { memberId: '', name: '', reference: null, planned: sum('planned'), rode: sum('rode'), excused: sum('excused'), noShow: sum('noShow'), missed: sum('missed'), late: sum('late') },
    };
  }

  /** Every trip in the range, one line each, for a spreadsheet (UTF-8 with BOM so Excel reads Arabic). */
  async attendanceCsv(orgId: string, q: AttendanceQuery): Promise<string> {
    this.assertRange(q);
    const rows = await this.db.execute<{
      service_date: string;
      leg: string;
      name: string;
      reference: string | null;
      scheduled: string;
      picked: string | null;
      status: string;
      missed: boolean;
      late_minutes: number | null;
    }>(sql`
      ${this.tripsFor(orgId, q)}
      SELECT service_date::text, leg, name, reference,
             to_char(scheduled_at AT TIME ZONE 'Asia/Riyadh', 'HH24:MI') AS scheduled,
             to_char(picked_up_at AT TIME ZONE 'Asia/Riyadh', 'HH24:MI') AS picked,
             status, missed, late_minutes
      FROM t ORDER BY service_date, name, leg DESC`);
    const label = (r: (typeof rows.rows)[number]) =>
      r.missed
        ? 'لم يحضر السائق'
        : ({ completed: 'ركب', skipped: 'اعتذر', no_show: 'لم يخرج', cancelled: 'ملغاة', scheduled: 'مجدولة', en_route: 'جارية', arrived: 'جارية', on_board: 'جارية' } as Record<string, string>)[r.status] ?? r.status;
    const cell = (v: string | number | null) => {
      const s = v === null ? '' : String(v);
      // Quote everything; a leading = + - @ could run as a formula in a spreadsheet.
      return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const lines = [
      ['التاريخ', 'الاتجاه', 'الاسم', 'المرجع', 'الموعد', 'وقت الركوب', 'الحالة', 'التأخير (دقيقة)'].map(cell).join(','),
      ...rows.rows.map((r) =>
        [
          r.service_date,
          r.leg === 'outbound' ? 'ذهاب' : 'عودة',
          r.name,
          r.reference,
          r.scheduled,
          r.picked,
          label(r),
          r.late_minutes !== null && r.late_minutes > 0 ? r.late_minutes : null,
        ]
          .map(cell)
          .join(','),
      ),
    ];
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  private assertRange(q: AttendanceQuery): void {
    if (q.to < q.from || addDays(q.from, MAX_ATTENDANCE_DAYS) < q.to) {
      throw new AppError('VALIDATION_FAILED', {}, [`the range must be ${MAX_ATTENDANCE_DAYS} days at most, from before to`]);
    }
  }

  /** The organization's trips in the range, with the member they belong to (by the rider's phone). */
  private tripsFor(orgId: string, q: AttendanceQuery) {
    const today = riyadhToday();
    return sql`
      WITH t AS (
        SELECT tr.service_date, tr.leg, tr.status, tr.scheduled_at, tr.picked_up_at, m.id AS member_id, m.name, m.reference,
               (tr.status IN ('scheduled','en_route') AND tr.service_date < ${today}) AS missed,
               CASE WHEN tr.status = 'completed'
                 THEN floor(extract(epoch FROM (coalesce(tr.arrived_at, tr.picked_up_at) - tr.scheduled_at)) / 60)::int END AS late_minutes
        FROM trips tr
        JOIN subscriptions s ON s.id = tr.subscription_id AND s.organization_id = ${orgId}
        JOIN users u ON u.id = tr.rider_id
        JOIN LATERAL (
          SELECT id, name, reference FROM organization_members
          WHERE organization_id = ${orgId} AND phone = u.phone
          ORDER BY removed_at IS NULL DESC, created_at DESC LIMIT 1
        ) m ON true
        WHERE tr.service_date BETWEEN ${q.from} AND ${q.to}
      )`;
  }

  // ------------------------------------------------------------------ sponsorship

  /** The organization that pays for this rider on this plan, if the rider is one of its members. */
  async sponsorFor(riderId: string, partnerId: string, planId: string): Promise<Organization | null> {
    const row = await this.db
      .select({ org: organizations })
      .from(users)
      .innerJoin(
        organizationMembers,
        and(eq(organizationMembers.phone, users.phone), eq(organizationMembers.partnerId, partnerId), isNull(organizationMembers.removedAt)),
      )
      .innerJoin(
        organizations,
        and(eq(organizations.id, organizationMembers.organizationId), eq(organizations.status, 'active'), sql`${planId}::uuid = ANY(${organizations.planIds})`),
      )
      .where(eq(users.id, riderId))
      .then((r) => r[0]);
    return row?.org ?? null;
  }

  sponsorView(org: Organization | null, priceHalalas: number): SponsorView | null {
    if (!org) return null;
    return { organizationId: org.id, nameAr: org.nameAr, nameEn: org.nameEn, coverageBps: org.coverageBps, orgHalalas: splitPrice(priceHalalas, org.coverageBps).org };
  }

  /** For the rider's subscription screen: who pays, by id. */
  async name(orgId: string | null): Promise<{ nameAr: string; nameEn: string } | null> {
    if (!orgId) return null;
    const o = await this.db.query.organizations.findFirst({ columns: { nameAr: true, nameEn: true }, where: eq(organizations.id, orgId) });
    return o ?? null;
  }
}

