import { Logger } from '@nestjs/common';
import {
  CheckoutRequest,
  CheckoutResult,
  GatewayStatus,
  PaymentGateway,
  PaymentStatus,
  SavedCard,
  SavedCardCharge,
  toSar,
} from './gateway';

type Fetch = typeof fetch;

interface TapCharge {
  id: string;
  status: string;
  transaction?: { url?: string };
  response?: { code?: string; message?: string };
  card?: { id?: string; brand?: string; scheme?: string; last_four?: string; exp_month?: number; exp_year?: number };
  customer?: { id?: string };
  payment_agreement?: { id?: string; contract?: { id?: string; customer_id?: string } };
}

export class TapError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Tap Payments (https://developers.tap.company).
 * - Checkout: a charge with source "src_all" returns a hosted page listing every enabled
 *   method (mada, Visa/Mastercard, Apple Pay, STC Pay). save_card keeps the card and returns
 *   a payment agreement for later merchant-initiated charges, mada included.
 * - Renewal: a one-time token is created from the saved card, then charged with
 *   customer_initiated=false and the payment agreement.
 * - Marketplace: "destinations" sends the partner's share to their Tap sub-account.
 */
export class TapGateway implements PaymentGateway {
  readonly name = 'tap' as const;
  readonly supportsSavedCards = true;
  private readonly logger = new Logger('Tap');

  constructor(
    private readonly secretKey: string,
    private readonly merchantId: string,
    private readonly baseUrl = 'https://api.tap.company',
    private readonly http: Fetch = fetch,
  ) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const body: Record<string, unknown> = {
      amount: toSar(req.amountHalalas),
      currency: 'SAR',
      customer_initiated: true,
      threeDSecure: true,
      save_card: req.saveCard,
      description: req.description,
      metadata: { payment_id: req.paymentId },
      reference: { transaction: req.paymentId, order: req.paymentId },
      receipt: { email: false, sms: false },
      customer: req.customer.providerCustomerId
        ? { id: req.customer.providerCustomerId }
        : {
            first_name: req.customer.name ?? 'Rider',
            phone: { country_code: '966', number: req.customer.phone.replace(/^\+966/, '') },
          },
      source: { id: 'src_all' },
      post: { url: req.webhookUrl },
      redirect: { url: req.returnUrl },
      ...this.merchant(),
      ...this.destinations(req.split),
    };
    const charge = await this.call<TapCharge>('POST', '/v2/charges', body);
    return { providerPaymentId: charge.id, checkoutUrl: charge.transaction?.url ?? null, status: mapStatus(charge.status) };
  }

  async chargeSavedCard(req: SavedCardCharge): Promise<CheckoutResult> {
    if (!req.card.customerId || !req.card.agreementId) {
      throw new TapError('Saved card is missing its customer or payment agreement', 400);
    }
    const token = await this.call<{ id: string }>('POST', '/v2/tokens', {
      saved_card: { card_id: req.card.cardId, customer_id: req.card.customerId },
    });
    const charge = await this.call<TapCharge>('POST', '/v2/charges', {
      amount: toSar(req.amountHalalas),
      currency: 'SAR',
      customer_initiated: false,
      threeDSecure: false,
      save_card: false,
      payment_agreement: { id: req.card.agreementId },
      description: req.description,
      metadata: { payment_id: req.paymentId },
      reference: { transaction: req.paymentId, order: req.paymentId },
      customer: { id: req.card.customerId },
      source: { id: token.id },
      post: { url: req.webhookUrl },
      redirect: { url: req.returnUrl },
      ...this.merchant(),
      ...this.destinations(req.split),
    });
    return { providerPaymentId: charge.id, checkoutUrl: charge.transaction?.url ?? null, status: mapStatus(charge.status) };
  }

  async retrieve(providerPaymentId: string): Promise<PaymentStatus> {
    const charge = await this.call<TapCharge>('GET', `/v2/charges/${encodeURIComponent(providerPaymentId)}`);
    const status = mapStatus(charge.status);
    const cardId = charge.payment_agreement?.contract?.id ?? charge.card?.id ?? null;
    const savedCard: SavedCard | null =
      status === 'paid' && cardId && charge.payment_agreement?.id
        ? {
            cardId,
            customerId: charge.customer?.id ?? charge.payment_agreement.contract?.customer_id ?? null,
            agreementId: charge.payment_agreement.id,
            brand: (charge.card?.scheme ?? charge.card?.brand ?? 'CARD').toUpperCase(),
            last4: charge.card?.last_four ?? '0000',
            expMonth: charge.card?.exp_month ?? null,
            expYear: charge.card?.exp_year ?? null,
          }
        : null;
    return {
      status,
      failureReason: status === 'failed' ? (charge.response?.message ?? charge.status) : null,
      savedCard,
    };
  }

  webhookPaymentId(body: unknown): string | null {
    const id = (body as { id?: unknown })?.id;
    return typeof id === 'string' && id.startsWith('chg_') ? id : null;
  }

  private merchant(): Record<string, unknown> {
    return this.merchantId ? { merchant: { id: this.merchantId } } : {};
  }

  private destinations(split: CheckoutRequest['split']): Record<string, unknown> {
    if (!split || split.amountHalalas <= 0) return {};
    return { destinations: { destination: [{ id: split.accountId, amount: toSar(split.amountHalalas), currency: 'SAR' }] } };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
      throw new TapError(`Tap ${method} ${path} failed with ${res.status}`, res.status);
    }
    return JSON.parse(text) as T;
  }
}

function mapStatus(status: string | undefined): GatewayStatus {
  switch (status) {
    case 'CAPTURED':
      return 'paid';
    case 'INITIATED':
    case 'IN_PROGRESS':
    case 'UNKNOWN':
      return 'pending';
    default:
      return 'failed';
  }
}
