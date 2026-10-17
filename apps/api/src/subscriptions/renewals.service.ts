import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { addDays, riyadhToday } from '../common/saudi';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { paymentMethods, payments, Subscription, subscriptions } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { BillingService } from '../payments/billing.service';

export interface RenewalResult {
  renewed: number;
  failed: number;
  linksSent: number;
  expired: number;
  cancelled: number;
}

/**
 * Daily renewal run (05:00 Riyadh, before the compliance scan and long before the first trips).
 *
 * On the last day of a period the saved card is charged for the next one. If that fails, or
 * there is no saved card, the subscription becomes past due: it keeps running for the grace
 * days while the rider gets a payment link, the card is retried once a day, and after the
 * grace days it expires. Subscriptions set to cancel end on their last paid day.
 */
@Injectable()
export class RenewalsService {
  private readonly logger = new Logger(RenewalsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<RenewalResult> {
    const today = riyadhToday(now);
    const result: RenewalResult = { renewed: 0, failed: 0, linksSent: 0, expired: 0, cancelled: 0 };

    // Cancelled at period end, and the period is over.
    const ending = await this.db
      .update(subscriptions)
      .set({ status: 'cancelled' })
      .where(
        and(
          inArray(subscriptions.status, ['active', 'past_due']),
          eq(subscriptions.cancelAtPeriodEnd, true),
          lte(subscriptions.currentPeriodEnd, addDays(today, -1)),
        ),
      )
      .returning({ id: subscriptions.id });
    result.cancelled = ending.length;

    const due = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.status, ['active', 'past_due']),
          eq(subscriptions.cancelAtPeriodEnd, false),
          lte(subscriptions.currentPeriodEnd, today),
        ),
      );

    for (const sub of due) {
      const periodEnd = sub.currentPeriodEnd as string;
      const nextStart = addDays(periodEnd, 1);

      if (sub.status === 'past_due' && today > addDays(periodEnd, this.env.RENEWAL_GRACE_DAYS)) {
        await this.db.update(subscriptions).set({ status: 'expired' }).where(eq(subscriptions.id, sub.id));
        await this.notifyExpired(sub);
        result.expired++;
        continue;
      }
      if (!sub.autoRenew && sub.status === 'active' && today <= periodEnd) {
        // No automatic renewal: offer a link on the last day instead of charging.
        if (await this.sendPayLink(sub, nextStart, today)) result.linksSent++;
        continue;
      }

      const card = sub.paymentMethodId
        ? await this.db.query.paymentMethods.findFirst({
            where: and(eq(paymentMethods.id, sub.paymentMethodId), isNull(paymentMethods.deletedAt)),
          })
        : undefined;
      if (card && sub.autoRenew && this.billing.supportsSavedCards) {
        const payment = await this.billing.chargeRenewal(sub, card, nextStart, `renew:${sub.id}:${nextStart}:${today}`);
        if (payment.status === 'paid') {
          result.renewed++;
          continue;
        }
        result.failed++;
      }

      // Past due: keep service during the grace days and ask the rider to pay.
      if (sub.status !== 'past_due') {
        await this.db
          .update(subscriptions)
          .set({ status: 'past_due', renewalAttempts: sub.renewalAttempts + 1 })
          .where(eq(subscriptions.id, sub.id));
      } else {
        await this.db
          .update(subscriptions)
          .set({ renewalAttempts: sub.renewalAttempts + 1 })
          .where(eq(subscriptions.id, sub.id));
      }
      if (await this.sendPayLink(sub, nextStart, today)) result.linksSent++;
    }

    this.logger.log(`Renewals ${today}: ${JSON.stringify(result)}`);
    return result;
  }

  /** One payment link per period; the notification is repeated at most once a day. */
  private async sendPayLink(sub: Subscription, periodStart: string, today: string): Promise<boolean> {
    const alreadyPaid = await this.db.query.payments.findFirst({
      columns: { id: true },
      where: and(eq(payments.subscriptionId, sub.id), eq(payments.periodStart, periodStart), eq(payments.status, 'paid')),
    });
    if (alreadyPaid) return false;
    let payment;
    try {
      payment = await this.billing.checkout(sub, 'renewal', {
        periodStart,
        idempotencyKey: `renewlink:${sub.id}:${periodStart}`,
        saveCard: true,
      });
    } catch (err) {
      this.logger.error(`Could not create a renewal link for ${sub.id}: ${(err as Error).message}`);
      return false;
    }
    const amount = (sub.priceHalalas / 100).toFixed(2);
    const created = await this.notifications.notify([sub.riderId], {
      kind: 'renewal_due',
      titleAr: 'جدّد اشتراكك',
      titleEn: 'Renew your subscription',
      bodyAr: `لم نتمكن من خصم ${amount} ريال تلقائيا. ادفع من التطبيق ليستمر سائقك دون انقطاع.`,
      bodyEn: `We could not charge SAR ${amount} automatically. Pay in the app to keep your rides going.`,
      data: { subscriptionId: sub.id, paymentId: payment.id, payUrl: payment.checkoutUrl },
      dedupeKey: `renewal:${sub.id}:${periodStart}:${today}`,
    });
    return created > 0;
  }

  private async notifyExpired(sub: Subscription): Promise<void> {
    await this.notifications.notify([sub.riderId], {
      kind: 'subscription_expired',
      titleAr: 'انتهى اشتراكك',
      titleEn: 'Your subscription has ended',
      bodyAr: 'لم يتم التجديد. يمكنك الاشتراك من جديد في أي وقت من التطبيق.',
      bodyEn: 'It was not renewed. You can subscribe again any time in the app.',
      data: { subscriptionId: sub.id },
      dedupeKey: `expired:${sub.id}`,
    });
  }
}
