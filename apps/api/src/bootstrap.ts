import { INestApplication, Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { Env } from './config/env';
import { MetricsService } from './monitoring/metrics.service';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', env.TRUST_PROXY_HOPS);
  express.disable('x-powered-by');

  app.useLogger(app.get(Logger));

  // Response time of every request, per route, for the system page; requests over a second are logged.
  const metrics = app.get(MetricsService);
  const slowLog = new NestLogger('Slow');
  express.use((req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const route = req.route ? `${req.method} ${req.baseUrl}${(req.route as { path: string }).path}` : `${req.method} (unmatched)`;
      metrics.record(route, res.statusCode, Math.round(ms));
      if (ms > 1000) slowLog.warn(`${route} took ${Math.round(ms)} ms`);
    });
    next();
  });
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
