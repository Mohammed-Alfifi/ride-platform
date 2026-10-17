'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, useLoad } from '@/components/ui';
import { api, ApiError, DocType, DocumentView, DriverDetail } from '@/lib/client';
import { formatDate, formatDay, formatSaudiPhone } from '@/lib/format';

const DOC_ORDER: DocType[] = [
  'driver_photo',
  'national_id',
  'driving_license',
  'vehicle_registration',
  'vehicle_insurance',
  'periodic_inspection',
];

export default function DriverDetailPage() {
  const { t, lang, profile, notify } = useApp();
  const { id } = useParams<{ id: string }>();
  const canReview = profile?.role === 'super_admin' || profile?.role === 'partner_admin';
  const detail = useLoad(() => api<DriverDetail>(`admin/drivers/${id}`), [id]);

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [marked, setMarked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [docToReject, setDocToReject] = useState<DocumentView | null>(null);

  const d = detail.data;
  const docs = d ? [...d.documents].sort((a, b) => DOC_ORDER.indexOf(a.type) - DOC_ORDER.indexOf(b.type)) : [];
  const reviewing = d?.onboardingStatus === 'submitted' && canReview;
  const pendingRenewals = d?.onboardingStatus === 'approved' ? docs.filter((x) => x.status === 'pending') : [];

  const errorText = (err: unknown) => (err instanceof ApiError && err.message ? err.message : t.common.networkError);

  async function approve() {
    setBusy(true);
    try {
      await api(`admin/drivers/${id}/approve`, { method: 'POST' });
      notify(t.drivers.approved);
      await detail.reload();
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendBack() {
    if (reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`admin/drivers/${id}/reject`, {
        method: 'POST',
        body: {
          reason: reason.trim(),
          documents: Object.entries(marked).map(([documentId, r]) => ({
            documentId,
            reason: r.trim().length >= 3 ? r.trim() : reason.trim(),
          })),
        },
      });
      notify(t.drivers.rejected);
      setRejecting(false);
      setMarked({});
      setReason('');
      await detail.reload();
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reviewDoc(doc: DocumentView, status: 'accepted' | 'rejected', rejectionReason?: string) {
    await api(`admin/documents/${doc.id}`, { method: 'PATCH', body: { status, rejectionReason } });
    notify(status === 'accepted' ? t.drivers.docAccepted : t.drivers.docRejected);
    await detail.reload();
  }

  function holdText(reasonCode: string | null): string {
    if (!reasonCode) return '';
    return reasonCode
      .split(',')
      .map((part) => {
        const [, type] = part.split(':');
        if (type && type in t.docTypes) return t.docTypes[type as DocType];
        return part === 'vehicle_too_old' ? t.drivers.eligibleUntil : part;
      })
      .join('، ');
  }

  return (
    <>
      <Link href="/drivers" className="back-link">
        {t.drivers.back}
      </Link>
      <LoadState loading={detail.loading && !d} error={detail.error} onRetry={detail.reload} />
      {d && (
        <>
          <div className="detail-head">
            <div>
              <h1>{d.fullName ?? formatSaudiPhone(d.phone)}</h1>
              <div className="meta">
                <span className={`badge badge-${d.onboardingStatus === 'approved' ? 'active' : d.onboardingStatus === 'rejected' ? 'suspended' : 'pending'}`}>
                  {t.drivers.onboarding[d.onboardingStatus]}
                </span>
                {d.submittedAt && (
                  <span className="tabnum">
                    {t.drivers.submittedAt}: {formatDate(d.submittedAt, lang)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {d.complianceHold && (
            <div className="alert alert-red" role="status">
              <h2>{t.drivers.complianceTitle}</h2>
              <p>
                {t.drivers.complianceBody}
                {holdText(d.complianceReason)}
              </p>
            </div>
          )}
          {d.onboardingStatus === 'rejected' && d.rejectionReason && (
            <div className="alert alert-amber">
              <p>
                {t.drivers.rejectionShown}
                {d.rejectionReason}
              </p>
            </div>
          )}
          {pendingRenewals.length > 0 && canReview && (
            <div className="alert alert-amber">
              <p>{t.drivers.reviewNote}</p>
            </div>
          )}

          <div className="detail-grid">
            <section className="panel">
              <h2>{t.drivers.personal}</h2>
              <dl className="facts">
                <dt>{t.drivers.phone}</dt>
                <dd className="num">{formatSaudiPhone(d.phone)}</dd>
                <dt>{t.drivers.nationalId}</dt>
                <dd className="num">{d.nationalId ?? '—'}</dd>
                <dt>{t.drivers.dateOfBirth}</dt>
                <dd className="tabnum">{formatDay(d.dateOfBirth, lang)}</dd>
              </dl>
            </section>
            <section className="panel">
              <h2>{t.drivers.vehicleTitle}</h2>
              {d.vehicle ? (
                <dl className="facts">
                  <dt>{t.drivers.plate}</dt>
                  <dd>
                    <span className="plate" aria-label={`${d.vehicle.plateLetters} ${d.vehicle.plateNumbers}`}>
                      <span>{d.vehicle.plateNumbers}</span>
                      {/* Latin letters sit under their Arabic letters, so they read reversed on the plate. */}
                      <span>{d.vehicle.plateLetters.split('').reverse().join(' ')}</span>
                    </span>
                  </dd>
                  <dt>{t.drivers.model}</dt>
                  <dd>
                    {d.vehicle.make} {d.vehicle.model}
                  </dd>
                  <dt>{t.drivers.year}</dt>
                  <dd className="tabnum">{d.vehicle.year}</dd>
                  <dt>{t.drivers.color}</dt>
                  <dd>{d.vehicle.color}</dd>
                  <dt>{t.drivers.seats}</dt>
                  <dd className="tabnum">{d.vehicle.seats}</dd>
                  <dt>{t.drivers.eligibleUntil}</dt>
                  <dd className="tabnum">{formatDay(d.vehicle.eligibleUntil, lang)}</dd>
                </dl>
              ) : (
                <p className="empty">—</p>
              )}
            </section>
          </div>

          <section className="panel" style={{ marginBottom: '1.25rem' }}>
            <h2>{t.drivers.documents}</h2>
            {rejecting && <p className="lead" style={{ margin: '0.5rem 1.25rem 0' }}>{t.drivers.rejectDocs}</p>}
            <div className="docs">
              {docs.map((doc) => {
                const isMarked = doc.id in marked;
                const src = `/api/proxy/documents/${doc.id}/file`;
                return (
                  <article key={doc.id} className={`doc${isMarked ? ' is-marked' : ''}`}>
                    <a className="doc-thumb" href={src} target="_blank" rel="noreferrer" aria-label={`${t.drivers.openFile}: ${t.docTypes[doc.type]}`}>
                      {doc.mime.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt={t.docTypes[doc.type]} loading="lazy" />
                      ) : (
                        <span className="pdf">PDF</span>
                      )}
                    </a>
                    <div className="doc-body">
                      <strong>{t.docTypes[doc.type]}</strong>
                      {doc.expiresAt && (
                        <span className="sub tabnum">
                          {t.drivers.expires}: {formatDay(doc.expiresAt, lang)}
                        </span>
                      )}
                      <span className={`badge badge-${doc.status === 'accepted' ? 'active' : doc.status === 'rejected' ? 'suspended' : 'pending'}`}>
                        {t.docStatus[doc.status]}
                      </span>
                      {doc.rejectionReason && <span className="reason">{doc.rejectionReason}</span>}
                    </div>
                    {rejecting && (
                      <>
                        <label className="doc-mark">
                          <input
                            type="checkbox"
                            checked={isMarked}
                            onChange={(e) =>
                              setMarked((m) => {
                                const next = { ...m };
                                if (e.target.checked) next[doc.id] = '';
                                else delete next[doc.id];
                                return next;
                              })
                            }
                          />
                          {t.drivers.rejectDoc}
                        </label>
                        {isMarked && (
                          <div className="doc-mark">
                            <input
                              className="input"
                              placeholder={t.drivers.docReason}
                              aria-label={t.drivers.docReason}
                              value={marked[doc.id]}
                              onChange={(e) => setMarked((m) => ({ ...m, [doc.id]: e.target.value }))}
                            />
                          </div>
                        )}
                      </>
                    )}
                    {canReview && d.onboardingStatus === 'approved' && doc.status === 'pending' && (
                      <div className="doc-actions">
                        <button type="button" className="btn btn-link" onClick={() => reviewDoc(doc, 'accepted').catch((e) => notify(errorText(e), 'error'))}>
                          {t.drivers.acceptDoc}
                        </button>
                        <button type="button" className="btn btn-link btn-danger" onClick={() => setDocToReject(doc)}>
                          {t.drivers.rejectDoc}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {reviewing && !rejecting && (
            <div className="action-bar">
              <p>{t.drivers.approveHint}</p>
              <div className="btns">
                <button type="button" className="btn btn-quiet" onClick={() => setRejecting(true)} disabled={busy}>
                  {t.drivers.reject}
                </button>
                <button type="button" className="btn" onClick={approve} disabled={busy}>
                  {t.drivers.approve}
                </button>
              </div>
            </div>
          )}
          {reviewing && rejecting && (
            <div className="action-bar" style={{ display: 'grid' }}>
              <div className="field">
                <label htmlFor="reason">{t.drivers.rejectReason}</label>
                <textarea id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </div>
              <div className="btns" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    setRejecting(false);
                    setMarked({});
                  }}
                >
                  {t.common.cancel}
                </button>
                <button type="button" className="btn" onClick={sendBack} disabled={busy || reason.trim().length < 3}>
                  {t.drivers.reject}
                </button>
              </div>
            </div>
          )}

          <FormDialog
            open={docToReject !== null}
            title={docToReject ? `${t.drivers.rejectDoc}: ${t.docTypes[docToReject.type]}` : ''}
            submitLabel={t.drivers.rejectDoc}
            onClose={() => setDocToReject(null)}
            onSubmit={async (form) => {
              if (!docToReject) return;
              await reviewDoc(docToReject, 'rejected', String(form.get('reason') ?? '').trim());
              setDocToReject(null);
            }}
          >
            <div className="field">
              <label htmlFor="doc-reason">{t.drivers.docReason}</label>
              <textarea id="doc-reason" name="reason" className="input" required minLength={3} maxLength={300} />
            </div>
          </FormDialog>
        </>
      )}
    </>
  );
}
