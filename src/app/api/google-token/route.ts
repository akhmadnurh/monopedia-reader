import { NextRequest, NextResponse } from "next/server";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

function getClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
}

function getClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
  scope: string;
}

/**
 * POST /api/google-token
 *
 * Handles two operations based on the `action` field:
 *
 * 1. `exchange` — Exchange an authorization code for tokens.
 *    Body: { action: "exchange", code: string, redirect_uri?: string }
 *    Returns: { access_token, expires_in, refresh_token, token_type }
 *
 * 2. `refresh` — Refresh an expired access token.
 *    Body: { action: "refresh", refresh_token: string }
 *    Returns: { access_token, expires_in, token_type }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        {
          error: "Google OAuth is not configured. Missing client ID or secret.",
        },
        { status: 500 },
      );
    }

    if (action === "exchange") {
      const { code, redirect_uri } = body;
      if (!code) {
        return NextResponse.json(
          { error: "Missing authorization code" },
          { status: 400 },
        );
      }

      const resolvedRedirectUri = redirect_uri || request.nextUrl.origin;

      const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: resolvedRedirectUri,
        grant_type: "authorization_code",
      });

      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("[google-token] exchange failed:", res.status, err);
        return NextResponse.json({ error: err }, { status: res.status });
      }

      const data: TokenResponse = await res.json();
      console.log(
        "[google-token] exchange OK, has_refresh_token:",
        !!data.refresh_token,
      );
      return NextResponse.json({
        access_token: data.access_token,
        expires_in: data.expires_in,
        refresh_token: data.refresh_token ?? null,
        token_type: data.token_type,
      });
    }

    if (action === "refresh") {
      const { refresh_token } = body;
      if (!refresh_token) {
        return NextResponse.json(
          { error: "Missing refresh_token" },
          { status: 400 },
        );
      }

      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token,
        grant_type: "refresh_token",
      });

      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("[google-token] refresh failed:", res.status, err);
        return NextResponse.json({ error: err }, { status: res.status });
      }

      const data: TokenResponse = await res.json();
      console.log("[google-token] refresh OK, expires_in:", data.expires_in);
      return NextResponse.json({
        access_token: data.access_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
