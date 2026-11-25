import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class RunStopView {
  @ApiProperty() seq!: number;
  @ApiProperty({ enum: ['pickup', 'dropoff'] }) kind!: 'pickup' | 'dropoff';
  @ApiProperty() tripId!: string;
  @ApiProperty() tripStatus!: string;
  @ApiProperty() place!: string;
  @ApiProperty({ nullable: true, type: String }) rider!: string | null;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty() plannedAt!: string;
  @ApiProperty({ nullable: true, type: Number, description: 'Pick-ups: minutes from the time the rider chose' })
  offsetMinutes!: number | null;
}

export class RunView {
  @ApiProperty() id!: string;
  @ApiProperty() driverId!: string;
  @ApiProperty({ nullable: true, type: String }) driverName!: string | null;
  @ApiProperty() serviceDate!: string;
  @ApiProperty({ enum: ['outbound', 'return'] }) leg!: 'outbound' | 'return';
  @ApiProperty({ enum: ['planned', 'in_progress', 'completed', 'cancelled'] }) status!: string;
  @ApiProperty() plannedStartAt!: string;
  @ApiProperty() plannedEndAt!: string;
  @ApiProperty({ description: 'Driving time between stops' }) driveMinutes!: number;
  @ApiProperty({ description: 'Minutes past the latest pick-up time, all riders' }) lateMinutes!: number;
  @ApiProperty({ example: 'builtin' }) optimizer!: string;
  @ApiProperty({ example: 'osrm' }) routing!: string;
  @ApiProperty() riders!: number;
  @ApiProperty({ type: [RunStopView] }) stops!: RunStopView[];
}

export class DriverSuggestionView {
  @ApiProperty() driverId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty() seats!: number;
  @ApiProperty({ description: 'Riders already in the busier leg' }) riders!: number;
  @ApiProperty({ description: 'Minutes this rider adds to the driver’s day' }) addedMinutes!: number;
  @ApiProperty({ description: 'Every rider still picked up on time and within ride limits' }) fitsWindows!: boolean;
}

export class SubstituteView {
  @ApiProperty() driverId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true, type: Number, description: 'By road from the last known position' }) etaMinutes!: number | null;
  @ApiProperty({ nullable: true, type: String }) locationAt!: string | null;
}

export class RunsQuery {
  @ApiProperty({ example: '2026-11-26' })
  @IsDateString({ strict: true })
  date!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  driverId?: string;
}

export class PlanRunsDto {
  @ApiProperty({ example: '2026-11-26' })
  @IsDateString({ strict: true })
  date!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Super admins only' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}
