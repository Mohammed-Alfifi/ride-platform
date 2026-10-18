import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { TripGenerator } from './trip.generator';
import { BOARD_VIEWS, BoardView, LiveView, TripsService, TripView } from './trips.service';

class DayQuery {
  @ApiPropertyOptional({ example: '2026-10-19', description: 'Riyadh calendar day; today when omitted' })
  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;
}

class RangeQuery {
  @ApiPropertyOptional({ example: '2026-10-19' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  days?: number;
}

class BoardQuery extends DayQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ enum: BOARD_VIEWS, description: 'Which trips to list (the counters always cover the whole day)' })
  @IsOptional()
  @IsIn(BOARD_VIEWS as unknown as string[])
  view?: BoardView;
}

class LocationPoint {
  @ApiProperty() @IsLatitude() lat!: number;
  @ApiProperty() @IsLongitude() lng!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(360) heading?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(250) speedKmh?: number;
  @ApiPropertyOptional({ description: 'When the phone recorded it' }) @IsOptional() @IsISO8601() at?: string;
}

class LocationReport {
  @ApiProperty({ type: [LocationPoint], description: 'Points collected since the last report, oldest first' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => LocationPoint)
  points!: LocationPoint[];
}

class AssignDriverDto {
  @ApiProperty({ format: 'uuid', nullable: true, description: 'null removes the driver' })
  @IsOptional()
  @IsUUID()
  driverId!: string | null;
}

@ApiTags('driver: trips')
@ApiBearerAuth()
@Roles('driver')
@Controller('v1/driver')
export class DriverTripsController {
  constructor(private readonly trips: TripsService) {}

  @Get('trips')
  @ApiOperation({ summary: "The driver's trips for a day, in order" })
  list(@CurrentUser() u: AuthUser, @Query() q: DayQuery): Promise<TripView[]> {
    return this.trips.driverTrips(u.id, q.date);
  }

  @Post('trips/:id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'On the way to the pick-up (up to 90 minutes early)' })
  start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TripView> {
    return this.trips.start(u, id);
  }

  @Post('trips/:id/arrive')
  @HttpCode(200)
  @ApiOperation({ summary: 'At the pick-up (within 300 m when the location is known)' })
  arrive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TripView> {
    return this.trips.arrive(u, id);
  }

  @Post('trips/:id/pickup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rider on board' })
  pickup(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TripView> {
    return this.trips.pickUp(u, id);
  }

  @Post('trips/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dropped off (within 500 m of the drop-off when the location is known)' })
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TripView> {
    return this.trips.complete(u, id);
  }

  @Post('trips/:id/no-show')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rider did not come out (after waiting 5 minutes)' })
  noShow(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TripView> {
    return this.trips.noShow(u, id);
  }

  @Post('location')
  @HttpCode(200)
  @ApiOperation({ summary: 'Location updates while the app is open (every 5-10 seconds)' })
  location(@CurrentUser() u: AuthUser, @Body() body: LocationReport): Promise<{ activeTripId: string | null }> {
    return this.trips.report(u.id, body.points);
  }
}

@ApiTags('rider: trips')
@ApiBearerAuth()
@Roles('rider')
@Controller('v1/trips')
export class RiderTripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @ApiOperation({ summary: 'Upcoming trips (today and the next days)' })
  list(@CurrentUser() u: AuthUser, @Query() q: RangeQuery): Promise<TripView[]> {
    return this.trips.riderTrips(u.id, q.from, q.days);
  }

  @Get(':id/live')
  @ApiOperation({ summary: 'Trip with the driver location and arrival estimate; poll every 5 seconds' })
  live(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<LiveView> {
    return this.trips.riderLive(u.id, id);
  }

  @Post(':id/skip')
  @HttpCode(200)
  @ApiOperation({ summary: 'Do not need this trip (up to 30 minutes before it)' })
  skip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TripView> {
    return this.trips.skip(u.id, id);
  }
}

@ApiTags('admin: dispatch')
@ApiBearerAuth()
@Roles('super_admin', 'partner_admin', 'dispatcher')
@Controller('v1/admin')
export class DispatchController {
  constructor(
    private readonly trips: TripsService,
    private readonly generator: TripGenerator,
  ) {}

  @Get('dispatch')
  @ApiOperation({ summary: "The day's trips, drivers and their live positions; poll every 10 seconds" })
  board(@CurrentUser() u: AuthUser, @Query() q: BoardQuery) {
    return this.trips.board(u, q);
  }

  @Get('trips/:id/live')
  live(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.adminLive(u, id);
  }

  @Patch('trips/:id/driver')
  @ApiOperation({ summary: 'Give one trip to another driver (a substitute for the day)' })
  assignTrip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignDriverDto): Promise<TripView> {
    return this.trips.assignTrip(u, id, body.driverId ?? null);
  }

  @Patch('subscriptions/:id/driver')
  @ApiOperation({ summary: "Set the rider's regular driver" })
  assignSubscription(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignDriverDto) {
    return this.trips.assignSubscription(u, id, body.driverId ?? null);
  }

  @Post('trips/generate')
  @HttpCode(200)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Create today and tomorrow trips now (normally nightly at 00:10)' })
  async generate(): Promise<{ created: number }> {
    return { created: await this.generator.generate() };
  }
}
