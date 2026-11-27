import { Body, Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ExportQuery, LicenseView, LicenseParams, UpsertLicenseDto } from './compliance.dto';
import { LicensesService } from './licenses.service';
import { ManualExportGateway, REGULATOR_GATEWAY, RegulatorBatch, RegulatorService } from './regulator';

@ApiTags('admin: compliance')
@ApiBearerAuth()
@Controller('v1/admin')
export class ComplianceController {
  constructor(
    private readonly licenses: LicensesService,
    private readonly regulator: RegulatorService,
  ) {}

  @Get('partners/:partnerId/licenses')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: [LicenseView] })
  list(@CurrentUser() u: AuthUser, @Param('partnerId', ParseUUIDPipe) partnerId: string): Promise<LicenseView[]> {
    return this.licenses.list(u, partnerId);
  }

  @Put('partners/:partnerId/licenses/:serviceClass')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Enter or renew a licence; it waits for platform verification again' })
  @ApiOkResponse({ type: LicenseView })
  upsert(
    @CurrentUser() u: AuthUser,
    @Param() p: LicenseParams,
    @Body() dto: UpsertLicenseDto,
    @Req() req: Request,
  ): Promise<LicenseView> {
    return this.licenses.upsert(u, p.partnerId, p.serviceClass, dto, req.ip);
  }

  @Post('partners/:partnerId/licenses/:serviceClass/verify')
  @HttpCode(200)
  @Roles('super_admin')
  @ApiOperation({ summary: "Confirm the licence against the authority's records" })
  @ApiOkResponse({ type: LicenseView })
  verify(
    @CurrentUser() u: AuthUser,
    @Param() p: LicenseParams,
    @Req() req: Request,
  ): Promise<LicenseView> {
    return this.licenses.verify(u, p.partnerId, p.serviceClass, req.ip);
  }

  @Get('regulator/export')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Drivers, vehicles and trips of a period for the transport authority (contains national IDs)' })
  export(@CurrentUser() u: AuthUser, @Query() q: ExportQuery, @Req() req: Request): Promise<RegulatorBatch> {
    return this.regulator.export(u, q.partnerId, q.from, q.to, req.ip);
  }

  @Post('regulator/submit')
  @HttpCode(200)
  @Roles('super_admin')
  @ApiOperation({ summary: "Send a period's batch through the configured authority connector" })
  submit(@CurrentUser() u: AuthUser, @Query() q: ExportQuery, @Req() req: Request) {
    return this.regulator.submit(u, q.partnerId, q.from, q.to, req.ip);
  }
}

/** Global so plans, subscriptions and dispatch can ask whether a class may be sold. */
@Global()
@Module({
  controllers: [ComplianceController],
  providers: [LicensesService, RegulatorService, { provide: REGULATOR_GATEWAY, useClass: ManualExportGateway }],
  exports: [LicensesService],
})
export class ComplianceModule {}
