import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
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
  ValidateNested,
} from 'class-validator';
import { DOCUMENT_TYPES, type DocumentType } from '../database/schema';

export class JoinPartnerDto {
  @ApiProperty({ example: 'K7M2QX' })
  @IsString()
  @Length(4, 8)
  code!: string;
}

export class DriverProfileDto {
  @ApiProperty({ example: 'محمد عبدالله الشهري' })
  @IsString()
  @Length(5, 120)
  fullName!: string;

  @ApiProperty({ example: '1012345678', description: 'Saudi national ID (10 digits, starts with 1)' })
  @IsString()
  @Matches(/^\d{10}$/)
  nationalId!: string;

  @ApiProperty({ example: '1995-04-12' })
  @IsDateString({ strict: true })
  dateOfBirth!: string;

  @ApiProperty({ description: 'The driver confirms Saudi citizenship (TGA requirement for private cars)' })
  @IsBoolean()
  @Equals(true)
  saudiConfirmed!: boolean;
}

export class VehicleDto {
  @ApiProperty({ example: 'ا ب ح', description: 'Plate letters, Arabic or Latin' })
  @IsString()
  @Length(1, 8)
  plateLetters!: string;

  @ApiProperty({ example: '1234' })
  @Matches(/^\d{1,4}$/)
  plateNumbers!: string;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @Length(2, 60)
  make!: string;

  @ApiProperty({ example: 'Camry' })
  @IsString()
  @Length(1, 60)
  model!: string;

  @ApiProperty({ example: 2023 })
  @IsInt()
  @Min(1990)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 'أبيض' })
  @IsString()
  @Length(2, 30)
  color!: string;

  @ApiProperty({ example: 4, description: 'Passenger seats, not counting the driver' })
  @IsInt()
  @Min(1)
  @Max(14)
  seats!: number;
}

export class UploadDocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES as unknown as string[])
  type!: DocumentType;

  @ApiPropertyOptional({ example: '2027-03-01', description: 'Required for every type except driver_photo' })
  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string;
}

export class DocumentView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DOCUMENT_TYPES }) type!: DocumentType;
  @ApiProperty() mime!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ nullable: true, type: String }) expiresAt!: string | null;
  @ApiProperty({ enum: ['pending', 'accepted', 'rejected'] }) status!: 'pending' | 'accepted' | 'rejected';
  @ApiProperty({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty({ description: 'Authenticated download path' }) fileUrl!: string;
  @ApiProperty() createdAt!: string;
}

export class VehicleView {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ABJ' }) plateLetters!: string;
  @ApiProperty({ example: '1234' }) plateNumbers!: string;
  @ApiProperty() make!: string;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiProperty() color!: string;
  @ApiProperty() seats!: number;
  @ApiProperty({ description: 'Last day the vehicle may serve under the age rule (exclusive)' })
  eligibleUntil!: string;
}

export class RequirementView {
  @ApiProperty({ enum: DOCUMENT_TYPES }) type!: DocumentType;
  @ApiProperty() expiryRequired!: boolean;
  @ApiProperty({ nullable: true, type: String, enum: ['pending', 'accepted', 'rejected'] })
  status!: 'pending' | 'accepted' | 'rejected' | null;
}

export class OnboardingView {
  @ApiProperty({ enum: ['not_joined', 'draft', 'submitted', 'approved', 'rejected'] })
  status!: 'not_joined' | 'draft' | 'submitted' | 'approved' | 'rejected';
  @ApiProperty({ nullable: true, type: Object }) partner!: { id: string; nameAr: string; nameEn: string } | null;
  @ApiProperty({ nullable: true, type: Object }) profile!: {
    fullName: string | null;
    nationalIdLast4: string | null;
    dateOfBirth: string | null;
    saudiConfirmed: boolean;
  } | null;
  @ApiProperty({ nullable: true, type: VehicleView }) vehicle!: VehicleView | null;
  @ApiProperty({ type: [DocumentView] }) documents!: DocumentView[];
  @ApiProperty({ type: [RequirementView] }) requirements!: RequirementView[];
  @ApiProperty({ type: [String], example: ['profile', 'vehicle', 'document.driving_license'] }) missing!: string[];
  @ApiProperty() canSubmit!: boolean;
  @ApiProperty({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty() complianceHold!: boolean;
  @ApiProperty({ nullable: true, type: String }) complianceReason!: string | null;
}

// ------------------------------------------------------------------ admin

export class ListDriversQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ enum: ['draft', 'submitted', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['draft', 'submitted', 'approved', 'rejected'])
  status?: 'draft' | 'submitted' | 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Only drivers on compliance hold' })
  @IsOptional()
  @IsIn(['true', 'false'])
  hold?: 'true' | 'false';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

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

export class DriverListItem {
  @ApiProperty() id!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true, type: String }) fullName!: string | null;
  @ApiProperty() accountStatus!: string;
  @ApiProperty() onboardingStatus!: string;
  @ApiProperty({ nullable: true, type: String }) partnerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) vehicle!: string | null;
  @ApiProperty() complianceHold!: boolean;
  @ApiProperty({ nullable: true, type: String }) submittedAt!: string | null;
  @ApiProperty() pendingDocuments!: number;
}

export class DriverPage {
  @ApiProperty({ type: [DriverListItem] }) items!: DriverListItem[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class DriverDetail {
  @ApiProperty() id!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() accountStatus!: string;
  @ApiProperty() onboardingStatus!: string;
  @ApiProperty({ nullable: true, type: String }) partnerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) fullName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Full number for partner admins, masked for dispatchers' })
  nationalId!: string | null;
  @ApiProperty({ nullable: true, type: String }) dateOfBirth!: string | null;
  @ApiProperty({ nullable: true, type: VehicleView }) vehicle!: VehicleView | null;
  @ApiProperty({ type: [DocumentView] }) documents!: DocumentView[];
  @ApiProperty({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) submittedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) reviewedAt!: string | null;
  @ApiProperty() complianceHold!: boolean;
  @ApiProperty({ nullable: true, type: String }) complianceReason!: string | null;
}

export class DocumentRejection {
  @ApiProperty()
  @IsUUID()
  documentId!: string;

  @ApiProperty({ example: 'الصورة غير واضحة' })
  @IsString()
  @Length(3, 300)
  reason!: string;
}

export class RejectDriverDto {
  @ApiProperty({ example: 'صورة الرخصة غير واضحة' })
  @IsString()
  @Length(3, 500)
  reason!: string;

  @ApiPropertyOptional({ type: [DocumentRejection] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DocumentRejection)
  documents?: DocumentRejection[];
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['accepted', 'rejected'] })
  @IsIn(['accepted', 'rejected'])
  status!: 'accepted' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 300)
  rejectionReason?: string;
}

export class ExpiringQuery {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  days = 30;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class ExpiringItem {
  @ApiProperty() documentId!: string;
  @ApiProperty() driverId!: string;
  @ApiProperty({ nullable: true, type: String }) driverName!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: DOCUMENT_TYPES }) type!: DocumentType;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ description: 'Negative when already expired' }) daysLeft!: number;
  @ApiProperty() complianceHold!: boolean;
}
