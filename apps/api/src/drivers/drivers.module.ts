import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ComplianceService } from './compliance.service';
import { DocumentsService } from './documents.service';
import { AdminDriversController, DocumentFilesController, DriverOnboardingController } from './drivers.controller';
import { OnboardingService } from './onboarding.service';
import { ReviewService } from './review.service';

@Module({
  imports: [AuthModule],
  controllers: [DriverOnboardingController, DocumentFilesController, AdminDriversController],
  providers: [DocumentsService, OnboardingService, ReviewService, ComplianceService],
  exports: [ComplianceService],
})
export class DriversModule {}
