import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';
import { AppError, ErrorCode } from './errors';
import { resolveLocale, translate } from './i18n';

interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
  requestId?: string;
}

/**
 * Every error leaves the API in one shape:
 * { "error": { "code": "AUTH_OTP_INVALID", "message": "<localised>", "details": ... }, "requestId": "..." }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const locale = resolveLocale(req.headers['accept-language']);

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL';
    let params: Record<string, string | number> = {};
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      params = exception.params;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'RATE_LIMITED';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForStatus(status);
      if (code === 'DOCUMENT_TOO_LARGE') params = { maxMb: process.env.UPLOAD_MAX_MB ?? '10' };
      const body = exception.getResponse();
      if (status === HttpStatus.BAD_REQUEST && typeof body === 'object' && body !== null) {
        details = (body as { message?: unknown }).message;
      }
    }

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      Sentry.captureException(exception);
    }

    const payload: ErrorBody = {
      error: { code, message: translate(code, locale, params) },
      requestId: req.id ? String(req.id) : undefined,
    };
    if (details !== undefined) payload.error.details = details;
    if (code === 'AUTH_OTP_RATE_LIMITED' && params.retryAfter !== undefined) {
      res.setHeader('Retry-After', String(params.retryAfter));
    }
    res.status(status).json(payload);
  }
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_FAILED';
    case HttpStatus.UNAUTHORIZED:
      return 'AUTH_TOKEN_INVALID';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'DOCUMENT_TOO_LARGE';
    default:
      return 'INTERNAL';
  }
}
