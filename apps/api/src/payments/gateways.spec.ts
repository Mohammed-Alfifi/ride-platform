import { CheckoutRequest } from './gateway';
import { MoyasarGateway } from './moyasar.gateway';
import { TapGateway } from './tap.gateway';

interface Call {
  url: string;
  method: string;
  auth: string;
  body: Record<string, unknown> | undefined;
}

function fakeFetch(responses: unknown[], status = 200) {
  const calls: Call[] = [];
  const http = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method as string,
      auth: (init.headers as Record<string, string>).Authorization,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = responses.shift();
    return { ok: status < 400, status, text: async () => JSON.stringify(next ?? {}) } as Response;
  }) as unknown as typeof fetch;
  return { http, calls };
}

const request: CheckoutRequest = {
  paymentId: 'pay-1',
  amountHalalas: 115000,
  description: 'Round trip',
  customer: { name: 'Sara', phone: '+966501234567', providerCustomerId: null },
  saveCard: true,
  returnUrl: 'https://api.example.sa/v1/payments/pay-1/return',
  webhookUrl: 'https://api.example.sa/v1/webhooks/payments/tap',
  split: { accountId: 'dest_42', amountHalalas: 97750 },
};

describe('TapGateway', () => {
  it('opens a hosted charge that saves the card and splits the partner share', async () => {
    const { http, calls } = fakeFetch([{ id: 'chg_1', status: 'INITIATED', transaction: { url: 'https://tap/pay' } }]);
    const tap = new TapGateway('sk_test', 'm_9', 'https://api.tap.company', http);
    const res = await tap.createCheckout(request);
    expect(res).toEqual({ providerPaymentId: 'chg_1', checkoutUrl: 'https://tap/pay', status: 'pending' });
    expect(calls[0]).toMatchObject({ url: 'https://api.tap.company/v2/charges', method: 'POST', auth: 'Bearer sk_test' });
    expect(calls[0].body).toMatchObject({
      amount: 1150,
      currency: 'SAR',
      save_card: true,
      customer_initiated: true,
      source: { id: 'src_all' },
      merchant: { id: 'm_9' },
      customer: { phone: { country_code: '966', number: '501234567' } },
      redirect: { url: request.returnUrl },
      post: { url: request.webhookUrl },
      destinations: { destination: [{ id: 'dest_42', amount: 977.5, currency: 'SAR' }] },
    });
  });

  it('charges a saved card through a token and the payment agreement', async () => {
    const { http, calls } = fakeFetch([{ id: 'tok_1' }, { id: 'chg_2', status: 'CAPTURED' }]);
    const tap = new TapGateway('sk_test', '', 'https://api.tap.company', http);
    const res = await tap.chargeSavedCard({
      ...request,
      split: undefined,
      card: { cardId: 'card_1', customerId: 'cus_1', agreementId: 'agr_1', brand: 'MADA', last4: '4242', expMonth: 1, expYear: 2030 },
    });
    expect(res.status).toBe('paid');
    expect(calls[0]).toMatchObject({ url: 'https://api.tap.company/v2/tokens', body: { saved_card: { card_id: 'card_1', customer_id: 'cus_1' } } });
    expect(calls[1].body).toMatchObject({ customer_initiated: false, payment_agreement: { id: 'agr_1' }, source: { id: 'tok_1' } });
    expect(calls[1].body).not.toHaveProperty('merchant');
    expect(calls[1].body).not.toHaveProperty('destinations');
  });

  it('refuses a saved card without an agreement', async () => {
    const tap = new TapGateway('sk', '', 'https://x', fakeFetch([]).http);
    await expect(
      tap.chargeSavedCard({ ...request, card: { cardId: 'c', customerId: null, agreementId: null, brand: 'VISA', last4: '1', expMonth: null, expYear: null } }),
    ).rejects.toThrow(/agreement/);
  });

  it('reads the charge back, including the card to keep', async () => {
    const { http } = fakeFetch([
      {
        id: 'chg_1',
        status: 'CAPTURED',
        customer: { id: 'cus_1' },
        card: { scheme: 'mada', last_four: '1234', exp_month: 5, exp_year: 2029 },
        payment_agreement: { id: 'agr_1', contract: { id: 'card_9' } },
      },
      { id: 'chg_2', status: 'DECLINED', response: { message: 'Insufficient funds' } },
    ]);
    const tap = new TapGateway('sk', '', 'https://x', http);
    expect(await tap.retrieve('chg_1')).toEqual({
      status: 'paid',
      failureReason: null,
      savedCard: { cardId: 'card_9', customerId: 'cus_1', agreementId: 'agr_1', brand: 'MADA', last4: '1234', expMonth: 5, expYear: 2029 },
    });
    expect(await tap.retrieve('chg_2')).toEqual({ status: 'failed', failureReason: 'Insufficient funds', savedCard: null });
  });

  it('reports provider errors and only takes charge ids from webhooks', async () => {
    const tap = new TapGateway('sk', '', 'https://x', fakeFetch([{ errors: [] }], 401).http);
    await expect(tap.retrieve('chg_1')).rejects.toThrow(/401/);
    expect(tap.webhookPaymentId({ id: 'chg_abc' })).toBe('chg_abc');
    expect(tap.webhookPaymentId({ id: 'evil' })).toBeNull();
    expect(tap.webhookPaymentId(null)).toBeNull();
  });
});

describe('MoyasarGateway', () => {
  it('creates a hosted invoice with basic auth', async () => {
    const { http, calls } = fakeFetch([{ id: 'inv_1', url: 'https://moyasar/i/1', status: 'initiated' }]);
    const m = new MoyasarGateway('sk_live', 'https://api.moyasar.com', http);
    expect(await m.createCheckout(request)).toEqual({ providerPaymentId: 'inv_1', checkoutUrl: 'https://moyasar/i/1', status: 'pending' });
    expect(calls[0]).toMatchObject({
      url: 'https://api.moyasar.com/v1/invoices',
      auth: `Basic ${Buffer.from('sk_live:').toString('base64')}`,
      body: { amount: 115000, currency: 'SAR', success_url: request.returnUrl },
    });
    expect(m.supportsSavedCards).toBe(false);
  });

  it('maps invoice statuses and webhook ids', async () => {
    const m = new MoyasarGateway('sk', 'https://x', fakeFetch([{ status: 'paid' }, { status: 'initiated' }, { status: 'expired' }]).http);
    expect((await m.retrieve('a')).status).toBe('paid');
    expect((await m.retrieve('b')).status).toBe('pending');
    expect(await m.retrieve('c')).toMatchObject({ status: 'failed', failureReason: 'expired' });
    expect(m.webhookPaymentId({ data: { invoice_id: 'inv_7', id: 'pay_1' } })).toBe('inv_7');
    await expect(m.chargeSavedCard({} as never)).rejects.toThrow(/payment link/);
  });
});
