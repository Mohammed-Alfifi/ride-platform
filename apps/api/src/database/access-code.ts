import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AccessService } from '../auth/access.service';
import type { AuditService } from '../audit/audit.service';
import type { TokensService } from '../auth/tokens.service';
import { loadEnv } from '../config/env';
import * as schema from './schema';

/**
 * Prints a dashboard access code for an admin phone, for servers without SMS (SMS_PROVIDER=none).
 * Usage: node dist/database/access-code.js +9665XXXXXXXX
 */
async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) throw new Error('usage: access-code.js <admin phone>');
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    const access = new AccessService(db as never, env, {} as AuditService, {} as TokensService);
    const code = await access.adminCodeFor(phone);
    console.warn(`Access code for ${phone}: ${code}  (valid ${env.ACCESS_CODE_TTL_DAYS} days, single use)`);
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
