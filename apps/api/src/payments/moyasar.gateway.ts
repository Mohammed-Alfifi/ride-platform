import { Logger } from '@nestjs/common';
import { CheckoutRequest, CheckoutResult, PaymentGateway, PaymentStatus, SavedCardCharge } from './gateway';

type Fetch = typeof fetch;

/**
 * Moyasar (https://docs.moyasar.com), kept as the alternative provider.
 * Checkout uses a hosted invoice page (mada, cards, Apple Pay, STC Pay). Moyasar's hosted
 * invoice does not hand back a reusable card, so renewals fall back to a payment link that
 * the rider pays from the app. Marketplace splits are not available.
 */
export class MoyasarGateway implements PaymentGateway {
  readonly name = 'moyasar' as const;
  readonly supportsSavedCards = false;
  private readonly logger = new Logger('Moyasar');

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.moyasar.com',
    private readonly http: Fetch = fetch,
  ) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const invoice = await this.call<{ id: string; url: string; status: string }>('POST', '/v1/invoices', {
      amount: req.amountHalalas,
      currency: 'SAR',
      description: req.description,
      callback_url: req.webhookUrl,
      success_url: req.returnUrl,
      back_url: req.returnUrl,
      metadata: { payment_id: req.paymentId },
    });
    return { providerPaymentId: invoice.id, checkoutUrl: invoice.url, status: 'pending' };
  }

  async chargeSavedCard(_req: SavedCardCharge): Promise<CheckoutResult> {
    throw new Error('Moyasar invoices do not provide saved cards; renew with a payment link');
  }

  async retrieve(providerPaymentId: string): Promise<PaymentStatus> {
    const invoice = await this.call<{ status: string }>('GET', `/v1/invoices/${encodeURIComponent(providerPaymentId)}`);
    const status = invoice.status === 'paid' ? 'paid' : ['initiated', 'pending'].includes(invoice.status) ? 'pending' : 'failed';
    return { status, failureReason: status === 'failed' ? invoice.status : null, savedCard: null };
  }

  webhookPaymentId(body: unknown): string | null {
    const data = (body as { data?: { invoice_id?: unknown; id?: unknown } })?.data;
    const id = data?.invoice_id ?? data?.id;
    return typeof id === 'string' ? id : null;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`Moyasar ${method} ${path} failed with ${res.status}`);
    }
    return JSON.parse(text) as T;
  }
}
