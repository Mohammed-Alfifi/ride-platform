import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { addDays, daysBetween, riyadhToday } from '../common/saudi';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  invoices,
  partners,
  paymentMethods,
  payments,
  places,
  plans,
  Subscription,
  subscriptions,
  zones,
} from '../database/schema';
import { TripGenerator } from '../trips/trip.generator';
import { BillingService, PaymentView } from '../payments/billing.service';
import { InvoicesService, InvoiceView } from '../payments/invoices.service';
import { vatIncluded } from '../payments/zatca';
import {
  CreatePlaceDto,
  CreateSubscriptionDto,
  PauseDto,
  PaymentMethodView,
  PlaceView,
  QuoteDto,
  QuoteView,
  SubscribeResult,
  SubscriptionView,
} from './subscriptions.dto';

/** Road distance is estimated from the straight line until routing arrives in phase 4. */
const ROAD_FACTOR = 1.3;
const MAX_PAUSE_DAYS = 30;

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly billing: BillingService,
    private readonly invoiceService: InvoicesService,
    private readonly tripGenerator: TripGenerator,
  ) {}

  // ------------------------------------------------------------------ places

  async listPlaces(riderId: string): Promise<PlaceView[]> {
    const rows = await this.placeRows(and(eq(places.riderId, riderId), isNull(places.deletedAt)));
    return rows;
  }

  async addPlace(riderId: string, dto: CreatePlaceDto): Promise<PlaceView> {
    const [row] = await this.db
      .insert(places)
      .values({
        riderId,
        label: dto.label,
        name: dto.name.trim(),
        address: dto.address?.trim() ?? null,
        location: sql`ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)` as unknown as string,
      })
      .returning({ id: places.id });
    return (await this.placeRows(eq(places.id, row.id)))[0];
  }

  async removePlace(riderId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(places)
      .set({ deletedAt: new Date() })
      .where(and(eq(places.id, id), eq(places.riderId, riderId), isNull(places.deletedAt)))
      .returning({ id: places.id });
    if (!row) throw new AppError('PLACE_NOT_FOUND');
  }

  // ------------------------------------------------------------------ quote

  async quote(riderId: string, dto: QuoteDto): Promise<QuoteView> {
    const plan = await this.db
      .select({ plan: plans, zoneActive: zones.active, partnerStatus: partners.status })
      .from(plans)
      .innerJoin(zones, eq(zones.id, plans.zoneId))
      .innerJoin(partners, eq(partners.id, plans.partnerId))
      .where(eq(plans.id, dto.planId))
      .then((r) => r[0]);
    if (!plan) throw new AppError('PLAN_NOT_FOUND');
    if (!plan.plan.active || !plan.zoneActive || plan.partnerStatus !== 'active') throw new AppError('PLAN_UNAVAILABLE');
    await this.ownPlace(riderId, dto.pickupPlaceId);
    await this.ownPlace(riderId, dto.dropoffPlaceId);

    const geo = await this.db.execute<{ inside: boolean; meters: number }>(sql`
      SELECT ST_Contains(z.area, p.location) AS inside,
             ST_Distance(p.location::geography, d.location::geography) AS meters
      FROM zones z, places p, places d
      WHERE z.id = ${plan.plan.zoneId} AND p.id = ${dto.pickupPlaceId} AND d.id = ${dto.dropoffPlaceId}`);
    const { inside, meters } = geo.rows[0];
    const distanceKm = Math.max(1, Math.ceil((Number(meters) / 1000) * ROAD_FACTOR));
    const reason = !inside ? 'PLACE_OUTSIDE_ZONE' : distanceKm > plan.plan.maxDistanceKm ? 'PLAN_DISTANCE_EXCEEDED' : null;

    return {
      planId: plan.plan.id,
      eligible: reason === null,
      reason,
      distanceKm,
      maxDistanceKm: plan.plan.maxDistanceKm,
      priceHalalas: plan.plan.priceHalalas,
      vatHalalas: vatIncluded(plan.plan.priceHalalas, this.env.VAT_RATE_BPS),
      daysPerWeek: plan.plan.daysPerWeek,
      tripType: plan.plan.tripType,
    };
  }

  // ------------------------------------------------------------------ subscribe

  async subscribe(riderId: string, dto: CreateSubscriptionDto): Promise<SubscribeResult> {
    const quote = await this.quote(riderId, dto);
    if (quote.reason === 'PLACE_OUTSIDE_ZONE') throw new AppError('PLACE_OUTSIDE_ZONE');
    if (quote.reason === 'PLAN_DISTANCE_EXCEEDED') {
      throw new AppError('PLAN_DISTANCE_EXCEEDED', { distanceKm: quote.distanceKm, maxKm: quote.maxDistanceKm });
    }
    if (dto.days.length !== quote.daysPerWeek) {
      throw new AppError('SUBSCRIPTION_SCHEDULE_INVALID', {}, [`choose exactly ${quote.daysPerWeek} days`]);
    }
    if (quote.tripType === 'round_trip') {
      if (!dto.returnTime || dto.returnTime <= dto.outboundTime) {
        throw new AppError('SUBSCRIPTION_SCHEDULE_INVALID', {}, ['returnTime must be after outboundTime']);
      }
    }
    if (dto.outboundTime < '05:00' || dto.outboundTime > '22:00') {
      throw new AppError('SUBSCRIPTION_SCHEDULE_INVALID', {}, ['service runs between 05:00 and 22:00']);
    }

    const plan = (await this.db.query.plans.findFirst({ where: eq(plans.id, dto.planId) }))!;
    const [sub] = await this.db
      .insert(subscriptions)
      .values({
        riderId,
        partnerId: plan.partnerId,
        planId: plan.id,
        pickupPlaceId: dto.pickupPlaceId,
        dropoffPlaceId: dto.dropoffPlaceId,
        days: [...dto.days].sort(),
        outboundTime: dto.outboundTime,
        returnTime: quote.tripType === 'round_trip' ? (dto.returnTime as string) : null,
        distanceKm: quote.distanceKm,
        priceHalalas: plan.priceHalalas,
        autoRenew: dto.saveCard !== false,
      })
      .returning();

    const payment = await this.billing.checkout(sub, 'start', { saveCard: dto.saveCard !== false });
    return {
      subscription: await this.view(riderId, sub.id),
      payment: { id: payment.id, status: payment.status, checkoutUrl: payment.status === 'initiated' ? payment.checkoutUrl : null },
    };
  }

  /** A fresh payment page for a subscription waiting for payment (first payment or a failed renewal). */
  async payNow(riderId: string, id: string): Promise<PaymentView> {
    const sub = await this.own(riderId, id);
    if (sub.status === 'pending_payment') {
      return this.billing.presentPayment(await this.billing.checkout(sub, 'start'));
    }
    if (sub.status === 'past_due' && sub.currentPeriodEnd) {
      const periodStart = addDays(sub.currentPeriodEnd, 1);
      const payment = await this.billing.checkout(sub, 'renewal', { periodStart });
      return this.billing.presentPayment(payment);
    }
    throw new AppError('SUBSCRIPTION_INVALID_STATE');
  }

  async list(riderId: string): Promise<SubscriptionView[]> {
    const rows = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.riderId, riderId))
      .orderBy(desc(subscriptions.createdAt));
    return Promise.all(rows.map((r) => this.view(riderId, r.id)));
  }

  async view(riderId: string, id: string): Promise<SubscriptionView> {
    const sub = await this.own(riderId, id);
    const plan = (await this.db.query.plans.findFirst({ where: eq(plans.id, sub.planId) }))!;
    const partner = (await this.db.query.partners.findFirst({ where: eq(partners.id, sub.partnerId) }))!;
    const placeRows = await this.placeRows(inArray(places.id, [sub.pickupPlaceId, sub.dropoffPlaceId]));
    const card = sub.paymentMethodId
      ? await this.db.query.paymentMethods.findFirst({
          where: and(eq(paymentMethods.id, sub.paymentMethodId), isNull(paymentMethods.deletedAt)),
        })
      : undefined;
    const pending =
      sub.status === 'pending_payment' || sub.status === 'past_due'
        ? await this.db.query.payments.findFirst({
            where: and(eq(payments.subscriptionId, sub.id), eq(payments.status, 'initiated')),
            orderBy: desc(payments.createdAt),
          })
        : undefined;
    return {
      id: sub.id,
      status: sub.status,
      planId: plan.id,
      planNameAr: plan.nameAr,
      planNameEn: plan.nameEn,
      partnerNameAr: partner.nameAr,
      partnerNameEn: partner.nameEn,
      pickup: placeRows.find((p) => p.id === sub.pickupPlaceId) as PlaceView,
      dropoff: placeRows.find((p) => p.id === sub.dropoffPlaceId) as PlaceView,
      days: sub.days,
      outboundTime: sub.outboundTime,
      returnTime: sub.returnTime,
      distanceKm: sub.distanceKm,
      priceHalalas: sub.priceHalalas,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      autoRenew: sub.autoRenew,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pausedFrom: sub.pausedFrom,
      pausedUntil: sub.pausedUntil,
      card: card ? { id: card.id, brand: card.brand, last4: card.last4 } : null,
      payUrl: pending?.checkoutUrl ?? null,
      pendingPaymentId: pending?.id ?? null,
      createdAt: sub.createdAt.toISOString(),
    };
  }

  /** Pause for a trip or holiday: the paid period is extended by the paused days. */
  async pause(riderId: string, id: string, dto: PauseDto): Promise<SubscriptionView> {
    const sub = await this.own(riderId, id);
    if (sub.status !== 'active' || !sub.currentPeriodStart || !sub.currentPeriodEnd) throw new AppError('SUBSCRIPTION_INVALID_STATE');
    const tomorrow = addDays(riyadhToday(), 1);
    const length = daysBetween(dto.from, dto.until) + 1;
    const alreadyPausedThisPeriod = sub.pausedUntil !== null && sub.pausedUntil >= sub.currentPeriodStart;
    if (dto.from < tomorrow || length < 1 || length > MAX_PAUSE_DAYS || dto.from > sub.currentPeriodEnd || alreadyPausedThisPeriod) {
      throw new AppError('PAUSE_INVALID');
    }
    await this.db
      .update(subscriptions)
      .set({ pausedFrom: dto.from, pausedUntil: dto.until, currentPeriodEnd: addDays(sub.currentPeriodEnd, length) })
      .where(eq(subscriptions.id, sub.id));
    await this.tripGenerator.cancelFuture(sub.id, { from: dto.from, until: dto.until, reason: 'paused' });
    return this.view(riderId, id);
  }

  /** Ends a pause early (or cancels one not started yet) and gives back the unused days. */
  async resume(riderId: string, id: string): Promise<SubscriptionView> {
    const sub = await this.own(riderId, id);
    const today = riyadhToday();
    if (!sub.pausedFrom || !sub.pausedUntil || sub.pausedUntil < today || !sub.currentPeriodEnd) {
      throw new AppError('SUBSCRIPTION_INVALID_STATE');
    }
    const firstUnused = sub.pausedFrom > today ? sub.pausedFrom : addDays(today, 1);
    const unused = Math.max(0, daysBetween(firstUnused, sub.pausedUntil) + 1);
    const started = sub.pausedFrom <= today;
    await this.db
      .update(subscriptions)
      .set({
        pausedFrom: started ? sub.pausedFrom : null,
        pausedUntil: started ? today : null,
        currentPeriodEnd: addDays(sub.currentPeriodEnd, -unused),
      })
      .where(eq(subscriptions.id, sub.id));
    await this.tripGenerator.restorePaused(sub.id);
    return this.view(riderId, id);
  }

  async cancel(riderId: string, id: string): Promise<SubscriptionView> {
    const sub = await this.own(riderId, id);
    if (sub.status === 'pending_payment') {
      await this.db.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, sub.id));
    } else if (sub.status === 'active' || sub.status === 'past_due') {
      await this.db.update(subscriptions).set({ cancelAtPeriodEnd: true, autoRenew: false }).where(eq(subscriptions.id, sub.id));
    } else {
      throw new AppError('SUBSCRIPTION_INVALID_STATE');
    }
    return this.view(riderId, id);
  }

  async keep(riderId: string, id: string): Promise<SubscriptionView> {
    const sub = await this.own(riderId, id);
    if (sub.status !== 'active' || !sub.cancelAtPeriodEnd) throw new AppError('SUBSCRIPTION_INVALID_STATE');
    await this.db.update(subscriptions).set({ cancelAtPeriodEnd: false, autoRenew: true }).where(eq(subscriptions.id, sub.id));
    return this.view(riderId, id);
  }

  // ------------------------------------------------------------------ payments, cards, invoices

  async payment(riderId: string, paymentId: string): Promise<PaymentView> {
    const row = await this.db.query.payments.findFirst({ where: and(eq(payments.id, paymentId), eq(payments.riderId, riderId)) });
    if (!row) throw new AppError('PAYMENT_NOT_FOUND');
    const synced = await this.billing.sync(row.id);
    const invoice = await this.db.query.invoices.findFirst({ columns: { id: true }, where: eq(invoices.paymentId, row.id) });
    return this.billing.presentPayment(synced, invoice?.id ?? null);
  }

  async cards(riderId: string): Promise<PaymentMethodView[]> {
    const rows = await this.db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.riderId, riderId), isNull(paymentMethods.deletedAt)))
      .orderBy(desc(paymentMethods.createdAt));
    return rows.map((c) => ({ id: c.id, brand: c.brand, last4: c.last4, expMonth: c.expMonth, expYear: c.expYear, isDefault: c.isDefault }));
  }

  /** Removing a card stops automatic renewal on the subscriptions that used it. */
  async removeCard(riderId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(paymentMethods)
      .set({ deletedAt: new Date(), isDefault: false })
      .where(and(eq(paymentMethods.id, id), eq(paymentMethods.riderId, riderId), isNull(paymentMethods.deletedAt)))
      .returning({ id: paymentMethods.id });
    if (!row) throw new AppError('PAYMENT_METHOD_NOT_FOUND');
    await this.db
      .update(subscriptions)
      .set({ paymentMethodId: null })
      .where(and(eq(subscriptions.riderId, riderId), eq(subscriptions.paymentMethodId, id)));
  }

  async invoices(riderId: string): Promise<InvoiceView[]> {
    const rows = await this.db.select().from(invoices).where(eq(invoices.riderId, riderId)).orderBy(desc(invoices.issuedAt));
    return rows.map((r) => this.invoiceService.present(r));
  }

  // ------------------------------------------------------------------ helpers

  private async own(riderId: string, id: string): Promise<Subscription> {
    const sub = await this.db.query.subscriptions.findFirst({ where: and(eq(subscriptions.id, id), eq(subscriptions.riderId, riderId)) });
    if (!sub) throw new AppError('SUBSCRIPTION_NOT_FOUND');
    return sub;
  }

  private async ownPlace(riderId: string, id: string): Promise<void> {
    const p = await this.db.query.places.findFirst({
      columns: { id: true },
      where: and(eq(places.id, id), eq(places.riderId, riderId), isNull(places.deletedAt)),
    });
    if (!p) throw new AppError('PLACE_NOT_FOUND');
  }

  private async placeRows(where: ReturnType<typeof and>): Promise<PlaceView[]> {
    const rows = await this.db
      .select({
        id: places.id,
        label: places.label,
        name: places.name,
        address: places.address,
        lat: sql<number>`ST_Y(${places.location})`,
        lng: sql<number>`ST_X(${places.location})`,
      })
      .from(places)
      .where(where)
      .orderBy(places.createdAt);
    return rows.map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
  }
}
