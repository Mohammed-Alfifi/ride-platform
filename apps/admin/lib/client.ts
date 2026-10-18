'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Calls the API through the dashboard's own server (/api/proxy), which adds the session. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '');
  }
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError(401, 'AUTH_TOKEN_INVALID', '');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'INTERNAL', body?.error?.message ?? '', body?.error?.details);
  }
  return body as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? '');
  return data as T;
}

export interface Profile {
  id: string;
  name: string | null;
  role: 'super_admin' | 'partner_admin' | 'dispatcher';
  partnerId: string | null;
}

export interface UserView {
  id: string;
  phone: string;
  name: string | null;
  role: 'rider' | 'driver' | 'partner_admin' | 'dispatcher' | 'super_admin';
  audience: 'rider' | 'driver' | 'admin';
  partnerId: string | null;
  locale: 'ar' | 'en';
  status: 'active' | 'pending' | 'suspended';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserPage {
  items: UserView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PartnerView {
  id: string;
  nameAr: string;
  nameEn: string;
  legalName: string | null;
  crNumber: string | null;
  tgaLicenseNumber: string | null;
  contactPhone: string | null;
  commissionBps: number;
  vatNumber: string | null;
  gatewayAccountId: string | null;
  status: 'active' | 'suspended';
  joinCode: string;
  staffCount: number;
  createdAt: string;
}

export type DocType =
  | 'national_id'
  | 'driving_license'
  | 'driver_photo'
  | 'vehicle_registration'
  | 'vehicle_insurance'
  | 'periodic_inspection';
export type OnboardingStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface DocumentView {
  id: string;
  type: DocType;
  mime: string;
  sizeBytes: number;
  expiresAt: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  rejectionReason: string | null;
  fileUrl: string;
  createdAt: string;
}

export interface VehicleView {
  id: string;
  plateLetters: string;
  plateNumbers: string;
  make: string;
  model: string;
  year: number;
  color: string;
  seats: number;
  eligibleUntil: string;
}

export interface DriverListItem {
  id: string;
  phone: string;
  fullName: string | null;
  accountStatus: string;
  onboardingStatus: OnboardingStatus;
  partnerId: string | null;
  vehicle: string | null;
  complianceHold: boolean;
  submittedAt: string | null;
  pendingDocuments: number;
}

export interface DriverPage {
  items: DriverListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DriverDetail {
  id: string;
  phone: string;
  accountStatus: 'active' | 'pending' | 'suspended';
  onboardingStatus: OnboardingStatus;
  partnerId: string | null;
  fullName: string | null;
  nationalId: string | null;
  dateOfBirth: string | null;
  vehicle: VehicleView | null;
  documents: DocumentView[];
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  complianceHold: boolean;
  complianceReason: string | null;
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface ZoneView {
  id: string;
  partnerId: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
  area: GeoPolygon;
  areaKm2: number;
  planCount: number;
}

export interface PlanView {
  id: string;
  partnerId: string;
  zoneId: string;
  nameAr: string;
  nameEn: string;
  tripType: 'round_trip' | 'one_way';
  daysPerWeek: number;
  priceHalalas: number;
  maxDistanceKm: number;
  active: boolean;
}

export interface ExpiringItem {
  documentId: string;
  driverId: string;
  driverName: string | null;
  phone: string;
  type: DocType;
  expiresAt: string;
  daysLeft: number;
  complianceHold: boolean;
}

export type SubscriptionStatus = 'pending_payment' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired';

export interface AdminSubscription {
  id: string;
  status: SubscriptionStatus;
  riderName: string | null;
  riderPhone: string;
  planNameAr: string;
  planNameEn: string;
  days: number[];
  outboundTime: string;
  returnTime: string | null;
  priceHalalas: number;
  discountHalalas?: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pausedFrom: string | null;
  pausedUntil: string | null;
  partnerId: string;
  driverId: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminPayment {
  id: string;
  status: 'initiated' | 'paid' | 'failed';
  purpose: 'start' | 'renewal';
  provider: string;
  amountHalalas: number;
  platformFeeHalalas: number;
  partnerShareHalalas: number;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  riderName: string | null;
  riderPhone: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface PaymentPage extends Page<AdminPayment> {
  totals: { paidCount: number; collectedHalalas: number; platformFeeHalalas: number; partnerShareHalalas: number };
}

export type TripStatus = 'scheduled' | 'en_route' | 'arrived' | 'on_board' | 'completed' | 'no_show' | 'skipped' | 'cancelled';

export interface Spot {
  lat: number;
  lng: number;
  name: string;
}

export interface TripView {
  id: string;
  subscriptionId: string;
  serviceDate: string;
  leg: 'outbound' | 'return';
  scheduledAt: string;
  status: TripStatus;
  pickup: Spot;
  dropoff: Spot;
  rider: { id: string; name: string | null; phone: string };
  passengerName: string | null;
  driver: {
    id: string;
    name: string | null;
    phone: string | null;
    vehicle: { plate: string; make: string; model: string; color: string } | null;
  } | null;
  startedAt: string | null;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
  endedReason: string | null;
}

export interface LivePosition {
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  at: string;
}

export interface DispatchDriver {
  id: string;
  name: string | null;
  phone: string;
  onHold: boolean;
  plate: string | null;
  seats: number | null;
  tripsToday: number;
  currentTripId: string | null;
  location: LivePosition | null;
}

export interface DispatchBoard {
  date: string;
  summary: {
    total: number;
    unassigned: number;
    upcoming: number;
    active: number;
    completed: number;
    problems: number;
    skipped: number;
    late: number;
  };
  trips: TripView[];
  drivers: DispatchDriver[];
}

export interface TripLive {
  trip: TripView;
  driverLocation: LivePosition | null;
  etaMinutes: number | null;
  distanceMeters: number | null;
  route: { lat: number; lng: number }[];
}
