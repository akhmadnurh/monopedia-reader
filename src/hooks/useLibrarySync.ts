"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTokenValid, clearToken } from "@/lib/google-auth";

export type LibrarySyncStatus = "idle" | "pulling" | "synced";

function isAutoSyncNewBooksEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("autoSyncNewBooks") === "true";
}

/**
 * Library-level sync hook.
 *
 * When the user returns to the Library tab (focus / visibilitychange → visible),
 * fetches the latest metadata.json from Google Drive, merges it into IndexedDB,
 * and signals the UI to refresh progress data.
 *
 * If auto-sync new books is enabled, also downloads new book blobs in background.
 *
 * Returns a `status` for visual feedback (idle → pulling → synced).
 */
export function useLibrarySync() {
  const [status, setStatus] = useState<LibrarySyncStatus>("idle");
  const syncingRef = useRef(false);

  const fetchRemoteProgress = useCallback(async () => {
    if (!isTokenValid()) { console.warn("[LibrarySync] SKIPPED: token invalid"); return; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { console.warn("[LibrarySync] SKIPPED: offline"); return; }
    if (syncingRef.current) { console.warn("[LibrarySync] SKIPPED: already syncing"); return; }

    syncingRef.current = true;
    setStatus("pulling");
    console.log("[LibrarySync] ▶ fetchRemoteProgress START");

    try {
      const { downloadSyncData, downloadAllBooks } = await import("@/lib/gdrive-sync");
      console.log("[LibrarySync] calling downloadSyncData()...");
      const result = await downloadSyncData();
      console.log("[LibrarySync] downloadSyncData result:", result);
      setStatus("synced");

      // Auto-download new book blobs in background if enabled
      if (isAutoSyncNewBooksEnabled()) {
        downloadAllBooks().catch(() => {});
      }

      // Reset to idle after a brief moment so the badge reverts
      setTimeout(() => setStatus((s) => (s === "synced" ? "idle" : s)), 2000);
    } catch (err) {
      console.error("[LibrarySync] ✖ ERROR:", err);
      if (
        err instanceof Error &&
        (err.name === "TokenExpiredError" || err.message.includes("401"))
      ) {
        clearToken();
      }
      setStatus("idle");
    } finally {
      syncingRef.current = false;
      console.log("[LibrarySync] ■ fetchRemoteProgress END");
    }
  }, []);

  // ── Trigger: mount → pull remote progress immediately ──
  useEffect(() => {
    console.log("[LibrarySync] mount effect fired, scheduling fetchRemoteProgress in 500ms");
    const timer = setTimeout(() => {
      console.log("[LibrarySync] mount timer triggered, calling fetchRemoteProgress");
      fetchRemoteProgress();
    }, 500);
    return () => clearTimeout(timer);
  }, [fetchRemoteProgress]);

  // ── Trigger: focus / visibility change → pull from Drive ──
  useEffect(() => {
    function handlePull() {
      if (!isTokenValid()) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      fetchRemoteProgress();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") handlePull();
    }

    window.addEventListener("focus", handlePull);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handlePull);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchRemoteProgress]);

  return { status, fetchRemoteProgress };
}
