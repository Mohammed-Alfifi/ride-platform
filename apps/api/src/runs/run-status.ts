import { sql } from 'drizzle-orm';
import type { Database } from '../database/database.module';

/**
 * Keeps a run's status in step with its trips: in progress once any trip has started, completed
 * once every trip has ended, cancelled when all of them were called off. Called after each trip
 * transition; a no-op for trips outside any run.
 */
export async function syncRunStatus(db: Database, tripId: string): Promise<void> {
  await db.execute(sql`
    UPDATE runs r SET status = s.next, updated_at = now()
    FROM (
      SELECT rs.run_id,
        CASE
          WHEN bool_and(t.status IN ('cancelled', 'skipped')) THEN 'cancelled'
          WHEN bool_and(t.status IN ('completed', 'no_show', 'cancelled', 'skipped')) THEN 'completed'
          WHEN bool_or(t.status IN ('en_route', 'arrived', 'on_board', 'completed', 'no_show')) THEN 'in_progress'
          ELSE 'planned'
        END::run_status AS next
      FROM run_stops rs JOIN trips t ON t.id = rs.trip_id
      WHERE rs.run_id = (SELECT run_id FROM run_stops WHERE trip_id = ${tripId} LIMIT 1)
        AND rs.kind = 'pickup'
      GROUP BY rs.run_id
    ) s
    WHERE r.id = s.run_id AND r.status <> s.next`);
}
