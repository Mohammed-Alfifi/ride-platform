import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './guards';
import { OtpService } from './otp.service';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { AccessService } from './access.service';
import { ConsoleSmsProvider, NoSmsProvider, SMS_PROVIDER, SmsProvider, TaqnyatSmsProvider } from './sms/sms.provider';

export function createSmsProvider(env: Env): SmsProvider {
  if (env.SMS_PROVIDER === 'taqnyat') return new TaqnyatSmsProvider(env.TAQNYAT_TOKEN, env.SMS_SENDER);
  if (env.SMS_PROVIDER === 'none') return new NoSmsProvider();
  return new ConsoleSmsProvider();
}
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
    AccessService,
    { provide: SMS_PROVIDER, inject: [ENV], useFactory: createSmsProvider },
  ],
  exports: [TokensService, JwtAuthGuard, RolesGuard, AccessService],
})
export class AuthModule {}
