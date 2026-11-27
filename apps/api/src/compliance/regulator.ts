import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, between, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { decryptField } from '../common/crypto';
import { AppError } from '../common/errors';
import { daysBetween } from '../common/saudi';
import { partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { documents, driverProfiles, partnerLicenses, partners, plans, subscriptions, trips, users, vehicles } from '../database/schema';
import { isNull } from 'drizzle-orm';

/** What the platform hands the transport authority: who drove, in what, and which trips ran. */
export interface RegulatorBatch {
  generatedAt: string;
  period: { from: string; to: string };
  partner: { id: string; legalName: string | null; crNumber: string | null };
  licenses: { serviceClass: string; licenseNumber: string; unifiedCode: string | null; expiresAt: string; verified: boolean }[];
  drivers: {
    id: string;
    fullName: string | null;
    nationalId: string | null;
    dateOfBirth: string | null;
    phone: string;
    complianceHold: boolean;
    vehicle: { plate: string; make: string; model: string; year: number; seats: number } | null;
    documents: { type: string; expiresAt: string | null; status: string }[];
  }[];
  trips: {
    id: string;
    serviceClass: string;
    serviceDate: string;
    leg: string;
    status: string;
    driverId: string | null;
    scheduledAt: string;
    startedAt: string | null;
    pickedUpAt: string | null;
    completedAt: string | null;
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
  }[];
}

/**
 * Where batches go. The authority links each licensed provider to its systems with its own
 * specification; until that arrives, `manual-export` leaves the batch to be downloaded and filed.
 * A real connector implements this interface and is selected the way payment gateways are.
 */
export interface RegulatorGateway {
  readonly name: string;
  submit(batch: RegulatorBatch): Promise<{ accepted: boolean; reference: string | null }>;
}

export const REGULATOR_GATEWAY = Symbol('REGULATOR_GATEWAY');

export class ManualExportGateway implements RegulatorGateway {
  readonly name = 'manual-export';
  private readonly logger = new Logger('Regulator');
  async submit(batch: RegulatorBatch): Promise<{ accepted: boolean; reference: string | null }> {
    this.logger.log(`Batch for ${batch.partner.id} (${batch.period.from}..${batch.period.to}) ready for manual filing`);
    return { accepted: false, reference: null };
  }
}

const MAX_EXPORT_DAYS = 31;

@Injectable()
export class RegulatorService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(REGULATOR_GATEWAY) private readonly gateway: RegulatorGateway,
    private readonly audit: AuditService,
  ) {}

  /** Builds the batch for one partner and period. Contains full national IDs: admins only, audited. */
  async export(actor: AuthUser, requestedPartner: string | undefined, from: string, to: string, ip?: string): Promise<RegulatorBatch> {
    const partnerId = partnerScope(actor, requestedPartner);
    if (!partnerId) throw new AppError('VALIDATION_FAILED', {}, ['partnerId is required']);
    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_EXPORT_DAYS) {
      throw new AppError('VALIDATION_FAILED', {}, [`from..to must be 1 to ${MAX_EXPORT_DAYS} days`]);
    }
    const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, partnerId) });
    if (!partner) throw new AppError('NOT_FOUND');

    const licenses = await this.db.select().from(partnerLicenses).where(eq(partnerLicenses.partnerId, partnerId));
    const driverRows = await this.db
      .select({ profile: driverProfiles, phone: users.phone, vehicle: vehicles })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .leftJoin(vehicles, eq(vehicles.driverId, driverProfiles.userId))
      .where(and(eq(driverProfiles.partnerId, partnerId), eq(driverProfiles.status, 'approved')))
      .orderBy(asc(driverProfiles.fullName));
    const driverIds = driverRows.map((d) => d.profile.userId);
    const docs = driverIds.length
      ? await this.db
          .select({ driverId: documents.driverId, type: documents.type, expiresAt: documents.expiresAt, status: documents.status })
          .from(documents)
          .where(and(inArray(documents.driverId, driverIds), isNull(documents.supersededAt)))
      : [];
    const tripRows = await this.db
      .select({
        t: trips,
        serviceClass: plans.serviceClass,
        pickupLat: sql<number>`ST_Y(${trips.pickup})`,
        pickupLng: sql<number>`ST_X(${trips.pickup})`,
        dropoffLat: sql<number>`ST_Y(${trips.dropoff})`,
        dropoffLng: sql<number>`ST_X(${trips.dropoff})`,
      })
      .from(trips)
      .innerJoin(subscriptions, eq(subscriptions.id, trips.subscriptionId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(trips.partnerId, partnerId), between(trips.serviceDate, from, to)))
      .orderBy(asc(trips.scheduledAt));

    const batch: RegulatorBatch = {
      generatedAt: new Date().toISOString(),
      period: { from, to },
      partner: { id: partner.id, legalName: partner.legalName, crNumber: partner.crNumber },
      licenses: licenses.map((l) => ({
        serviceClass: l.serviceClass,
        licenseNumber: l.licenseNumber,
        unifiedCode: l.unifiedCode,
        expiresAt: l.expiresAt,
        verified: Boolean(l.verifiedAt),
      })),
      drivers: driverRows.map(({ profile, phone, vehicle }) => ({
        id: profile.userId,
        fullName: profile.fullName,
        nationalId: profile.nationalIdEncrypted ? decryptField(this.env.DATA_ENCRYPTION_KEY, profile.nationalIdEncrypted) : null,
        dateOfBirth: profile.dateOfBirth,
        phone,
        complianceHold: profile.complianceHold,
        vehicle: vehicle
          ? { plate: `${vehicle.plateLetters} ${vehicle.plateNumbers}`, make: vehicle.make, model: vehicle.model, year: vehicle.year, seats: vehicle.seats }
          : null,
        documents: docs.filter((d) => d.driverId === profile.userId).map((d) => ({ type: d.type, expiresAt: d.expiresAt, status: d.status })),
      })),
      trips: tripRows.map(({ t, serviceClass, pickupLat, pickupLng, dropoffLat, dropoffLng }) => ({
        id: t.id,
        serviceClass,
        serviceDate: t.serviceDate,
        leg: t.leg,
        status: t.status,
        driverId: t.driverId,
        scheduledAt: t.scheduledAt.toISOString(),
        startedAt: t.startedAt?.toISOString() ?? null,
        pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        pickup: { lat: Number(pickupLat), lng: Number(pickupLng) },
        dropoff: { lat: Number(dropoffLat), lng: Number(dropoffLng) },
      })),
    };
    await this.audit.record({
      actorId: actor.id,
      partnerId,
      action: 'regulator.export',
      entity: 'partner',
      entityId: partnerId,
      after: { from, to, drivers: batch.drivers.length, trips: batch.trips.length, gateway: this.gateway.name },
      ip,
    });
    return batch;
  }

  /** Hands a batch to the configured gateway. */
  async submit(actor: AuthUser, partnerId: string | undefined, from: string, to: string, ip?: string) {
    const batch = await this.export(actor, partnerId, from, to, ip);
    const result = await this.gateway.submit(batch);
    return { gateway: this.gateway.name, ...result, drivers: batch.drivers.length, trips: batch.trips.length };
  }
}
