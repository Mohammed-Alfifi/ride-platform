import { TaqnyatSmsProvider } from './sms.provider';

describe('TaqnyatSmsProvider', () => {
  it('posts the message with the bearer token and sender', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    await new TaqnyatSmsProvider('tok', 'Mishwar', fake).send('+966501234567', 'رمز التحقق: 1234');
    expect(calls[0].url).toBe('https://api.taqnyat.sa/v1/messages');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ recipients: ['966501234567'], body: 'رمز التحقق: 1234', sender: 'Mishwar' });
  });

  it('throws when the gateway refuses, so the user sees an error', async () => {
    const fake = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    await expect(new TaqnyatSmsProvider('bad', 'X', fake).send('+966501234567', 'x')).rejects.toThrow(/401/);
  });
});
