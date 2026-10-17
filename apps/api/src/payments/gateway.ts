/**
 * The one interface every payment provider implements. The rest of the platform never talks
 * to a provider directly, so switching provider is a configuration change.
 *
 * Money is always in halalas (1 SAR = 100 halalas).
 */
export type GatewayStatus = 'pending' | 'paid' | 'failed';

export interface SavedCard {
  /** Provider's id for the stored card (never the card number). */
  cardId: string;
  customerId: string | null;
  /** Agreement that authorises later merchant-initiated charges (required by Tap for MIT). */
  agreementId: string | null;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export interface CheckoutRequest {
  paymentId: string;
  amountHalalas: number;
  description: string;
  customer: { name: string | null; phone: string; providerCustomerId?: string | null };
  /** Ask the provider to keep the card for automatic renewals. */
  saveCard: boolean;
  returnUrl: string;
  webhookUrl: string;
  /** Marketplace split: this part goes straight to the partner's sub-account. */
  split?: { accountId: string; amountHalalas: number } | null;
}

export interface CheckoutResult {
  providerPaymentId: string;
  /** Hosted payment page (or 3-D Secure page). Null when the charge completed without one. */
  checkoutUrl: string | null;
  status: GatewayStatus;
}

export interface SavedCardCharge {
  paymentId: string;
  amountHalalas: number;
  description: string;
  card: SavedCard;
  returnUrl: string;
  webhookUrl: string;
  split?: { accountId: string; amountHalalas: number } | null;
}

export interface PaymentStatus {
  status: GatewayStatus;
  failureReason: string | null;
  /** Filled when the payment saved the card. */
  savedCard: SavedCard | null;
}

export interface PaymentGateway {
  readonly name: 'sandbox' | 'tap' | 'moyasar';
  /** Whether the provider can charge a saved card without the rider (automatic renewals). */
  readonly supportsSavedCards: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Merchant-initiated charge for a renewal. */
  chargeSavedCard(req: SavedCardCharge): Promise<CheckoutResult>;
  /** Server-to-server lookup; the platform never trusts a webhook body or a redirect on its own. */
  retrieve(providerPaymentId: string): Promise<PaymentStatus>;
  /** Pulls the provider payment id out of a webhook body; the status is then fetched with retrieve(). */
  webhookPaymentId(body: unknown): string | null;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export const toSar = (halalas: number): number => Math.round(halalas) / 100;
