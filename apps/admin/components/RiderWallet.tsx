'use client';

import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, useLoad } from '@/components/ui';
import { api, WalletView } from '@/lib/client';
import { formatDate, formatSar } from '@/lib/format';
import { fill } from '@/lib/i18n';

/** A rider's credit with one partner: compensation, cancellation credit and what was used, plus a manual adjustment. */
export default function RiderWallet({
  rider,
  onClose,
}: {
  rider: { id: string; name: string; partnerId: string } | null;
  onClose: () => void;
}) {
  const { t, lang, notify } = useApp();
  const wallet = useLoad(
    () => (rider ? api<WalletView>(`admin/wallet?riderId=${rider.id}`) : Promise.resolve(null)),
    [rider?.id],
  );
  const balance = wallet.data?.balances.find((b) => b.partnerId === rider?.partnerId)?.balanceHalalas ?? 0;
  const entries = (wallet.data?.entries ?? []).filter((e) => e.partnerId === rider?.partnerId);

  async function adjust(form: FormData) {
    if (!rider) return;
    await api('admin/wallet/adjust', {
      method: 'POST',
      body: {
        riderId: rider.id,
        partnerId: rider.partnerId,
        amountHalalas: Math.round(Number(form.get('amount')) * 100),
        note: String(form.get('note') ?? '').trim(),
      },
    });
    notify(t.wallet.saved);
    await wallet.reload();
  }

  return (
    <FormDialog
      open={rider !== null}
      title={fill(t.wallet.title, { name: rider?.name ?? '' })}
      submitLabel={t.wallet.save}
      onClose={onClose}
      onSubmit={adjust}
    >
      <LoadState loading={wallet.loading && !wallet.data} error={wallet.error} onRetry={wallet.reload} />
      <p className="pay-who">
        <strong>{t.wallet.balance}</strong>
        <span className="tabnum">{formatSar(balance, lang)}</span>
      </p>
      {wallet.data && entries.length === 0 && <p className="hint">{t.wallet.empty}</p>}
      {entries.length > 0 && (
        <ul className="wallet-list">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id}>
              <span>
                {t.wallet.kinds[e.kind]}
                <span className="sub">{formatDate(e.createdAt, lang)}</span>
              </span>
              <span className="tabnum" dir="ltr">
                {e.amountHalalas > 0 ? '+' : '−'}
                {formatSar(Math.abs(e.amountHalalas), lang)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <div className="field">
          <label htmlFor="w-amount">{t.wallet.amount}</label>
          <input id="w-amount" name="amount" className="input num" type="number" step={0.01} required dir="ltr" aria-describedby="w-hint" />
          <span className="hint" id="w-hint">
            {t.wallet.amountHint}
          </span>
        </div>
        <div className="field">
          <label htmlFor="w-note">{t.wallet.note}</label>
          <input id="w-note" name="note" className="input" required minLength={3} maxLength={200} />
        </div>
      </div>
    </FormDialog>
  );
}
