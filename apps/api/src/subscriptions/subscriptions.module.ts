import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { BillingService } from '../payments/billing.service';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payments/gateway';
import { InvoicesService } from '../payments/invoices.service';
import { MoyasarGateway } from '../payments/moyasar.gateway';
import { ManualGateway } from '../payments/manual.gateway';
import { SandboxGateway } from '../payments/sandbox.gateway';
import { TapGateway } from '../payments/tap.gateway';
import { REDIS } from '../redis/redis.module';
import { RenewalsService } from './renewals.service';
import {
  AdminBillingController,
  InvoicesController,
  PaymentCallbacksController,
  RiderController,
} from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PromosService } from '../services/promos.service';
import { TripsModule } from '../trips/trips.module';

/** Picks the payment provider from PAYMENT_PROVIDER. Switching provider is a config change. */
export function createGateway(env: Env, redis: Redis): PaymentGateway {
  switch (env.PAYMENT_PROVIDER) {
    case 'tap':
      return new TapGateway(env.TAP_SECRET_KEY as string, env.TAP_MERCHANT_ID ?? '', env.TAP_API_URL);
    case 'moyasar':
      return new MoyasarGateway(env.MOYASAR_SECRET_KEY as string, env.MOYASAR_API_URL);
    case 'manual':
      return new ManualGateway();
    default:
      return new SandboxGateway(redis, env.PUBLIC_API_URL);
  }
}

@Module({
  imports: [TripsModule],
  controllers: [RiderController, InvoicesController, PaymentCallbacksController, AdminBillingController],
  providers: [
    { provide: PAYMENT_GATEWAY, inject: [ENV, REDIS], useFactory: createGateway },
    InvoicesService,
    BillingService,
    SubscriptionsService,
    RenewalsService,
    PromosService,
  ],
  exports: [RenewalsService, BillingService, PromosService],
})
export class SubscriptionsModule {}
