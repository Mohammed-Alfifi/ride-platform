import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { ROLES, type Role } from '../database/schema';
import { UserView } from './user.presenter';

const ADMIN_ROLE_VALUES = ['partner_admin', 'dispatcher', 'super_admin'] as const;
type AdminRole = (typeof ADMIN_ROLE_VALUES)[number];

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'محمد' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'] })
  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: 'ar' | 'en';
}

export class ListUsersQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Super admins only; partner staff always see their own partner' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES as unknown as string[])
  role?: Role;

  @ApiPropertyOptional({ description: 'Search by name or phone digits' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class CreateStaffDto {
  @ApiProperty({ example: '0501234567' })
  @IsString()
  @MaxLength(24)
  phone!: string;

  @ApiProperty({ example: 'أحمد' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ enum: ADMIN_ROLE_VALUES })
  @IsIn(ADMIN_ROLE_VALUES as unknown as string[])
  role!: AdminRole;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required for partner roles when the caller is a super admin' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ enum: ['partner_admin', 'dispatcher'] })
  @IsOptional()
  @IsIn(['partner_admin', 'dispatcher'])
  role?: 'partner_admin' | 'dispatcher';

  @ApiPropertyOptional({ enum: ['active', 'pending', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'pending', 'suspended'])
  status?: 'active' | 'pending' | 'suspended';
}

export class UserPage {
  @ApiProperty({ type: [UserView] }) items!: UserView[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
