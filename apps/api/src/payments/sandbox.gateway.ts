import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { CheckoutRequest, CheckoutResult, PaymentGateway, PaymentStatus, SavedCardCharge } from './gateway';

/**
 * Built-in test provider for development, staging and automated tests. Refused in production.
 * Its hosted page (/v1/sandbox/checkout/:id) offers "pay" and "decline". Saved cards ending
 * in 0002 are declined on renewal, so failure paths can be exercised.
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox' as const;
  readonly supportsSavedCards = true;

  constructor(
    private readonly redis: Redis,
    private readonly publicUrl: string,
  ) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const id = `sbx_${randomUUID().replace(/-/g, '')}`;
    await this.redis.set(
      key(id),
      JSON.stringify({ status: 'pending', saveCard: req.saveCard, returnUrl: req.returnUrl, amount: req.amountHalalas }),
      'EX',
      86_400,
    );
    return { providerPaymentId: id, checkoutUrl: `${this.publicUrl}/v1/sandbox/checkout/${id}`, status: 'pending' };
  }

  async chargeSavedCard(req: SavedCardCharge): Promise<CheckoutResult> {
    const id = `sbx_${randomUUID().replace(/-/g, '')}`;
    const declined = req.card.last4 === '0002';
    await this.redis.set(key(id), JSON.stringify({ status: declined ? 'failed' : 'paid', saveCard: false }), 'EX', 86_400);
    return { providerPaymentId: id, checkoutUrl: null, status: declined ? 'failed' : 'paid' };
  }

  async retrieve(providerPaymentId: string): Promise<PaymentStatus> {
    const raw = await this.redis.get(key(providerPaymentId));
    if (!raw) return { status: 'failed', failureReason: 'unknown payment', savedCard: null };
    const p = JSON.parse(raw) as { status: 'pending' | 'paid' | 'failed'; saveCard: boolean; last4?: string };
    return {
      status: p.status,
      failureReason: p.status === 'failed' ? 'declined' : null,
      savedCard:
        p.status === 'paid' && p.saveCard
          ? {
              cardId: `card_${providerPaymentId}`,
              customerId: 'cus_sandbox',
              agreementId: `agr_${providerPaymentId}`,
              brand: 'MADA',
              last4: p.last4 ?? '4242',
              expMonth: 12,
              expYear: new Date().getUTCFullYear() + 3,
            }
          : null,
    };
  }

  webhookPaymentId(body: unknown): string | null {
    const id = (body as { id?: unknown })?.id;
    return typeof id === 'string' ? id : null;
  }

  /** Used by the sandbox checkout page. */
  async complete(providerPaymentId: string, outcome: 'paid' | 'failed', last4?: string): Promise<string | null> {
    const raw = await this.redis.get(key(providerPaymentId));
    if (!raw) return null;
    const p = JSON.parse(raw) as { returnUrl?: string };
    await this.redis.set(key(providerPaymentId), JSON.stringify({ ...p, status: outcome, last4 }), 'EX', 86_400);
    return p.returnUrl ?? null;
  }

  async describe(providerPaymentId: string): Promise<{ amount: number; status: string } | null> {
    const raw = await this.redis.get(key(providerPaymentId));
    return raw ? (JSON.parse(raw) as { amount: number; status: string }) : null;
  }
}

const key = (id: string) => `sandbox:payment:${id}`;
