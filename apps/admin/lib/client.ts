'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Calls the API through the dashboard's own server (/api/proxy), which adds the session. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '');
  }
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError(401, 'AUTH_TOKEN_INVALID', '');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'INTERNAL', body?.error?.message ?? '', body?.error?.details);
  }
  return body as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? '');
  return data as T;
}

export interface Profile {
  id: string;
  name: string | null;
  role: 'super_admin' | 'partner_admin' | 'dispatcher';
  partnerId: string | null;
}

export interface UserView {
  id: string;
  phone: string;
  name: string | null;
  role: 'rider' | 'driver' | 'partner_admin' | 'dispatcher' | 'super_admin';
  audience: 'rider' | 'driver' | 'admin';
  partnerId: string | null;
  locale: 'ar' | 'en';
  status: 'active' | 'pending' | 'suspended';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserPage {
  items: UserView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PartnerView {
  id: string;
  nameAr: string;
  nameEn: string;
  legalName: string | null;
  crNumber: string | null;
  tgaLicenseNumber: string | null;
  contactPhone: string | null;
  commissionBps: number;
  status: 'active' | 'suspended';
  staffCount: number;
  createdAt: string;
}
