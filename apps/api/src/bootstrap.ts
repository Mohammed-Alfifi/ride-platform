import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { Env } from './config/env';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.useLogger(app.get(Logger));
  // Locally the API is plain http; asking browsers to upgrade to https would break the test payment page.
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: local ? null : [] } } }));
  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: false,
    exposedHeaders: ['x-request-id', 'retry-after'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Ride Platform API')
    .setDescription(
      'Scheduled ride subscriptions run by licensed partners. Errors use one shape: ' +
        '{ error: { code, message, details? }, requestId }. Send Accept-Language: ar|en.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
