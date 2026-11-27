import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { SERVICE_CLASSES, type ServiceClass } from '../database/schema';

export class UpsertLicenseDto {
  @ApiProperty({ example: '1234567890', description: 'Licence number issued by the Transport General Authority' })
  @IsString()
  @Length(3, 40)
  licenseNumber!: string;

  @ApiPropertyOptional({ description: "The authority's unified code, shown to riders" })
  @IsOptional()
  @IsString()
  @Length(3, 40)
  unifiedCode?: string;

  @ApiProperty({ example: '2028-11-30' })
  @IsDateString({ strict: true })
  expiresAt!: string;

  @ApiPropertyOptional({ description: 'Lowest approved monthly price, VAT included, halalas' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  minPriceHalalas?: number;

  @ApiPropertyOptional({ description: 'Highest approved monthly price, VAT included, halalas' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxPriceHalalas?: number;

  @ApiPropertyOptional({ description: 'Reference of the approved pricing method' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  pricingReference?: string;
}

export class LicenseParams {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  partnerId!: string;

  @ApiProperty({ enum: SERVICE_CLASSES })
  @IsIn(SERVICE_CLASSES as unknown as string[])
  serviceClass!: ServiceClass;
}

export class LicenseView {
  @ApiProperty() id!: string;
  @ApiProperty() partnerId!: string;
  @ApiProperty({ enum: SERVICE_CLASSES }) serviceClass!: ServiceClass;
  @ApiProperty() licenseNumber!: string;
  @ApiProperty({ nullable: true, type: String }) unifiedCode!: string | null;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ nullable: true, type: Number }) minPriceHalalas!: number | null;
  @ApiProperty({ nullable: true, type: Number }) maxPriceHalalas!: number | null;
  @ApiProperty({ nullable: true, type: String }) pricingReference!: string | null;
  @ApiProperty({ nullable: true, type: String }) verifiedAt!: string | null;
  @ApiProperty({ description: 'Verified and not expired: the class may be sold' }) valid!: boolean;
}

export class ExportQuery {
  @ApiProperty({ example: '2026-11-01' })
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-11-30' })
  @IsDateString({ strict: true })
  to!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Super admins only' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}
