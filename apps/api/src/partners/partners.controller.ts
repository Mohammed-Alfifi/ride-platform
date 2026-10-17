import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { CreatePartnerDto, PartnerView, UpdatePartnerDto } from './partners.dto';
import { PartnersService } from './partners.service';

@ApiTags('admin: partners')
@ApiBearerAuth()
@Controller('v1/admin/partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOperation({ summary: 'All partners for super admins; the caller’s own partner otherwise' })
  @ApiOkResponse({ type: [PartnerView] })
  list(@CurrentUser() user: AuthUser): Promise<PartnerView[]> {
    return this.partners.list(user);
  }

  @Get(':id')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: PartnerView })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PartnerView> {
    return this.partners.get(user, id);
  }

  @Post()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Register a licensed transport partner' })
  @ApiCreatedResponse({ type: PartnerView })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePartnerDto, @Req() req: Request): Promise<PartnerView> {
    return this.partners.create(user, dto, req.ip);
  }

  @Patch(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Edit a partner or suspend it (signs out all its staff)' })
  @ApiOkResponse({ type: PartnerView })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerDto,
    @Req() req: Request,
  ): Promise<PartnerView> {
    return this.partners.update(user, id, dto, req.ip);
  }
}
