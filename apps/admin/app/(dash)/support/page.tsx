'use client';

import { FormEvent, useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatDate, formatSaudiPhone } from '@/lib/format';

type Status = 'open' | 'answered' | 'closed';
type Category = 'trip' | 'driver' | 'payment' | 'app' | 'other';

interface TicketRow {
  id: string;
  number: number;
  category: Category;
  subject: string;
  status: Status;
  urgent?: boolean;
  tripId: string | null;
  lastMessageAt: string;
  requester?: { name: string | null; phone: string; role: string };
}

interface Ticket extends TicketRow {
  messages: { id: string; fromStaff: boolean; body: string; authorName: string | null; createdAt: string }[];
}

const FILTERS: ('open' | 'answered' | 'closed' | '')[] = ['open', 'answered', 'closed', ''];
const TONE: Record<Status, string> = { open: 'pending', answered: 'active', closed: 'muted' };

export default function SupportPage() {
  const { t, lang, notify } = useApp();
  const [status, setStatus] = useState<Status | ''>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useLoad(() => api<TicketRow[]>(`admin/support/tickets${status ? `?status=${status}` : ''}`), [status]);
  const ticket = useLoad(() => (selected ? api<Ticket>(`admin/support/tickets/${selected}`) : Promise.resolve(null)), [selected]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    setBusy(true);
    try {
      await api(`admin/support/tickets/${selected}/reply`, { method: 'POST', body: { body: draft.trim() } });
      setDraft('');
      notify(t.support.sent);
      await Promise.all([ticket.reload(), list.reload()]);
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!selected) return;
    await api(`admin/support/tickets/${selected}/close`, { method: 'POST' });
    await Promise.all([ticket.reload(), list.reload()]);
  }

  const role = (r: string) => (r === 'driver' ? t.support.roles.driver : t.support.roles.rider);

  return (
    <>
      <div className="page-head">
        <h1>{t.support.title}</h1>
      </div>
      <div className="support">
        <section className="panel">
          <div className="tabs" role="tablist">
            {FILTERS.map((f) => (
              <button key={f || 'all'} type="button" role="tab" aria-selected={status === f} onClick={() => setStatus(f)}>
                {f ? t.support.filters[f] : t.support.filters.all}
              </button>
            ))}
          </div>
          <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
          {list.data && list.data.length === 0 && <p className="empty">{t.support.empty}</p>}
          <ul className="ticket-list">
            {list.data?.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  aria-current={x.id === selected}
                  className={x.urgent && x.status !== 'closed' ? 'ticket-urgent' : undefined}
                  onClick={() => setSelected(x.id)}
                >
                  <span className="ticket-head">
                    <strong>
                      {x.urgent && <span className="badge badge-urgent">{t.support.urgent}</span>} {x.subject}
                    </strong>
                    <span className={`badge badge-${TONE[x.status]}`}>{t.support.states[x.status]}</span>
                  </span>
                  <span className="sub">
                    #{x.number} · {t.support.categories[x.category]} · {x.requester?.name ?? (x.requester ? formatSaudiPhone(x.requester.phone) : '')}{' '}
                    {x.requester && `(${role(x.requester.role)})`}
                  </span>
                  <span className="sub tabnum">{formatDate(x.lastMessageAt, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          {!selected && <p className="empty">{t.support.choose}</p>}
          {selected && <LoadState loading={ticket.loading && !ticket.data} error={ticket.error} onRetry={ticket.reload} />}
          {ticket.data && (
            <>
              <div className="thread">
                <div className="ticket-head">
                  <h2 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>
                    #{ticket.data.number} {ticket.data.subject}
                  </h2>
                  {ticket.data.status !== 'closed' && (
                    <button type="button" className="btn btn-link" onClick={close}>
                      {t.support.close}
                    </button>
                  )}
                </div>
                {ticket.data.requester && (
                  <p className="sub">
                    {t.support.customer}: {ticket.data.requester.name ?? '—'} ·{' '}
                    <a href={`tel:${ticket.data.requester.phone}`} dir="ltr">
                      {formatSaudiPhone(ticket.data.requester.phone)}
                    </a>
                  </p>
                )}
                {ticket.data.messages.map((m) => (
                  <div key={m.id} className={`msg${m.fromStaff ? ' staff' : ''}`}>
                    {m.body}
                    <span className="meta">
                      {m.authorName ?? ''} · <span className="tabnum">{formatDate(m.createdAt, lang)}</span>
                    </span>
                  </div>
                ))}
              </div>
              {ticket.data.status === 'closed' ? (
                <p className="empty">{t.support.closed}</p>
              ) : (
                <form className="reply" onSubmit={send}>
                  <label htmlFor="reply" className="visually-hidden">
                    {t.support.reply}
                  </label>
                  <textarea
                    id="reply"
                    className="input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t.support.replyPlaceholder}
                    maxLength={2000}
                  />
                  <button type="submit" className="btn" disabled={busy || !draft.trim()}>
                    {t.support.send}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
