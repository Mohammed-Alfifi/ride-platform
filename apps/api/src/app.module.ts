import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { ConfigModule } from './config/config.module';
import { loadEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { PartnersModule } from './partners/partners.module';
import Redis from 'ioredis';
import { REDIS, RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.service';
import { StorageModule } from './storage/storage.service';
import { ZonesModule } from './zones/zones.controller';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.code', 'req.body.refreshToken'],
          remove: true,
        },
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
        transport:
          env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
      },
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    StorageModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    PartnersModule,
    DriversModule,
    ZonesModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AppModule {}
