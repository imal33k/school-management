export const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

const TOKEN_KEY = 'schoolhouse.accessToken';
const REFRESH_TOKEN_KEY = 'schoolhouse.refreshToken';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function setRefreshToken(token: string) {
  sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getStatusMessage(status: number, path: string, serverMessage: string) {
  const normalizedMessage = serverMessage.trim();
  const isGenericMessage =
    !normalizedMessage ||
    /^(request failed|internal server error|unauthorized|gateway timeout|bad gateway)(\s*\(\d+\))?$/i.test(
      normalizedMessage,
    );

  if (status === 401) {
    if (!isGenericMessage) return normalizedMessage;
    return path === '/auth/login'
      ? 'Sign-in failed. Check your email and password, then try again.'
      : 'Your session has expired or is no longer valid. Sign in again to continue.';
  }
  if (status === 403) {
    return isGenericMessage
      ? 'You do not have permission to do that. Contact your school administrator if you think you should have access.'
      : normalizedMessage;
  }
  if (status === 404) {
    return isGenericMessage
      ? 'The requested record or page could not be found. Refresh and try again.'
      : normalizedMessage;
  }
  if (status === 408 || status === 504) {
    return 'The server took too long to respond. Check your connection and try again. If you were submitting a payment or creating a record, check whether it completed before retrying.';
  }
  if (status === 429) {
    return 'Too many requests were made. Wait a little and try again.';
  }
  if (status >= 500) {
    return isGenericMessage
      ? `The server could not complete this request (${status}). Please try again shortly.`
      : normalizedMessage;
  }
  return isGenericMessage
    ? `The request could not be completed (${status}). Please review the information and try again.`
    : normalizedMessage;
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message.filter((part): part is string => typeof part === 'string').join('. ');
  }
  return '';
}

let refreshRequest: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshRequest) {
    refreshRequest = (async () => {
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        throw new ApiError(
          `Could not reach the school server at ${API_BASE}. Check that the backend is running.`,
          0,
        );
      }

      if (!response.ok) {
        clearToken();
        return null;
      }

      let result: { access_token?: unknown; refresh_token?: unknown };
      try {
        result = (await response.json()) as {
          access_token?: unknown;
          refresh_token?: unknown;
        };
      } catch {
        clearToken();
        window.dispatchEvent(new Event('schoolhouse:unauthorized'));
        throw new ApiError('The server returned an invalid refresh response', 502);
      }
      if (
        typeof result.access_token !== 'string' ||
        typeof result.refresh_token !== 'string'
      ) {
        clearToken();
        window.dispatchEvent(new Event('schoolhouse:unauthorized'));
        throw new ApiError('The server returned an invalid refresh response', 502);
      }

      setToken(result.access_token);
      setRefreshToken(result.refresh_token);
      return result.access_token;
    })().finally(() => {
      refreshRequest = null;
    });
  }

  return refreshRequest;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  let requestBody = options.body;
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      body: requestBody,
      headers,
    });
  } catch {
    throw new ApiError(
      `Could not reach the school server at ${API_BASE}. Check that the backend is running.`,
      0,
    );
  }

  if (response.status === 401 && token && !path.startsWith('/auth/')) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      headers.set('Authorization', `Bearer ${refreshedToken}`);
      if (path === '/auth/logout') {
        requestBody = JSON.stringify({ refreshToken: getRefreshToken() });
      }
      try {
        response = await fetch(`${API_BASE}${path}`, {
          ...options,
          body: requestBody,
          headers,
        });
      } catch {
        throw new ApiError(
          `Could not reach the school server at ${API_BASE}. Check that the backend is running.`,
          0,
        );
      }
    } else {
      clearToken();
    }
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiError(
      'The server connection ended before a response could be read. Check your connection and retry.',
      response.status,
      undefined,
      path,
    );
  }
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const serverMessage = extractErrorMessage(payload);
    const message = getStatusMessage(
      response.status,
      path,
      serverMessage,
    );
    if (response.status === 401 && token) {
      clearToken();
      window.dispatchEvent(new Event('schoolhouse:unauthorized'));
    }
    throw new ApiError(message, response.status, payload, path);
  }

  return payload as T;
}

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}
