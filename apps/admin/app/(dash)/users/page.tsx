'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, StatusBadge, useLoad } from '@/components/ui';
import { api, ApiError, PartnerView, UserPage, UserView } from '@/lib/client';
import { formatDate, formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

const PAGE_SIZE = 20;
const ROLE_FILTERS = ['partner_admin', 'dispatcher', 'driver', 'rider', 'super_admin'] as const;

export default function UsersPage() {
  const { t, lang, profile, notify } = useApp();
  const isSuper = profile?.role === 'super_admin';
  const canManage = isSuper || profile?.role === 'partner_admin';

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [newRole, setNewRole] = useState<'partner_admin' | 'dispatcher' | 'super_admin'>('dispatcher');

  // Debounce typing so the list does not reload on every key.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const partners = useLoad(() => api<PartnerView[]>('admin/partners'), []);
  const partnerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of partners.data ?? []) map.set(p.id, lang === 'ar' ? p.nameAr : p.nameEn);
    return map;
  }, [partners.data, lang]);

  const list = useLoad(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (query) params.set('q', query);
    if (role) params.set('role', role);
    if (partnerId) params.set('partnerId', partnerId);
    return api<UserPage>(`admin/users?${params}`);
  }, [query, role, partnerId, page]);

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  async function create(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    await api('admin/users', {
      method: 'POST',
      body: {
        phone: text('phone'),
        name: text('name'),
        role: newRole,
        partnerId: isSuper && newRole !== 'super_admin' ? text('partnerId') || undefined : undefined,
      },
    });
    setAdding(false);
    notify(t.users.created);
    await list.reload();
  }

  async function patch(u: UserView, body: Record<string, string>) {
    try {
      await api(`admin/users/${u.id}`, { method: 'PATCH', body });
      notify(t.users.updated);
      await list.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.users.title}</h1>
        {canManage && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            {t.users.add}
          </button>
        )}
      </div>

      <section className="panel">
        <div className="toolbar">
          <input
            className="input"
            type="search"
            placeholder={t.users.searchPlaceholder}
            aria-label={t.users.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="select"
            aria-label={t.users.role}
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t.users.allRoles}</option>
            {ROLE_FILTERS.filter((r) => isSuper || (r !== 'super_admin' && r !== 'rider')).map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
          {isSuper && (
            <select
              className="select"
              aria-label={t.users.partner}
              value={partnerId}
              onChange={(e) => {
                setPartnerId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t.users.allPartners}</option>
              {(partners.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {lang === 'ar' ? p.nameAr : p.nameEn}
                </option>
              ))}
            </select>
          )}
        </div>

        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.items.length === 0 && <p className="empty">{t.users.empty}</p>}
        {list.data && list.data.items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.users.name}</th>
                  <th scope="col">{t.users.phone}</th>
                  <th scope="col">{t.users.role}</th>
                  {isSuper && <th scope="col">{t.users.partner}</th>}
                  <th scope="col">{t.users.lastLogin}</th>
                  <th scope="col">{t.users.status}</th>
                  {canManage && <th scope="col"><span className="visually-hidden">{t.users.status}</span></th>}
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => {
                  const self = u.id === profile?.id;
                  const staff = u.role === 'partner_admin' || u.role === 'dispatcher';
                  return (
                    <tr key={u.id}>
                      <td>
                        {u.name ?? '—'}
                        {self && <span className="tag-you">{t.users.you}</span>}
                      </td>
                      <td className="num">{formatSaudiPhone(u.phone)}</td>
                      <td>{t.roles[u.role]}</td>
                      {isSuper && <td>{u.partnerId ? partnerName.get(u.partnerId) ?? '—' : '—'}</td>}
                      <td className="tabnum">{formatDate(u.lastLoginAt, lang)}</td>
                      <td>
                        <StatusBadge status={u.status} />
                      </td>
                      {canManage && (
                        <td className="actions">
                          {!self && staff && (
                            <button
                              type="button"
                              className="btn btn-link"
                              onClick={() => patch(u, { role: u.role === 'dispatcher' ? 'partner_admin' : 'dispatcher' })}
                            >
                              {u.role === 'dispatcher' ? t.users.makeAdmin : t.users.makeDispatcher}
                            </button>
                          )}
                          {!self && (u.role !== 'super_admin' || isSuper) && (
                            <button
                              type="button"
                              className={`btn btn-link${u.status === 'suspended' ? '' : ' btn-danger'}`}
                              onClick={() => patch(u, { status: u.status === 'suspended' ? 'active' : 'suspended' })}
                            >
                              {u.status === 'suspended' ? t.users.activate : t.users.suspend}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > PAGE_SIZE && (
          <div className="pager">
            <span>{fill(t.users.pageOf, { page, pages })}</span>
            <div className="btns">
              <button type="button" className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t.users.previous}
              </button>
              <button type="button" className="btn btn-quiet" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t.users.next}
              </button>
            </div>
          </div>
        )}
      </section>

      <FormDialog open={adding} title={t.users.add} submitLabel={t.users.add} onClose={() => setAdding(false)} onSubmit={create}>
        <div className="row">
          <div className="field">
            <label htmlFor="name">{t.users.name}</label>
            <input id="name" name="name" className="input" required minLength={2} />
          </div>
          <div className="field">
            <label htmlFor="phone">{t.users.phone}</label>
            <input id="phone" name="phone" className="input num" type="tel" inputMode="tel" placeholder="05XXXXXXXX" required />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="role">{t.users.role}</label>
            <select
              id="role"
              className="select"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as typeof newRole)}
            >
              <option value="dispatcher">{t.roles.dispatcher}</option>
              <option value="partner_admin">{t.roles.partner_admin}</option>
              {isSuper && <option value="super_admin">{t.roles.super_admin}</option>}
            </select>
          </div>
          {isSuper && newRole !== 'super_admin' && (
            <div className="field">
              <label htmlFor="partnerId">{t.users.partner}</label>
              <select id="partnerId" name="partnerId" className="select" required defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {(partners.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {lang === 'ar' ? p.nameAr : p.nameEn}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </FormDialog>
    </>
  );
}
