/**
 * API client for Inventory backend.
 * Handles Bearer token injection and 401 session expiry.
 */

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  return localStorage.getItem('inventory_token');
}

export function setToken(token: string) {
  localStorage.setItem('inventory_token', token);
}

export function clearToken() {
  localStorage.removeItem('inventory_token');
  localStorage.removeItem('inventory_user');
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && token) {
    clearToken();
    window.location.replace('/login?session-expired');
    throw new ApiError(401, 'Session expired');
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const errorMsg =
      (data as { error?: string } | null)?.error || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, errorMsg, data);
  }

  return data as T;
}
