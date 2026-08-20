"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTokenValid, clearToken } from "@/lib/google-auth";

export type LibrarySyncStatus = "idle" | "pulling" | "synced";

/**
 * Library-level sync hook.
 *
 * When the user returns to the Library tab (focus / visibilitychange → visible),
 * fetches the latest metadata.json from Google Drive, merges it into IndexedDB,
 * and signals the UI to refresh progress data.
 *
 * Returns a `status` for visual feedback (idle → pulling → synced).
 */
export function useLibrarySync() {
  const [status, setStatus] = useState<LibrarySyncStatus>("idle");
  const syncingRef = useRef(false);

  const fetchRemoteProgress = useCallback(async () => {
    if (!isTokenValid()) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (syncingRef.current) return;

    syncingRef.current = true;
    setStatus("pulling");

    try {
      const { downloadSyncData } = await import("@/lib/gdrive-sync");
      await downloadSyncData();
      setStatus("synced");
      // Reset to idle after a brief moment so the badge reverts
      setTimeout(() => setStatus((s) => (s === "synced" ? "idle" : s)), 2000);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "TokenExpiredError" || err.message.includes("401"))
      ) {
        clearToken();
      }
      setStatus("idle");
    } finally {
      syncingRef.current = false;
    }
  }, []);

  // Listen for focus / visibility change → pull from Drive
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
