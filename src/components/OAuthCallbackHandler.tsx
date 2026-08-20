"use client";

import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  handleOAuthCallback,
  storeTokens,
} from "@/lib/google-auth";
import { getOrCreateFolder, downloadSyncData } from "@/lib/gdrive-sync";

export default function OAuthCallbackHandler() {
  const [status, setStatus] = useState<"idle" | "exchanging" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const error = urlParams.get("error");
    const state = urlParams.get("state");

    if (!code && !error) return;

    if (error) {
      setStatus("error");
      setErrorMsg(`Google returned an error: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    const savedState = sessionStorage.getItem("oauth_state");
    if (savedState && state !== savedState) {
      setStatus("error");
      setErrorMsg("Security check failed (state mismatch). Please try again.");
      sessionStorage.removeItem("oauth_state");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    sessionStorage.removeItem("oauth_state");

    async function exchange() {
      setStatus("exchanging");

      try {
        const result = await handleOAuthCallback(code!);

        if (result) {
          storeTokens(result.accessToken, result.expiresIn, result.refreshToken);
          setStatus("success");

          getOrCreateFolder()
            .then(() => downloadSyncData())
            .catch(() => {});

          window.history.replaceState({}, "", "/settings");
          setTimeout(() => {
            window.location.href = "/settings";
          }, 1500);
        } else {
          setStatus("error");
          setErrorMsg(
            "Token exchange failed. Check that GOOGLE_CLIENT_SECRET is set in .env.local and http://localhost:3000 is in Google Cloud Console → Authorized redirect URIs."
          );
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch (err) {
        setStatus("error");
        setErrorMsg(
          `Exchange error: ${err instanceof Error ? err.message : "Unknown error"}.`
        );
        window.history.replaceState({}, "", window.location.pathname);
      }
    }

    exchange();
  }, []);

  if (status === "idle") return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm">
      <div className="mx-4 max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-2xl">
        {status === "exchanging" && (
          <>
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-emerald-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Connecting to Google Drive...</h2>
            <p className="mt-2 text-sm text-zinc-400">Exchanging authorization code...</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Connected!</h2>
            <p className="mt-2 text-sm text-zinc-400">Redirecting to settings...</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="mx-auto mb-4 h-10 w-10 text-red-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Connection Failed</h2>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => {
                setStatus("idle");
                window.history.replaceState({}, "", window.location.pathname);
              }}
              className="mt-5 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
