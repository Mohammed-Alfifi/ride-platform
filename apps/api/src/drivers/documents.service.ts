import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { riyadhToday } from '../common/saudi';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { DocumentRow, documents, DocumentType, driverProfiles, EXPIRING_DOCUMENTS } from '../database/schema';
import { FileStorage, sniffFileType, STORAGE } from '../storage/storage.service';

export interface UploadedBlob {
  buffer: Buffer;
  size: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE) private readonly storage: FileStorage,
  ) {}

  /** The driver's current documents: the latest upload of each type. */
  current(driverId: string): Promise<DocumentRow[]> {
    return this.db
      .select()
      .from(documents)
      .where(and(eq(documents.driverId, driverId), isNull(documents.supersededAt)))
      .orderBy(documents.type);
  }

  /**
   * Stores a new document and retires the previous one of the same type (kept for history).
   * Files are recognised by content, not by the name or type the client claims.
   */
  async upload(driverId: string, type: DocumentType, expiresAt: string | undefined, file: UploadedBlob | undefined): Promise<DocumentRow> {
    const profile = await this.db.query.driverProfiles.findFirst({ where: eq(driverProfiles.userId, driverId) });
    if (!profile?.partnerId) throw new AppError('DRIVER_NOT_JOINED');

    if (EXPIRING_DOCUMENTS.includes(type)) {
      if (!expiresAt) throw new AppError('DOCUMENT_EXPIRY_REQUIRED');
      if (expiresAt <= riyadhToday()) throw new AppError('DOCUMENT_EXPIRED');
    }
    if (!file || file.size === 0) throw new AppError('VALIDATION_FAILED', {}, ['file is required']);
    const maxBytes = this.env.UPLOAD_MAX_MB * 1024 * 1024;
    if (file.size > maxBytes) throw new AppError('DOCUMENT_TOO_LARGE', { maxMb: this.env.UPLOAD_MAX_MB });
    const kind = sniffFileType(file.buffer);
    if (!kind) throw new AppError('DOCUMENT_FILE_UNSUPPORTED');
    if (type === 'driver_photo' && kind.mime === 'application/pdf') throw new AppError('DOCUMENT_FILE_UNSUPPORTED');

    const key = `drivers/${driverId}/${type}/${randomUUID()}.${kind.ext}`;
    await this.storage.put(key, file.buffer, kind.mime);

    return this.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ supersededAt: new Date() })
        .where(and(eq(documents.driverId, driverId), eq(documents.type, type), isNull(documents.supersededAt)));
      const [row] = await tx
        .insert(documents)
        .values({
          driverId,
          partnerId: profile.partnerId as string,
          type,
          storageKey: key,
          mime: kind.mime,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          expiresAt: EXPIRING_DOCUMENTS.includes(type) ? (expiresAt as string) : null,
        })
        .returning();
      return row;
    });
  }

  /** Opens a document for someone allowed to see it: its driver, its partner's staff, or a platform admin. */
  async openForViewer(viewer: AuthUser, documentId: string): Promise<{ doc: DocumentRow; stream: Readable }> {
    const doc = await this.db.query.documents.findFirst({ where: eq(documents.id, documentId) });
    const allowed =
      doc &&
      (viewer.role === 'super_admin' ||
        (viewer.role === 'driver' && doc.driverId === viewer.id) ||
        ((viewer.role === 'partner_admin' || viewer.role === 'dispatcher') && doc.partnerId === viewer.partnerId));
    if (!doc || !allowed) throw new AppError('DOCUMENT_NOT_FOUND');
    return { doc, stream: await this.storage.get(doc.storageKey) };
  }

  history(driverId: string): Promise<DocumentRow[]> {
    return this.db.select().from(documents).where(eq(documents.driverId, driverId)).orderBy(desc(documents.createdAt));
  }
}
