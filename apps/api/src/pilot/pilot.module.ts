import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TripsModule } from '../trips/trips.module';
import { AdminPilotController, MePilotController, PublicPilotController } from './pilot.controller';
import { PilotService } from './pilot.service';

/** What a controlled field pilot needs: invitations, join requests, consent and account deletion. */
@Module({
  imports: [AuthModule, TripsModule],
  controllers: [PublicPilotController, MePilotController, AdminPilotController],
  providers: [PilotService],
  exports: [PilotService],
})
export class PilotModule {}
