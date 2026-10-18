import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { assertPartnerAccess } from '../common/tenant';
import { addDays, monthlyPeriodEnd, riyadhToday } from '../common/saudi';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  invoices,
  partners,
  PaymentMethod,
  paymentMethods,
  PaymentRow,
  payments,
  plans,
  Subscription,
  subscriptions,
  users,
} from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { CheckoutResult, PAYMENT_GATEWAY, PaymentGateway, SavedCard } from './gateway';
import { InvoicesService } from './invoices.service';
import { TripGenerator } from '../trips/trip.generator';
import { PromosService } from '../services/promos.service';

export interface PaymentView {
  id: string;
  subscriptionId: string;
  purpose: 'start' | 'renewal';
  status: 'initiated' | 'paid' | 'failed';
  amountHalalas: number;
  checkoutUrl: string | null;
  failureReason: string | null;
  invoiceId: string | null;
  paidAt: string | null;
  createdAt: string;
}

/**
 * Turns subscriptions into payments and payments into active service.
 * Every status change is confirmed with the provider server-to-server (sync), whether it was
 * triggered by the rider returning from the payment page, a webhook, or the renewal job.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
    private readonly tripGenerator: TripGenerator,
    private readonly promos: PromosService,
    private readonly audit: AuditService,
  ) {}

  get manual(): boolean {
    return this.gateway.name === 'manual';
  }

  get supportsSavedCards(): boolean {
    return this.gateway.supportsSavedCards;
  }

  /** Opens a hosted payment page for the subscription (first payment, or a renewal link). */
  async checkout(
    sub: Subscription,
    purpose: 'start' | 'renewal',
    opts: { periodStart?: string; idempotencyKey?: string; saveCard?: boolean } = {},
  ): Promise<PaymentRow> {
    if (opts.idempotencyKey) {
      const existing = await this.db.query.payments.findFirst({ where: eq(payments.idempotencyKey, opts.idempotencyKey) });
      if (existing) return existing;
    }
    if (this.manual) {
      // Nothing to open: the rider pays the team. Keep one waiting payment per period.
      const waiting = await this.db.query.payments.findFirst({
        where: and(eq(payments.subscriptionId, sub.id), eq(payments.status, 'initiated'), eq(payments.purpose, purpose)),
      });
      if (waiting) return waiting;
    }
    const payment = await this.createRow(sub, purpose, opts.periodStart ?? null, opts.idempotencyKey ?? null);
    const rider = await this.db.query.users.findFirst({ where: eq(users.id, sub.riderId) });
    const card = await this.defaultCard(sub.riderId);
    let result: CheckoutResult;
    try {
      result = await this.gateway.createCheckout({
        paymentId: payment.id,
        amountHalalas: payment.amountHalalas,
        description: await this.description(sub),
        customer: { name: rider?.name ?? null, phone: rider?.phone ?? '', providerCustomerId: card?.providerCustomerId },
        saveCard: opts.saveCard ?? this.gateway.supportsSavedCards,
        returnUrl: this.returnUrl(payment.id),
        webhookUrl: this.webhookUrl(),
        split: await this.split(payment),
      });
    } catch (err) {
      await this.fail(payment, 'provider_error');
      this.logger.error(`Checkout failed for payment ${payment.id}: ${(err as Error).message}`);
      throw new AppError('PAYMENT_PROVIDER_ERROR');
    }
    const [updated] = await this.db
      .update(payments)
      .set({ providerPaymentId: result.providerPaymentId, checkoutUrl: result.checkoutUrl })
      .where(eq(payments.id, payment.id))
      .returning();
    if (result.status !== 'pending') return this.sync(updated.id);
    return updated;
  }

  /** Charges the saved card for a renewal. Returns the payment, paid or failed. */
  async chargeRenewal(sub: Subscription, card: PaymentMethod, periodStart: string, idempotencyKey: string): Promise<PaymentRow> {
    const existing = await this.db.query.payments.findFirst({ where: eq(payments.idempotencyKey, idempotencyKey) });
    if (existing) return existing;
    const payment = await this.createRow(sub, 'renewal', periodStart, idempotencyKey);
    const saved: SavedCard = {
      cardId: card.providerCardId,
      customerId: card.providerCustomerId,
      agreementId: card.providerAgreementId,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
    };
    try {
      const result = await this.gateway.chargeSavedCard({
        paymentId: payment.id,
        amountHalalas: payment.amountHalalas,
        description: await this.description(sub),
        card: saved,
        returnUrl: this.returnUrl(payment.id),
        webhookUrl: this.webhookUrl(),
        split: await this.split(payment),
      });
      await this.db
        .update(payments)
        .set({ providerPaymentId: result.providerPaymentId, checkoutUrl: result.checkoutUrl })
        .where(eq(payments.id, payment.id));
      return this.sync(payment.id);
    } catch (err) {
      this.logger.warn(`Renewal charge failed for subscription ${sub.id}: ${(err as Error).message}`);
      return this.fail(payment, 'charge_failed');
    }
  }

  /** Confirms a payment with the provider and applies the result. Safe to call any number of times. */
  async sync(paymentId: string): Promise<PaymentRow> {
    const payment = await this.db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
    if (!payment) throw new AppError('PAYMENT_NOT_FOUND');
    if (payment.status !== 'initiated' || !payment.providerPaymentId) return payment;

    const result = await this.gateway.retrieve(payment.providerPaymentId);
    if (result.status === 'pending') return payment;
    if (result.status === 'failed') return this.fail(payment, result.failureReason ?? 'declined');

    const [paid] = await this.db
      .update(payments)
      .set({ status: 'paid', paidAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'initiated')))
      .returning();
    if (!paid) return (await this.db.query.payments.findFirst({ where: eq(payments.id, paymentId) })) as PaymentRow;

    return this.afterPaid(paid, result.savedCard);
  }

  /**
   * An admin confirms money received outside the gateway (bank transfer or cash). Pays what is due:
   * the waiting payment, the first payment, or the next period of a running subscription.
   */
  async recordManual(
    actor: AuthUser,
    subscriptionId: string,
    input: { method: 'cash' | 'bank_transfer'; reference?: string | null },
    ip: string | null = null,
  ): Promise<PaymentView> {
    const sub = await this.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, subscriptionId) });
    if (!sub) throw new AppError('SUBSCRIPTION_NOT_FOUND');
    assertPartnerAccess(actor, sub.partnerId);

    let payment = await this.db.query.payments.findFirst({
      where: and(eq(payments.subscriptionId, sub.id), eq(payments.status, 'initiated')),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });
    if (payment && payment.provider !== 'manual') {
      // A gateway page is still open: close it so the rider cannot pay twice.
      await this.fail(payment, 'replaced_by_manual');
      const replaced = payment;
      payment = await this.createRow(sub, replaced.purpose, replaced.periodStart, null, 'manual');
    }
    if (!payment) {
      if (sub.status === 'pending_payment') {
        payment = await this.createRow(sub, 'start', null, null, 'manual');
      } else if ((sub.status === 'active' || sub.status === 'past_due') && sub.currentPeriodEnd) {
        const periodStart = addDays(sub.currentPeriodEnd, 1);
        const key = `manual:${sub.id}:${periodStart}`;
        const done = await this.db.query.payments.findFirst({ where: eq(payments.idempotencyKey, key) });
        if (done) throw new AppError('PAYMENT_NOTHING_DUE');
        payment = await this.createRow(sub, 'renewal', periodStart, key, 'manual');
      } else {
        throw new AppError('PAYMENT_NOTHING_DUE');
      }
    }

    const [paid] = await this.db
      .update(payments)
      .set({
        status: 'paid',
        paidAt: new Date(),
        method: input.method,
        reference: input.reference?.trim() || null,
        recordedBy: actor.id,
        providerPaymentId: payment.providerPaymentId ?? `manual_${payment.id}`,
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'initiated')))
      .returning();
    if (!paid) throw new AppError('PAYMENT_NOTHING_DUE');
    await this.audit.record({
      actorId: actor.id,
      partnerId: sub.partnerId,
      action: 'payment.record_manual',
      entity: 'payment',
      entityId: paid.id,
      after: { method: input.method, reference: paid.reference, amountHalalas: paid.amountHalalas },
      ip,
    });
    await this.afterPaid(paid, null);
    const invoice = await this.db.query.invoices.findFirst({ columns: { id: true }, where: eq(invoices.paymentId, paid.id) });
    return this.presentPayment(paid, invoice?.id ?? null);
  }

  /** Everything that follows a confirmed payment: the period, trips, invoice and the rider's notice. */
  private async afterPaid(paid: PaymentRow, savedCard: SavedCard | null): Promise<PaymentRow> {
    const sub = (await this.db.query.subscriptions.findFirst({ where: eq(subscriptions.id, paid.subscriptionId) })) as Subscription;
    const cardId = savedCard ? await this.saveCard(paid.riderId, savedCard) : null;
    await this.applyPaidPeriod(sub, paid, cardId);
    if (paid.discountHalalas > 0 && sub.promoCodeId) await this.promos.markUsed(sub.promoCodeId);
    // Trips for the paid days that fall within the next two days, without waiting for the nightly run.
    await this.tripGenerator.generate({ subscriptionId: sub.id });
    await this.invoices.issue(paid, await this.description(sub));
    await this.notifications.notify([paid.riderId], {
      kind: 'payment_paid',
      titleAr: paid.purpose === 'start' ? 'تم تفعيل اشتراكك' : 'تم تجديد اشتراكك',
      titleEn: paid.purpose === 'start' ? 'Your subscription is active' : 'Your subscription is renewed',
      bodyAr: `تم استلام ${(paid.amountHalalas / 100).toFixed(2)} ريال. الفاتورة متاحة في التطبيق.`,
      bodyEn: `We received SAR ${(paid.amountHalalas / 100).toFixed(2)}. Your invoice is in the app.`,
      data: { paymentId: paid.id, subscriptionId: paid.subscriptionId },
    });
    return paid;
  }

  async syncByProviderId(providerPaymentId: string): Promise<void> {
    const payment = await this.db.query.payments.findFirst({
      where: and(eq(payments.provider, this.gateway.name), eq(payments.providerPaymentId, providerPaymentId)),
    });
    if (payment) await this.sync(payment.id);
  }

  webhookPaymentId(body: unknown): string | null {
    return this.gateway.webhookPaymentId(body);
  }

  async defaultCard(riderId: string): Promise<PaymentMethod | undefined> {
    const cards = await this.db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.riderId, riderId), isNull(paymentMethods.deletedAt), eq(paymentMethods.provider, this.gateway.name)));
    return cards.find((c) => c.isDefault) ?? cards[0];
  }

  presentPayment(p: PaymentRow, invoiceId: string | null = null): PaymentView {
    return {
      id: p.id,
      subscriptionId: p.subscriptionId,
      purpose: p.purpose,
      status: p.status,
      amountHalalas: p.amountHalalas,
      checkoutUrl: p.status === 'initiated' ? p.checkoutUrl : null,
      failureReason: p.failureReason,
      invoiceId,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------ internals

  private async applyPaidPeriod(sub: Subscription, payment: PaymentRow, cardId: string | null): Promise<void> {
    const start = payment.periodStart ?? addDays(riyadhToday(), 1);
    const end = monthlyPeriodEnd(start);
    // A late payment for a period already covered must not shorten the subscription.
    if (sub.currentPeriodEnd && sub.currentPeriodEnd >= end) return;
    await this.db
      .update(subscriptions)
      .set({
        status: 'active',
        currentPeriodStart: start,
        currentPeriodEnd: end,
        renewalAttempts: 0,
        ...(cardId && !sub.paymentMethodId ? { paymentMethodId: cardId } : {}),
      })
      .where(eq(subscriptions.id, sub.id));
  }

  private async saveCard(riderId: string, card: SavedCard): Promise<string> {
    const existing = await this.db.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.provider, this.gateway.name), eq(paymentMethods.providerCardId, card.cardId)),
    });
    if (existing) {
      if (existing.deletedAt) await this.db.update(paymentMethods).set({ deletedAt: null }).where(eq(paymentMethods.id, existing.id));
      return existing.id;
    }
    const hasDefault = Boolean(await this.defaultCard(riderId));
    const [row] = await this.db
      .insert(paymentMethods)
      .values({
        riderId,
        provider: this.gateway.name,
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
        providerCustomerId: card.customerId,
        providerCardId: card.cardId,
        providerAgreementId: card.agreementId,
        isDefault: !hasDefault,
      })
      .returning({ id: paymentMethods.id });
    return row.id;
  }

  private async createRow(
    sub: Subscription,
    purpose: 'start' | 'renewal',
    periodStart: string | null,
    idempotencyKey: string | null,
    provider: string = this.gateway.name,
  ): Promise<PaymentRow> {
    const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, sub.partnerId) });
    // A discount code applies to the first payment only.
    const discount = purpose === 'start' ? sub.discountHalalas : 0;
    const amount = sub.priceHalalas - discount;
    const fee = Math.round((amount * (partner?.commissionBps ?? 0)) / 10_000);
    const [row] = await this.db
      .insert(payments)
      .values({
        riderId: sub.riderId,
        partnerId: sub.partnerId,
        subscriptionId: sub.id,
        purpose,
        provider,
        amountHalalas: amount,
        discountHalalas: discount,
        platformFeeHalalas: fee,
        partnerShareHalalas: amount - fee,
        periodStart,
        idempotencyKey,
      })
      .returning();
    return row;
  }

  private async fail(payment: PaymentRow, reason: string): Promise<PaymentRow> {
    const [row] = await this.db
      .update(payments)
      .set({ status: 'failed', failureReason: reason.slice(0, 200) })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'initiated')))
      .returning();
    return row ?? payment;
  }

  /** The partner's share goes to their gateway sub-account when the provider supports splits. */
  private async split(payment: PaymentRow): Promise<{ accountId: string; amountHalalas: number } | null> {
    if (this.gateway.name !== 'tap') return null;
    const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, payment.partnerId) });
    return partner?.gatewayAccountId ? { accountId: partner.gatewayAccountId, amountHalalas: payment.partnerShareHalalas } : null;
  }

  private async description(sub: Subscription): Promise<string> {
    const plan = await this.db.query.plans.findFirst({ columns: { nameAr: true }, where: eq(plans.id, sub.planId) });
    return `اشتراك تنقل شهري: ${plan?.nameAr ?? ''}`.slice(0, 255);
  }

  private returnUrl(paymentId: string): string {
    return `${this.env.PUBLIC_API_URL}/v1/payments/${paymentId}/return`;
  }

  private webhookUrl(): string {
    return `${this.env.PUBLIC_API_URL}/v1/webhooks/payments/${this.gateway.name}`;
  }
}
