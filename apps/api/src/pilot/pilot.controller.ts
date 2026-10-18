import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AccessService } from '../auth/access.service';
import type { AuthUser, RequestMeta } from '../auth/auth.types';
import { CurrentUser, Public, ReqMeta, Roles } from '../auth/decorators';
import { AUDIENCES, type Audience } from '../database/schema';
import { PilotService } from './pilot.service';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class JoinDto {
  @ApiProperty({ enum: ['rider', 'driver'] }) @IsIn(['rider', 'driver']) kind!: 'rider' | 'driver';
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ example: '0501234567' }) @IsString() @MaxLength(24) phone!: string;
  @ApiProperty({ example: 'الرياض' }) @IsString() @Length(2, 60) city!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string;
  @ApiPropertyOptional({ description: 'School or workplace' }) @IsOptional() @IsString() @MaxLength(120) destination?: string;
  @ApiPropertyOptional({ example: '06:30' }) @IsOptional() @Matches(TIME) morningTime?: string;
  @ApiPropertyOptional({ example: '13:30' }) @IsOptional() @Matches(TIME) returnTime?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) riders?: number;
  @ApiPropertyOptional({ description: 'Drivers: car model and year' }) @IsOptional() @IsString() @MaxLength(80) car?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ description: 'Leave empty' }) @IsOptional() @IsString() @MaxLength(200) website?: string;
}

class JoinQuery {
  @ApiPropertyOptional({ enum: ['new', 'invited', 'declined'] }) @IsOptional() @IsIn(['new', 'invited', 'declined']) status?: 'new' | 'invited' | 'declined';
  @ApiPropertyOptional({ enum: ['rider', 'driver'] }) @IsOptional() @IsIn(['rider', 'driver']) kind?: 'rider' | 'driver';
}

class InviteDto {
  @ApiProperty({ example: '0501234567' }) @IsString() @MaxLength(24) phone!: string;
  @ApiProperty({ enum: AUDIENCES }) @IsIn(AUDIENCES as unknown as string[]) audience!: Audience;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Platform admins only' }) @IsOptional() @IsUUID() partnerId?: string;
}

class InviteQuery {
  @ApiPropertyOptional({ enum: AUDIENCES }) @IsOptional() @IsIn(AUDIENCES as unknown as string[]) audience?: Audience;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) search?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() partnerId?: string;
}

class TermsDto {
  @ApiProperty({ example: '2026-10' }) @IsString() @Length(1, 20) version!: string;
}

@ApiTags('public: app')
@Public()
@Controller('v1')
export class PublicPilotController {
  constructor(private readonly pilot: PilotService) {}

  @Get('app-config')
  @ApiOperation({ summary: 'How this server runs: sign-in method, payment mode, links, support contact' })
  config() {
    return this.pilot.appConfig();
  }

  @Post('join')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Public join form: a family, an employee or a driver asks to take part' })
  join(@Body() dto: JoinDto) {
    return this.pilot.submitJoin(dto);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('v1/me')
export class MePilotController {
  constructor(private readonly pilot: PilotService) {}

  @Post('terms')
  @HttpCode(204)
  @ApiOperation({ summary: 'Record that the user accepted this version of the terms and privacy policy' })
  async terms(@CurrentUser() u: AuthUser, @Body() dto: TermsDto): Promise<void> {
    await this.pilot.acceptTerms(u.id, dto.version);
  }

  @Delete()
  @HttpCode(204)
  @Roles('rider', 'driver')
  @ApiOperation({ summary: 'Delete my account (riders: no running subscription; drivers: no trips left today)' })
  async remove(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.pilot.deleteAccount(u, meta.ip ?? null);
  }
}

@ApiTags('admin: pilot')
@ApiBearerAuth()
@Roles('super_admin', 'partner_admin')
@Controller('v1/admin')
export class AdminPilotController {
  constructor(
    private readonly pilot: PilotService,
    private readonly access: AccessService,
  ) {}

  @Get('join-requests')
  joinRequests(@CurrentUser() u: AuthUser, @Query() q: JoinQuery) {
    return this.pilot.joinRequests(u, q);
  }

  @Post('join-requests/:id/invite')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve: invite the phone and get the WhatsApp message with the access code' })
  invite(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.pilot.inviteFromRequest(u, id, meta.ip ?? null);
  }

  @Post('join-requests/:id/decline')
  @HttpCode(204)
  async decline(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.pilot.declineRequest(u, id);
  }

  @Get('access')
  @ApiOperation({ summary: 'Invited phones (invite-only pilot)' })
  invites(@CurrentUser() u: AuthUser, @Query() q: InviteQuery) {
    return this.access.list(u, q);
  }

  @Post('access')
  @HttpCode(200)
  @ApiOperation({ summary: 'Invite a phone directly and get its access code (shown once)' })
  create(@CurrentUser() u: AuthUser, @Body() dto: InviteDto, @ReqMeta() meta: RequestMeta) {
    return this.access.invite(u, dto, meta.ip ?? null);
  }

  @Post('access/:id/code')
  @HttpCode(200)
  @ApiOperation({ summary: 'A new access code, e.g. after the person changed phone or signed out' })
  code(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.access.newCode(u, id);
  }

  @Delete('access/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the invite and sign the person out' })
  async revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.access.revoke(u, id, meta.ip ?? null);
  }
}
