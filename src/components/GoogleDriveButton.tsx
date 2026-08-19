"use client";

import { useEffect, useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { Cloud, LogOut, Loader2 } from "lucide-react";
import {
  isTokenValid,
  storeToken,
  clearToken,
} from "@/lib/google-auth";

export default function GoogleDriveButton() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setConnected(isTokenValid());
  }, []);

  const login = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/drive.file",
    onSuccess: (tokenResponse) => {
      storeToken(tokenResponse.access_token, tokenResponse.expires_in);
      setConnected(true);
      setLoading(false);
    },
    onError: () => {
      setLoading(false);
    },
  });

  function handleClick() {
    if (connected) {
      clearToken();
      setConnected(false);
    } else {
      setLoading(true);
      login();
    }
  }

  return (
    <button
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
