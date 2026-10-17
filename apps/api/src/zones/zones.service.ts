import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { DB, Database } from '../database/database.module';
import { partners, Plan, plans, zones } from '../database/schema';
import {
  CoverageView,
  CreatePlanDto,
  CreateZoneDto,
  GeoJsonPolygon,
  PlanView,
  UpdatePlanDto,
  UpdateZoneDto,
  ZoneView,
} from './zones.dto';

/** Rough bounding box of Saudi Arabia; catches swapped lat/lng and stray points. */
const KSA = { minLng: 34.4, maxLng: 55.7, minLat: 16.3, maxLat: 32.2 };
/** A service area is a neighbourhood or a district, not a region. */
const MAX_AREA_KM2 = 1500;

@Injectable()
export class ZonesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ zones

  async list(actor: AuthUser, requestedPartner?: string): Promise<ZoneView[]> {
    const scope = partnerScope(actor, requestedPartner);
    const rows = await this.selectZones(scope ? eq(zones.partnerId, scope) : undefined);
    return this.withPlanCounts(rows);
  }

  async create(actor: AuthUser, dto: CreateZoneDto, ip?: string): Promise<ZoneView> {
    const partnerId = this.targetPartner(actor, dto.partnerId);
    const geojson = await this.validArea(dto.area);
    const [row] = await this.db
      .insert(zones)
      .values({
        partnerId,
        nameAr: dto.nameAr.trim(),
        nameEn: dto.nameEn.trim(),
        area: sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)` as unknown as string,
      })
      .returning({ id: zones.id });
    await this.audit.record({ actorId: actor.id, partnerId, action: 'zone.create', entity: 'zone', entityId: row.id, after: dto, ip });
    return this.get(row.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateZoneDto, ip?: string): Promise<ZoneView> {
    const before = await this.get(id);
    assertPartnerAccess(actor, before.partnerId);
    const set: Record<string, unknown> = {};
    if (dto.nameAr !== undefined) set.nameAr = dto.nameAr.trim();
    if (dto.nameEn !== undefined) set.nameEn = dto.nameEn.trim();
    if (dto.active !== undefined) set.active = dto.active;
    if (dto.area) set.area = sql`ST_SetSRID(ST_GeomFromGeoJSON(${await this.validArea(dto.area)}), 4326)`;
    if (Object.keys(set).length > 0) {
      await this.db.update(zones).set(set).where(eq(zones.id, id));
      await this.audit.record({
        actorId: actor.id,
        partnerId: before.partnerId,
        action: 'zone.update',
        entity: 'zone',
        entityId: id,
        before: { nameAr: before.nameAr, nameEn: before.nameEn, active: before.active },
        after: dto,
        ip,
      });
    }
    return this.get(id);
  }

  /** Active zones of active partners that contain the point, with their active plans. */
  async coverage(lat: number, lng: number): Promise<CoverageView[]> {
    const point = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
    const found = await this.db
      .select({
        zoneId: zones.id,
        zoneNameAr: zones.nameAr,
        zoneNameEn: zones.nameEn,
        partnerId: partners.id,
        partnerNameAr: partners.nameAr,
        partnerNameEn: partners.nameEn,
      })
      .from(zones)
      .innerJoin(partners, eq(partners.id, zones.partnerId))
      .where(and(eq(zones.active, true), eq(partners.status, 'active'), sql`ST_Contains(${zones.area}, ${point})`));
    if (found.length === 0) return [];
    const planRows = await this.db
      .select()
      .from(plans)
      .where(and(inArray(plans.zoneId, found.map((z) => z.zoneId)), eq(plans.active, true)))
      .orderBy(asc(plans.priceHalalas));
    return found.map((z) => ({ ...z, plans: planRows.filter((p) => p.zoneId === z.zoneId).map(presentPlan) }));
  }

  // ------------------------------------------------------------------ plans

  async listPlans(actor: AuthUser, requestedPartner?: string): Promise<PlanView[]> {
    const scope = partnerScope(actor, requestedPartner);
    const rows = await this.db
      .select()
      .from(plans)
      .where(scope ? eq(plans.partnerId, scope) : undefined)
      .orderBy(asc(plans.zoneId), asc(plans.priceHalalas));
    return rows.map(presentPlan);
  }

  async createPlan(actor: AuthUser, dto: CreatePlanDto, ip?: string): Promise<PlanView> {
    const zone = await this.get(dto.zoneId);
    assertPartnerAccess(actor, zone.partnerId);
    const [row] = await this.db
      .insert(plans)
      .values({ ...dto, nameAr: dto.nameAr.trim(), nameEn: dto.nameEn.trim(), partnerId: zone.partnerId })
      .returning();
    await this.audit.record({ actorId: actor.id, partnerId: zone.partnerId, action: 'plan.create', entity: 'plan', entityId: row.id, after: row, ip });
    return presentPlan(row);
  }

  async updatePlan(actor: AuthUser, id: string, dto: UpdatePlanDto, ip?: string): Promise<PlanView> {
    const before = await this.db.query.plans.findFirst({ where: eq(plans.id, id) });
    if (!before) throw new AppError('PLAN_NOT_FOUND');
    try {
      assertPartnerAccess(actor, before.partnerId);
    } catch {
      throw new AppError('PLAN_NOT_FOUND');
    }
    const [row] = await this.db.update(plans).set(dto).where(eq(plans.id, id)).returning();
    await this.audit.record({ actorId: actor.id, partnerId: before.partnerId, action: 'plan.update', entity: 'plan', entityId: id, before, after: row, ip });
    return presentPlan(row);
  }

  // ------------------------------------------------------------------ helpers

  private async get(id: string): Promise<ZoneView> {
    const [row] = await this.selectZones(eq(zones.id, id));
    if (!row) throw new AppError('ZONE_NOT_FOUND');
    const [withCounts] = await this.withPlanCounts([row]);
    return withCounts;
  }

  private async selectZones(where: ReturnType<typeof eq> | undefined) {
    const rows = await this.db
      .select({
        id: zones.id,
        partnerId: zones.partnerId,
        nameAr: zones.nameAr,
        nameEn: zones.nameEn,
        active: zones.active,
        geojson: sql<string>`ST_AsGeoJSON(${zones.area}, 6)`,
        areaKm2: sql<number>`ROUND((ST_Area(${zones.area}::geography) / 1e6)::numeric, 2)::float8`,
      })
      .from(zones)
      .where(where)
      .orderBy(asc(zones.nameAr));
    return rows.map((r) => ({
      id: r.id,
      partnerId: r.partnerId,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      active: r.active,
      area: JSON.parse(r.geojson) as GeoJsonPolygon,
      areaKm2: Number(r.areaKm2),
      planCount: 0,
    }));
  }

  private async withPlanCounts(rows: ZoneView[]): Promise<ZoneView[]> {
    if (rows.length === 0) return rows;
    const counts = await this.db
      .select({ zoneId: plans.zoneId, n: count() })
      .from(plans)
      .where(and(inArray(plans.zoneId, rows.map((r) => r.id)), eq(plans.active, true)))
      .groupBy(plans.zoneId);
    const byZone = new Map(counts.map((c) => [c.zoneId, c.n]));
    return rows.map((r) => ({ ...r, planCount: byZone.get(r.id) ?? 0 }));
  }

  private targetPartner(actor: AuthUser, requested?: string): string {
    const scope = partnerScope(actor, requested);
    if (!scope) throw new AppError('VALIDATION_FAILED', {}, ['partnerId is required']);
    return scope;
  }

  /** Checks shape, location and size; returns the GeoJSON string to store. */
  private async validArea(area: GeoJsonPolygon): Promise<string> {
    const ring = area.coordinates[0];
    const pointsOk =
      Array.isArray(ring) &&
      ring.length >= 3 &&
      ring.length <= 500 &&
      ring.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
          p[0] >= KSA.minLng &&
          p[0] <= KSA.maxLng &&
          p[1] >= KSA.minLat &&
          p[1] <= KSA.maxLat,
      );
    if (!pointsOk) throw new AppError('ZONE_INVALID');

    const closed = [...ring];
    const [fx, fy] = closed[0];
    const [lx, ly] = closed[closed.length - 1];
    if (fx !== lx || fy !== ly) closed.push([fx, fy]);
    if (closed.length < 4) throw new AppError('ZONE_INVALID');
    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [closed] });

    const result = await this.db.execute<{ valid: boolean; km2: number }>(
      sql`SELECT ST_IsValid(g) AS valid, ST_Area(g::geography) / 1e6 AS km2
          FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS g) s`,
    );
    const { valid, km2 } = result.rows[0];
    if (!valid || Number(km2) <= 0 || Number(km2) > MAX_AREA_KM2) throw new AppError('ZONE_INVALID');
    return geojson;
  }
}

export function presentPlan(p: Plan): PlanView {
  return {
    id: p.id,
    partnerId: p.partnerId,
    zoneId: p.zoneId,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    tripType: p.tripType,
    daysPerWeek: p.daysPerWeek,
    priceHalalas: p.priceHalalas,
    maxDistanceKm: p.maxDistanceKm,
    active: p.active,
  };
}
