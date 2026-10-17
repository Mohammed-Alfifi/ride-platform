import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { resolveLocale } from '../common/i18n';
import type { AuthUser, RequestMeta } from './auth.types';
import {
  AuthResponse,
  OtpRequestDto,
  OtpRequestResponse,
  OtpVerifyDto,
  RefreshDto,
  TokenPairView,
} from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser, Public, ReqMeta } from './decorators';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a one-time code by SMS' })
  @ApiOkResponse({ type: OtpRequestResponse })
  requestOtp(
    @Body() dto: OtpRequestDto,
    @Headers('accept-language') lang?: string,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(dto.phone, dto.app, resolveLocale(lang));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the code and sign in (creates rider and driver accounts on first sign-in)' })
  @ApiOkResponse({ type: AuthResponse })
  verifyOtp(@Body() dto: OtpVerifyDto, @ReqMeta() meta: RequestMeta): Promise<AuthResponse> {
    return this.auth.verifyOtp(dto.phone, dto.app, dto.code, meta);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (rotation)' })
  @ApiOkResponse({ type: TokenPairView })
  refresh(@Body() dto: RefreshDto, @ReqMeta() meta: RequestMeta): Promise<TokenPairView> {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End this session' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'End every session of the signed-in user on all devices' })
  async logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logoutAll(user.id);
  }
}
