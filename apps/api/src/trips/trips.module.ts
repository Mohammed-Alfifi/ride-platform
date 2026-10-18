import { Module } from '@nestjs/common';
import { LiveStore } from './live.store';
import { TripGenerator } from './trip.generator';
import { TripWatch } from './trip.watch';
import { DispatchController, DriverTripsController, RiderTripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  controllers: [DriverTripsController, RiderTripsController, DispatchController],
  providers: [TripsService, TripGenerator, LiveStore, TripWatch],
  exports: [TripGenerator, TripsService, LiveStore, TripWatch],
})
export class TripsModule {}
