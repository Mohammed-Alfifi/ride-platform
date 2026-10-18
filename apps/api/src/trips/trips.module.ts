import { Module } from '@nestjs/common';
import { LiveStore } from './live.store';
import { TripGenerator } from './trip.generator';
import { DispatchController, DriverTripsController, RiderTripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  controllers: [DriverTripsController, RiderTripsController, DispatchController],
  providers: [TripsService, TripGenerator, LiveStore],
  exports: [TripGenerator, TripsService, LiveStore],
})
export class TripsModule {}
