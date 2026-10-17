import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePlaceDto {
  @ApiProperty({ enum: ['home', 'school', 'work', 'other'] })
  @IsIn(['home', 'school', 'work', 'other'])
  label!: 'home' | 'school' | 'work' | 'other';

  @ApiProperty({ example: 'البيت' })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ example: 24.8675 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 46.8275 })
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ example: 'حي الرمال، شارع 15' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}

export class PlaceView {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() name!: string;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
}

export class QuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pickupPlaceId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dropoffPlaceId!: string;
}

export class QuoteView {
  @ApiProperty() planId!: string;
  @ApiProperty() eligible!: boolean;
  @ApiProperty({ nullable: true, type: String, enum: ['PLACE_OUTSIDE_ZONE', 'PLAN_DISTANCE_EXCEEDED'] })
  reason!: 'PLACE_OUTSIDE_ZONE' | 'PLAN_DISTANCE_EXCEEDED' | null;
  @ApiProperty({ description: 'Estimated road distance (straight line x 1.3), km' }) distanceKm!: number;
  @ApiProperty() maxDistanceKm!: number;
  @ApiProperty({ description: 'Monthly, VAT included' }) priceHalalas!: number;
  @ApiProperty() vatHalalas!: number;
  @ApiProperty() daysPerWeek!: number;
  @ApiProperty({ enum: ['round_trip', 'one_way'] }) tripType!: string;
}

export class CreateSubscriptionDto extends QuoteDto {
  @ApiProperty({ example: [0, 1, 2, 3, 4], description: '0 = Sunday ... 6 = Saturday' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @ApiProperty({ example: '06:30' })
  @Matches(TIME)
  outboundTime!: string;

  @ApiPropertyOptional({ example: '13:30', description: 'Required for round-trip plans' })
  @IsOptional()
  @Matches(TIME)
  returnTime?: string;

  @ApiPropertyOptional({ description: 'Keep the card for automatic monthly renewal', default: true })
  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;
}

export class PauseDto {
  @ApiProperty({ example: '2026-11-01' })
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-11-10' })
  @IsDateString({ strict: true })
  until!: string;
}

export class SubscriptionView {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() planId!: string;
  @ApiProperty() planNameAr!: string;
  @ApiProperty() planNameEn!: string;
  @ApiProperty() partnerNameAr!: string;
  @ApiProperty() partnerNameEn!: string;
  @ApiProperty({ type: PlaceView }) pickup!: PlaceView;
  @ApiProperty({ type: PlaceView }) dropoff!: PlaceView;
  @ApiProperty({ type: [Number] }) days!: number[];
  @ApiProperty() outboundTime!: string;
  @ApiProperty({ nullable: true, type: String }) returnTime!: string | null;
  @ApiProperty() distanceKm!: number;
  @ApiProperty() priceHalalas!: number;
  @ApiProperty({ nullable: true, type: String }) currentPeriodStart!: string | null;
  @ApiProperty({ nullable: true, type: String }) currentPeriodEnd!: string | null;
  @ApiProperty() autoRenew!: boolean;
  @ApiProperty() cancelAtPeriodEnd!: boolean;
  @ApiProperty({ nullable: true, type: String }) pausedFrom!: string | null;
  @ApiProperty({ nullable: true, type: String }) pausedUntil!: string | null;
  @ApiProperty({ nullable: true, type: Object, description: 'Card used for renewals' })
  card!: { id: string; brand: string; last4: string } | null;
  @ApiProperty({ nullable: true, type: String, description: 'Open payment page when payment is due' })
  payUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) pendingPaymentId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class SubscribeResult {
  @ApiProperty({ type: SubscriptionView }) subscription!: SubscriptionView;
  @ApiProperty({ type: Object, description: 'Open checkoutUrl in a browser view; poll the payment until paid' })
  payment!: { id: string; status: string; checkoutUrl: string | null };
}

export class PaymentMethodView {
  @ApiProperty() id!: string;
  @ApiProperty() brand!: string;
  @ApiProperty() last4!: string;
  @ApiProperty({ nullable: true, type: Number }) expMonth!: number | null;
  @ApiProperty({ nullable: true, type: Number }) expYear!: number | null;
  @ApiProperty() isDefault!: boolean;
}

export class AdminListQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
