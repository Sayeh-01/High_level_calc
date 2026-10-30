import { getAuthCookie } from './auth-plugins';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const cookie = getAuthCookie();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'http_error', json?.message, json?.details);
  return json as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/** Presigned upload: ask the API for a URL, then PUT the bytes. Works on web (blob URLs) and native (file URIs). */
export async function uploadFile(groupId: string, uri: string, mime: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const start = await post<{ fileId: string; uploadUrl: string }>(`/groups/${groupId}/files`, { mime, size: blob.size || 1 });
  const res = await fetch(`${API_URL}${start.uploadUrl}`, { method: 'PUT', body: blob, headers: { 'content-type': mime } });
  if (!res.ok) throw new ApiError(res.status, 'upload_failed');
  return start.fileId;
}

export function fileUrl(groupId: string, fileId: string) {
  return `${API_URL}/api/groups/${groupId}/files/${fileId}`;
}

export function authHeaders(): Record<string, string> {
  const cookie = getAuthCookie();
  return cookie ? { cookie } : {};
}

export async function uploadProfilePhoto(uri: string, mime: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const start = await post<{ uploadUrl: string; imageUrl: string }>('/me/photo', { mime, size: blob.size || 1 });
  const res = await fetch(`${API_URL}${start.uploadUrl}`, { method: 'PUT', body: blob, headers: { 'content-type': mime } });
  if (!res.ok) throw new ApiError(res.status, 'upload_failed');
  return start.imageUrl;
}

/** Profile photos are stored as API paths; group photos as file ids. */
export function imageSource(pathOrUrl: string) {
  return { uri: pathOrUrl.startsWith('/') ? `${API_URL}${pathOrUrl}` : pathOrUrl, headers: authHeaders() };
}

/** Vault uploads are encrypted at rest by the server. */
export async function uploadVaultFile(groupId: string, uri: string, mime: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const start = await post<{ fileId: string; uploadUrl: string }>(`/groups/${groupId}/vault/uploads`, { mime, size: blob.size || 1 });
  const res = await fetch(`${API_URL}${start.uploadUrl}`, { method: 'PUT', body: blob, headers: { 'content-type': mime } });
  if (!res.ok) throw new ApiError(res.status, 'upload_failed');
  return start.fileId;
}
