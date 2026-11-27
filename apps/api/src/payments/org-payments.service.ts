import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { OrganizationInvoice, organizationInvoices, OrganizationPayment, organizationPayments, partners, users } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgCheckoutView } from '../organizations/organizations.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrgInvoicesService } from '../organizations/org-invoices.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway';

/** A payment page opened less than this long ago is offered again instead of a new one. */
const REUSE_MS = 30 * 60_000;

/**
 * An organization paying its monthly invoice online. Same gateway and the same rule as riders'
 * payments: the result is always read back from the gateway, never taken from a redirect or a
 * webhook body. The invoice is marked paid once, whichever of the two arrives first.
 */
@Injectable()
export class OrgPaymentsService {
  private readonly logger = new Logger(OrgPaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly orgs: OrganizationsService,
    private readonly invoices: OrgInvoicesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async checkout(user: AuthUser, invoiceId: string): Promise<OrgCheckoutView> {
    const org = await this.orgs.orgOf(user);
    const inv = await this.invoices.getForOrg(org.id, invoiceId);
    if (inv.status !== 'issued') throw new AppError('ORG_INVOICE_PAID');
    if (this.gateway.name === 'manual') throw new AppError('ORG_ONLINE_PAYMENT_UNAVAILABLE');

    const recent = await this.db.query.organizationPayments.findFirst({
      where: and(
        eq(organizationPayments.orgInvoiceId, inv.id),
        eq(organizationPayments.status, 'initiated'),
        eq(organizationPayments.amountHalalas, inv.totalHalalas),
        gt(organizationPayments.createdAt, new Date(Date.now() - REUSE_MS)),
      ),
      orderBy: desc(organizationPayments.createdAt),
    });
    if (recent?.checkoutUrl) return { paymentId: recent.id, checkoutUrl: recent.checkoutUrl, amountHalalas: recent.amountHalalas };

    const [row] = await this.db
      .insert(organizationPayments)
      .values({ orgInvoiceId: inv.id, organizationId: org.id, partnerId: inv.partnerId, amountHalalas: inv.totalHalalas, provider: this.gateway.name, createdBy: user.id })
      .returning();
    const admin = await this.db.query.users.findFirst({ columns: { phone: true }, where: eq(users.id, user.id) });
    const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, inv.partnerId) });
    let result;
    try {
      result = await this.gateway.createCheckout({
        paymentId: row.id,
        amountHalalas: inv.totalHalalas,
        description: `فاتورة ${inv.number} - ${org.nameAr}`.slice(0, 255),
        customer: { name: org.legalName, phone: org.contactPhone ?? admin?.phone ?? '' },
        saveCard: false,
        returnUrl: `${this.env.PUBLIC_API_URL}/v1/org-payments/${row.id}/return`,
        webhookUrl: `${this.env.PUBLIC_API_URL}/v1/webhooks/payments/${this.gateway.name}`,
        split: this.gateway.name === 'tap' && partner?.gatewayAccountId ? { accountId: partner.gatewayAccountId, amountHalalas: inv.partnerShareHalalas } : null,
      });
    } catch (err) {
      await this.db.update(organizationPayments).set({ status: 'failed', failureReason: 'provider_error' }).where(eq(organizationPayments.id, row.id));
      this.logger.error(`Organization checkout failed for ${inv.number}: ${(err as Error).message}`);
      throw new AppError('PAYMENT_PROVIDER_ERROR');
    }
    const [updated] = await this.db
      .update(organizationPayments)
      .set({ providerPaymentId: result.providerPaymentId, checkoutUrl: result.checkoutUrl })
      .where(eq(organizationPayments.id, row.id))
      .returning();
    if (result.status !== 'pending') await this.sync(updated.id);
    return { paymentId: row.id, checkoutUrl: result.checkoutUrl ?? `${this.env.PUBLIC_API_URL}/v1/org-payments/${row.id}/return`, amountHalalas: row.amountHalalas };
  }

  /** Reads the payment back from the gateway and settles the invoice. Safe to call any number of times. */
  async sync(id: string): Promise<OrganizationPayment> {
    const payment = await this.db.query.organizationPayments.findFirst({ where: eq(organizationPayments.id, id) });
    if (!payment) throw new AppError('PAYMENT_NOT_FOUND');
    if (payment.status !== 'initiated' || !payment.providerPaymentId) return payment;
    const result = await this.gateway.retrieve(payment.providerPaymentId);
    if (result.status === 'pending') return payment;
    if (result.status === 'failed') {
      const [failed] = await this.db
        .update(organizationPayments)
        .set({ status: 'failed', failureReason: (result.failureReason ?? 'declined').slice(0, 200) })
        .where(and(eq(organizationPayments.id, id), eq(organizationPayments.status, 'initiated')))
        .returning();
      return failed ?? payment;
    }

    const settled = await this.db.transaction(async (tx) => {
      const [paid] = await tx
        .update(organizationPayments)
        .set({ status: 'paid', paidAt: new Date() })
        .where(and(eq(organizationPayments.id, id), eq(organizationPayments.status, 'initiated')))
        .returning();
      if (!paid) return null;
      const [inv] = await tx
        .update(organizationInvoices)
        .set({ status: 'paid', paidAt: paid.paidAt, method: 'online', reference: payment.providerPaymentId })
        .where(and(eq(organizationInvoices.id, payment.orgInvoiceId), eq(organizationInvoices.status, 'issued')))
        .returning();
      return { paid, inv: inv ?? null };
    });
    if (!settled) return (await this.db.query.organizationPayments.findFirst({ where: eq(organizationPayments.id, id) })) as OrganizationPayment;
    if (!settled.inv) {
      // Paid online after the team had already recorded a transfer: the money must go back.
      this.logger.warn(`Organization payment ${id} arrived for an invoice already paid; refund it from the gateway dashboard`);
    } else {
      await this.afterPaid(settled.inv, settled.paid);
    }
    return settled.paid;
  }

  /** For gateway webhooks: true when the provider id belongs to an organization payment. */
  async syncByProviderId(providerPaymentId: string): Promise<boolean> {
    const payment = await this.db.query.organizationPayments.findFirst({
      where: and(eq(organizationPayments.provider, this.gateway.name), eq(organizationPayments.providerPaymentId, providerPaymentId)),
    });
    if (!payment) return false;
    await this.sync(payment.id);
    return true;
  }

  private async afterPaid(inv: OrganizationInvoice, paid: OrganizationPayment): Promise<void> {
    await this.audit.record({
      actorId: paid.createdBy,
      partnerId: inv.partnerId,
      action: 'organization_invoice.pay_online',
      entity: 'organization_invoice',
      entityId: inv.id,
      after: { provider: paid.provider, providerPaymentId: paid.providerPaymentId, amount: paid.amountHalalas },
    });
    const people = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.organizationId, inv.organizationId)));
    const team = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.partnerId, inv.partnerId), eq(users.role, 'partner_admin')));
    const amount = (inv.totalHalalas / 100).toFixed(2);
    await this.notifications.notify(
      [...people, ...team].map((u) => u.id),
      {
        kind: 'organization_invoice_paid',
        titleAr: `سُددت الفاتورة ${inv.number}`,
        titleEn: `Invoice ${inv.number} is paid`,
        bodyAr: `استلمنا ${amount} ريال إلكترونيا. شكرا لكم.`,
        bodyEn: `SAR ${amount} received online. Thank you.`,
        data: { organizationInvoiceId: inv.id },
        dedupeKey: `org-invoice-paid:${inv.id}`,
      },
    );
  }
}
