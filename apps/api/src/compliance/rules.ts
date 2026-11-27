import type { Env } from '../config/env';
import { BASE_DOCUMENTS, DocumentType, ServiceClass, SERVICE_CLASSES } from '../database/schema';

/**
 * What the transport regulations ask of a driver, a vehicle and a sale, per service class.
 *
 * commute   - Implementing regulation for ride-hailing mediation through apps (TGA, 1447/03/01 H):
 *             Saudi drivers in their own cars, criminal record renewed yearly, the rider's prior
 *             consent before a trip is shared, prices under a method the authority approved.
 * education - Regulation of the education transport activity and its implementing rules:
 *             cars of 7 to 9 seats or buses, drivers at least 25 with a professional driver card,
 *             a written contract with the guardian, an escort on buses of young students.
 *
 * Numbers that the authority may revise live in settings (see Env); the shape lives here.
 */
export interface ClassRules {
  serviceClass: ServiceClass;
  /** Documents required on top of BASE_DOCUMENTS. */
  extraDocuments: readonly DocumentType[];
  minSeats: number;
  maxSeats: number;
  minDriverAge: number;
  vehicleMaxAgeYears: number;
  guardianContract: boolean;
}

export function rulesFor(serviceClass: ServiceClass, env: Pick<Env, 'VEHICLE_MAX_AGE_YEARS' | 'EDUCATION_VEHICLE_MAX_AGE_YEARS'>): ClassRules {
  if (serviceClass === 'education') {
    return {
      serviceClass,
      extraDocuments: ['professional_driver_card', 'criminal_record', 'operating_card', 'first_aid_certificate'],
      minSeats: 7,
      maxSeats: 14,
      minDriverAge: 25,
      vehicleMaxAgeYears: env.EDUCATION_VEHICLE_MAX_AGE_YEARS,
      guardianContract: true,
    };
  }
  return {
    serviceClass,
    extraDocuments: ['criminal_record'],
    minSeats: 1,
    maxSeats: 14,
    minDriverAge: 18,
    vehicleMaxAgeYears: env.VEHICLE_MAX_AGE_YEARS,
    guardianContract: false,
  };
}

/** Every document a driver serving these classes must hold. */
export function requiredDocuments(classes: Iterable<ServiceClass>, env: Parameters<typeof rulesFor>[1]): DocumentType[] {
  const out = new Set<DocumentType>(BASE_DOCUMENTS);
  for (const c of classes) for (const d of rulesFor(c, env).extraDocuments) out.add(d);
  return [...out];
}

/** Documents added by this phase; drivers approved before them get the grace period, if any. */
export const NEWLY_REQUIRED: readonly DocumentType[] = ['professional_driver_card', 'criminal_record', 'operating_card', 'first_aid_certificate'];

export function isServiceClass(v: unknown): v is ServiceClass {
  return typeof v === 'string' && (SERVICE_CLASSES as readonly string[]).includes(v);
}

/** Whole years between a date of birth and a day, both YYYY-MM-DD. */
export function ageOn(dateOfBirth: string, day: string): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = day.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
