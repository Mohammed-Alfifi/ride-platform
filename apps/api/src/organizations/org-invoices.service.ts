import { Inject, Injectable, Logger } from '@nestjs/common';
import QRCode from 'qrcode';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { addDays, riyadhToday } from '../common/saudi';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  Organization,
  OrganizationInvoice,
  organizationCredits,
  organizationInvoices,
  organizations,
  orgInvoiceSequences,
  partners,
  payments,
  users,
} from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { vatIncluded, zatcaQr } from '../payments/zatca';
import { OrgCreditView, OrgInvoiceDetailView, OrgInvoiceLineView, OrgInvoiceView, PayOrgInvoiceDto } from './organizations.dto';

/** The first moment of the month after `month` (YYYY-MM), Riyadh time. */
function monthEnd(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return new Date(`${next}-01T00:00:00+03:00`);
}

/** The month before today's, Riyadh time: what the run on the 1st bills. */
export function previousMonth(today = riyadhToday()): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * One tax invoice a month to each organization, from the partner (the seller) to the organization
 * (the buyer, with its VAT and CR numbers): its share of every subscription period paid up to the
 * end of that month and not billed before. Late items roll into the next month, never twice.
 */
@Injectable()
export class OrgInvoicesService {
  private readonly logger = new Logger(OrgInvoicesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async issue(org: Organization, month: string, actor: AuthUser | null = null): Promise<OrganizationInvoice> {
    const existing = await this.db.query.organizationInvoices.findFirst({
      where: and(eq(organizationInvoices.organizationId, org.id), eq(organizationInvoices.month, month)),
    });
    if (existing) return existing;
    if (monthEnd(month) > monthEnd(riyadhToday().slice(0, 7))) throw new AppError('VALIDATION_FAILED', {}, ['month is in the future']);
    const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, org.partnerId) });
    if (!partner) throw new AppError('PARTNER_NOT_FOUND');

    const invoice = await this.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: payments.id, org: payments.orgHalalas })
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, org.id),
            eq(payments.status, 'paid'),
            gt(payments.orgHalalas, 0),
            isNull(payments.orgInvoiceId),
            lt(payments.paidAt, monthEnd(month)),
          ),
        )
        .for('update');
      if (due.length === 0) throw new AppError('ORG_NOTHING_TO_INVOICE');
      const gross = due.reduce((a, p) => a + p.org, 0);
      // Credits owed to the organization come off, oldest first, never past the invoice's own amount;
      // a credit that does not fit whole waits for the next month.
      const open = await tx
        .select({ id: organizationCredits.id, amount: organizationCredits.amountHalalas })
        .from(organizationCredits)
        .where(and(eq(organizationCredits.organizationId, org.id), isNull(organizationCredits.orgInvoiceId), lt(organizationCredits.createdAt, monthEnd(month))))
        .orderBy(asc(organizationCredits.createdAt))
        .for('update');
      const applied: string[] = [];
      let credit = 0;
      for (const c of open) {
        // One that does not fit waits; smaller ones after it can still be used now.
        if (credit + c.amount > gross) continue;
        credit += c.amount;
        applied.push(c.id);
      }
      const total = gross - credit;
      const issuedAt = new Date();
      const year = Number(riyadhToday(issuedAt).slice(0, 4));
      const sellerName = partner.legalName ?? partner.nameAr;
      const vat = partner.vatNumber ? vatIncluded(total, this.env.VAT_RATE_BPS) : 0;
      const fee = Math.round((total * partner.commissionBps) / 10_000);
      const [seq] = await tx
        .insert(orgInvoiceSequences)
        .values({ year, last: 1 })
        .onConflictDoUpdate({ target: orgInvoiceSequences.year, set: { last: sql`${orgInvoiceSequences.last} + 1` } })
        .returning();
      const [row] = await tx
        .insert(organizationInvoices)
        .values({
          organizationId: org.id,
          partnerId: org.partnerId,
          month,
          number: `ORG-${year}-${String(seq.last).padStart(5, '0')}`,
          sellerName,
          sellerVatNumber: partner.vatNumber,
          buyerName: org.legalName,
          buyerVatNumber: org.vatNumber,
          buyerCrNumber: org.crNumber,
          lines: due.length,
          grossHalalas: gross,
          creditHalalas: credit,
          totalHalalas: total,
          vatHalalas: vat,
          platformFeeHalalas: fee,
          partnerShareHalalas: total - fee,
          qrTlv: partner.vatNumber ? zatcaQr({ sellerName, vatNumber: partner.vatNumber, timestamp: issuedAt, totalHalalas: total, vatHalalas: vat }) : null,
          issuedAt,
          dueDate: addDays(riyadhToday(issuedAt), this.env.ORG_INVOICE_DUE_DAYS),
          // Nothing left to pay once the credits are taken off.
          ...(total === 0 ? { status: 'paid' as const, paidAt: issuedAt, method: 'credit' } : {}),
        })
        .returning();
      if (applied.length) await tx.update(organizationCredits).set({ orgInvoiceId: row.id }).where(inArray(organizationCredits.id, applied));
      await tx
        .update(payments)
        .set({ orgInvoiceId: row.id })
        .where(sql`${payments.id} IN (${sql.join(
          due.map((d) => sql`${d.id}::uuid`),
          sql`, `,
        )})`);
      return row;
    });

    if (actor) {
      await this.audit.record({ actorId: actor.id, partnerId: org.partnerId, action: 'organization_invoice.issue', entity: 'organization_invoice', entityId: invoice.id, after: { month, total: invoice.totalHalalas } });
    }
    const admins = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, org.id), isNull(users.deletedAt)));
    await this.notifications.notify(
      admins.map((a) => a.id),
      {
        kind: 'organization_invoice',
        titleAr: `فاتورة شهر ${month}`,
        titleEn: `Invoice for ${month}`,
        bodyAr: `${(invoice.totalHalalas / 100).toFixed(2)} ريال عن ${invoice.lines} اشتراك، تستحق في ${invoice.dueDate}.`,
        bodyEn: `SAR ${(invoice.totalHalalas / 100).toFixed(2)} for ${invoice.lines} subscriptions, due ${invoice.dueDate}.`,
        data: { organizationInvoiceId: invoice.id },
        dedupeKey: `org-invoice:${invoice.id}`,
      },
    );
    return invoice;
  }

  /** The run on the 1st: last month's invoice for every organization with something to bill. */
  async issueAll(month = previousMonth()): Promise<{ issued: number }> {
    const orgs = await this.db.execute<{ id: string }>(sql`
      SELECT DISTINCT organization_id AS id FROM payments
      WHERE organization_id IS NOT NULL AND status = 'paid' AND org_halalas > 0 AND org_invoice_id IS NULL AND paid_at < ${monthEnd(month)}`);
    let issued = 0;
    for (const { id } of orgs.rows) {
      const org = await this.db.query.organizations.findFirst({ where: eq(organizations.id, id) });
      if (!org) continue;
      try {
        await this.issue(org, month);
        issued++;
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'ORG_NOTHING_TO_INVOICE')) this.logger.error(`Invoice for ${id} ${month} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Organization invoices ${month}: ${issued}`);
    return { issued };
  }

  async listForPartner(actor: AuthUser, organizationId?: string, partnerId?: string): Promise<OrgInvoiceView[]> {
    const scope = partnerScope(actor, partnerId);
    const where = and(
      scope ? eq(organizationInvoices.partnerId, scope) : undefined,
      organizationId ? eq(organizationInvoices.organizationId, organizationId) : undefined,
    );
    return this.listWhere(where);
  }

  listForOrg(orgId: string): Promise<OrgInvoiceView[]> {
    return this.listWhere(eq(organizationInvoices.organizationId, orgId));
  }

  private async listWhere(where: ReturnType<typeof and>): Promise<OrgInvoiceView[]> {
    const rows = await this.db
      .select({ inv: organizationInvoices, nameAr: organizations.nameAr, nameEn: organizations.nameEn })
      .from(organizationInvoices)
      .innerJoin(organizations, eq(organizations.id, organizationInvoices.organizationId))
      .where(where)
      .orderBy(desc(organizationInvoices.issuedAt))
      .limit(200);
    return rows.map((r) => this.present(r.inv, r.nameAr, r.nameEn));
  }

  async getForPartner(actor: AuthUser, id: string): Promise<OrganizationInvoice> {
    const inv = await this.db.query.organizationInvoices.findFirst({ where: eq(organizationInvoices.id, id) });
    if (!inv) throw new AppError('ORG_INVOICE_NOT_FOUND');
    try {
      assertPartnerAccess(actor, inv.partnerId);
    } catch {
      throw new AppError('ORG_INVOICE_NOT_FOUND');
    }
    return inv;
  }

  async getForOrg(orgId: string, id: string): Promise<OrganizationInvoice> {
    const inv = await this.db.query.organizationInvoices.findFirst({
      where: and(eq(organizationInvoices.id, id), eq(organizationInvoices.organizationId, orgId)),
    });
    if (!inv) throw new AppError('ORG_INVOICE_NOT_FOUND');
    return inv;
  }

  async detail(inv: OrganizationInvoice): Promise<OrgInvoiceDetailView> {
    const org = (await this.db.query.organizations.findFirst({ where: eq(organizations.id, inv.organizationId) })) as Organization;
    return { ...this.present(inv, org.nameAr, org.nameEn), items: await this.items(inv), credits: await this.credits(inv) };
  }

  async pay(actor: AuthUser, id: string, dto: PayOrgInvoiceDto, ip?: string): Promise<OrgInvoiceView> {
    const inv = await this.getForPartner(actor, id);
    if (inv.status !== 'issued') throw new AppError('ORG_INVOICE_PAID');
    const [paid] = await this.db
      .update(organizationInvoices)
      .set({ status: 'paid', paidAt: new Date(), method: dto.method, reference: dto.reference?.trim() || null, recordedBy: actor.id })
      .where(and(eq(organizationInvoices.id, id), eq(organizationInvoices.status, 'issued')))
      .returning();
    if (!paid) throw new AppError('ORG_INVOICE_PAID');
    await this.audit.record({
      actorId: actor.id,
      partnerId: inv.partnerId,
      action: 'organization_invoice.pay',
      entity: 'organization_invoice',
      entityId: id,
      after: { method: dto.method, reference: paid.reference },
      ip,
    });
    const org = (await this.db.query.organizations.findFirst({ where: eq(organizations.id, inv.organizationId) })) as Organization;
    return this.present(paid, org.nameAr, org.nameEn);
  }

  private async credits(inv: OrganizationInvoice): Promise<OrgCreditView[]> {
    const rows = await this.db.select().from(organizationCredits).where(eq(organizationCredits.orgInvoiceId, inv.id)).orderBy(asc(organizationCredits.createdAt));
    return rows.map(presentCredit);
  }

  /** Credits not yet taken off an invoice. */
  async openCredits(orgId: string): Promise<OrgCreditView[]> {
    const rows = await this.db
      .select()
      .from(organizationCredits)
      .where(and(eq(organizationCredits.organizationId, orgId), isNull(organizationCredits.orgInvoiceId)))
      .orderBy(desc(organizationCredits.createdAt))
      .limit(200);
    return rows.map(presentCredit);
  }

  private async items(inv: OrganizationInvoice): Promise<OrgInvoiceLineView[]> {
    const rows = await this.db.execute<{
      member_name: string | null;
      rider_name: string | null;
      reference: string | null;
      plan_ar: string;
      plan_en: string;
      period_start: string | null;
      paid_at: Date;
      amount: number;
    }>(sql`
      SELECT m.name AS member_name, u.name AS rider_name, m.reference, pl.name_ar AS plan_ar, pl.name_en AS plan_en,
             p.period_start::text AS period_start, p.paid_at, p.org_halalas AS amount
      FROM payments p
      JOIN subscriptions s ON s.id = p.subscription_id
      JOIN plans pl ON pl.id = s.plan_id
      JOIN users u ON u.id = p.rider_id
      LEFT JOIN LATERAL (
        SELECT name, reference FROM organization_members
        WHERE organization_id = p.organization_id AND phone = u.phone
        ORDER BY removed_at IS NULL DESC, created_at DESC LIMIT 1
      ) m ON true
      WHERE p.org_invoice_id = ${inv.id}
      ORDER BY m.name, p.paid_at`);
    return rows.rows.map((r) => ({
      memberName: r.member_name ?? r.rider_name ?? '—',
      reference: r.reference,
      planNameAr: r.plan_ar,
      planNameEn: r.plan_en,
      periodStart: r.period_start ?? riyadhToday(new Date(r.paid_at)),
      amountHalalas: Number(r.amount),
    }));
  }

  present(inv: OrganizationInvoice, nameAr: string, nameEn: string): OrgInvoiceView {
    return {
      id: inv.id,
      organizationId: inv.organizationId,
      organizationNameAr: nameAr,
      organizationNameEn: nameEn,
      month: inv.month,
      number: inv.number,
      lines: inv.lines,
      grossHalalas: inv.grossHalalas,
      creditHalalas: inv.creditHalalas,
      totalHalalas: inv.totalHalalas,
      vatHalalas: inv.vatHalalas,
      status: inv.status,
      issuedAt: inv.issuedAt.toISOString(),
      dueDate: inv.dueDate,
      overdue: inv.status === 'issued' && inv.dueDate < riyadhToday(),
      paidAt: inv.paidAt?.toISOString() ?? null,
      reference: inv.reference,
    };
  }

  /** A printable bilingual tax invoice with one line per member period. */
  async html(inv: OrganizationInvoice): Promise<string> {
    const items = await this.items(inv);
    const credits = await this.credits(inv);
    const sar = (h: number) => (h / 100).toFixed(2);
    const esc = (s: string | null) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
    const qr = inv.qrTlv ? await QRCode.toString(inv.qrTlv, { type: 'svg', margin: 0, width: 140 }) : '';
    const title = inv.sellerVatNumber ? 'فاتورة ضريبية · Tax Invoice' : 'فاتورة · Invoice';
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium' }).format(inv.issuedAt);
    const rows = items
      .map((i) => `<tr><td>${esc(i.memberName)}${i.reference ? ` <span class="muted">${esc(i.reference)}</span>` : ''}</td><td>${esc(i.planNameAr)}</td><td class="n">${esc(i.periodStart)}</td><td class="n">${sar(i.amountHalalas)}</td></tr>`)
      .join('');
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(inv.number)}</title>
<style>body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#18263a;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:18px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:7px 4px;border-bottom:1px solid #d9e0e4;text-align:right;font-size:14px}
th{color:#4a5a6e;font-weight:600}.n{direction:ltr;text-align:left;font-variant-numeric:tabular-nums}.muted{color:#4a5a6e;font-size:13px}
.parties{display:flex;gap:24px;flex-wrap:wrap}.parties div{flex:1;min-width:220px}.total td{font-weight:700;border-bottom:0}
@media print{body{margin:0}}</style></head>
<body><h1>${title}</h1><div class="muted">${esc(inv.number)} · ${date} · الاستحقاق · Due ${esc(inv.dueDate)}</div>
<div class="parties"><div><table>
<tr><td>البائع · Seller</td><td>${esc(inv.sellerName)}</td></tr>
${inv.sellerVatNumber ? `<tr><td>الرقم الضريبي · VAT No.</td><td class="n">${esc(inv.sellerVatNumber)}</td></tr>` : ''}
</table></div><div><table>
<tr><td>المشتري · Buyer</td><td>${esc(inv.buyerName)}</td></tr>
${inv.buyerVatNumber ? `<tr><td>الرقم الضريبي · VAT No.</td><td class="n">${esc(inv.buyerVatNumber)}</td></tr>` : ''}
${inv.buyerCrNumber ? `<tr><td>السجل التجاري · CR</td><td class="n">${esc(inv.buyerCrNumber)}</td></tr>` : ''}
</table></div></div>
<div class="muted">خدمة نقل مجدولة لشهر ${esc(inv.month)} · Scheduled transport, ${esc(inv.month)}</div>
<table><thead><tr><th>العضو · Member</th><th>الباقة · Plan</th><th class="n">بداية الفترة · From</th><th class="n">SAR</th></tr></thead><tbody>${rows}</tbody></table>
${
  credits.length
    ? `<div class="muted">خصم مستحق للجهة · Credits</div><table><tbody>${credits
        .map((c) => `<tr><td>${esc(c.noteAr)} <span class="muted">${esc(c.createdAt.slice(0, 10))}</span></td><td class="n">−${sar(c.amountHalalas)}</td></tr>`)
        .join('')}</tbody></table>`
    : ''
}
<table>${inv.creditHalalas ? `<tr><td>قيمة الاشتراكات · Subscriptions</td><td class="n">${sar(inv.grossHalalas)} SAR</td></tr><tr><td>الخصم · Credits</td><td class="n">−${sar(inv.creditHalalas)} SAR</td></tr>` : ''}<tr><td>المبلغ قبل الضريبة · Subtotal</td><td class="n">${sar(inv.totalHalalas - inv.vatHalalas)} SAR</td></tr>
<tr><td>ضريبة القيمة المضافة · VAT</td><td class="n">${sar(inv.vatHalalas)} SAR</td></tr>
<tr class="total"><td>الإجمالي · Total</td><td class="n">${sar(inv.totalHalalas)} SAR</td></tr></table>
${qr ? `<div>${qr}</div>` : ''}</body></html>`;
  }
}

function presentCredit(c: typeof organizationCredits.$inferSelect): OrgCreditView {
  return { id: c.id, kind: c.kind, amountHalalas: c.amountHalalas, noteAr: c.noteAr, noteEn: c.noteEn, createdAt: c.createdAt.toISOString() };
}
