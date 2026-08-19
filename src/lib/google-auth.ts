export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("gdrive_access_token");
}

export function getStoredTokenExpiry(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("gdrive_token_expiry");
  return raw ? Number(raw) : null;
}

export function isTokenValid(): boolean {
  const token = getStoredToken();
  const expiry = getStoredTokenExpiry();
  if (!token || !expiry) return false;
  return Date.now() < expiry;
}

export function storeToken(accessToken: string, expiresIn: number): void {
  localStorage.setItem("gdrive_access_token", accessToken);
  localStorage.setItem("gdrive_token_expiry", String(Date.now() + expiresIn * 1000));
}

export function clearToken(): void {
  localStorage.removeItem("gdrive_access_token");
  localStorage.removeItem("gdrive_token_expiry");
  // Also clear cached folder ID so it re-resolves on next login
  localStorage.removeItem("gdrive_monopedia_folder_id");
}

export class TokenExpiredError extends Error {
  constructor() {
    super("Token expired");
    this.name = "TokenExpiredError";
  }
}

export async function driveFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getStoredToken();
  if (!token) throw new Error("Not authenticated");

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    clearToken();
    throw new TokenExpiredError();
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
