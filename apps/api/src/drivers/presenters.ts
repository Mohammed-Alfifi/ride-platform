import { vehicleEligibleUntil } from '../common/saudi';
import { DOCUMENT_TYPES, DocumentRow, DocumentType, EXPIRING_DOCUMENTS, Vehicle } from '../database/schema';
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
    eligibleUntil: vehicleEligibleUntil(v.year, maxAgeYears).toISOString().slice(0, 10),
  };
}

export function requirementsFor(current: DocumentRow[]): RequirementView[] {
  const byType = new Map<DocumentType, DocumentRow>(current.map((d) => [d.type, d]));
  return DOCUMENT_TYPES.map((type) => ({
    type,
    expiryRequired: EXPIRING_DOCUMENTS.includes(type),
    status: byType.get(type)?.status ?? null,
  }));
}

export function maskNationalId(last4: string | null): string | null {
  return last4 ? `******${last4}` : null;
}
