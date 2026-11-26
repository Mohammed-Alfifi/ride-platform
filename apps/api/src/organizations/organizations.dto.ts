import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ORG_KINDS, type OrgKind } from '../database/schema';

export class CreateOrganizationDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Super admins only; others use their own partner' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiProperty({ enum: ORG_KINDS })
  @IsIn(ORG_KINDS)
  kind!: OrgKind;

  @ApiProperty({ example: 'شركة المراعي - فرع الخرج' })
  @IsString()
  @Length(2, 160)
  nameAr!: string;

  @ApiProperty({ example: 'Almarai - Al Kharj' })
  @IsString()
  @Length(2, 160)
  nameEn!: string;

  @ApiProperty({ description: 'The buyer on the tax invoice' })
  @IsString()
  @Length(2, 200)
  legalName!: string;

  @ApiPropertyOptional({ example: '1010123456' })
  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'crNumber must be 10 digits' })
  crNumber?: string | null;

  @ApiPropertyOptional({ example: '300000000000003' })
  @IsOptional()
  @Matches(/^3\d{13}3$/, { message: 'vatNumber must be 15 digits starting and ending with 3' })
  vatNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 200)
  address?: string | null;

  @ApiPropertyOptional({ example: '0501234567' })
  @IsOptional()
  @IsString()
  @Length(9, 16)
  contactPhone?: string | null;

  @ApiProperty({ example: 10000, description: 'Share of each subscription the organization pays, basis points (100 to 10000)' })
  @IsInt()
  @Min(100)
  @Max(10_000)
  coverageBps!: number;

  @ApiProperty({ type: [String], description: 'Plans its members may take' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  planIds!: string[];
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {
  @ApiPropertyOptional({ enum: ['active', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}

export class OrganizationQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class OrganizationView {
  @ApiProperty() id!: string;
  @ApiProperty() partnerId!: string;
  @ApiProperty() partnerNameAr!: string;
  @ApiProperty() partnerNameEn!: string;
  @ApiProperty({ enum: ORG_KINDS }) kind!: OrgKind;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() legalName!: string;
  @ApiProperty({ nullable: true, type: String }) crNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) vatNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
  @ApiProperty({ nullable: true, type: String }) contactPhone!: string | null;
  @ApiProperty() coverageBps!: number;
  @ApiProperty({ type: [String] }) planIds!: string[];
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: 'active' | 'suspended';
  @ApiProperty() members!: number;
  @ApiProperty({ description: 'Members with a running subscription paid by the organization' }) seats!: number;
  @ApiProperty({ description: 'Issued and not yet paid, halalas' }) unpaidHalalas!: number;
  @ApiProperty({ description: 'Unpaid invoices past their due date' }) overdue!: number;
  @ApiProperty({ description: 'Credits owed to it, for its next invoice' }) openCreditHalalas!: number;
}

export class OrgPlanView {
  @ApiProperty() id!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() priceHalalas!: number;
  @ApiProperty({ description: 'What the organization pays per period' }) orgHalalas!: number;
  @ApiProperty({ description: 'What the member pays per period' }) memberHalalas!: number;
}

/** What an organization admin sees about their own account. */
export class OrgProfileView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ORG_KINDS }) kind!: OrgKind;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() partnerNameAr!: string;
  @ApiProperty() partnerNameEn!: string;
  @ApiProperty() coverageBps!: number;
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: 'active' | 'suspended';
  @ApiProperty({ type: [OrgPlanView] }) plans!: OrgPlanView[];
  @ApiProperty() members!: number;
  @ApiProperty() seats!: number;
  @ApiProperty() unpaidHalalas!: number;
  @ApiProperty({ description: 'Credits owed to it, for its next invoice' }) openCreditHalalas!: number;
  @ApiProperty({ description: 'Invoices can be paid online' }) payOnline!: boolean;
}

export class CreateOrgAdminDto {
  @ApiProperty({ example: '0501234567' })
  @IsString()
  @Length(9, 20)
  phone!: string;

  @ApiProperty({ example: 'منسقة شؤون الموظفين' })
  @IsString()
  @Length(2, 120)
  name!: string;
}

export class OrgAdminView {
  @ApiProperty() id!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ enum: ['active', 'pending', 'suspended'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) lastLoginAt!: string | null;
}

export class AddMemberDto {
  @ApiProperty({ example: '0501234567', description: 'The number they sign in to the rider app with (a guardian’s for a student)' })
  @IsString()
  @Length(1, 30)
  phone!: string;

  @ApiProperty({ example: 'سارة العتيبي' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ example: 'E-1043', description: 'Employee number, or a student’s grade and class' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  reference?: string | null;
}

export class BulkMembersDto {
  @ApiProperty({ type: [AddMemberDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AddMemberDto)
  members!: AddMemberDto[];
}

export class BulkRowError {
  @ApiProperty() row!: number;
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: ['AUTH_PHONE_INVALID', 'ORG_MEMBER_ELSEWHERE', 'DUPLICATE'] }) code!: string;
}

export class BulkResultView {
  @ApiProperty() added!: number;
  @ApiProperty({ description: 'Already members of this organization' }) existing!: number;
  @ApiProperty({ type: [BulkRowError] }) errors!: BulkRowError[];
}

export class MemberView {
  @ApiProperty() id!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
  @ApiProperty({ description: 'Has a rider account with this number' }) joined!: boolean;
  @ApiProperty({ nullable: true, enum: ['pending_payment', 'active', 'past_due', 'paused', 'cancelled', 'expired'] })
  subscriptionStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) planNameAr!: string | null;
  @ApiProperty({ nullable: true, type: String }) planNameEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) currentPeriodEnd!: string | null;
  @ApiProperty() createdAt!: string;
}

export class MemberQuery {
  @ApiPropertyOptional({ description: 'Name, phone or reference' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;
}

export class AttendanceQuery {
  @ApiProperty({ example: '2026-11-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-11-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

export class AttendanceRow {
  @ApiProperty() memberId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
  @ApiProperty({ description: 'Trips planned in the range' }) planned!: number;
  @ApiProperty({ description: 'Rode' }) rode!: number;
  @ApiProperty({ description: 'Told the driver they would not ride' }) excused!: number;
  @ApiProperty({ description: 'Did not come out' }) noShow!: number;
  @ApiProperty({ description: 'The car did not come, or was cancelled by the partner' }) missed!: number;
  @ApiProperty({ description: 'Rode, but the car came late' }) late!: number;
}

export class AttendanceView {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: [AttendanceRow] }) rows!: AttendanceRow[];
  @ApiProperty({ type: AttendanceRow, description: 'Sums; memberId and name are empty' }) totals!: AttendanceRow;
}

export class IssueOrgInvoiceDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

export class PayOrgInvoiceDto {
  @ApiProperty({ enum: ['bank_transfer', 'cash'] })
  @IsIn(['bank_transfer', 'cash'])
  method!: 'bank_transfer' | 'cash';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  reference?: string;
}

export class OrgInvoiceView {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() organizationNameAr!: string;
  @ApiProperty() organizationNameEn!: string;
  @ApiProperty() month!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ description: 'Subscription periods billed' }) lines!: number;
  @ApiProperty({ description: 'The organization’s share of those periods' }) grossHalalas!: number;
  @ApiProperty({ description: 'Credits taken off' }) creditHalalas!: number;
  @ApiProperty({ description: 'To pay: gross less credits' }) totalHalalas!: number;
  @ApiProperty() vatHalalas!: number;
  @ApiProperty({ enum: ['issued', 'paid', 'void'] }) status!: string;
  @ApiProperty() issuedAt!: string;
  @ApiProperty() dueDate!: string;
  @ApiProperty() overdue!: boolean;
  @ApiProperty({ nullable: true, type: String }) paidAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
}

export class OrgInvoiceLineView {
  @ApiProperty() memberName!: string;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
  @ApiProperty() planNameAr!: string;
  @ApiProperty() planNameEn!: string;
  @ApiProperty() periodStart!: string;
  @ApiProperty() amountHalalas!: number;
}

export class OrgCreditView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['compensation', 'cancellation'] }) kind!: 'compensation' | 'cancellation';
  @ApiProperty() amountHalalas!: number;
  @ApiProperty() noteAr!: string;
  @ApiProperty() noteEn!: string;
  @ApiProperty() createdAt!: string;
}

export class OrgInvoiceDetailView extends OrgInvoiceView {
  @ApiProperty({ type: [OrgInvoiceLineView] }) items!: OrgInvoiceLineView[];
  @ApiProperty({ type: [OrgCreditView] }) credits!: OrgCreditView[];
}

export class OrgCheckoutView {
  @ApiProperty() paymentId!: string;
  @ApiProperty({ description: 'The gateway’s payment page' }) checkoutUrl!: string;
  @ApiProperty() amountHalalas!: number;
}

/** The organization paying for a rider's subscription, as shown in the quote and the subscription. */
export class SponsorView {
  @ApiProperty() organizationId!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() coverageBps!: number;
  @ApiProperty({ description: 'Paid by the organization each period' }) orgHalalas!: number;
}
