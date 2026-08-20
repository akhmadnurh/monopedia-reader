"use client";

import { useCallback, useEffect, useRef } from "react";
import { isTokenValid, clearToken } from "@/lib/google-auth";
import {
  getProgressLocalStorage,
  type LocalProgress,
} from "@/lib/reader-storage";

interface UseReaderSyncOptions {
  bookId: number;
  /** Debounce delay in ms (default: 60 000 — 1 minute) */
  debounceMs?: number;
  /** Called when a sync attempt completes */
  onSyncComplete?: (result: { direction: string; remoteExportedAt: number }) => void;
  /** Called when the OAuth token expires mid-session */
  onAuthExpired?: () => void;
  /** Called when remote progress is newer than local — passes remote lastPage */
  onRemoteProgress?: (remoteLastPage: number) => void;
}

/**
 * Offline-First Hybrid Sync for the reader.
 *
 * Source of truth: LocalStorage (instant, synchronous writes on every page change).
 * Drive sync is fire-and-forget — only runs when online, debounced, and with
 * updatedAt-based conflict resolution to prevent overwriting newer data.
 *
 * Sync triggers:
 * 1. Debounced  — 60 s after the last `scheduleSync()` call (only if online).
 * 2. Immediate  — `syncImmediate()` cancels debounce and syncs right away.
 * 3. Visibility hidden — push local data to Drive.
 * 4. Visibility visible — pull remote data, notify if newer.
 * 5. Unmount    — flushes pending debounce on cleanup.
 */
export function useReaderSync(options: UseReaderSyncOptions) {
  const {
    bookId,
    debounceMs = 60_000,
    onSyncComplete,
    onAuthExpired,
    onRemoteProgress,
  } = options;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const onSyncCompleteRef = useRef(onSyncComplete);
  const onAuthExpiredRef = useRef(onAuthExpired);
  const onRemoteProgressRef = useRef(onRemoteProgress);

  // Keep refs stable so effects don't re-run on callback identity changes
  onSyncCompleteRef.current = onSyncComplete;
  onAuthExpiredRef.current = onAuthExpired;
  onRemoteProgressRef.current = onRemoteProgress;

  // ── Core sync: read latest from LocalStorage → compare updatedAt → push if newer ──
  const syncMetadata = useCallback(async () => {
    if (!isTokenValid()) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (syncingRef.current) return;

    syncingRef.current = true;
    try {
      const local: LocalProgress | null = getProgressLocalStorage(bookId);
      const { fullSync } = await import("@/lib/gdrive-sync");
      const { exportSyncData } = await import("@/lib/db");

      const result = await fullSync();

      if (local) {
        const syncData = await exportSyncData();
        const remoteProgress = syncData.progress.find(
          (p) => p.bookId === bookId,
        );
        const remoteUpdatedAt = remoteProgress?.lastReadAt ?? 0;

        if (local.updatedAt > remoteUpdatedAt) {
          await fullSync();
        }
      }

      onSyncCompleteRef.current?.(result);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "TokenExpiredError" || err.message.includes("401"))
      ) {
        clearToken();
        onAuthExpiredRef.current?.();
      }
    } finally {
      syncingRef.current = false;
    }
  }, [bookId]);

  // ── Fetch remote progress for this book (pull on focus) ──
  const fetchRemoteProgress = useCallback(async () => {
    if (!isTokenValid()) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (syncingRef.current) return;

    syncingRef.current = true;
    // Dispatch syncing event for visual feedback
    document.dispatchEvent(new CustomEvent("monopedia:sync-pulling"));

    try {
      const { downloadSyncData } = await import("@/lib/gdrive-sync");
      const result = await downloadSyncData();

      if (result.updated) {
        // After download, read the updated progress from IndexedDB
        const { getProgress } = await import("@/lib/db");
        const dbProgress = await getProgress(bookId);

        if (dbProgress) {
          const remotePage = dbProgress.cfi.startsWith("page-")
            ? parseInt(dbProgress.cfi.replace("page-", ""), 10)
            : 0;

          if (remotePage > 0) {
            const local = getProgressLocalStorage(bookId);
            const localPage = local?.lastPage ?? 0;

            if (remotePage > localPage) {
              onRemoteProgressRef.current?.(remotePage);
            }
          }
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "TokenExpiredError" || err.message.includes("401"))
      ) {
        clearToken();
        onAuthExpiredRef.current?.();
      }
      // Offline / network errors — silently ignore
    } finally {
      syncingRef.current = false;
      document.dispatchEvent(new CustomEvent("monopedia:sync-pulled"));
    }
  }, [bookId]);

  // ── 1. Debounced sync ──
  const scheduleSync = useCallback(() => {
    try {
      if (!isTokenValid()) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        syncMetadata();
      }, debounceMs);
    } catch {
      // Offline / SSR — ignore
    }
  }, [debounceMs, syncMetadata]);

  // ── 2. Immediate sync (cancels pending debounce) ──
  const syncImmediate = useCallback(async () => {
    try {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      await syncMetadata();
    } catch {
      // Silently degrade to offline
    }
  }, [syncMetadata]);

  // ── 3. Trigger: visibilitychange → push on hidden, pull on visible ──
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        // Push: flush pending debounce immediately
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
        syncMetadata();
      } else if (document.visibilityState === "visible") {
        // Pull: check if remote has newer progress
        fetchRemoteProgress();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [syncMetadata, fetchRemoteProgress]);

  // ── 5. Trigger: mount → pull remote progress immediately ──
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRemoteProgress();
    }, 500);
    return () => clearTimeout(timer);
  }, [fetchRemoteProgress]);

  // ── 4. Trigger: unmount → flush pending debounce ──
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        syncMetadata();
      }
    };
  }, [syncMetadata]);

  // ── Cleanup debounce timer on unmount (safety net) ──
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { scheduleSync, syncImmediate, fetchRemoteProgress };
}
