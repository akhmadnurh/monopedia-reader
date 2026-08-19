"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Download, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import InstallPwaButton from "@/components/InstallPwaButton";
import { isTokenValid, clearToken } from "@/lib/google-auth";
import { downloadAllBooks, type PullResult } from "@/lib/gdrive-sync";

export default function SettingsPage() {
  const [connected, setConnected] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);

  // Re-check on mount and whenever GoogleDriveButton toggles
  useEffect(() => {
    setConnected(isTokenValid());
  }, []);

  // Listen for storage changes (token stored/cleared from another tab or GoogleDriveButton)
  useEffect(() => {
    function handleStorage() {
      setConnected(isTokenValid());
    }
    window.addEventListener("storage", handleStorage);
    // Also poll occasionally in case same-tab changes happen
    const id = setInterval(handleStorage, 2000);
    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(id);
    };
  }, []);

  const handleSyncLibrary = useCallback(async () => {
    if (!isTokenValid()) return;
    setPulling(true);
    setPullResult(null);
    try {
      const result = await downloadAllBooks();
      setPullResult(result);
      // If token expired during pull, update connection state
      if (!isTokenValid()) {
        clearToken();
        setConnected(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setPullResult({ imported: 0, skipped: 0, errors: 1, errorDetails: [msg] });
      if (!isTokenValid()) {
        clearToken();
        setConnected(false);
      }
    } finally {
      setPulling(false);
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <a
            href="/"
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
          <span className="text-lg font-semibold">Settings</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 py-8">
        <div className="mx-auto w-full max-w-2xl space-y-8">
          {/* Install App Section */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Install
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <p className="mb-4 text-sm text-zinc-400">
                Install Monopedia Reader on your device for quick access and offline use.
              </p>
              <InstallPwaButton />
            </div>
          </section>

          {/* Cloud Sync Section */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Cloud Sync
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <p className="mb-4 text-sm text-zinc-400">
                Connect your Google Drive to sync books and reading progress across devices.
                Your files stay in your own Drive — we never store them on external servers.
              </p>
              <GoogleDriveButton onConnectionChange={setConnected} />

              {connected && (
                <div className="mt-4 space-y-3">
                  <button
                    onClick={handleSyncLibrary}
                    disabled={pulling}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  >
                    {pulling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {pulling ? "Syncing Library..." : "Pull All Books from Drive"}
                  </button>

                  {pullResult && (
                    <div className="space-y-2">
                      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                        pullResult.errors > 0 ? "bg-red-900/20 text-red-400" : "bg-emerald-900/20 text-emerald-400"
                      }`}>
                        {pullResult.errors > 0 ? (
                          <AlertCircle className="h-4 w-4 shrink-0" />
                        ) : (
                          <CheckCircle className="h-4 w-4 shrink-0" />
                        )}
                        <span>
                          {pullResult.imported > 0 && `${pullResult.imported} imported`}
                          {pullResult.imported > 0 && pullResult.skipped > 0 && ", "}
                          {pullResult.skipped > 0 && `${pullResult.skipped} already exist`}
                          {pullResult.imported === 0 && pullResult.skipped === 0 && pullResult.errors === 0 && "No new books found"}
                          {pullResult.errors > 0 && `${pullResult.errors} failed`}
                        </span>
                      </div>
                      {pullResult.errorDetails.length > 0 && (
                        <div className="rounded-lg bg-red-900/10 px-3 py-2 text-xs text-red-400/80">
                          {pullResult.errorDetails.map((detail, i) => (
                            <p key={i}>{detail}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* About Section */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              About
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">App</span>
                <span className="text-zinc-200">Monopedia Reader</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Version</span>
                <span className="text-zinc-200">0.1.0</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Storage</span>
                {connected ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Google Drive (Synced)
                  </span>
                ) : (
                  <span className="text-zinc-200">Offline (IndexedDB)</span>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
