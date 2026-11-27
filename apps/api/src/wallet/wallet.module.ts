import { Body, Controller, Get, Global, Inject, Injectable, Logger, Module, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, NotEquals } from 'class-validator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AppError } from '../common/errors';
import { addDays, riyadhToday } from '../common/saudi';
import { assertPartnerAccess } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { partners, payments, Subscription, subscriptions, users, walletEntries, WalletKind } from '../database/schema';

type Payment = typeof payments.$inferSelect;
import { NotificationsService } from '../notifications/notifications.service';

/** The gateway never charges less than this; wallet credit leaves at least this much to pay. */
const MIN_CHARGE_HALALAS = 100;

export class WalletEntryView {
  @ApiProperty() id!: string;
  @ApiProperty() partnerId!: string;
  @ApiProperty({ enum: ['compensation', 'refund', 'redeem', 'adjustment'] }) kind!: WalletKind;
  @ApiProperty({ description: 'Halalas: + credit, - used' }) amountHalalas!: number;
  @ApiProperty() noteAr!: string;
  @ApiProperty() noteEn!: string;
  @ApiProperty({ nullable: true, type: String }) tripId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class WalletBalanceView {
  @ApiProperty() partnerId!: string;
  @ApiProperty() partnerNameAr!: string;
  @ApiProperty() partnerNameEn!: string;
  @ApiProperty() balanceHalalas!: number;
}

export class WalletView {
  @ApiProperty({ type: [WalletBalanceView] }) balances!: WalletBalanceView[];
  @ApiProperty({ type: [WalletEntryView], description: 'Newest first, up to 100' }) entries!: WalletEntryView[];
}

export class AdjustWalletDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  riderId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Super admins only; others use their own partner' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiProperty({ example: 2500, description: 'Halalas; negative takes credit back' })
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  amountHalalas!: number;

  @ApiProperty({ example: 'تعويض عن تأخر رحلة الأحد' })
  @IsString()
  @Length(3, 200)
  note!: string;
}

export class RiderWalletQuery {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  riderId!: string;
}

/** What each way of cancelling gives the rider, shown before they choose. */
export class CancelPreviewView {
  @ApiProperty({ nullable: true, type: String, description: 'Cancel at period end: last day of service' })
  lastServiceDay!: string | null;
  @ApiProperty({ description: 'Cancel now: trips left in the paid period' }) remainingTrips!: number;
  @ApiProperty({ description: 'Cancel now: credit added to the wallet for them' }) creditHalalas!: number;
  @ApiProperty({ description: 'Whether cancelling now is possible (a paid period with trips left)' }) canCancelNow!: boolean;
}

/** How a rider ended up owed a trip: never came, or came late. */
type Fault = 'missed' | 'late';

/**
 * The rider's credit with each partner: compensation for trips the partner missed or ran late,
 * unused trips when cancelling now, and adjustments by the team. It lowers the rider's next
 * payment to that partner and is never paid out in cash.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger('Wallet');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async balance(riderId: string, partnerId: string): Promise<number> {
    const [row] = await this.db
      .select({ sum: sql<number>`coalesce(sum(${walletEntries.amountHalalas}), 0)::int` })
      .from(walletEntries)
      .where(and(eq(walletEntries.riderId, riderId), eq(walletEntries.partnerId, partnerId)));
    return Number(row?.sum ?? 0);
  }

  /** Credit not already set aside for a payment that is still waiting. */
  async available(riderId: string, partnerId: string): Promise<number> {
    const [row] = await this.db.execute<{ held: number }>(sql`
      SELECT coalesce(sum(p.wallet_halalas), 0)::int AS held FROM payments p
      WHERE p.rider_id = ${riderId} AND p.partner_id = ${partnerId} AND p.status = 'initiated'
        AND NOT EXISTS (SELECT 1 FROM wallet_entries w WHERE w.payment_id = p.id AND w.kind = 'redeem')`).then((r) => r.rows);
    return Math.max(0, (await this.balance(riderId, partnerId)) - Number(row?.held ?? 0));
  }

  /** How much credit a new payment of this amount uses: all that is available, leaving the minimum charge. */
  async toUse(riderId: string, partnerId: string, amountHalalas: number): Promise<number> {
    const room = amountHalalas - MIN_CHARGE_HALALAS;
    if (room <= 0) return 0;
    return Math.min(room, await this.available(riderId, partnerId));
  }

  /** Records the credit a confirmed payment used. Safe to call more than once per payment. */
  async redeem(payment: Payment): Promise<void> {
    if (payment.walletHalalas <= 0) return;
    await this.db
      .insert(walletEntries)
      .values({
        riderId: payment.riderId,
        partnerId: payment.partnerId,
        kind: 'redeem',
        amountHalalas: -payment.walletHalalas,
        paymentId: payment.id,
        subscriptionId: payment.subscriptionId,
        noteAr: 'خُصم من دفعة الاشتراك',
        noteEn: 'Used on a subscription payment',
      })
      .onConflictDoNothing();
  }

  async view(riderId: string): Promise<WalletView> {
    const balances = await this.db
      .select({
        partnerId: walletEntries.partnerId,
        partnerNameAr: partners.nameAr,
        partnerNameEn: partners.nameEn,
        balanceHalalas: sql<number>`sum(${walletEntries.amountHalalas})::int`,
      })
      .from(walletEntries)
      .innerJoin(partners, eq(partners.id, walletEntries.partnerId))
      .where(eq(walletEntries.riderId, riderId))
      .groupBy(walletEntries.partnerId, partners.nameAr, partners.nameEn);
    const entries = await this.db
      .select()
      .from(walletEntries)
      .where(eq(walletEntries.riderId, riderId))
      .orderBy(desc(walletEntries.createdAt))
      .limit(100);
    return {
      balances: balances.map((b) => ({ ...b, balanceHalalas: Number(b.balanceHalalas) })).filter((b) => b.balanceHalalas !== 0),
      entries: entries.map((e) => ({
        id: e.id,
        partnerId: e.partnerId,
        kind: e.kind,
        amountHalalas: e.amountHalalas,
        noteAr: e.noteAr,
        noteEn: e.noteEn,
        tripId: e.tripId,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** The team adds or takes back credit by hand (a goodwill gesture, a correction). Audited. */
  async adjust(actor: AuthUser, dto: AdjustWalletDto, ip?: string): Promise<WalletEntryView> {
    const partnerId = actor.role === 'super_admin' ? dto.partnerId : actor.partnerId;
    if (!partnerId) throw new AppError('VALIDATION_FAILED', {}, ['partnerId is required']);
    assertPartnerAccess(actor, partnerId);
    const rider = await this.db.query.users.findFirst({ columns: { id: true, role: true }, where: eq(users.id, dto.riderId) });
    if (!rider || rider.role !== 'rider') throw new AppError('NOT_FOUND');
    if (dto.amountHalalas < 0 && (await this.available(dto.riderId, partnerId)) + dto.amountHalalas < 0) {
      throw new AppError('VALIDATION_FAILED', {}, ['cannot take back more than the available credit']);
    }
    const [row] = await this.db
      .insert(walletEntries)
      .values({ riderId: dto.riderId, partnerId, kind: 'adjustment', amountHalalas: dto.amountHalalas, noteAr: dto.note, noteEn: dto.note, createdBy: actor.id })
      .returning();
    await this.audit.record({ actorId: actor.id, partnerId, action: 'wallet.adjust', entity: 'wallet_entry', entityId: row.id, after: row, ip });
    if (dto.amountHalalas > 0) {
      await this.notifications.notify([dto.riderId], {
        kind: 'wallet_credit',
        titleAr: `أضيف ${sar(dto.amountHalalas)} ريال إلى رصيدك`,
        titleEn: `SAR ${sar(dto.amountHalalas)} added to your credit`,
        bodyAr: dto.note,
        bodyEn: dto.note,
        data: { entryId: row.id },
      });
    }
    return { id: row.id, partnerId, kind: row.kind, amountHalalas: row.amountHalalas, noteAr: row.noteAr, noteEn: row.noteEn, tripId: null, createdAt: row.createdAt.toISOString() };
  }

  async riderView(actor: AuthUser, riderId: string): Promise<WalletView> {
    const view = await this.view(riderId);
    if (actor.role === 'super_admin') return view;
    return {
      balances: view.balances.filter((b) => b.partnerId === actor.partnerId),
      entries: view.entries.filter((e) => e.partnerId === actor.partnerId),
    };
  }

  // ------------------------------------------------------------------ compensation

  /** What one trip of a subscription is worth: its price spread over the trips of a period. */
  tripValue(sub: Pick<Subscription, 'priceHalalas' | 'days' | 'periodDays' | 'returnTime'>): number {
    const days = sub.periodDays ?? 30;
    const trips = Math.max(1, Math.round((sub.days.length * days) / 7) * (sub.returnTime ? 2 : 1));
    return Math.round(sub.priceHalalas / trips);
  }

  /**
   * The nightly pass over a finished day: every trip the partner missed (the car never came) or ran
   * late (arrived more than COMPENSATION_LATE_MINUTES after the rider's time) earns its value back.
   * Trips the rider skipped, did not come out for, or that were cancelled by a pause are not owed.
   */
  async compensate(day = addDays(riyadhToday(), -1)): Promise<{ missed: number; late: number; credited: number }> {
    const lateBy = `${this.env.COMPENSATION_LATE_MINUTES} minutes`;
    const rows = await this.db.execute<{ trip_id: string; subscription_id: string; fault: Fault; minutes: number | null }>(sql`
      SELECT t.id AS trip_id, t.subscription_id,
        CASE WHEN t.status IN ('scheduled', 'en_route') THEN 'missed' ELSE 'late' END AS fault,
        CASE WHEN t.status IN ('scheduled', 'en_route') THEN NULL
             ELSE round(extract(epoch FROM (coalesce(t.arrived_at, t.picked_up_at) - t.scheduled_at)) / 60)::int END AS minutes
      FROM trips t
      WHERE t.service_date = ${day}::date
        AND (
          t.status IN ('scheduled', 'en_route')
          OR (t.status = 'completed' AND coalesce(t.arrived_at, t.picked_up_at) > t.scheduled_at + ${lateBy}::interval)
        )
        AND NOT EXISTS (SELECT 1 FROM wallet_entries w WHERE w.trip_id = t.id AND w.kind = 'compensation')`);
    let credited = 0;
    let missed = 0;
    let late = 0;
    if (rows.rows.length === 0) return { missed, late, credited };
    const subs = await this.db.select().from(subscriptions).where(inArray(subscriptions.id, [...new Set(rows.rows.map((r) => r.subscription_id))]));
    for (const r of rows.rows) {
      const sub = subs.find((s) => s.id === r.subscription_id);
      if (!sub) continue;
      const amount = this.tripValue(sub);
      if (amount <= 0) continue;
      const note =
        r.fault === 'missed'
          ? { ar: `تعويض عن رحلة لم يحضر لها السائق (${day})`, en: `Compensation: the car did not come (${day})` }
          : { ar: `تعويض عن تأخر السائق ${r.minutes} دقيقة (${day})`, en: `Compensation: the car was ${r.minutes} min late (${day})` };
      const inserted = await this.db
        .insert(walletEntries)
        .values({
          riderId: sub.riderId,
          partnerId: sub.partnerId,
          kind: 'compensation',
          amountHalalas: amount,
          tripId: r.trip_id,
          subscriptionId: sub.id,
          noteAr: note.ar,
          noteEn: note.en,
        })
        .onConflictDoNothing()
        .returning({ id: walletEntries.id });
      if (inserted.length === 0) continue;
      if (r.fault === 'missed') missed++;
      else late++;
      credited += amount;
      await this.notifications.notify([sub.riderId], {
        kind: 'wallet_credit',
        titleAr: `عوضناك ${sar(amount)} ريال`,
        titleEn: `We credited you SAR ${sar(amount)}`,
        bodyAr: `${note.ar}. يُخصم الرصيد من دفعتك القادمة.`,
        bodyEn: `${note.en}. The credit comes off your next payment.`,
        data: { tripId: r.trip_id },
        dedupeKey: `compensation:${r.trip_id}`,
      });
    }
    if (credited > 0) this.logger.log(`Compensation ${day}: ${missed} missed, ${late} late, ${credited} halalas`);
    return { missed, late, credited };
  }

  // ------------------------------------------------------------------ cancelling now

  /** Trips left in the paid period after today, counting the rider's days and any pause. */
  remainingTrips(sub: Subscription, today = riyadhToday()): number {
    if (!sub.currentPeriodEnd || (sub.status !== 'active' && sub.status !== 'paused')) return 0;
    let n = 0;
    for (let d = addDays(today, 1); d <= sub.currentPeriodEnd; d = addDays(d, 1)) {
      const paused = sub.pausedFrom && sub.pausedUntil && d >= sub.pausedFrom && d <= sub.pausedUntil;
      if (!paused && sub.days.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) n += sub.returnTime ? 2 : 1;
    }
    return n;
  }

  /** Never more than was paid for the period. */
  refundFor(sub: Subscription, today = riyadhToday()): { remainingTrips: number; creditHalalas: number } {
    const remainingTrips = this.remainingTrips(sub, today);
    return { remainingTrips, creditHalalas: Math.min(sub.priceHalalas, remainingTrips * this.tripValue(sub)) };
  }

  async creditRefund(sub: Subscription, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.db.insert(walletEntries).values({
      riderId: sub.riderId,
      partnerId: sub.partnerId,
      kind: 'refund',
      amountHalalas: amount,
      subscriptionId: sub.id,
      noteAr: 'رحلات متبقية من اشتراك أُلغي',
      noteEn: 'Trips left on a cancelled subscription',
    });
  }
}

function sar(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

@ApiTags('rider: wallet')
@ApiBearerAuth()
@Controller('v1/wallet')
@Roles('rider')
export class RiderWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Credit with each partner and its history' })
  @ApiOkResponse({ type: WalletView })
  get(@CurrentUser() u: AuthUser): Promise<WalletView> {
    return this.wallet.view(u.id);
  }
}

@ApiTags('admin: wallet')
@ApiBearerAuth()
@Controller('v1/admin/wallet')
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: WalletView })
  rider(@CurrentUser() u: AuthUser, @Query() q: RiderWalletQuery): Promise<WalletView> {
    return this.wallet.riderView(u, q.riderId);
  }

  @Post('adjust')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: "Add credit to a rider's wallet (or take it back)" })
  @ApiOkResponse({ type: WalletEntryView })
  adjust(@CurrentUser() u: AuthUser, @Body() dto: AdjustWalletDto, @Req() req: Request): Promise<WalletEntryView> {
    return this.wallet.adjust(u, dto, req.ip);
  }

  @Post('compensate/:day')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Run the compensation pass for a day now (normally nightly)' })
  compensate(@Param('day') day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError('VALIDATION_FAILED', {}, ['day must be YYYY-MM-DD']);
    return this.wallet.compensate(day);
  }
}

/** Global: billing uses credit at payment, subscriptions refund on cancel, jobs compensate nightly. */
@Global()
@Module({ controllers: [RiderWalletController, AdminWalletController], providers: [WalletService], exports: [WalletService] })
export class WalletModule {}

