import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Partner } from '../database/schema';

export class CreatePartnerDto {
  @ApiProperty({ example: 'شركة النقل المتحدة' })
  @IsString()
  @Length(2, 160)
  nameAr!: string;

  @ApiProperty({ example: 'United Transport Co.' })
  @IsString()
  @Length(2, 160)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ example: '1010123456', description: 'Commercial registration (10 digits)' })
  @IsOptional()
  @Matches(/^\d{10}$/)
  crNumber?: string;

  @ApiPropertyOptional({ description: 'Transport General Authority licence number' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tgaLicenseNumber?: string;

  @ApiPropertyOptional({ example: '0112345678' })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  contactPhone?: string;

  @ApiPropertyOptional({ example: 1500, description: 'Commission in basis points (1500 = 15%)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionBps?: number;

  @ApiPropertyOptional({
    example: '310123456700003',
    description: 'VAT registration number (15 digits, starts and ends with 3). Leave empty if not VAT registered.',
  })
  @IsOptional()
  @Matches(/^3\d{13}3$/)
  vatNumber?: string;

  @ApiPropertyOptional({ example: 'dest_xxxx', description: 'Payment gateway sub-account (Tap destination) that receives the partner share' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  gatewayAccountId?: string;
}

export class UpdatePartnerDto extends PartialType(CreatePartnerDto) {
  @ApiPropertyOptional({ enum: ['active', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}

export class PartnerView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ nullable: true, type: String }) legalName!: string | null;
  @ApiProperty({ nullable: true, type: String }) crNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) tgaLicenseNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) contactPhone!: string | null;
  @ApiProperty() commissionBps!: number;
  @ApiProperty({ nullable: true, type: String }) vatNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) gatewayAccountId!: string | null;
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: Partner['status'];
  @ApiProperty({ example: 'K7M2QX', description: 'Drivers enter this code in the driver app to join' })
  joinCode!: string;
  @ApiProperty() staffCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export function presentPartner(p: Partner, staffCount = 0): PartnerView {
  return {
    id: p.id,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    legalName: p.legalName,
    crNumber: p.crNumber,
    tgaLicenseNumber: p.tgaLicenseNumber,
    contactPhone: p.contactPhone,
    commissionBps: p.commissionBps,
    vatNumber: p.vatNumber,
    gatewayAccountId: p.gatewayAccountId,
    status: p.status,
    joinCode: p.joinCode,
    staffCount,
    createdAt: p.createdAt.toISOString(),
  };
}
