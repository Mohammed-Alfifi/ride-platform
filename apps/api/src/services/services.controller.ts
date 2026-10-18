import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { AnalyticsService } from './analytics.service';
import { EngagementService, RATING_TAGS } from './engagement.service';
import { PromosService } from './promos.service';

class RatingDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) stars!: number;

  @ApiPropertyOptional({ enum: RATING_TAGS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(RATING_TAGS as unknown as string[], { each: true })
  tags?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

class TicketDto {
  @ApiProperty({ enum: ['trip', 'driver', 'payment', 'app', 'other'] })
  @IsIn(['trip', 'driver', 'payment', 'app', 'other'])
  category!: 'trip' | 'driver' | 'payment' | 'app' | 'other';

  @ApiProperty() @IsString() @Length(3, 120) subject!: string;
  @ApiProperty() @IsString() @Length(2, 2000) message!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() tripId?: string;
}

class MessageDto {
  @ApiProperty() @IsString() @Length(1, 2000) body!: string;
}

class TicketQuery {
  @ApiPropertyOptional({ enum: ['open', 'answered', 'closed'] }) @IsOptional() @IsIn(['open', 'answered', 'closed']) status?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() partnerId?: string;
}

class RangeQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() partnerId?: string;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
}

class RatingQuery extends RangeQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() driverId?: string;
}

class PromoDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Platform admins only' }) @IsOptional() @IsUUID() partnerId?: string;

  @ApiProperty({ example: 'SCHOOL25' })
  @Matches(/^[A-Za-z0-9-]{3,20}$/)
  code!: string;

  @ApiProperty({ enum: ['percent', 'amount'] }) @IsIn(['percent', 'amount']) kind!: 'percent' | 'amount';

  @ApiProperty({ description: 'percent: 1-100; amount: halalas' }) @IsInt() @Min(1) @Max(1_000_000) value!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) validUntil?: string;
}

class PromoActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

@ApiTags('rider: trip extras')
@ApiBearerAuth()
@Roles('rider')
@Controller('v1/trips')
export class TripExtrasController {
  constructor(private readonly engagement: EngagementService) {}

  @Post(':id/share')
  @HttpCode(200)
  @ApiOperation({ summary: 'A link to follow this trip live without the app (for a parent or relative)' })
  share(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.share(u.id, id);
  }

  @Delete(':id/share')
  @HttpCode(204)
  async unshare(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.engagement.stopSharing(u.id, id);
  }

  @Post(':id/rating')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rate a completed trip (can be changed later)' })
  rate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RatingDto) {
    return this.engagement.rate(u.id, id, dto);
  }
}

@ApiTags('public: shared trip')
@Public()
@Controller('v1/shared')
export class SharedTripController {
  constructor(private readonly engagement: EngagementService) {}

  @Get(':token')
  @ApiOperation({ summary: 'A shared trip, for the tracking page. No phone numbers; first names only.' })
  shared(@Param('token') token: string) {
    return this.engagement.shared(token);
  }
}

@ApiTags('support')
@ApiBearerAuth()
@Roles('rider', 'driver')
@Controller('v1/support/tickets')
export class SupportController {
  constructor(private readonly engagement: EngagementService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.engagement.myTickets(u.id);
  }

  @Post()
  open(@CurrentUser() u: AuthUser, @Body() dto: TicketDto) {
    return this.engagement.openTicket(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.ticket(id, u);
  }

  @Post(':id/messages')
  message(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto) {
    return this.engagement.reply(u, id, dto.body);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.close(u, id);
  }
}

@ApiTags('admin: service')
@ApiBearerAuth()
@Roles('super_admin', 'partner_admin', 'dispatcher')
@Controller('v1/admin')
export class AdminServiceController {
  constructor(
    private readonly engagement: EngagementService,
    private readonly promos: PromosService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('support/tickets')
  tickets(@CurrentUser() u: AuthUser, @Query() q: TicketQuery) {
    return this.engagement.adminTickets(u, q);
  }

  @Get('support/tickets/:id')
  ticket(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.ticket(id, u);
  }

  @Post('support/tickets/:id/reply')
  reply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto) {
    return this.engagement.reply(u, id, dto.body);
  }

  @Post('support/tickets/:id/close')
  @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.close(u, id);
  }

  @Get('ratings')
  @ApiOperation({ summary: 'Recent ratings and each driver average (lowest first)' })
  ratings(@CurrentUser() u: AuthUser, @Query() q: RatingQuery) {
    return this.engagement.ratings(u, q);
  }

  @Get('promo-codes')
  @Roles('super_admin', 'partner_admin')
  promoList(@CurrentUser() u: AuthUser, @Query() q: TicketQuery) {
    return this.promos.list(u, q.partnerId);
  }

  @Post('promo-codes')
  @Roles('super_admin', 'partner_admin')
  promoCreate(@CurrentUser() u: AuthUser, @Body() dto: PromoDto) {
    return this.promos.create(u, dto);
  }

  @Patch('promo-codes/:id')
  @Roles('super_admin', 'partner_admin')
  promoActive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PromoActiveDto) {
    return this.promos.setActive(u, id, dto.active);
  }

  @Get('analytics')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Revenue, subscriptions, trips, punctuality and ratings for a date range (last 30 days by default)' })
  report(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) {
    return this.analytics.report(u, q);
  }

  @Get('payments.csv')
  @Roles('super_admin', 'partner_admin')
  @Header('Cache-Control', 'private, no-store')
  async csv(@CurrentUser() u: AuthUser, @Query() q: RangeQuery, @Res() res: Response): Promise<void> {
    const body = await this.analytics.paymentsCsv(u, q);
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="payments-${q.from ?? 'last30'}-${q.to ?? 'today'}.csv"`)
      .send(body);
  }
}
