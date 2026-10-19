'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/client';
import { useApp } from './Providers';

export function StatusBadge({ status }: { status: 'active' | 'pending' | 'suspended' }) {
  const { t } = useApp();
  return <span className={`badge badge-${status}`}>{t.status[status]}</span>;
}

/** Loads data on mount and when deps change; exposes reload for after mutations. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadRef.current());
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, deps); // reload is stable; the caller decides what should trigger a reload

  return { data, error, loading, reload };
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: ApiError | null; onRetry: () => void }) {
  const { t } = useApp();
  if (error) {
    return (
      <div className="error-state" role="alert">
        <span>{error.message || t.common.networkError}</span>
        <button type="button" className="btn btn-quiet" onClick={onRetry}>
          {t.common.retry}
        </button>
      </div>
    );
  }
  if (loading) return <div className="loading">{t.common.loading}</div>;
  return null;
}

/** A modal form built on the native <dialog>, so focus trapping and Escape work for free. */
export function FormDialog({
  open,
  title,
  submitLabel,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setError('');
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(new FormData(e.currentTarget));
      e.currentTarget?.reset();
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t.common.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-labelledby="dialog-title">
      <form onSubmit={submit}>
        <h2 id="dialog-title">{title}</h2>
        {children}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="footer">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Previous / next for a paged list; hidden when everything fits on one page. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const { t } = useApp();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <span>{t.users.pageOf.replace('{page}', String(page)).replace('{pages}', String(pages))}</span>
      <div className="btns">
        <button type="button" className="btn btn-quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t.users.previous}
        </button>
        <button type="button" className="btn btn-quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t.users.next}
        </button>
      </div>
    </div>
  );
}
