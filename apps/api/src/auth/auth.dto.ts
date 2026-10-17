import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { AUDIENCES, type Audience } from '../database/schema';
import { UserView } from '../users/user.presenter';

export class OtpRequestDto {
  @ApiProperty({ example: '0501234567', description: 'Saudi mobile number in any common format' })
  @IsString()
  @MaxLength(24)
  phone!: string;

  @ApiProperty({ enum: AUDIENCES, description: 'The app the user is signing in to' })
  @IsIn(AUDIENCES as unknown as string[])
  app!: Audience;
}

export class OtpRequestResponse {
  @ApiProperty({ example: true }) sent!: boolean;
  @ApiProperty({ example: 300, description: 'Seconds until the code expires' }) expiresIn!: number;
  @ApiProperty({ example: 60, description: 'Seconds before another code may be requested' })
  resendAfter!: number;
}

export class OtpVerifyDto extends OtpRequestDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/)
  code!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'The refresh token returned at sign-in or the last refresh' })
  @IsString()
  @MaxLength(200)
  refreshToken!: string;
}

export class TokenPairView {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ example: 900 }) accessTokenExpiresIn!: number;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ format: 'date-time' }) refreshTokenExpiresAt!: string;
}

export class AuthResponse extends TokenPairView {
  @ApiProperty({ type: UserView }) user!: UserView;
  @ApiProperty({ description: 'True when this sign-in created the account' }) isNewUser!: boolean;
}
