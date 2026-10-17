import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { partnerScope } from '../common/tenant';
import { ComplianceService, ScanResult } from './compliance.service';
import { DocumentsService, UploadedBlob } from './documents.service';
import {
  DocumentView,
  DriverDetail,
  DriverPage,
  DriverProfileDto,
  ExpiringItem,
  ExpiringQuery,
  JoinPartnerDto,
  ListDriversQuery,
  OnboardingView,
  RejectDriverDto,
  ReviewDocumentDto,
  UploadDocumentDto,
  VehicleDto,
} from './drivers.dto';
import { OnboardingService } from './onboarding.service';
import { presentDocument } from './presenters';
import { ReviewService } from './review.service';

/** Hard cap at the HTTP layer; the configured limit (UPLOAD_MAX_MB) is checked in the service. */
const UPLOAD_HARD_CAP = 25 * 1024 * 1024;

@ApiTags('driver: onboarding')
@ApiBearerAuth()
@Roles('driver')
@Controller('v1/driver')
export class DriverOnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly docs: DocumentsService,
  ) {}

  @Get('onboarding')
  @ApiOperation({ summary: 'Everything the driver app needs to show the onboarding checklist' })
  @ApiOkResponse({ type: OnboardingView })
  view(@CurrentUser() user: AuthUser): Promise<OnboardingView> {
    return this.onboarding.view(user.id);
  }

  @Post('onboarding/join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join a transport partner with its join code' })
  @ApiOkResponse({ type: OnboardingView })
  join(@CurrentUser() user: AuthUser, @Body() dto: JoinPartnerDto): Promise<OnboardingView> {
    return this.onboarding.join(user.id, dto.code);
  }

  @Put('onboarding/profile')
  @ApiOkResponse({ type: OnboardingView })
  profile(@CurrentUser() user: AuthUser, @Body() dto: DriverProfileDto): Promise<OnboardingView> {
    return this.onboarding.saveProfile(user.id, dto);
  }

  @Put('onboarding/vehicle')
  @ApiOkResponse({ type: OnboardingView })
  vehicle(@CurrentUser() user: AuthUser, @Body() dto: VehicleDto): Promise<OnboardingView> {
    return this.onboarding.saveVehicle(user.id, dto);
  }

  @Post('onboarding/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the application to the partner for review' })
  @ApiOkResponse({ type: OnboardingView })
  submit(@CurrentUser() user: AuthUser): Promise<OnboardingView> {
    return this.onboarding.submit(user.id);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_CAP, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string' },
        expiresAt: { type: 'string', format: 'date' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a document (JPG, PNG or PDF). Replaces the previous one of the same type.' })
  @ApiOkResponse({ type: DocumentView })
  async upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: UploadedBlob,
  ): Promise<DocumentView> {
    const row = await this.docs.upload(user.id, dto.type, dto.expiresAt, file);
    return presentDocument(row);
  }
}

@ApiTags('documents')
@ApiBearerAuth()
@Controller('v1/documents')
export class DocumentFilesController {
  constructor(private readonly docs: DocumentsService) {}

  @Get(':id/file')
  @ApiOperation({ summary: 'Download a document file (its driver, the partner’s staff, or a platform admin)' })
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const { doc, stream } = await this.docs.openForViewer(user, id);
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Length', String(doc.sizeBytes));
    res.setHeader('Content-Disposition', `inline; filename="${doc.type}.${doc.mime.split('/')[1]}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}

@ApiTags('admin: drivers')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminDriversController {
  constructor(
    private readonly review: ReviewService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get('drivers')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOperation({ summary: 'Drivers of the partner; applications waiting for review come first' })
  @ApiOkResponse({ type: DriverPage })
  list(@CurrentUser() user: AuthUser, @Query() q: ListDriversQuery): Promise<DriverPage> {
    return this.review.list(user, q);
  }

  @Get('drivers/:id')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: DriverDetail })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<DriverDetail> {
    return this.review.detail(user, id);
  }

  @Post('drivers/:id/approve')
  @HttpCode(200)
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Approve the application and accept its pending documents' })
  @ApiOkResponse({ type: DriverDetail })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request): Promise<DriverDetail> {
    return this.review.approve(user, id, req.ip);
  }

  @Post('drivers/:id/reject')
  @HttpCode(200)
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Send the application back with reasons' })
  @ApiOkResponse({ type: DriverDetail })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDriverDto,
    @Req() req: Request,
  ): Promise<DriverDetail> {
    return this.review.reject(user, id, dto, req.ip);
  }

  @Patch('documents/:id')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Accept or reject one document (for renewals after approval)' })
  @ApiOkResponse({ type: DriverDetail })
  reviewDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: Request,
  ): Promise<DriverDetail> {
    return this.review.reviewDocument(user, id, dto, req.ip);
  }

  @Get('compliance/expiring')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOperation({ summary: 'Approved drivers’ documents expiring within N days, expired ones included' })
  @ApiOkResponse({ type: [ExpiringItem] })
  expiring(@CurrentUser() user: AuthUser, @Query() q: ExpiringQuery): Promise<ExpiringItem[]> {
    return this.compliance.expiring(q.days, partnerScope(user, q.partnerId));
  }

  @Post('compliance/scan')
  @HttpCode(200)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Run the daily compliance scan now' })
  scan(): Promise<ScanResult> {
    return this.compliance.scan();
  }
}
