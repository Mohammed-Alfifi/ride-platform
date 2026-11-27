import { Body, Controller, Delete, Get, Global, Header, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AppError } from '../common/errors';
import {
  AddMemberDto,
  AttendanceQuery,
  AttendanceView,
  BulkMembersDto,
  BulkResultView,
  CreateOrgAdminDto,
  CreateOrganizationDto,
  IssueOrgInvoiceDto,
  MemberQuery,
  MemberView,
  OrgAdminView,
  OrganizationQuery,
  OrganizationView,
  OrgInvoiceDetailView,
  OrgInvoiceView,
  OrgProfileView,
  PayOrgInvoiceDto,
  UpdateOrganizationDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';
import { OrgInvoicesService } from './org-invoices.service';

/** The partner's side: agreements with companies and schools, their admins and their invoices. */
@ApiTags('admin: organizations')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminOrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly invoices: OrgInvoicesService,
  ) {}

  @Get('organizations')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: [OrganizationView] })
  list(@CurrentUser() u: AuthUser, @Query() q: OrganizationQuery): Promise<OrganizationView[]> {
    return this.orgs.list(u, q);
  }

  @Post('organizations')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Add a company or school that pays for its people' })
  @ApiCreatedResponse({ type: OrganizationView })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrganizationDto, @Req() req: Request): Promise<OrganizationView> {
    return this.orgs.create(u, dto, req.ip);
  }

  @Get('organizations/:id')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: OrganizationView })
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrganizationView> {
    return this.orgs.view(u, id);
  }

  @Patch('organizations/:id')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Change the agreement; coverage and plans apply from each member’s next payment' })
  @ApiOkResponse({ type: OrganizationView })
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationDto, @Req() req: Request): Promise<OrganizationView> {
    return this.orgs.update(u, id, dto, req.ip);
  }

  @Get('organizations/:id/members')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: [MemberView] })
  async members(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MemberQuery): Promise<MemberView[]> {
    const org = await this.orgs.getForPartner(u, id);
    return this.orgs.members(org.id, q);
  }

  @Get('organizations/:id/admins')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: [OrgAdminView] })
  admins(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrgAdminView[]> {
    return this.orgs.admins(u, id);
  }

  @Post('organizations/:id/admins')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'An account that signs in to the dashboard for this organization only' })
  @ApiCreatedResponse({ type: OrgAdminView })
  addAdmin(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateOrgAdminDto, @Req() req: Request): Promise<OrgAdminView> {
    return this.orgs.addAdmin(u, id, dto, req.ip);
  }

  @Get('organization-invoices')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: [OrgInvoiceView] })
  invoicesList(@CurrentUser() u: AuthUser, @Query() q: OrganizationQuery): Promise<OrgInvoiceView[]> {
    return this.invoices.listForPartner(u, undefined, q.partnerId);
  }

  @Get('organizations/:id/invoices')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: [OrgInvoiceView] })
  async orgInvoices(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrgInvoiceView[]> {
    const org = await this.orgs.getForPartner(u, id);
    return this.invoices.listForPartner(u, org.id);
  }

  @Post('organizations/:id/invoices')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Issue the month’s invoice now (the run on the 1st does it otherwise)' })
  @ApiCreatedResponse({ type: OrgInvoiceDetailView })
  async issue(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueOrgInvoiceDto): Promise<OrgInvoiceDetailView> {
    const org = await this.orgs.getForPartner(u, id);
    return this.invoices.detail(await this.invoices.issue(org, dto.month, u));
  }

  @Get('organization-invoices/:id')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: OrgInvoiceDetailView })
  async invoice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrgInvoiceDetailView> {
    return this.invoices.detail(await this.invoices.getForPartner(u, id));
  }

  @Get('organization-invoices/:id/html')
  @Roles('super_admin', 'partner_admin')
  @Header('Cache-Control', 'private, no-store')
  async invoiceHtml(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    res.type('html').send(await this.invoices.html(await this.invoices.getForPartner(u, id)));
  }

  @Post('organization-invoices/:id/pay')
  @HttpCode(200)
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Record the organization’s transfer' })
  @ApiOkResponse({ type: OrgInvoiceView })
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayOrgInvoiceDto, @Req() req: Request): Promise<OrgInvoiceView> {
    return this.invoices.pay(u, id, dto, req.ip);
  }

  @Post('organization-invoices/run/:month')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Run the monthly invoicing for a month again (it only bills what was not billed)' })
  run(@Param('month') month: string): Promise<{ issued: number }> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('VALIDATION_FAILED', {}, ['month must be YYYY-MM']);
    return this.invoices.issueAll(month);
  }
}

/** The organization's own dashboard: its members, their attendance, and its invoices. */
@ApiTags('organization')
@ApiBearerAuth()
@Roles('org_admin')
@Controller('v1/org')
export class OrgPortalController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly invoices: OrgInvoicesService,
  ) {}

  @Get()
  @ApiOkResponse({ type: OrgProfileView })
  profile(@CurrentUser() u: AuthUser): Promise<OrgProfileView> {
    return this.orgs.profile(u);
  }

  @Get('members')
  @ApiOkResponse({ type: [MemberView] })
  async members(@CurrentUser() u: AuthUser, @Query() q: MemberQuery): Promise<MemberView[]> {
    return this.orgs.members((await this.orgs.orgOf(u)).id, q);
  }

  @Post('members')
  @ApiOperation({ summary: 'Add someone the organization pays for, by the phone they use in the rider app' })
  @ApiCreatedResponse({ type: MemberView })
  addMember(@CurrentUser() u: AuthUser, @Body() dto: AddMemberDto): Promise<MemberView> {
    return this.orgs.addMember(u, dto);
  }

  @Post('members/bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add up to 500 members at once (e.g. pasted from a spreadsheet)' })
  @ApiOkResponse({ type: BulkResultView })
  bulk(@CurrentUser() u: AuthUser, @Body() dto: BulkMembersDto): Promise<BulkResultView> {
    return this.orgs.bulk(u, dto);
  }

  @Delete('members/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop paying for a member from their next period' })
  @ApiNoContentResponse()
  removeMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.orgs.removeMember(u, id);
  }

  @Get('attendance')
  @ApiOperation({ summary: 'Trips per member in a date range (92 days at most)' })
  @ApiOkResponse({ type: AttendanceView })
  async attendance(@CurrentUser() u: AuthUser, @Query() q: AttendanceQuery): Promise<AttendanceView> {
    return this.orgs.attendance((await this.orgs.orgOf(u)).id, q);
  }

  @Get('attendance.csv')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Every trip in the range as a spreadsheet' })
  async attendanceCsv(@CurrentUser() u: AuthUser, @Query() q: AttendanceQuery, @Res() res: Response): Promise<void> {
    const csv = await this.orgs.attendanceCsv((await this.orgs.orgOf(u)).id, q);
    res.type('text/csv; charset=utf-8').attachment(`attendance-${q.from}-${q.to}.csv`).send(csv);
  }

  @Get('invoices')
  @ApiOkResponse({ type: [OrgInvoiceView] })
  async invoicesList(@CurrentUser() u: AuthUser): Promise<OrgInvoiceView[]> {
    return this.invoices.listForOrg((await this.orgs.orgOf(u)).id);
  }

  @Get('invoices/:id')
  @ApiOkResponse({ type: OrgInvoiceDetailView })
  async invoice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrgInvoiceDetailView> {
    return this.invoices.detail(await this.invoices.getForOrg((await this.orgs.orgOf(u)).id, id));
  }

  @Get('invoices/:id/html')
  @Header('Cache-Control', 'private, no-store')
  async invoiceHtml(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    res.type('html').send(await this.invoices.html(await this.invoices.getForOrg((await this.orgs.orgOf(u)).id, id)));
  }
}

@Global()
@Module({
  controllers: [AdminOrganizationsController, OrgPortalController],
  providers: [OrganizationsService, OrgInvoicesService],
  exports: [OrganizationsService, OrgInvoicesService],
})
export class OrganizationsModule {}
