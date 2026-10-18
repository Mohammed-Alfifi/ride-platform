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

/** No SMS: sign-in uses access codes issued from the dashboard (ACCESS_MODE=invite). */
@Injectable()
export class NoSmsProvider implements SmsProvider {
  async send(): Promise<void> {
    // Nothing is sent; the caller tells the app to ask for the access code instead.
  }
}

/**
 * Taqnyat (taqnyat.sa), a Saudi SMS gateway. Needs a bearer token and an approved sender name.
 * API: POST https://api.taqnyat.sa/v1/messages { recipients, body, sender }.
 */
export class TaqnyatSmsProvider implements SmsProvider {
  constructor(
    private readonly token: string,
    private readonly sender: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(to: string, message: string): Promise<void> {
    const res = await this.fetcher('https://api.taqnyat.sa/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [to.replace(/^\+/, '')], body: message, sender: this.sender }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Taqnyat returned ${res.status}`);
  }
}
