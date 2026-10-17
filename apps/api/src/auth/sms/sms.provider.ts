import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '../../common/phone';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  /** Sends a text message to an E.164 number. Throws on delivery failure. */
  send(to: string, message: string): Promise<void>;
}

/**
 * Development and staging only: writes the message to the log instead of sending it.
 * Refused in production by the env schema. Plug a Saudi SMS gateway in by adding a
 * provider class here and a value to SMS_PROVIDER in src/config/env.ts.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  async send(to: string, message: string): Promise<void> {
    this.logger.warn(`[console SMS] to ${maskPhone(to)}: ${message}`);
  }
}
