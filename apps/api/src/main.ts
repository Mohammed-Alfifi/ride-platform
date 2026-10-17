import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app, env);

  if (env.NODE_ENV !== 'production' || env.SWAGGER_ENABLED) {
    SwaggerModule.setup('docs', app, buildOpenApi(app));
  }

  await app.listen(env.PORT, '0.0.0.0');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
