"use client";

import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import InstallPwaButton from "@/components/InstallPwaButton";
import { isTokenValid } from "@/lib/google-auth";

export default function SettingsPage() {
  const [connected, setConnected] = useState(false);

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
