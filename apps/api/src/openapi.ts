import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApi } from './bootstrap';

/** Writes packages/contracts/openapi.json, the contract the apps are built against. */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = buildOpenApi(app);
  const out = path.resolve(__dirname, '../../../packages/contracts/openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  await app.close();
  console.warn(`OpenAPI written to ${out}`);
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
