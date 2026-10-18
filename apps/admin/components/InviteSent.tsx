'use client';

import { useEffect, useRef } from 'react';
import { useApp } from './Providers';

export interface IssuedCode {
  code: string;
  message: string;
  whatsappUrl: string;
  invite: { id: string; name: string | null; phone: string };
}

/** Shows a fresh access code once, with the WhatsApp message ready to send. */
export function InviteSent({ issued, onClose }: { issued: IssuedCode | null; onClose: () => void }) {
  const { t, notify } = useApp();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (issued && !el.open) el.showModal();
    else if (!issued && el.open) el.close();
  }, [issued]);

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.message);
      notify(t.pilot.copied);
    } catch {
      notify(t.common.networkError, 'error');
    }
  }

  return (
    <dialog ref={ref} className="sheet invite-sent" onClose={onClose} aria-labelledby="invite-title">
      {issued && (
        <div>
          <h2 id="invite-title">{t.pilot.sendTitle}</h2>
          <p className="hint">{t.pilot.sendIntro}</p>
          <div className="invite-code" aria-label={t.pilot.code}>
            <span className="label">{t.pilot.code}</span>
            <span className="digits num" dir="ltr">
              {issued.code.slice(0, 4)} {issued.code.slice(4)}
            </span>
          </div>
          <pre className="invite-message">{issued.message}</pre>
          <div className="footer">
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              {t.pilot.done}
            </button>
            <button type="button" className="btn btn-quiet" onClick={copy}>
              {t.pilot.copy}
            </button>
            <a className="btn btn-whatsapp" href={issued.whatsappUrl} target="_blank" rel="noopener noreferrer">
              {t.pilot.whatsapp}
            </a>
          </div>
        </div>
      )}
    </dialog>
  );
}
