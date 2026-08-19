"use client";

import { ArrowLeft } from "lucide-react";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import InstallPwaButton from "@/components/InstallPwaButton";

export default function SettingsPage() {
  return (
    <div className="flex flex-col min-h-screen">
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
              <GoogleDriveButton />
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
                <span className="text-zinc-200">Offline (IndexedDB)</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
