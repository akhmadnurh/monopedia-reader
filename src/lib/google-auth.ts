// ---------------------------------------------------------------------------
// Google OAuth token management with automatic refresh
//
// Tokens are stored in localStorage:
//   gdrive_access_token   — current access token
//   gdrive_token_expiry   — Date.now() when the access token expires
//   gdrive_refresh_token  — long-lived refresh token (never expires unless revoked)
//
// On every `driveFetch` call, if the access token is within 5 minutes of
// expiry and a refresh token exists, it is automatically refreshed in the
// background so the user never gets logged out.
// ---------------------------------------------------------------------------

const STORAGE_ACCESS_TOKEN = "gdrive_access_token";
const STORAGE_TOKEN_EXPIRY = "gdrive_token_expiry";
const STORAGE_REFRESH_TOKEN = "gdrive_refresh_token";
const STORAGE_FOLDER_ID = "gdrive_monopedia_folder_id";

// Refresh 5 minutes before actual expiry to avoid edge-case 401s
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Basic getters / setters
// ---------------------------------------------------------------------------

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_ACCESS_TOKEN);
}

export function getStoredTokenExpiry(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_TOKEN_EXPIRY);
  return raw ? Number(raw) : null;
}

function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_REFRESH_TOKEN);
}

function storeAccessToken(accessToken: string, expiresIn: number): void {
  localStorage.setItem(STORAGE_ACCESS_TOKEN, accessToken);
  localStorage.setItem(STORAGE_TOKEN_EXPIRY, String(Date.now() + expiresIn * 1000));
}

function storeRefreshToken(refreshToken: string): void {
  localStorage.setItem(STORAGE_REFRESH_TOKEN, refreshToken);
}

/**
 * Store all tokens after a successful login or token exchange.
 */
export function storeTokens(accessToken: string, expiresIn: number, refreshToken: string | null): void {
  storeAccessToken(accessToken, expiresIn);
  if (refreshToken) {
    storeRefreshToken(refreshToken);
  }
}

/**
 * Check whether the current access token is still valid (not expired).
 */
export function isTokenValid(): boolean {
  const token = getStoredToken();
  const expiry = getStoredTokenExpiry();
  if (!token || !expiry) return false;
  return Date.now() < expiry;
}

/**
 * Check whether the token needs refreshing (within buffer window of expiry).
 */
function tokenNeedsRefresh(): boolean {
  const expiry = getStoredTokenExpiry();
  if (!expiry) return false;
  return Date.now() >= expiry - REFRESH_BUFFER_MS;
}

/**
 * Clear all stored auth data.
 */
export function clearToken(): void {
  localStorage.removeItem(STORAGE_ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_TOKEN_EXPIRY);
  localStorage.removeItem(STORAGE_REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_FOLDER_ID);
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

let refreshPromise: Promise<string | null> | null = null;

/**
 * Refresh the access token using the stored refresh token.
 * Returns the new access token, or null if refresh failed.
 *
 * Deduplicates concurrent calls — if a refresh is already in-flight,
 * subsequent callers await the same promise.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch("/api/google-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", refresh_token: refreshToken }),
      });

      if (!res.ok) {
        // Refresh token revoked or invalid → force logout
        clearToken();
        return null;
      }

      const data = await res.json();
      storeAccessToken(data.access_token, data.expires_in);
      return data.access_token;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Get a valid access token, refreshing automatically if needed.
 * Returns null if no refresh token exists or refresh fails.
 */
export async function getValidToken(): Promise<string | null> {
  // If token is still valid and not near expiry, return it
  if (isTokenValid() && !tokenNeedsRefresh()) {
    return getStoredToken();
  }

  // Token expired or near expiry — try to refresh
  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;

  // Refresh failed — return whatever access token we have (may be expired)
  return getStoredToken();
}

// ---------------------------------------------------------------------------
// Exchange authorization code for tokens (called after Google login)
// ---------------------------------------------------------------------------

export async function exchangeCodeForTokens(
  code: string,
  redirectUri?: string,
): Promise<{ accessToken: string; expiresIn: number; refreshToken: string | null } | null> {
  try {
    const res = await fetch("/api/google-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drive API helpers
// ---------------------------------------------------------------------------

export class TokenExpiredError extends Error {
  constructor() {
    super("Token expired");
    this.name = "TokenExpiredError";
  }
}

/**
 * Make an authenticated request to Google Drive API.
 *
 * Automatically refreshes the access token if it's expired or near-expiry.
 * If a 401 is received, attempts one refresh + retry before giving up.
 */
export async function driveFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  // Get a valid token (auto-refreshes if needed)
  let token = await getValidToken();
  if (!token) throw new TokenExpiredError();

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(input, { ...init, headers });

  // If 401, try one refresh + retry
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      res = await fetch(input, { ...init, headers });
    }

    if (res.status === 401) {
      clearToken();
      throw new TokenExpiredError();
    }
  }

  return res;
}

export async function driveFetchJson<T = unknown>(
  input: string | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await driveFetch(input, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}
