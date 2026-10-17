import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { normalizeSaudiMobile } from '../common/phone';
import * as schema from './schema';

/**
 * Creates the first super admin from SUPER_ADMIN_PHONE. Idempotent.
 * With --demo it also adds a demo partner and its admin (+966500000001) for local testing.
 */
async function seed(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    const rawPhone = process.env.SUPER_ADMIN_PHONE;
    if (rawPhone) {
      const phone = normalizeSaudiMobile(rawPhone);
      const existing = await db.query.users.findFirst({
        where: and(eq(schema.users.phone, phone), eq(schema.users.audience, 'admin'), isNull(schema.users.deletedAt)),
      });
      if (existing) {
        console.warn(`Super admin ${phone} already exists`);
      } else {
        await db.insert(schema.users).values({
          phone,
          audience: 'admin',
          role: 'super_admin',
          name: process.env.SUPER_ADMIN_NAME || 'Platform Owner',
        });
        console.warn(`Super admin ${phone} created`);
      }
    } else {
      console.warn('SUPER_ADMIN_PHONE is empty; skipped super admin');
    }

    if (process.argv.includes('--demo')) {
      let partner = await db.query.partners.findFirst({ where: eq(schema.partners.crNumber, '1010000001') });
      if (!partner) {
        [partner] = await db
          .insert(schema.partners)
          .values({
            nameAr: 'شريك تجريبي للنقل',
            nameEn: 'Demo Transport Partner',
            crNumber: '1010000001',
            commissionBps: 1500,
            joinCode: 'DEMO26',
          })
          .returning();
      }
      const demoPhone = '+966500000001';
      const demoAdmin = await db.query.users.findFirst({
        where: and(eq(schema.users.phone, demoPhone), eq(schema.users.audience, 'admin')),
      });
      if (!demoAdmin) {
        await db.insert(schema.users).values({
          phone: demoPhone,
          audience: 'admin',
          role: 'partner_admin',
          partnerId: partner.id,
          name: 'مدير الشريك التجريبي',
        });
      }
      const existingZone = await db.query.zones.findFirst({ where: eq(schema.zones.partnerId, partner.id) });
      if (!existingZone) {
        const area = JSON.stringify({
          type: 'Polygon',
          coordinates: [[[46.82, 24.86], [46.835, 24.86], [46.835, 24.875], [46.82, 24.875], [46.82, 24.86]]],
        });
        const [zone] = await db
          .insert(schema.zones)
          .values({
            partnerId: partner.id,
            nameAr: 'حي الرمال',
            nameEn: 'Al Rimal',
            area: sql`ST_SetSRID(ST_GeomFromGeoJSON(${area}), 4326)` as unknown as string,
          })
          .returning();
        await db.insert(schema.plans).values({
          partnerId: partner.id,
          zoneId: zone.id,
          nameAr: 'ذهاب وعودة - 5 أيام',
          nameEn: 'Round trip - 5 days',
          tripType: 'round_trip',
          daysPerWeek: 5,
          priceHalalas: 120000,
          maxDistanceKm: 15,
        });
      }
      console.warn(`Demo partner ready (join code DEMO26); partner admin ${demoPhone}`);
    }
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
