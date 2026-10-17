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

export type Partner = typeof partners.$inferSelect;
export type User = typeof users.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
