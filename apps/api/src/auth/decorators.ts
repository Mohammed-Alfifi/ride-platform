import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../database/schema';
import type { AuthUser, RequestMeta } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Route needs no access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is limited to these roles. Without it any signed-in user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return req.user;
});

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : undefined };
});
