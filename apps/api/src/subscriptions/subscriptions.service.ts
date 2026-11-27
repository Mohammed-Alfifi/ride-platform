import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
  familyMembers,
  driverProfiles,
  vehicles,
  users,
  Gender,
} from '../database/schema';
import { LicensesService } from '../compliance/licenses.service';
import { MeetingPointsService } from '../meeting-points/meeting-points.module';
import { CancelPreviewView, WalletService } from '../wallet/wallet.module';
import { OrganizationsService, splitPrice } from '../organizations/organizations.service';
import { rulesFor } from '../compliance/rules';
import { ContractView, guardianContract } from '../compliance/contract';
import { TripGenerator } from '../trips/trip.generator';
import { discountFor, PromosService } from '../services/promos.service';
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
  CreateMemberDto,
  MemberView,
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
    private readonly promos: PromosService,
    private readonly licenses: LicensesService,
    private readonly meetingPoints: MeetingPointsService,
    private readonly wallet: WalletService,
    private readonly orgs: OrganizationsService,
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
    // A lapsed licence or a price outside the approved range takes the plan off sale.
    const gate = await this.licenses.sellable([plan.plan]);
    if (!gate.canSell(plan.plan.partnerId, plan.plan.serviceClass, plan.plan.priceHalalas)) throw new AppError('PLAN_UNAVAILABLE');
    await this.ownPlace(riderId, dto.pickupPlaceId);
    await this.ownPlace(riderId, dto.dropoffPlaceId);

    const geo = await this.db.execute<{ inside: boolean; meters: number }>(sql`
      SELECT ST_Contains(z.area, p.location) AS inside,
             ST_Distance(p.location::geography, d.location::geography) AS meters
      FROM zones z, places p, places d
      WHERE z.id = ${plan.plan.zoneId} AND p.id = ${dto.pickupPlaceId} AND d.id = ${dto.dropoffPlaceId}`);
    const { inside, meters } = geo.rows[0];
    const distanceKm = Math.max(1, Math.ceil((Number(meters) / 1000) * ROAD_FACTOR));
    // Meeting-point plans: the rider walks to the nearest point of the zone.
    const meetingPoint = plan.plan.pickupMode === 'meeting_point' ? await this.meetingPoints.nearest(plan.plan.zoneId, dto.pickupPlaceId) : null;
    const reason = !inside
      ? 'PLACE_OUTSIDE_ZONE'
      : distanceKm > plan.plan.maxDistanceKm
        ? 'PLAN_DISTANCE_EXCEEDED'
        : plan.plan.pickupMode === 'meeting_point' && !meetingPoint
          ? 'NO_MEETING_POINT_NEARBY'
          : null;
    // A member of a company or school with this partner: the organization pays its share first.
    const sponsor = await this.orgs.sponsorFor(riderId, plan.plan.partnerId, plan.plan.id);
    const split = splitPrice(plan.plan.priceHalalas, sponsor?.coverageBps ?? 0);
    const promo = dto.promoCode ? await this.promos.resolve(dto.promoCode, plan.plan.partnerId) : null;
    const discount = promo ? Math.min(discountFor(promo, plan.plan.priceHalalas), split.member) : 0;
    const wallet = await this.wallet.toUse(riderId, plan.plan.partnerId, split.member - discount);

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
      promoCode: promo?.code ?? null,
      discountHalalas: discount,
      walletHalalas: wallet,
      firstPaymentHalalas: split.member - discount - wallet,
      sponsor: this.orgs.sponsorView(sponsor, plan.plan.priceHalalas),
      meetingPoint: meetingPoint ? { ...meetingPoint.point, walkMeters: meetingPoint.walkMeters } : null,
      periodDays: plan.plan.periodDays,
      renewable: plan.plan.renewable,
    };
  }

  // ------------------------------------------------------------------ subscribe

  async subscribe(riderId: string, dto: CreateSubscriptionDto): Promise<SubscribeResult> {
    const quote = await this.quote(riderId, dto);
    if (quote.reason === 'PLACE_OUTSIDE_ZONE') throw new AppError('PLACE_OUTSIDE_ZONE');
    if (quote.reason === 'NO_MEETING_POINT_NEARBY') throw new AppError('NO_MEETING_POINT_NEARBY', { meters: this.env.MEETING_POINT_MAX_WALK_M });
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

    if (this.env.PILOT_MAX_ACTIVE_SUBSCRIPTIONS > 0) {
      const [row] = await this.db
        .select({ n: count() })
        .from(subscriptions)
        .where(inArray(subscriptions.status, ['active', 'past_due', 'paused']));
      if (Number(row?.n ?? 0) >= this.env.PILOT_MAX_ACTIVE_SUBSCRIPTIONS) throw new AppError('PILOT_FULL');
    }

    const plan = (await this.db.query.plans.findFirst({ where: eq(plans.id, dto.planId) }))!;
    if (dto.memberId) await this.ownMember(riderId, dto.memberId);
    if (plan.oncePerRider) await this.assertFirstTrial(riderId, plan.id);
    if (plan.periodDays && plan.periodDays < 7) {
      // A short period must contain at least one of the chosen days, or nothing would run.
      const first = addDays(riyadhToday(), 1);
      const hit = Array.from({ length: plan.periodDays }, (_, i) => new Date(`${addDays(first, i)}T00:00:00Z`).getUTCDay()).some((d) =>
        dto.days.includes(d),
      );
      if (!hit) throw new AppError('TRIAL_NO_SERVICE_DAY');
    }

    // The regulation asks for the rider's prior consent before a trip is shared with others.
    if (dto.sharedRideConsent !== true) throw new AppError('SHARED_RIDE_CONSENT_REQUIRED');
    const needsContract = rulesFor(plan.serviceClass, this.env).guardianContract;
    if (needsContract && dto.guardianContractVersion !== this.env.GUARDIAN_CONTRACT_VERSION) {
      throw new AppError('GUARDIAN_CONTRACT_REQUIRED');
    }
    const passengerGender = await this.passengerGender(riderId, dto.memberId, dto.passengerGender);
    if (plan.womenOnly) {
      if (!passengerGender) throw new AppError('GENDER_REQUIRED');
      if (passengerGender !== 'female') throw new AppError('WOMEN_ONLY_PLAN');
    }
    const now = new Date();
    const promo = quote.promoCode ? await this.promos.resolve(quote.promoCode, plan.partnerId) : null;
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
        // A one-period plan (a trial) ends by itself at the end of its period.
        autoRenew: plan.renewable && dto.saveCard !== false,
        cancelAtPeriodEnd: !plan.renewable,
        periodDays: plan.periodDays,
        meetingPointId: quote.meetingPoint?.id ?? null,
        organizationId: quote.sponsor?.organizationId ?? null,
        memberId: dto.memberId ?? null,
        promoCodeId: promo?.id ?? null,
        discountHalalas: quote.discountHalalas,
        passengerGender,
        womenOnly: plan.womenOnly,
        sharedRideConsentAt: now,
        contractVersion: needsContract ? this.env.GUARDIAN_CONTRACT_VERSION : null,
        contractAcceptedAt: needsContract ? now : null,
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
    const member = sub.memberId ? await this.db.query.familyMembers.findFirst({ where: eq(familyMembers.id, sub.memberId) }) : undefined;
    const driver = sub.driverId
      ? await this.db
          .select({ name: driverProfiles.fullName, letters: vehicles.plateLetters, numbers: vehicles.plateNumbers })
          .from(driverProfiles)
          .leftJoin(vehicles, eq(vehicles.driverId, driverProfiles.userId))
          .where(eq(driverProfiles.userId, sub.driverId))
          .then((r) => r[0])
      : undefined;
    return {
      id: sub.id,
      status: sub.status,
      member: member ? { id: member.id, name: member.name } : null,
      driver: driver ? { name: driver.name, plate: driver.numbers ? `${driver.numbers} ${driver.letters}` : null } : null,
      planId: plan.id,
      planNameAr: plan.nameAr,
      planNameEn: plan.nameEn,
      partnerNameAr: partner.nameAr,
      partnerNameEn: partner.nameEn,
      serviceClass: plan.serviceClass,
      womenOnly: sub.womenOnly,
      contractVersion: sub.contractVersion,
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
      amountDueHalalas: pending?.amountHalalas ?? null,
      sponsor: await this.orgs.name(sub.organizationId),
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

  /** What each way of cancelling gives, shown to the rider before they choose. */
  async cancelPreview(riderId: string, id: string): Promise<CancelPreviewView> {
    const sub = await this.own(riderId, id);
    const refund = this.wallet.refundFor(sub);
    return {
      lastServiceDay: sub.status === 'active' ? sub.currentPeriodEnd : null,
      remainingTrips: refund.remainingTrips,
      creditHalalas: refund.creditHalalas,
      canCancelNow: sub.status === 'active' && refund.remainingTrips > 0,
    };
  }

  /**
   * period_end (default): stop renewing; service runs to the end of the paid period.
   * now: stop today; the trips left in the paid period come back as wallet credit.
   */
  async cancel(riderId: string, id: string, mode: 'period_end' | 'now' = 'period_end'): Promise<SubscriptionView> {
    const sub = await this.own(riderId, id);
    if (mode === 'now' && sub.status === 'active') {
      const refund = this.wallet.refundFor(sub);
      const today = riyadhToday();
      await this.db
        .update(subscriptions)
        .set({ status: 'cancelled', autoRenew: false, cancelAtPeriodEnd: false, currentPeriodEnd: today })
        .where(eq(subscriptions.id, sub.id));
      await this.tripGenerator.cancelFuture(sub.id, { from: addDays(today, 1), reason: 'subscription cancelled' });
      await this.wallet.creditRefund(sub, refund.creditHalalas);
      // The organization paid its share of those trips: it gets that back on its next invoice.
      const orgPart = Math.round((sub.priceHalalas * sub.orgShareBps) / 10_000);
      await this.wallet.creditOrganization(
        sub,
        'cancellation',
        Math.min(orgPart, refund.remainingTrips * this.wallet.orgTripValue(sub)),
        `cancel:${sub.id}:${today}`,
        { ar: `إلغاء فوري: ${refund.remainingTrips} رحلة متبقية`, en: `Cancelled at once: ${refund.remainingTrips} trips left` },
      );
      return this.view(riderId, id);
    }
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

  // ------------------------------------------------------------------ family

  async members(riderId: string): Promise<MemberView[]> {
    const rows = await this.db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.ownerId, riderId), isNull(familyMembers.deletedAt)))
      .orderBy(familyMembers.createdAt);
    return rows.map((m) => ({ id: m.id, name: m.name, relation: m.relation, note: m.note, gender: m.gender }));
  }

  async addMember(riderId: string, dto: CreateMemberDto): Promise<MemberView> {
    const [m] = await this.db
      .insert(familyMembers)
      .values({ ownerId: riderId, name: dto.name.trim(), relation: dto.relation, note: dto.note?.trim() || null, gender: dto.gender ?? null })
      .returning();
    return { id: m.id, name: m.name, relation: m.relation, note: m.note, gender: m.gender };
  }

  async removeMember(riderId: string, id: string): Promise<void> {
    await this.ownMember(riderId, id);
    await this.db.update(familyMembers).set({ deletedAt: new Date() }).where(eq(familyMembers.id, id));
  }

  /** The contract a guardian reads and accepts before subscribing to an education plan. */
  async contract(planId: string): Promise<ContractView> {
    const plan = await this.db.query.plans.findFirst({ where: eq(plans.id, planId) });
    if (!plan || !plan.active) throw new AppError('PLAN_NOT_FOUND');
    const partner = (await this.db.query.partners.findFirst({ where: eq(partners.id, plan.partnerId) }))!;
    const licence = await this.licenses.find(plan.partnerId, plan.serviceClass);
    return guardianContract(this.env.GUARDIAN_CONTRACT_VERSION, plan, partner, licence);
  }

  /** A trial plan is for a first try only: once per rider and partner, whatever its status since. */
  private async assertFirstTrial(riderId: string, planId: string): Promise<void> {
    const [row] = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.rider_id = ${riderId} AND p.once_per_rider
        AND p.partner_id = (SELECT partner_id FROM plans WHERE id = ${planId})
        AND EXISTS (SELECT 1 FROM payments x WHERE x.subscription_id = s.id AND x.status = 'paid')`).then((r) => r.rows);
    if ((row?.n ?? 0) > 0) throw new AppError('TRIAL_ALREADY_USED');
  }

  /** Who rides, as a gender: what the rider just told us (saved), or what we already know. */
  private async passengerGender(riderId: string, memberId: string | undefined, given: Gender | undefined): Promise<Gender | null> {
    if (memberId) {
      const m = await this.db.query.familyMembers.findFirst({ where: eq(familyMembers.id, memberId) });
      if (given && given !== m?.gender) await this.db.update(familyMembers).set({ gender: given }).where(eq(familyMembers.id, memberId));
      return given ?? m?.gender ?? null;
    }
    const u = await this.db.query.users.findFirst({ columns: { gender: true }, where: eq(users.id, riderId) });
    if (given && given !== u?.gender) await this.db.update(users).set({ gender: given }).where(eq(users.id, riderId));
    return given ?? u?.gender ?? null;
  }

  private async ownMember(riderId: string, id: string): Promise<void> {
    const m = await this.db.query.familyMembers.findFirst({
      where: and(eq(familyMembers.id, id), eq(familyMembers.ownerId, riderId), isNull(familyMembers.deletedAt)),
    });
    if (!m) throw new AppError('MEMBER_NOT_FOUND');
  }

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
