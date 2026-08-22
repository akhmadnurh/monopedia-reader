"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Cloud,
  HardDrive,
  Info,
} from "lucide-react";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import InstallPwaButton from "@/components/InstallPwaButton";
import { isTokenValid, clearToken } from "@/lib/google-auth";
import { downloadAllBooks, type PullResult } from "@/lib/gdrive-sync";

/* ------------------------------------------------------------------ */
/*  Reusable Switch                                                    */
/* ------------------------------------------------------------------ */
function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-zinc-600 transition-colors ${
        checked ? "bg-emerald-600" : "bg-zinc-700"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings Page                                                       */
/* ------------------------------------------------------------------ */
export default function SettingsPage() {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [autoSyncBooks, setAutoSyncBooks] = useState(false);
  const [autoSyncProgress, setAutoSyncProgress] = useState(true);

  useEffect(() => {
    setConnected(isTokenValid());
    setAutoSyncBooks(localStorage.getItem("autoSyncNewBooks") === "true");
    setAutoSyncProgress(localStorage.getItem("autoSyncProgress") !== "false");
  }, []);

  // Listen for storage changes (token stored/cleared from another tab or GoogleDriveButton)
  useEffect(() => {
    function handleStorage() {
      setConnected(isTokenValid());
    }
    window.addEventListener("storage", handleStorage);
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
      if (!isTokenValid()) {
        clearToken();
        setConnected(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setPullResult({
        imported: 0,
        skipped: 0,
        errors: 1,
        errorDetails: [msg],
      });
      if (!isTokenValid()) {
        clearToken();
        setConnected(false);
      }
    } finally {
      setPulling(false);
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <button
            onClick={() => router.replace("/")}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-base font-semibold">Settings</h1>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 py-8">
        <div className="mx-auto w-full max-w-2xl space-y-8">
          {/* ── Install Section ── */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Install
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="mb-4 text-sm text-zinc-400 leading-relaxed">
                Install Monopedia Reader on your device for quick access and
                offline use.
              </p>
              <InstallPwaButton />
            </div>
          </section>

          {/* ── Cloud Sync Section ── */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Cloud Sync
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <p className="text-sm text-zinc-400 leading-relaxed">
                Connect your Google Drive to sync books and reading progress
                across devices. Your files stay in your own Drive — we never
                store them on external servers.
              </p>

              {/* Connect / Disconnect button */}
              <GoogleDriveButton onConnectionChange={setConnected} />

              {/* Sync settings (only when connected) */}
              {connected && (
                <div className="space-y-2 pt-1">
                  {/* Switch: Auto-upload new books */}
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-3">
                    <div className="pr-4">
                      <p className="text-sm font-medium text-zinc-200">
                        Auto-upload new books
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Automatically sync newly imported books to Drive
                      </p>
                    </div>
                    <Switch
                      checked={autoSyncBooks}
                      onCheckedChange={(v) => {
                        setAutoSyncBooks(v);
                        localStorage.setItem("autoSyncNewBooks", String(v));
                      }}
                    />
                  </div>

                  {/* Switch: Auto-sync reading progress */}
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-3">
                    <div className="pr-4">
                      <p className="text-sm font-medium text-zinc-200">
                        Auto-sync reading progress
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Push progress to Drive and pull cross-device updates
                        automatically
                      </p>
                    </div>
                    <Switch
                      checked={autoSyncProgress}
                      onCheckedChange={(v) => {
                        setAutoSyncProgress(v);
                        localStorage.setItem("autoSyncProgress", String(v));
                      }}
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleSyncLibrary}
                      disabled={pulling}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      {pulling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {pulling ? "Syncing..." : "Pull All Books from Drive"}
                    </button>
                  </div>

                  {/* Pull result feedback */}
                  {pullResult && (
                    <div className="space-y-2 pt-1">
                      <div
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                          pullResult.errors > 0
                            ? "bg-red-950 text-red-400"
                            : "bg-emerald-950 text-emerald-400"
                        }`}
                      >
                        {pullResult.errors > 0 ? (
                          <AlertCircle className="h-4 w-4 shrink-0" />
                        ) : (
                          <CheckCircle className="h-4 w-4 shrink-0" />
                        )}
                        <span>
                          {pullResult.imported > 0 &&
                            `${pullResult.imported} imported`}
                          {pullResult.imported > 0 &&
                            pullResult.skipped > 0 &&
                            ", "}
                          {pullResult.skipped > 0 &&
                            `${pullResult.skipped} already exist`}
                          {pullResult.imported === 0 &&
                            pullResult.skipped === 0 &&
                            pullResult.errors === 0 &&
                            "No new books found"}
                          {pullResult.errors > 0 &&
                            `${pullResult.errors} failed`}
                        </span>
                      </div>
                      {pullResult.errorDetails.length > 0 && (
                        <div className="rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-400/80 space-y-1">
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

          {/* ── About Section ── */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              About
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800">
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm text-zinc-400">App</span>
                <span className="text-sm text-zinc-200">Monopedia Reader</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm text-zinc-400">Version</span>
                <span className="text-sm text-zinc-200">0.1.0</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm text-zinc-400">Storage</span>
                {connected ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                    <Cloud className="h-3.5 w-3.5" />
                    Google Drive
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm text-zinc-300">
                    <HardDrive className="h-3.5 w-3.5" />
                    Offline (IndexedDB)
                  </span>
                )}
              </div>
              <div className="flex items-start gap-3 px-5 py-3.5">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-zinc-500" />
                <p className="text-xs text-zinc-500 leading-relaxed">
                  All book files and reading data are stored locally in your
                  browser. Cloud sync is optional and uses your personal Google
                  Drive.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
