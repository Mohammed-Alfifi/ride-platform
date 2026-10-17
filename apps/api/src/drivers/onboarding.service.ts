import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { encryptField, pepperedHash } from '../common/crypto';
import { AppError } from '../common/errors';
import { isValidSaudiNationalId, normalizePlateLetters, riyadhToday, vehicleEligibleUntil } from '../common/saudi';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  DOCUMENT_TYPES,
  DocumentRow,
  documents,
  DriverProfile,
  driverProfiles,
  partners,
  users,
  vehicles,
} from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { isUniqueViolation } from '../users/users.service';
import { DocumentsService } from './documents.service';
import { DriverProfileDto, OnboardingView, VehicleDto } from './drivers.dto';
import { presentDocument, presentVehicle, requirementsFor } from './presenters';

/** The driver's side of joining a partner: details, vehicle, documents, submission. */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly docs: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async view(driverId: string): Promise<OnboardingView> {
    const profile = await this.profile(driverId);
    const partner = profile?.partnerId
      ? await this.db.query.partners.findFirst({
          columns: { id: true, nameAr: true, nameEn: true },
          where: eq(partners.id, profile.partnerId),
        })
      : undefined;
    const vehicle = await this.db.query.vehicles.findFirst({ where: eq(vehicles.driverId, driverId) });
    const current = await this.docs.current(driverId);
    const missing = this.missing(profile, Boolean(vehicle), current);

    return {
      status: profile?.partnerId ? profile.status : 'not_joined',
      partner: partner ?? null,
      profile: profile
        ? {
            fullName: profile.fullName,
            nationalIdLast4: profile.nationalIdLast4,
            dateOfBirth: profile.dateOfBirth,
            saudiConfirmed: profile.saudiConfirmed,
          }
        : null,
      vehicle: vehicle ? presentVehicle(vehicle, this.env.VEHICLE_MAX_AGE_YEARS) : null,
      documents: current.map(presentDocument),
      requirements: requirementsFor(current),
      missing,
      canSubmit: missing.length === 0 && (profile?.status === 'draft' || profile?.status === 'rejected'),
      rejectionReason: profile?.status === 'rejected' ? profile.rejectionReason : null,
      complianceHold: profile?.complianceHold ?? false,
      complianceReason: profile?.complianceReason ?? null,
    };
  }

  async join(driverId: string, rawCode: string): Promise<OnboardingView> {
    const code = rawCode.trim().toUpperCase();
    const partner = await this.db.query.partners.findFirst({ where: eq(partners.joinCode, code) });
    if (!partner || partner.status !== 'active') throw new AppError('DRIVER_JOIN_CODE_INVALID');

    const profile = await this.profile(driverId);
    if (profile?.partnerId === partner.id) return this.view(driverId);
    if (profile?.partnerId && profile.status !== 'draft') throw new AppError('DRIVER_ALREADY_JOINED');

    await this.db.transaction(async (tx) => {
      await tx
        .insert(driverProfiles)
        .values({ userId: driverId, partnerId: partner.id })
        .onConflictDoUpdate({ target: driverProfiles.userId, set: { partnerId: partner.id } });
      // Anything already uploaded moves with the driver to the new partner.
      await tx.update(vehicles).set({ partnerId: partner.id }).where(eq(vehicles.driverId, driverId));
      await tx.update(documents).set({ partnerId: partner.id }).where(eq(documents.driverId, driverId));
      await tx.update(users).set({ partnerId: partner.id }).where(eq(users.id, driverId));
    });
    return this.view(driverId);
  }

  async saveProfile(driverId: string, dto: DriverProfileDto): Promise<OnboardingView> {
    const profile = await this.editable(driverId);
    if (!dto.saudiConfirmed) throw new AppError('DRIVER_NOT_SAUDI');
    if (!isValidSaudiNationalId(dto.nationalId)) throw new AppError('DRIVER_NATIONAL_ID_INVALID');
    const age = yearsSince(dto.dateOfBirth, riyadhToday());
    if (age < 18 || age > 80) {
      throw new AppError('VALIDATION_FAILED', {}, ['dateOfBirth: the driver must be at least 18']);
    }

    try {
      await this.db
        .update(driverProfiles)
        .set({
          fullName: dto.fullName.trim(),
          nationalIdEncrypted: encryptField(this.env.DATA_ENCRYPTION_KEY, dto.nationalId),
          nationalIdHash: pepperedHash(this.env.HASH_PEPPER, `nid:${dto.nationalId}`),
          nationalIdLast4: dto.nationalId.slice(-4),
          dateOfBirth: dto.dateOfBirth,
          saudiConfirmed: true,
        })
        .where(eq(driverProfiles.userId, profile.userId));
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('DRIVER_NATIONAL_ID_TAKEN');
      throw err;
    }
    // Keep the account name in step with the legal name the partner sees.
    await this.db
      .update(users)
      .set({ name: dto.fullName.trim() })
      .where(and(eq(users.id, driverId), isNull(users.name)));
    return this.view(driverId);
  }

  async saveVehicle(driverId: string, dto: VehicleDto): Promise<OnboardingView> {
    const profile = await this.editable(driverId);
    const letters = normalizePlateLetters(dto.plateLetters);
    if (!letters) throw new AppError('VEHICLE_PLATE_INVALID');
    const until = vehicleEligibleUntil(dto.year, this.env.VEHICLE_MAX_AGE_YEARS).toISOString().slice(0, 10);
    if (until <= riyadhToday()) throw new AppError('VEHICLE_TOO_OLD', { maxYears: this.env.VEHICLE_MAX_AGE_YEARS });
    if (dto.year > new Date().getUTCFullYear() + 1) throw new AppError('VALIDATION_FAILED', {}, ['year is in the future']);

    const values = {
      driverId,
      partnerId: profile.partnerId as string,
      plateLetters: letters,
      plateNumbers: dto.plateNumbers,
      make: dto.make.trim(),
      model: dto.model.trim(),
      year: dto.year,
      color: dto.color.trim(),
      seats: dto.seats,
    };
    try {
      await this.db.insert(vehicles).values(values).onConflictDoUpdate({ target: vehicles.driverId, set: values });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('VEHICLE_PLATE_TAKEN');
      throw err;
    }
    return this.view(driverId);
  }

  async submit(driverId: string): Promise<OnboardingView> {
    const profile = await this.editable(driverId);
    const vehicle = await this.db.query.vehicles.findFirst({ where: eq(vehicles.driverId, driverId) });
    const current = await this.docs.current(driverId);
    const missing = this.missing(profile, Boolean(vehicle), current);
    if (missing.length > 0) throw new AppError('DRIVER_INCOMPLETE', {}, missing);
    if (vehicle) {
      const until = vehicleEligibleUntil(vehicle.year, this.env.VEHICLE_MAX_AGE_YEARS).toISOString().slice(0, 10);
      if (until <= riyadhToday()) throw new AppError('VEHICLE_TOO_OLD', { maxYears: this.env.VEHICLE_MAX_AGE_YEARS });
    }

    await this.db
      .update(driverProfiles)
      .set({ status: 'submitted', submittedAt: new Date(), rejectionReason: null })
      .where(eq(driverProfiles.userId, driverId));
    await this.audit.record({
      actorId: driverId,
      partnerId: profile.partnerId,
      action: 'driver.submit',
      entity: 'driver',
      entityId: driverId,
    });

    const admins = await this.notifications.partnerAdminIds(profile.partnerId as string);
    const name = profile.fullName ?? '';
    await this.notifications.notify(admins, {
      kind: 'driver_submitted',
      titleAr: 'طلب سائق جديد بانتظار المراجعة',
      titleEn: 'New driver application to review',
      bodyAr: `أرسل ${name} بياناته ووثائقه.`,
      bodyEn: `${name} has sent their details and documents.`,
      data: { driverId },
    });
    return this.view(driverId);
  }

  /** What is still needed before the application can be sent, as stable codes for the app. */
  private missing(profile: DriverProfile | undefined, hasVehicle: boolean, current: DocumentRow[]): string[] {
    if (!profile?.partnerId) return ['partner'];
    const out: string[] = [];
    if (!profile.fullName || !profile.nationalIdEncrypted || !profile.dateOfBirth || !profile.saudiConfirmed) {
      out.push('profile');
    }
    if (!hasVehicle) out.push('vehicle');
    for (const type of DOCUMENT_TYPES) {
      const doc = current.find((d) => d.type === type);
      if (!doc || doc.status === 'rejected') out.push(`document.${type}`);
    }
    return out;
  }

  private profile(driverId: string): Promise<DriverProfile | undefined> {
    return this.db.query.driverProfiles.findFirst({ where: eq(driverProfiles.userId, driverId) });
  }

  /** Details may change only before submission or after a rejection. */
  private async editable(driverId: string): Promise<DriverProfile> {
    const profile = await this.profile(driverId);
    if (!profile?.partnerId) throw new AppError('DRIVER_NOT_JOINED');
    if (profile.status === 'submitted' || profile.status === 'approved') throw new AppError('DRIVER_LOCKED');
    return profile;
  }
}

function yearsSince(isoDate: string, today: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
