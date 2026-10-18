import { CheckoutRequest, CheckoutResult, PaymentGateway, PaymentStatus } from './gateway';

/**
 * No payment gateway: riders pay by bank transfer or cash and an admin records the payment in the
 * dashboard (BillingService.recordManual). Payments wait as "initiated" until then.
 * Suits a pilot before a merchant account exists; no fees, nothing to integrate.
 */
export class ManualGateway implements PaymentGateway {
  readonly name = 'manual' as const;
  readonly supportsSavedCards = false;

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    return { providerPaymentId: `manual_${req.paymentId}`, checkoutUrl: null, status: 'pending' };
  }

  async chargeSavedCard(): Promise<CheckoutResult> {
    throw new Error('Manual payments cannot charge saved cards');
  }

  async retrieve(): Promise<PaymentStatus> {
    return { status: 'pending', failureReason: null, savedCard: null };
  }

  webhookPaymentId(): string | null {
    return null;
  }
}
