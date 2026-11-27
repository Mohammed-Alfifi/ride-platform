import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { partnerScope } from '../common/tenant';
import { DriverSuggestionView, PlanRunsDto, RunsQuery, RunView, SubstituteView } from './runs.dto';
import { RunsService } from './runs.service';

@ApiTags('dispatch: runs')
@ApiBearerAuth()
@Controller('v1/admin')
@Roles('super_admin', 'partner_admin', 'dispatcher')
export class RunsAdminController {
  constructor(private readonly runs: RunsService) {}

  @Get('runs')
  @ApiOperation({ summary: "A day's runs: each car's riders in planned order with times" })
  @ApiOkResponse({ type: [RunView] })
  list(@CurrentUser() u: AuthUser, @Query() q: RunsQuery): Promise<RunView[]> {
    return this.runs.list(u, q.date, q.partnerId, q.driverId);
  }

  @Post('runs/plan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-plan the runs of a day now (runs already started are kept)' })
  plan(@CurrentUser() u: AuthUser, @Body() dto: PlanRunsDto) {
    const partnerId = partnerScope(u, dto.partnerId);
    return this.runs.planDay(dto.date, { partnerId: partnerId ?? undefined });
  }

  @Get('subscriptions/:id/driver-suggestions')
  @ApiOperation({ summary: 'Best drivers for a rider: qualified, a free seat, the smallest detour' })
  @ApiOkResponse({ type: [DriverSuggestionView] })
  suggest(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<DriverSuggestionView[]> {
    return this.runs.suggestDrivers(u, id);
  }

  @Get('trips/:id/substitutes')
  @ApiOperation({ summary: 'Drivers who can take this trip now, nearest first' })
  @ApiOkResponse({ type: [SubstituteView] })
  substitutes(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SubstituteView[]> {
    return this.runs.substitutes(u, id);
  }
}

@ApiTags('driver: runs')
@ApiBearerAuth()
@Roles('driver')
@Controller('v1/driver')
export class DriverRunsController {
  constructor(private readonly runs: RunsService) {}

  @Get('runs/today')
  @ApiOperation({ summary: "Today's runs, stops in the order to drive them" })
  @ApiOkResponse({ type: [RunView] })
  today(@CurrentUser() u: AuthUser): Promise<RunView[]> {
    return this.runs.forDriver(u);
  }
}
