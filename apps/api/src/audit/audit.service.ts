import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { DB, Database } from '../database/database.module';
import { auditLogs } from '../database/schema';

export interface AuditEntry {
  actorId: string | null;
  partnerId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Append-only record of every administrative change: who, what, before and after. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditEntry, tx: Pick<Database, 'insert'> = this.db): Promise<void> {
    await tx.insert(auditLogs).values({
      actorId: entry.actorId,
      partnerId: entry.partnerId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
