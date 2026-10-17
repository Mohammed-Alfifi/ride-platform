import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GeoJsonPolygon {
  @ApiProperty({ example: 'Polygon' })
  @Equals('Polygon')
  type!: 'Polygon';

  @ApiProperty({
    description: 'One outer ring of [longitude, latitude] pairs (no holes)',
    example: [[[46.71, 24.82], [46.75, 24.82], [46.75, 24.85], [46.71, 24.85], [46.71, 24.82]]],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  coordinates!: number[][][];
}

export class CreateZoneDto {
  @ApiProperty({ example: 'حي الرمال' })
  @IsString()
  @Length(2, 120)
  nameAr!: string;

  @ApiProperty({ example: 'Al Rimal' })
  @IsString()
  @Length(2, 120)
  nameEn!: string;

  @ApiProperty({ type: GeoJsonPolygon })
  @ValidateNested()
  @Type(() => GeoJsonPolygon)
  area!: GeoJsonPolygon;

  @ApiPropertyOptional({ format: 'uuid', description: 'Super admins only' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class UpdateZoneDto extends PartialType(OmitType(CreateZoneDto, ['partnerId'] as const)) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ZoneView {
  @ApiProperty() id!: string;
  @ApiProperty() partnerId!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: GeoJsonPolygon }) area!: GeoJsonPolygon;
  @ApiProperty({ example: 6.4 }) areaKm2!: number;
  @ApiProperty() planCount!: number;
}

export class PointQuery {
  @ApiProperty({ example: 24.835 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 46.73 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class ZoneScopeQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class CreatePlanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  zoneId!: string;

  @ApiProperty({ example: 'ذهاب وعودة - 5 أيام' })
  @IsString()
  @Length(2, 120)
  nameAr!: string;

  @ApiProperty({ example: 'Round trip - 5 days' })
  @IsString()
  @Length(2, 120)
  nameEn!: string;

  @ApiProperty({ enum: ['round_trip', 'one_way'] })
  @IsIn(['round_trip', 'one_way'])
  tripType!: 'round_trip' | 'one_way';

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  @Max(7)
  daysPerWeek!: number;

  @ApiProperty({ example: 120000, description: 'Monthly price in halalas, VAT included (120000 = 1,200 SAR)' })
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  priceHalalas!: number;

  @ApiProperty({ example: 15 })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(200)
  maxDistanceKm!: number;
}

export class UpdatePlanDto extends PartialType(OmitType(CreatePlanDto, ['zoneId'] as const)) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PlanView {
  @ApiProperty() id!: string;
  @ApiProperty() partnerId!: string;
  @ApiProperty() zoneId!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ enum: ['round_trip', 'one_way'] }) tripType!: 'round_trip' | 'one_way';
  @ApiProperty() daysPerWeek!: number;
  @ApiProperty() priceHalalas!: number;
  @ApiProperty() maxDistanceKm!: number;
  @ApiProperty() active!: boolean;
}

export class CoverageView {
  @ApiProperty() zoneId!: string;
  @ApiProperty() zoneNameAr!: string;
  @ApiProperty() zoneNameEn!: string;
  @ApiProperty() partnerId!: string;
  @ApiProperty() partnerNameAr!: string;
  @ApiProperty() partnerNameEn!: string;
  @ApiProperty({ type: [PlanView] }) plans!: PlanView[];
}
