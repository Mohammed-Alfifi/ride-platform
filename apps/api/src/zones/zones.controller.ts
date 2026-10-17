import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import {
  CoverageView,
  CreatePlanDto,
  CreateZoneDto,
  PlanView,
  PointQuery,
  UpdatePlanDto,
  UpdateZoneDto,
  ZoneScopeQuery,
  ZoneView,
} from './zones.dto';
import { ZonesService } from './zones.service';

@ApiTags('admin: zones and plans')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get('zones')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: [ZoneView] })
  list(@CurrentUser() user: AuthUser, @Query() q: ZoneScopeQuery): Promise<ZoneView[]> {
    return this.zones.list(user, q.partnerId);
  }

  @Post('zones')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Draw a service area (GeoJSON polygon)' })
  @ApiOkResponse({ type: ZoneView })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateZoneDto, @Req() req: Request): Promise<ZoneView> {
    return this.zones.create(user, dto, req.ip);
  }

  @Patch('zones/:id')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: ZoneView })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateZoneDto,
    @Req() req: Request,
  ): Promise<ZoneView> {
    return this.zones.update(user, id, dto, req.ip);
  }

  @Get('plans')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: [PlanView] })
  plans(@CurrentUser() user: AuthUser, @Query() q: ZoneScopeQuery): Promise<PlanView[]> {
    return this.zones.listPlans(user, q.partnerId);
  }

  @Post('plans')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: PlanView })
  createPlan(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto, @Req() req: Request): Promise<PlanView> {
    return this.zones.createPlan(user, dto, req.ip);
  }

  @Patch('plans/:id')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: PlanView })
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: Request,
  ): Promise<PlanView> {
    return this.zones.updatePlan(user, id, dto, req.ip);
  }
}

@ApiTags('coverage')
@ApiBearerAuth()
@Controller('v1/coverage')
export class CoverageController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @ApiOperation({ summary: 'Is this location served? Returns the areas covering it and their plans' })
  @ApiOkResponse({ type: [CoverageView] })
  coverage(@Query() q: PointQuery): Promise<CoverageView[]> {
    return this.zones.coverage(q.lat, q.lng);
  }
}

@Module({
  controllers: [AdminZonesController, CoverageController],
  providers: [ZonesService],
})
export class ZonesModule {}
