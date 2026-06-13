/**
 * Typed API client. Same-origin via the Vite dev proxy, so the session cookie
 * rides along automatically. Errors throw an ApiError carrying the status.
 */

import type { Business, Diagnostic, Edition, FontFace, ImageAsset, Rect, Tier } from '@guide/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    let msg = res.statusText;
    if (data && typeof data === 'object' && 'error' in data) {
      msg = String((data as { error: unknown }).error);
    }
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}
function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return t; }
}

export interface User { id: string; email: string; name: string; role: 'owner' | 'member'; }
export interface EditionSummary { id: string; name: string; hotel: string; updatedAt: string; }

export interface PagePreview {
  pageId: string;
  side: 'left' | 'right';
  spreadWith?: string;
  trim: { w: number; h: number };
  bleed: number;
  svg: string;
}
export interface PreviewResult {
  pages: PagePreview[];
  frames: Record<string, { pageId: string; rect: Rect; kind: string }>;
  diagnostics: Diagnostic[];
}

export interface ExportJob {
  id: string; editionId: string; kind: 'press' | 'proof' | 'digital';
  status: 'running' | 'done' | 'failed';
  error?: string; diagnostics?: Diagnostic[]; stats?: unknown; filename?: string;
  createdAt: string; finishedAt?: string;
}

export const api = {
  /* auth */
  me: async (): Promise<User | null> => {
    try {
      return await req<User>('GET', '/api/auth/me');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  login: (email: string, password: string) =>
    req<User>('POST', '/api/auth/login', { email, password }),
  register: (email: string, name: string, password: string) =>
    req<User>('POST', '/api/auth/register', { email, name, password }),
  logout: () => req<{ ok: boolean }>('POST', '/api/auth/logout', {}),

  /* editions */
  listEditions: () => req<EditionSummary[]>('GET', '/api/editions'),
  getEdition: (id: string) => req<Edition>('GET', `/api/editions/${id}`),
  createEdition: (input: Partial<Edition> & { name: string; hotel: { name: string } }) =>
    req<Edition>('POST', '/api/editions', input),
  updateEdition: (id: string, edition: Edition) =>
    req<Edition>('PUT', `/api/editions/${id}`, { ...edition, baseUpdatedAt: edition.updatedAt }),
  deleteEdition: (id: string) => req<void>('DELETE', `/api/editions/${id}`),
  addListing: (id: string, businessId: string, sectionId: string, tier: Tier) =>
    req<{ listing: unknown; edition: Edition }>('POST', `/api/editions/${id}/listings`, {
      businessId, sectionId, tier,
    }),
  removeListing: (id: string, listingId: string) =>
    req<Edition>('DELETE', `/api/editions/${id}/listings/${listingId}`),
  reorderListings: (id: string, order: string[]) =>
    req<Edition>('POST', `/api/editions/${id}/listing-order`, { order }),

  /* preview (the canvas) */
  preview: (id: string, edition?: Edition, showBleed?: boolean) =>
    req<PreviewResult>('POST', `/api/editions/${id}/preview`, { edition, showBleed }),

  /* businesses */
  listBusinesses: () => req<Business[]>('GET', '/api/businesses'),
  createBusiness: (b: Partial<Business> & { name: string }) =>
    req<Business>('POST', '/api/businesses', b),
  updateBusiness: (id: string, b: Business) => req<Business>('PUT', `/api/businesses/${id}`, b),

  /* assets */
  listAssets: () => req<(ImageAsset & { filename?: string })[]>('GET', '/api/assets'),
  assetFile: (id: string) => `/api/assets/${id}/file`,
  assetThumb: (id: string, w = 320) => `/api/assets/${id}/thumb?w=${w}`,

  /* fonts */
  listFonts: () => req<FontFace[]>('GET', '/api/fonts'),

  /* export */
  startExport: (id: string, kind: 'press' | 'proof' | 'digital') =>
    req<ExportJob>('POST', `/api/editions/${id}/export`, { kind }),
  getExport: (jobId: string) => req<ExportJob>('GET', `/api/exports/${jobId}`),
  exportFileUrl: (jobId: string) => `/api/exports/${jobId}/file`,
};
