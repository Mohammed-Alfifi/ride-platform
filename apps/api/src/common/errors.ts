import { HttpStatus } from '@nestjs/common';

/** Stable, machine-readable error codes. Apps translate on code, never on message text. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  AUTH_PHONE_INVALID: HttpStatus.BAD_REQUEST,
  AUTH_OTP_INVALID: HttpStatus.UNAUTHORIZED,
  AUTH_OTP_EXPIRED: HttpStatus.UNAUTHORIZED,
  AUTH_OTP_TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,
  AUTH_OTP_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  AUTH_ACCOUNT_SUSPENDED: HttpStatus.FORBIDDEN,
  AUTH_TOKEN_INVALID: HttpStatus.UNAUTHORIZED,
  AUTH_REFRESH_INVALID: HttpStatus.UNAUTHORIZED,
  AUTH_REFRESH_REUSED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  PARTNER_NOT_FOUND: HttpStatus.NOT_FOUND,
  PARTNER_SUSPENDED: HttpStatus.FORBIDDEN,
  PARTNER_CR_EXISTS: HttpStatus.CONFLICT,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  USER_ALREADY_EXISTS: HttpStatus.CONFLICT,
  USER_CANNOT_MODIFY_SELF: HttpStatus.BAD_REQUEST,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, string | number> = {},
    readonly details?: unknown,
  ) {
    super(code);
    this.status = ERROR_STATUS[code];
  }
}
