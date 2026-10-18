import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { and, count, desc, eq, gte, lte, sql, SQL, sum } from 'drizzle-orm';
import type { Response } from 'express';
import type { AuthUser, RequestMeta } from '../auth/auth.types';
import { CurrentUser, Public, ReqMeta, Roles } from '../auth/decorators';
import { AppError } from '../common/errors';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { DB, Database } from '../database/database.module';
import { invoices, payments, plans, subscriptions, users } from '../database/schema';
import { BillingService, PaymentView } from '../payments/billing.service';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payments/gateway';
import { InvoicesService, InvoiceView } from '../payments/invoices.service';
import { SandboxGateway } from '../payments/sandbox.gateway';
import {
  AdminListQuery,
  CreateMemberDto,
  CreatePlaceDto,
  MemberView,
  CreateSubscriptionDto,
  PauseDto,
  PaymentMethodView,
  PlaceView,
  QuoteDto,
  QuoteView,
  SubscribeResult,
  SubscriptionView,
} from './subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('rider: subscriptions')
@ApiBearerAuth()
@Roles('rider')
@Controller('v1')
export class RiderController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('places')
  @ApiOkResponse({ type: [PlaceView] })
  places(@CurrentUser() u: AuthUser): Promise<PlaceView[]> {
    return this.subs.listPlaces(u.id);
  }

  @Post('places')
  @ApiOkResponse({ type: PlaceView })
  addPlace(@CurrentUser() u: AuthUser, @Body() dto: CreatePlaceDto): Promise<PlaceView> {
    return this.subs.addPlace(u.id, dto);
  }

  @Delete('places/:id')
  @HttpCode(204)
  async removePlace(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.subs.removePlace(u.id, id);
  }

  @Post('quotes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Can this plan serve these two places, and at what price?' })
  @ApiOkResponse({ type: QuoteView })
  quote(@CurrentUser() u: AuthUser, @Body() dto: QuoteDto): Promise<QuoteView> {
    return this.subs.quote(u.id, dto);
  }

  @Get('subscriptions')
  @ApiOkResponse({ type: [SubscriptionView] })
  list(@CurrentUser() u: AuthUser): Promise<SubscriptionView[]> {
    return this.subs.list(u.id);
  }

  @Post('subscriptions')
  @ApiOperation({ summary: 'Subscribe; returns a payment page to open in the app' })
  @ApiOkResponse({ type: SubscribeResult })
  subscribe(@CurrentUser() u: AuthUser, @Body() dto: CreateSubscriptionDto): Promise<SubscribeResult> {
    return this.subs.subscribe(u.id, dto);
  }

  @Get('subscriptions/:id')
  @ApiOkResponse({ type: SubscriptionView })
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionView> {
    return this.subs.view(u.id, id);
  }

  @Post('subscriptions/:id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'New payment page for a subscription waiting for payment or past due' })
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PaymentView> {
    return this.subs.payNow(u.id, id);
  }

  @Post('subscriptions/:id/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause up to 30 days once a period; the period is extended by the paused days' })
  @ApiOkResponse({ type: SubscriptionView })
  pause(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PauseDto): Promise<SubscriptionView> {
    return this.subs.pause(u.id, id, dto);
  }

  @Post('subscriptions/:id/resume')
  @HttpCode(200)
  @ApiOkResponse({ type: SubscriptionView })
  resume(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionView> {
    return this.subs.resume(u.id, id);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop renewing; service continues to the end of the paid period' })
  @ApiOkResponse({ type: SubscriptionView })
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionView> {
    return this.subs.cancel(u.id, id);
  }

  @Post('subscriptions/:id/keep')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo a cancellation before the period ends' })
  @ApiOkResponse({ type: SubscriptionView })
  keep(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionView> {
    return this.subs.keep(u.id, id);
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Payment status (confirmed with the provider); poll after the payment page closes' })
  payment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PaymentView> {
    return this.subs.payment(u.id, id);
  }

  @Get('payment-methods')
  @ApiOkResponse({ type: [PaymentMethodView] })
  cards(@CurrentUser() u: AuthUser): Promise<PaymentMethodView[]> {
    return this.subs.cards(u.id);
  }

  @Delete('payment-methods/:id')
  @HttpCode(204)
  async removeCard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.subs.removeCard(u.id, id);
  }

  @Get('family')
  @ApiOperation({ summary: 'People this account rides for (children, relatives)' })
  @ApiOkResponse({ type: [MemberView] })
  family(@CurrentUser() u: AuthUser): Promise<MemberView[]> {
    return this.subs.members(u.id);
  }

  @Post('family')
  @ApiOkResponse({ type: MemberView })
  addMember(@CurrentUser() u: AuthUser, @Body() dto: CreateMemberDto): Promise<MemberView> {
    return this.subs.addMember(u.id, dto);
  }

  @Delete('family/:id')
  @HttpCode(204)
  async removeMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.subs.removeMember(u.id, id);
  }

  @Get('invoices')
  invoices(@CurrentUser() u: AuthUser): Promise<InvoiceView[]> {
    return this.subs.invoices(u.id);
  }
}

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('v1/invoices')
export class InvoicesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly invoices: InvoicesService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Printable invoice (HTML) for the rider, the partner’s staff or a platform admin' })
  @Header('Cache-Control', 'private, no-store')
  async html(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const inv = await this.db.query.invoices.findFirst({ where: eq(invoices.id, id) });
    const allowed =
      inv &&
      ((u.role === 'rider' && inv.riderId === u.id) ||
        u.role === 'super_admin' ||
        ((u.role === 'partner_admin' || u.role === 'dispatcher') && inv.partnerId === u.partnerId));
    if (!inv || !allowed) throw new AppError('INVOICE_NOT_FOUND');
    res.type('html').send(await this.invoices.html(inv));
  }
}

/** Where gateways and payment pages come back to. None of these trust what they are told. */
@ApiTags('payments: callbacks')
@SkipThrottle()
@Public()
@Controller('v1')
export class PaymentCallbacksController {
  constructor(
    private readonly billing: BillingService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Get('payments/:id/return')
  @ApiOperation({ summary: 'The payment page returns here; the app closes its browser view on this URL' })
  async returned(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    let status: string;
    try {
      status = (await this.billing.sync(id)).status;
    } catch {
      status = 'initiated';
    }
    const [ar, en] =
      status === 'paid'
        ? ['تم الدفع بنجاح', 'Payment successful']
        : status === 'failed'
          ? ['لم يتم الدفع', 'Payment not completed']
          : ['جار تأكيد الدفع', 'Confirming your payment'];
    res
      .type('html')
      .send(
        `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${en}</title></head>` +
          `<body style="font-family:Tahoma,sans-serif;text-align:center;padding:48px 16px;color:#18263a" data-status="${status}">` +
          `<h1 style="font-size:20px">${ar}</h1><p>${en}</p><p style="color:#4a5a6e">يمكنك العودة إلى التطبيق</p></body></html>`,
      );
  }

  @Post('webhooks/payments/:provider')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gateway webhooks. The status is always re-read from the gateway.' })
  async webhook(@Param('provider') provider: string, @Body() body: unknown): Promise<{ received: true }> {
    if (provider === this.gateway.name) {
      const id = this.billing.webhookPaymentId(body);
      if (id) await this.billing.syncByProviderId(id);
    }
    return { received: true };
  }

  @Get('sandbox/checkout/:providerId')
  @ApiExcludeEndpoint()
  async sandboxPage(@Param('providerId') providerId: string, @Res() res: Response): Promise<void> {
    const sandbox = this.sandbox();
    const p = await sandbox.describe(providerId);
    if (!p) throw new AppError('PAYMENT_NOT_FOUND');
    const sar = (p.amount / 100).toFixed(2);
    res
      .type('html')
      .send(
        `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox checkout</title></head>` +
          `<body style="font-family:Tahoma,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#18263a">` +
          `<h1 style="font-size:20px">صفحة دفع تجريبية</h1><p>بيئة اختبار، لا تُخصم أي مبالغ حقيقية.</p>` +
          `<p style="font-size:28px;font-weight:700;direction:ltr;text-align:right">${sar} SAR</p>` +
          `<form method="post" action="/v1/sandbox/checkout/${providerId}/pay"><button style="width:100%;padding:14px;background:#0b6e4f;color:#fff;border:0;border-radius:8px;font-size:16px">ادفع (نجاح)</button></form>` +
          `<form method="post" action="/v1/sandbox/checkout/${providerId}/decline" style="margin-top:12px"><button style="width:100%;padding:14px;background:#fff;color:#b42318;border:1px solid #b42318;border-radius:8px;font-size:16px">رفض البطاقة (فشل)</button></form>` +
          `</body></html>`,
      );
  }

  @Post('sandbox/checkout/:providerId/:outcome')
  @ApiExcludeEndpoint()
  async sandboxComplete(
    @Param('providerId') providerId: string,
    @Param('outcome') outcome: string,
    @Query('last4') last4: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const back = await this.sandbox().complete(providerId, outcome === 'pay' ? 'paid' : 'failed', last4);
    if (!back) throw new AppError('PAYMENT_NOT_FOUND');
    await this.billing.syncByProviderId(providerId);
    res.redirect(303, back);
  }

  private sandbox(): SandboxGateway {
    if (!(this.gateway instanceof SandboxGateway)) throw new AppError('NOT_FOUND');
    return this.gateway;
  }
}

class ManualPaymentDto {
  @ApiProperty({ enum: ['cash', 'bank_transfer'] }) @IsIn(['cash', 'bank_transfer']) method!: 'cash' | 'bank_transfer';
  @ApiPropertyOptional({ description: 'Transfer or receipt number' }) @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

@ApiTags('admin: billing')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminBillingController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly billing: BillingService,
  ) {}

  @Post('subscriptions/:id/payments/manual')
  @HttpCode(200)
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Record a bank transfer or cash payment; activates or renews the subscription and issues the invoice' })
  recordManual(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualPaymentDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.billing.recordManual(u, id, dto, meta.ip ?? null);
  }

  @Get('subscriptions')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  async subscriptions(@CurrentUser() u: AuthUser, @Query() q: AdminListQuery) {
    const scope = partnerScope(u, q.partnerId);
    const where: SQL[] = [];
    if (scope) where.push(eq(subscriptions.partnerId, scope));
    if (q.status) where.push(sql`${subscriptions.status} = ${q.status}`);
    const cond = where.length ? and(...where) : undefined;
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          riderName: users.name,
          riderPhone: users.phone,
          planNameAr: plans.nameAr,
          planNameEn: plans.nameEn,
          days: subscriptions.days,
          outboundTime: subscriptions.outboundTime,
          returnTime: subscriptions.returnTime,
          priceHalalas: subscriptions.priceHalalas,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          pausedFrom: subscriptions.pausedFrom,
          pausedUntil: subscriptions.pausedUntil,
          partnerId: subscriptions.partnerId,
          driverId: subscriptions.driverId,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.riderId))
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(cond)
        .orderBy(desc(subscriptions.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(subscriptions).where(cond),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Get('payments')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Payments with totals: collected, platform commission and partner share' })
  async payments(@CurrentUser() u: AuthUser, @Query() q: AdminListQuery) {
    const scope = partnerScope(u, q.partnerId);
    const where: SQL[] = [];
    if (scope) where.push(eq(payments.partnerId, scope));
    if (q.status) where.push(sql`${payments.status} = ${q.status}`);
    if (q.from) where.push(gte(payments.createdAt, new Date(`${q.from}T00:00:00+03:00`)));
    if (q.to) where.push(lte(payments.createdAt, new Date(`${q.to}T23:59:59+03:00`)));
    const cond = where.length ? and(...where) : undefined;
    const paidCond = and(...where, eq(payments.status, 'paid'));
    const [items, [{ total }], [totals]] = await Promise.all([
      this.db
        .select({
          id: payments.id,
          status: payments.status,
          purpose: payments.purpose,
          provider: payments.provider,
          amountHalalas: payments.amountHalalas,
          platformFeeHalalas: payments.platformFeeHalalas,
          partnerShareHalalas: payments.partnerShareHalalas,
          failureReason: payments.failureReason,
          paidAt: payments.paidAt,
          createdAt: payments.createdAt,
          riderName: users.name,
          riderPhone: users.phone,
          invoiceId: invoices.id,
          invoiceNumber: invoices.number,
        })
        .from(payments)
        .innerJoin(users, eq(users.id, payments.riderId))
        .leftJoin(invoices, eq(invoices.paymentId, payments.id))
        .where(cond)
        .orderBy(desc(payments.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(payments).where(cond),
      this.db
        .select({
          collected: sum(payments.amountHalalas),
          platformFee: sum(payments.platformFeeHalalas),
          partnerShare: sum(payments.partnerShareHalalas),
          count: count(),
        })
        .from(payments)
        .where(paidCond),
    ]);
    return {
      items,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totals: {
        paidCount: totals.count,
        collectedHalalas: Number(totals.collected ?? 0),
        platformFeeHalalas: Number(totals.platformFee ?? 0),
        partnerShareHalalas: Number(totals.partnerShare ?? 0),
      },
    };
  }

  /** Lets partner staff open a rider's invoice from the payments list. */
  @Get('invoices/:id/check')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiExcludeEndpoint()
  async check(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.db.query.invoices.findFirst({ columns: { partnerId: true }, where: eq(invoices.id, id) });
    if (!inv) throw new AppError('INVOICE_NOT_FOUND');
    assertPartnerAccess(u, inv.partnerId);
    return { ok: true };
  }
}
