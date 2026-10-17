import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './guards';
import { OtpService } from './otp.service';
import { ConsoleSmsProvider, SMS_PROVIDER } from './sms/sms.provider';
import { TokensService } from './tokens.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokensService,
    JwtAuthGuard,
    RolesGuard,
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
  ],
  exports: [TokensService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
