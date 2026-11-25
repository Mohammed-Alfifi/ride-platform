import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { DriverRunsController, RunsAdminController } from '../runs/runs.controller';
import { RunsService } from '../runs/runs.service';
import { LiveStore } from './live.store';
import { TripGenerator } from './trip.generator';
import { TripWatch } from './trip.watch';
import { DispatchController, DriverTripsController, RiderTripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [DriversModule],
  // Runs live here: they plan over trips and are re-planned whenever trips change.
  controllers: [DriverTripsController, RiderTripsController, DispatchController, RunsAdminController, DriverRunsController],
  providers: [TripsService, TripGenerator, LiveStore, TripWatch, RunsService],
  exports: [TripGenerator, TripsService, LiveStore, TripWatch, RunsService],
})
export class TripsModule {}
