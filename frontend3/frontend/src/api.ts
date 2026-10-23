export const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

const TOKEN_KEY = 'schoolhouse.accessToken';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      `Could not reach the school server at ${API_BASE}. Check that the backend is running.`,
      0,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const body = payload as { message?: string | string[] };
    const message = Array.isArray(body?.message)
      ? body.message.join('. ')
      : body?.message ?? `Request failed (${response.status})`;
    if (response.status === 401 && token) {
      clearToken();
      window.dispatchEvent(new Event('schoolhouse:unauthorized'));
    }
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}
