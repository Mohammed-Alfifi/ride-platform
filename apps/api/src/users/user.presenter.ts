import { ApiProperty } from '@nestjs/swagger';
import { AUDIENCES, ROLES, type User } from '../database/schema';

export class UserView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '+966501234567' }) phone!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ enum: ROLES }) role!: User['role'];
  @ApiProperty({ enum: AUDIENCES }) audience!: User['audience'];
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) partnerId!: string | null;
  @ApiProperty({ enum: ['ar', 'en'] }) locale!: User['locale'];
  @ApiProperty({ enum: ['active', 'pending', 'suspended'] }) status!: User['status'];
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastLoginAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export function presentUser(u: User): UserView {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    role: u.role,
    audience: u.audience,
    partnerId: u.partnerId,
    locale: u.locale,
    status: u.status,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}
