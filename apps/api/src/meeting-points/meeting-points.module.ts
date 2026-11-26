import { Body, Controller, Get, Global, Inject, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AppError } from '../common/errors';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { meetingPoints, zones } from '../database/schema';

export class CreateMeetingPointDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  zoneId!: string;

  @ApiProperty({ example: 'موقف جامع الرمال' })
  @IsString()
  @Length(2, 120)
  nameAr!: string;

  @ApiProperty({ example: 'Al Rimal mosque car park' })
  @IsString()
  @Length(2, 120)
  nameEn!: string;

  @ApiProperty({ example: 24.8661 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 46.8279 })
  @IsLongitude()
  lng!: number;
}

export class UpdateMeetingPointDto extends PartialType(CreateMeetingPointDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MeetingPointQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Super admins only' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class MeetingPointView {
  @ApiProperty() id!: string;
  @ApiProperty() zoneId!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty() active!: boolean;
}

/** The meeting point a rider walks to, and how far. */
export interface NearestPoint {
  point: MeetingPointView;
  walkMeters: number;
}

const columns = {
  id: meetingPoints.id,
  zoneId: meetingPoints.zoneId,
  partnerId: meetingPoints.partnerId,
  nameAr: meetingPoints.nameAr,
  nameEn: meetingPoints.nameEn,
  lat: sql<number>`ST_Y(${meetingPoints.location})`,
  lng: sql<number>`ST_X(${meetingPoints.location})`,
  active: meetingPoints.active,
};

function present(r: { id: string; zoneId: string; nameAr: string; nameEn: string; lat: number; lng: number; active: boolean }): MeetingPointView {
  return { id: r.id, zoneId: r.zoneId, nameAr: r.nameAr, nameEn: r.nameEn, lat: Number(r.lat), lng: Number(r.lng), active: r.active };
}

/**
 * Meeting points: spots inside a zone where riders of meeting-point plans gather. A rider is
 * given the nearest active one within MEETING_POINT_MAX_WALK_M of their pick-up place.
 */
@Injectable()
export class MeetingPointsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, q: MeetingPointQuery): Promise<MeetingPointView[]> {
    const partnerId = partnerScope(actor, q.partnerId);
    const rows = await this.db
      .select(columns)
      .from(meetingPoints)
      .where(and(partnerId ? eq(meetingPoints.partnerId, partnerId) : undefined, q.zoneId ? eq(meetingPoints.zoneId, q.zoneId) : undefined))
      .orderBy(asc(meetingPoints.nameAr));
    return rows.map(present);
  }

  async create(actor: AuthUser, dto: CreateMeetingPointDto, ip?: string): Promise<MeetingPointView> {
    const zone = await this.zoneFor(actor, dto.zoneId);
    await this.assertInside(zone.id, dto.lat, dto.lng);
    const [row] = await this.db
      .insert(meetingPoints)
      .values({
        partnerId: zone.partnerId,
        zoneId: zone.id,
        nameAr: dto.nameAr.trim(),
        nameEn: dto.nameEn.trim(),
        location: sql`ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)` as unknown as string,
      })
      .returning({ id: meetingPoints.id });
    await this.audit.record({ actorId: actor.id, partnerId: zone.partnerId, action: 'meeting_point.create', entity: 'meeting_point', entityId: row.id, after: dto, ip });
    return this.get(row.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateMeetingPointDto, ip?: string): Promise<MeetingPointView> {
    const before = await this.get(id);
    const [owner] = await this.db.select({ partnerId: meetingPoints.partnerId }).from(meetingPoints).where(eq(meetingPoints.id, id));
    assertPartnerAccess(actor, owner.partnerId);
    const zoneId = dto.zoneId ?? before.zoneId;
    if (dto.zoneId) await this.zoneFor(actor, dto.zoneId);
    const lat = dto.lat ?? before.lat;
    const lng = dto.lng ?? before.lng;
    if (dto.lat !== undefined || dto.lng !== undefined || dto.zoneId) await this.assertInside(zoneId, lat, lng);
    await this.db
      .update(meetingPoints)
      .set({
        zoneId,
        ...(dto.nameAr ? { nameAr: dto.nameAr.trim() } : {}),
        ...(dto.nameEn ? { nameEn: dto.nameEn.trim() } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        location: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)` as unknown as string,
      })
      .where(eq(meetingPoints.id, id));
    // Riders keep the point they subscribed with; a moved point moves their future trips' stop.
    await this.audit.record({ actorId: actor.id, partnerId: owner.partnerId, action: 'meeting_point.update', entity: 'meeting_point', entityId: id, before, after: dto, ip });
    return this.get(id);
  }

  async get(id: string): Promise<MeetingPointView> {
    const [row] = await this.db.select(columns).from(meetingPoints).where(eq(meetingPoints.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return present(row);
  }

  /** Active points in a zone. */
  async countActive(zoneId: string): Promise<number> {
    const [row] = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM meeting_points WHERE zone_id = ${zoneId} AND active`).then((r) => r.rows);
    return row?.n ?? 0;
  }

  /** The nearest active point of the zone to a rider's place, if it is within walking distance. */
  async nearest(zoneId: string, placeId: string): Promise<NearestPoint | null> {
    const [row] = await this.db
      .select({ ...columns, meters: sql<number>`ST_Distance(${meetingPoints.location}::geography, (SELECT location FROM places WHERE id = ${placeId})::geography)` })
      .from(meetingPoints)
      .where(and(eq(meetingPoints.zoneId, zoneId), eq(meetingPoints.active, true)))
      .orderBy(sql`${meetingPoints.location} <-> (SELECT location FROM places WHERE id = ${placeId})`)
      .limit(1);
    if (!row) return null;
    const walkMeters = Math.round(Number(row.meters));
    return walkMeters <= this.env.MEETING_POINT_MAX_WALK_M ? { point: present(row), walkMeters } : null;
  }

  private async zoneFor(actor: AuthUser, zoneId: string) {
    const zone = await this.db.query.zones.findFirst({ where: eq(zones.id, zoneId) });
    if (!zone) throw new AppError('NOT_FOUND');
    assertPartnerAccess(actor, zone.partnerId);
    return zone;
  }

  private async assertInside(zoneId: string, lat: number, lng: number): Promise<void> {
    const [row] = await this.db
      .execute<{ inside: boolean }>(sql`SELECT ST_Contains(area, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) AS inside FROM zones WHERE id = ${zoneId}`)
      .then((r) => r.rows);
    if (!row?.inside) throw new AppError('MEETING_POINT_OUTSIDE_ZONE');
  }
}

@ApiTags('admin: meeting points')
@ApiBearerAuth()
@Controller('v1/admin/meeting-points')
export class MeetingPointsController {
  constructor(private readonly points: MeetingPointsService) {}

  @Get()
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: [MeetingPointView] })
  list(@CurrentUser() u: AuthUser, @Query() q: MeetingPointQuery): Promise<MeetingPointView[]> {
    return this.points.list(u, q);
  }

  @Post()
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Add a meeting point inside a zone' })
  @ApiOkResponse({ type: MeetingPointView })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateMeetingPointDto, @Req() req: Request): Promise<MeetingPointView> {
    return this.points.create(u, dto, req.ip);
  }

  @Patch(':id')
  @Roles('super_admin', 'partner_admin')
  @ApiOkResponse({ type: MeetingPointView })
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMeetingPointDto, @Req() req: Request): Promise<MeetingPointView> {
    return this.points.update(u, id, dto, req.ip);
  }
}

@Global()
@Module({ controllers: [MeetingPointsController], providers: [MeetingPointsService], exports: [MeetingPointsService] })
export class MeetingPointsModule {}
