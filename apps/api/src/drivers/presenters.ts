import { vehicleEligibleUntil } from '../common/saudi';
import { DocumentRow, DocumentType, EXPIRING_DOCUMENTS, Vehicle } from '../database/schema';
import { DocumentView, RequirementView, VehicleView } from './drivers.dto';

export function presentDocument(d: DocumentRow): DocumentView {
  return {
    id: d.id,
    type: d.type,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    expiresAt: d.expiresAt,
    status: d.status,
    rejectionReason: d.rejectionReason,
    fileUrl: `/v1/documents/${d.id}/file`,
    createdAt: d.createdAt.toISOString(),
  };
}

export function presentVehicle(v: Vehicle, maxAgeYears: number): VehicleView {
  return {
    id: v.id,
    plateLetters: v.plateLetters,
    plateNumbers: v.plateNumbers,
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    seats: v.seats,
    escortName: v.escortName,
    eligibleUntil: vehicleEligibleUntil(v.year, maxAgeYears).toISOString().slice(0, 10),
  };
}

/** The documents this driver must upload, given the service classes their partner is licensed for. */
export function requirementsFor(current: DocumentRow[], required: readonly DocumentType[]): RequirementView[] {
  const byType = new Map<DocumentType, DocumentRow>(current.map((d) => [d.type, d]));
  return required.map((type) => ({
    type,
    expiryRequired: EXPIRING_DOCUMENTS.includes(type),
    status: byType.get(type)?.status ?? null,
  }));
}

export function maskNationalId(last4: string | null): string | null {
  return last4 ? `******${last4}` : null;
}
