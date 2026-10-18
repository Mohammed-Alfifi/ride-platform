import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Phase 1 schema: partners (tenants), users, refresh tokens and audit logs.
 * Later phases add drivers, vehicles, zones, plans, subscriptions, trips, payments...
 * Every operational table carries partner_id so data stays isolated per partner.
 */

export const ROLES = ['rider', 'driver', 'partner_admin', 'dispatcher', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

/** Which app a user signs in to. A phone has at most one account per audience. */
export const AUDIENCES = ['rider', 'driver', 'admin'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const PARTNER_ROLES: readonly Role[] = ['partner_admin', 'dispatcher'];
export const ADMIN_ROLES: readonly Role[] = ['partner_admin', 'dispatcher', 'super_admin'];

export function audienceForRole(role: Role): Audience {
  if (role === 'rider') return 'rider';
  if (role === 'driver') return 'driver';
  return 'admin';
}

export const roleEnum = pgEnum('user_role', ROLES);
export const audienceEnum = pgEnum('user_audience', AUDIENCES);
export const userStatusEnum = pgEnum('user_status', ['active', 'pending', 'suspended']);
export const partnerStatusEnum = pgEnum('partner_status', ['active', 'suspended']);
export const localeEnum = pgEnum('user_locale', ['ar', 'en']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nameAr: varchar('name_ar', { length: 160 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }),
    crNumber: varchar('cr_number', { length: 20 }),
    tgaLicenseNumber: varchar('tga_license_number', { length: 40 }),
    contactPhone: varchar('contact_phone', { length: 16 }),
    /** Platform commission in basis points (1500 = 15%). */
    commissionBps: integer('commission_bps').notNull().default(0),
    status: partnerStatusEnum('status').notNull().default('active'),
    /** Short code drivers type in the driver app to join this partner. */
    joinCode: varchar('join_code', { length: 8 }).notNull(),
    /** VAT registration number (15 digits); printed on rider invoices, where the partner is the seller. */
    vatNumber: varchar('vat_number', { length: 15 }),
    /** The partner's sub-account at the payment gateway (e.g. Tap marketplace retailer id) for split payouts. */
    gatewayAccountId: varchar('gateway_account_id', { length: 80 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('partners_join_code_uq').on(t.joinCode),
    check('partners_commission_range', sql`${t.commissionBps} BETWEEN 0 AND 10000`),
    uniqueIndex('partners_cr_number_uq').on(t.crNumber),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 16 }).notNull(),
    audience: audienceEnum('audience').notNull(),
    role: roleEnum('role').notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 120 }),
    locale: localeEnum('locale').notNull().default('ar'),
    status: userStatusEnum('status').notNull().default('active'),
    /** Bumped to revoke every access token of the user immediately. */
    tokenVersion: integer('token_version').notNull().default(0),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** Which version of the terms and privacy policy the user accepted, and when. */
    termsVersion: varchar('terms_version', { length: 20 }),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_phone_audience_uq')
      .on(t.phone, t.audience)
      .where(sql`${t.deletedAt} IS NULL`),
    index('users_partner_idx').on(t.partnerId),
    check(
      'users_partner_role_ck',
      sql`(${t.role} IN ('partner_admin','dispatcher') AND ${t.partnerId} IS NOT NULL)
        OR (${t.role} = 'super_admin' AND ${t.partnerId} IS NULL)
        OR ${t.role} IN ('rider','driver')`,
    ),
    check(
      'users_role_audience_ck',
      sql`(${t.role} = 'rider' AND ${t.audience} = 'rider')
        OR (${t.role} = 'driver' AND ${t.audience} = 'driver')
        OR (${t.role} IN ('partner_admin','dispatcher','super_admin') AND ${t.audience} = 'admin')`,
    ),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** All tokens produced by rotating one login share a family; reuse revokes the family. */
    familyId: uuid('family_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    userAgent: varchar('user_agent', { length: 255 }),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_partner_idx').on(t.partnerId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
  ],
);

// ---------------------------------------------------------------- Phase 2

/** PostGIS polygon in WGS84. Written with ST_GeomFromGeoJSON, read with ST_AsGeoJSON. */
const polygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Polygon,4326)',
});

export const DOCUMENT_TYPES = [
  'national_id',
  'driving_license',
  'driver_photo',
  'vehicle_registration',
  'vehicle_insurance',
  'periodic_inspection',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
/** Documents whose expiry date must be recorded and is watched by the compliance scan. */
export const EXPIRING_DOCUMENTS: readonly DocumentType[] = [
  'national_id',
  'driving_license',
  'vehicle_registration',
  'vehicle_insurance',
  'periodic_inspection',
];

export const onboardingStatusEnum = pgEnum('driver_onboarding_status', ['draft', 'submitted', 'approved', 'rejected']);
export const documentTypeEnum = pgEnum('document_type', DOCUMENT_TYPES);
export const documentStatusEnum = pgEnum('document_status', ['pending', 'accepted', 'rejected']);
export const tripTypeEnum = pgEnum('plan_trip_type', ['round_trip', 'one_way']);

export const driverProfiles = pgTable(
  'driver_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    fullName: varchar('full_name', { length: 120 }),
    /** AES-256-GCM ciphertext; needed in full for reporting to the transport authority. */
    nationalIdEncrypted: varchar('national_id_encrypted', { length: 200 }),
    /** Peppered hash, used only to stop one ID from registering twice. */
    nationalIdHash: varchar('national_id_hash', { length: 64 }),
    nationalIdLast4: varchar('national_id_last4', { length: 4 }),
    dateOfBirth: date('date_of_birth'),
    saudiConfirmed: boolean('saudi_confirmed').notNull().default(false),
    status: onboardingStatusEnum('status').notNull().default('draft'),
    rejectionReason: varchar('rejection_reason', { length: 500 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Set by the compliance scan when a document or the vehicle stops being valid. */
    complianceHold: boolean('compliance_hold').notNull().default(false),
    complianceReason: varchar('compliance_reason', { length: 200 }),
    ...timestamps,
  },
  (t) => [
    index('driver_profiles_partner_idx').on(t.partnerId, t.status),
    uniqueIndex('driver_profiles_national_id_uq').on(t.nationalIdHash),
  ],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    plateLetters: varchar('plate_letters', { length: 3 }).notNull(),
    plateNumbers: varchar('plate_numbers', { length: 4 }).notNull(),
    make: varchar('make', { length: 60 }).notNull(),
    model: varchar('model', { length: 60 }).notNull(),
    year: integer('year').notNull(),
    color: varchar('color', { length: 30 }).notNull(),
    /** Passenger seats, not counting the driver. */
    seats: integer('seats').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('vehicles_driver_uq').on(t.driverId),
    uniqueIndex('vehicles_plate_uq').on(t.plateLetters, t.plateNumbers),
    index('vehicles_partner_idx').on(t.partnerId),
    check('vehicles_seats_ck', sql`${t.seats} BETWEEN 1 AND 14`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    type: documentTypeEnum('type').notNull(),
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    mime: varchar('mime', { length: 60 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    expiresAt: date('expires_at'),
    status: documentStatusEnum('status').notNull().default('pending'),
    rejectionReason: varchar('rejection_reason', { length: 300 }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Set when a newer upload of the same type replaces this one; history is kept. */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_driver_idx').on(t.driverId, t.type),
    index('documents_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.supersededAt} IS NULL`),
    uniqueIndex('documents_current_uq')
      .on(t.driverId, t.type)
      .where(sql`${t.supersededAt} IS NULL`),
  ],
);

export const zones = pgTable(
  'zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    nameAr: varchar('name_ar', { length: 120 }).notNull(),
    nameEn: varchar('name_en', { length: 120 }).notNull(),
    area: polygon('area').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('zones_partner_idx').on(t.partnerId),
    index('zones_area_gix').using('gist', t.area),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => zones.id, { onDelete: 'restrict' }),
    nameAr: varchar('name_ar', { length: 120 }).notNull(),
    nameEn: varchar('name_en', { length: 120 }).notNull(),
    tripType: tripTypeEnum('trip_type').notNull(),
    daysPerWeek: integer('days_per_week').notNull(),
    /** Monthly price in halalas, VAT included. 150000 = 1,500 SAR. */
    priceHalalas: integer('price_halalas').notNull(),
    /** Longest one-way distance this plan covers. */
    maxDistanceKm: integer('max_distance_km').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('plans_zone_idx').on(t.zoneId),
    check('plans_days_ck', sql`${t.daysPerWeek} BETWEEN 1 AND 7`),
    check('plans_price_ck', sql`${t.priceHalalas} > 0`),
    check('plans_distance_ck', sql`${t.maxDistanceKm} BETWEEN 1 AND 200`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 60 }).notNull(),
    titleAr: varchar('title_ar', { length: 160 }).notNull(),
    titleEn: varchar('title_en', { length: 160 }).notNull(),
    bodyAr: varchar('body_ar', { length: 500 }).notNull(),
    bodyEn: varchar('body_en', { length: 500 }).notNull(),
    data: jsonb('data'),
    /** Stops the daily scan from sending the same warning twice. */
    dedupeKey: varchar('dedupe_key', { length: 160 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey),
  ],
);

// ---------------------------------------------------------------- Phase 3

const point = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Point,4326)',
});

export const placeLabelEnum = pgEnum('place_label', ['home', 'school', 'work', 'other']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'pending_payment',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'expired',
]);
export const paymentStatusEnum = pgEnum('payment_status', ['initiated', 'paid', 'failed']);
export const paymentPurposeEnum = pgEnum('payment_purpose', ['start', 'renewal']);

export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: placeLabelEnum('label').notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    location: point('location').notNull(),
    address: varchar('address', { length: 255 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('places_rider_idx').on(t.riderId)],
);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 20 }).notNull(),
    brand: varchar('brand', { length: 20 }).notNull(),
    last4: varchar('last4', { length: 4 }).notNull(),
    expMonth: integer('exp_month'),
    expYear: integer('exp_year'),
    /** Gateway references only; card numbers never reach this system. */
    providerCustomerId: varchar('provider_customer_id', { length: 80 }),
    providerCardId: varchar('provider_card_id', { length: 80 }).notNull(),
    providerAgreementId: varchar('provider_agreement_id', { length: 80 }),
    isDefault: boolean('is_default').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payment_methods_rider_idx').on(t.riderId),
    uniqueIndex('payment_methods_card_uq').on(t.provider, t.providerCardId),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    pickupPlaceId: uuid('pickup_place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'restrict' }),
    dropoffPlaceId: uuid('dropoff_place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'restrict' }),
    /** Service days, 0 = Sunday ... 6 = Saturday. */
    days: integer('days').array().notNull(),
    /** Riyadh local times, HH:MM. */
    outboundTime: varchar('outbound_time', { length: 5 }).notNull(),
    returnTime: varchar('return_time', { length: 5 }),
    distanceKm: integer('distance_km').notNull(),
    /** Monthly price locked when subscribing, VAT included, halalas. */
    priceHalalas: integer('price_halalas').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('pending_payment'),
    currentPeriodStart: date('current_period_start'),
    currentPeriodEnd: date('current_period_end'),
    autoRenew: boolean('auto_renew').notNull().default(true),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    pausedFrom: date('paused_from'),
    pausedUntil: date('paused_until'),
    renewalAttempts: integer('renewal_attempts').notNull().default(0),
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id, { onDelete: 'set null' }),
    /** The rider's regular driver, chosen by the partner's dispatcher. Copied onto each new trip. */
    driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
    /** Who actually rides, when the account holder subscribes for a child or relative. */
    memberId: uuid('member_id').references(() => familyMembers.id, { onDelete: 'set null' }),
    promoCodeId: uuid('promo_code_id').references(() => promoCodes.id, { onDelete: 'set null' }),
    /** Taken off the first payment only. */
    discountHalalas: integer('discount_halalas').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('subscriptions_rider_idx').on(t.riderId),
    index('subscriptions_driver_idx').on(t.driverId),
    index('subscriptions_partner_idx').on(t.partnerId, t.status),
    index('subscriptions_renewal_idx').on(t.status, t.currentPeriodEnd),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    purpose: paymentPurposeEnum('purpose').notNull(),
    provider: varchar('provider', { length: 20 }).notNull(),
    providerPaymentId: varchar('provider_payment_id', { length: 80 }),
    checkoutUrl: varchar('checkout_url', { length: 500 }),
    amountHalalas: integer('amount_halalas').notNull(),
    /** The platform's commission and the partner's share, fixed when the payment is created. */
    discountHalalas: integer('discount_halalas').notNull().default(0),
    platformFeeHalalas: integer('platform_fee_halalas').notNull(),
    partnerShareHalalas: integer('partner_share_halalas').notNull(),
    status: paymentStatusEnum('status').notNull().default('initiated'),
    failureReason: varchar('failure_reason', { length: 200 }),
    /** gateway: paid online. cash / bank_transfer: recorded by an admin. */
    method: varchar('method', { length: 20 }).notNull().default('gateway'),
    /** Transfer number or receipt number for a recorded payment. */
    reference: varchar('reference', { length: 80 }),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    /** One renewal payment per subscription period; stops a job retry from charging twice. */
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    /** The service period this payment pays for. */
    periodStart: date('period_start'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payments_provider_uq').on(t.provider, t.providerPaymentId),
    uniqueIndex('payments_idempotency_uq').on(t.idempotencyKey),
    index('payments_partner_idx').on(t.partnerId, t.createdAt),
    index('payments_subscription_idx').on(t.subscriptionId),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    number: varchar('number', { length: 30 }).notNull(),
    sellerName: varchar('seller_name', { length: 200 }).notNull(),
    sellerVatNumber: varchar('seller_vat_number', { length: 15 }),
    buyerName: varchar('buyer_name', { length: 160 }),
    description: varchar('description', { length: 255 }).notNull(),
    totalHalalas: integer('total_halalas').notNull(),
    vatHalalas: integer('vat_halalas').notNull(),
    /** ZATCA simplified-invoice QR (TLV, base64). Present when the seller has a VAT number. */
    qrTlv: varchar('qr_tlv', { length: 600 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invoices_payment_uq').on(t.paymentId), uniqueIndex('invoices_number_uq').on(t.number)],
);

/** Gap-free invoice numbering per year. */
export const invoiceSequences = pgTable('invoice_sequences', {
  year: integer('year').primaryKey(),
  last: integer('last').notNull(),
});

// ---------------------------------------------------------------- trips (phase 4)

export const TRIP_STATUSES = [
  'scheduled', // generated, waiting for its day
  'en_route', // driver on the way to the pick-up
  'arrived', // driver waiting at the pick-up
  'on_board', // rider picked up
  'completed',
  'no_show', // rider did not come out
  'skipped', // rider said they do not need this trip
  'cancelled', // cancelled by the partner, or the subscription paused
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const tripStatusEnum = pgEnum('trip_status', TRIP_STATUSES);
export const tripLegEnum = pgEnum('trip_leg', ['outbound', 'return']);

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
    /** Riyadh calendar day of the trip. */
    serviceDate: date('service_date').notNull(),
    leg: tripLegEnum('leg').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    pickup: point('pickup').notNull(),
    pickupName: varchar('pickup_name', { length: 80 }).notNull(),
    dropoff: point('dropoff').notNull(),
    dropoffName: varchar('dropoff_name', { length: 80 }).notNull(),
    /** The person riding when it is not the account holder (a child, a relative). */
    passengerName: varchar('passenger_name', { length: 80 }),
    status: tripStatusEnum('status').notNull().default('scheduled'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    endedReason: varchar('ended_reason', { length: 200 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('trips_subscription_day_leg_uq').on(t.subscriptionId, t.serviceDate, t.leg),
    index('trips_partner_day_idx').on(t.partnerId, t.serviceDate),
    index('trips_driver_day_idx').on(t.driverId, t.serviceDate),
    index('trips_rider_day_idx').on(t.riderId, t.serviceDate),
  ],
);

/** Where the driver was during a trip, sampled; kept for disputes and safety reviews. */
export const tripPoints = pgTable(
  'trip_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    location: point('location').notNull(),
    speedKmh: integer('speed_kmh'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('trip_points_trip_idx').on(t.tripId, t.recordedAt)],
);

export type Trip = typeof trips.$inferSelect;

// ---------------------------------------------------------------- family, sharing, ratings, support, promotions

/** People an account holder rides for: a parent managing their children's school rides. */
export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    relation: varchar('relation', { length: 20 }).notNull(), // child | spouse | parent | other
    /** School, class or workplace: helps the driver at the gate. */
    note: varchar('note', { length: 120 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('family_members_owner_idx').on(t.ownerId)],
);

/** A link that lets someone without the app follow one trip live, until shortly after it ends. */
export const tripShares = pgTable(
  'trip_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token in the link; the token itself is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('trip_shares_token_uq').on(t.tokenHash), index('trip_shares_trip_idx').on(t.tripId)],
);

export const tripRatings = pgTable(
  'trip_ratings',
  {
    tripId: uuid('trip_id')
      .primaryKey()
      .references(() => trips.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    /** Quick reasons: on_time, clean_car, safe_driving, polite, late, unsafe, rude ... */
    tags: varchar('tags', { length: 30 }).array().notNull().default(sql`'{}'::varchar[]`),
    comment: varchar('comment', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trip_ratings_driver_idx').on(t.driverId),
    index('trip_ratings_partner_idx').on(t.partnerId, t.createdAt),
    check('trip_ratings_stars_ck', sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);

export const ticketCategoryEnum = pgEnum('ticket_category', ['trip', 'driver', 'payment', 'app', 'other']);
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'answered', 'closed']);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').generatedAlwaysAsIdentity().notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The partner who should answer; null goes to the platform team. */
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    category: ticketCategoryEnum('category').notNull(),
    subject: varchar('subject', { length: 120 }).notNull(),
    status: ticketStatusEnum('status').notNull().default('open'),
    /** An emergency report from the SOS button: shown first and alerted to every admin. */
    urgent: boolean('urgent').notNull().default(false),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('support_tickets_number_uq').on(t.number),
    index('support_tickets_user_idx').on(t.userId),
    index('support_tickets_partner_idx').on(t.partnerId, t.status),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    fromStaff: boolean('from_staff').notNull(),
    body: varchar('body', { length: 2000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const promoKindEnum = pgEnum('promo_kind', ['percent', 'amount']);

/** Discount codes a partner runs (first month only). */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 20 }).notNull(),
    kind: promoKindEnum('kind').notNull(),
    /** percent: 1-100; amount: halalas. */
    value: integer('value').notNull(),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    validFrom: date('valid_from'),
    validUntil: date('valid_until'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('promo_codes_code_uq').on(t.code),
    index('promo_codes_partner_idx').on(t.partnerId),
    check('promo_codes_value_ck', sql`${t.value} > 0 AND (${t.kind} <> 'percent' OR ${t.value} <= 100)`),
  ],
);

// ------------------------------------------------------------------ pilot operations

/**
 * Who may sign in while ACCESS_MODE=invite, and the access codes that replace SMS codes when
 * no SMS provider is set. A code is single use, expires, and is stored hashed.
 */
export const accessInvites = pgTable(
  'access_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 16 }).notNull(),
    audience: audienceEnum('audience').notNull(),
    name: varchar('name', { length: 120 }),
    /** The partner whose team sent the invite; scopes the list in the dashboard. */
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    joinRequestId: uuid('join_request_id'),
    codeHash: varchar('code_hash', { length: 128 }),
    codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
    codeFailures: integer('code_failures').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('access_invites_phone_uq')
      .on(t.phone, t.audience)
      .where(sql`${t.revokedAt} IS NULL`),
    index('access_invites_partner_idx').on(t.partnerId),
  ],
);

export const joinKindEnum = pgEnum('join_kind', ['rider', 'driver']);
export const joinStatusEnum = pgEnum('join_status', ['new', 'invited', 'declined']);

/** Applications from the public join page: families, employees and drivers outside the team's circle. */
export const joinRequests = pgTable(
  'join_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: joinKindEnum('kind').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 16 }).notNull(),
    city: varchar('city', { length: 60 }).notNull(),
    district: varchar('district', { length: 80 }),
    /** Riders: the school or workplace. */
    destination: varchar('destination', { length: 120 }),
    morningTime: varchar('morning_time', { length: 5 }),
    returnTime: varchar('return_time', { length: 5 }),
    riders: integer('riders'),
    /** Drivers: car model and year as typed. */
    car: varchar('car', { length: 80 }),
    note: varchar('note', { length: 500 }),
    status: joinStatusEnum('status').notNull().default('new'),
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('join_requests_status_idx').on(t.status, t.createdAt), index('join_requests_phone_idx').on(t.phone)],
);

/** Phones and browsers that receive push notifications (Firebase Cloud Messaging). */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 400 }).notNull(),
    platform: varchar('platform', { length: 10 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('device_tokens_token_uq').on(t.token), index('device_tokens_user_idx').on(t.userId)],
);

export type AccessInvite = typeof accessInvites.$inferSelect;
export type JoinRequest = typeof joinRequests.$inferSelect;

export type FamilyMember = typeof familyMembers.$inferSelect;
export type PromoCode = typeof promoCodes.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;

export type Partner = typeof partners.$inferSelect;
export type User = typeof users.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type Place = typeof places.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
