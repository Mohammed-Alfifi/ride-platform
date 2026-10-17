import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';

export const STORAGE = Symbol('STORAGE');

/** Private file storage. Files are never public; the API streams them after checking access. */
export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
}

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, { mode: 0o600 });
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  private resolve(key: string): string {
    const root = path.resolve(this.root);
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return file;
  }
}

export class S3Storage implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
    return res.Body as Readable;
  }
}

/** Accepted upload types, recognised by their first bytes rather than the name the client sent. */
const SIGNATURES: { mime: string; ext: string; bytes: number[] }[] = [
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

export function sniffFileType(buffer: Buffer): { mime: string; ext: string } | null {
  const match = SIGNATURES.find((s) => s.bytes.every((b, i) => buffer[i] === b));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

@Injectable()
export class StorageFactory {
  constructor(@Inject(ENV) private readonly env: Env) {}
  create(): FileStorage {
    return this.env.STORAGE_DRIVER === 's3' ? new S3Storage(this.env) : new LocalDiskStorage(this.env.STORAGE_DIR);
  }
}

@Global()
@Module({
  providers: [
    StorageFactory,
    { provide: STORAGE, inject: [StorageFactory], useFactory: (f: StorageFactory) => f.create() },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
