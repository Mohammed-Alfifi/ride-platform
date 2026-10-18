import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TripsModule } from '../trips/trips.module';
import { AnalyticsService } from './analytics.service';
import { EngagementService } from './engagement.service';
import { AdminServiceController, SharedTripController, SupportController, TripExtrasController } from './services.controller';

@Module({
  imports: [TripsModule, SubscriptionsModule],
  controllers: [TripExtrasController, SharedTripController, SupportController, AdminServiceController],
  providers: [EngagementService, AnalyticsService],
})
export class ServicesModule {}
