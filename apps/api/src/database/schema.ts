import { sql } from 'drizzle-orm';
import {
  check,
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
    ...timestamps,
  },
  (t) => [
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

export type Partner = typeof partners.$inferSelect;
export type User = typeof users.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
