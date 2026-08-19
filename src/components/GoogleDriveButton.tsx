"use client";

import { useEffect, useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { Cloud, LogOut, Loader2 } from "lucide-react";
import { isTokenValid, storeToken, clearToken } from "@/lib/google-auth";
import { getOrCreateFolder, downloadSyncData } from "@/lib/gdrive-sync";

export default function GoogleDriveButton({
  onConnectionChange,
}: { onConnectionChange?: (connected: boolean) => void } = {}) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const valid = isTokenValid();
    setConnected(valid);
    onConnectionChange?.(valid);
  }, []);

  const login = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/drive.file",
    onSuccess: (tokenResponse) => {
      storeToken(tokenResponse.access_token, tokenResponse.expires_in);
      setConnected(true);
      onConnectionChange?.(true);
      setLoading(false);

      // 1. Create "Monopedia Reader" folder immediately on login
      getOrCreateFolder()
        .then(() => {
          // 2. Then pull existing sync data from Drive
          return downloadSyncData();
        })
        .catch(() => {});
    },
    onError: () => {
      setLoading(false);
    },
  });

  function handleClick() {
    if (connected) {
      clearToken();
      setConnected(false);
      onConnectionChange?.(false);
    } else {
      setLoading(true);
      login();
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
        connected
          ? "border-green-800 bg-green-900/20 text-green-400 hover:bg-green-900/40"
          : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : connected ? (
        <LogOut className="h-4 w-4" />
      ) : (
        <Cloud className="h-4 w-4" />
      )}
      {connected ? "Disconnect Google Drive" : "Connect Google Drive"}
    </button>
  );
}
