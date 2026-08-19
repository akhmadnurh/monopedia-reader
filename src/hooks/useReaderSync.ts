"use client";

import { useCallback, useEffect, useRef } from "react";
import { isTokenValid, clearToken } from "@/lib/google-auth";
import {
  getProgressLocalStorage,
  getLocalUpdatedAt,
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
 * 3. Visibility — `document.visibilityState === 'hidden'` (minimise / close).
 * 4. Unmount    — flushes pending debounce on cleanup.
 */
export function useReaderSync(options: UseReaderSyncOptions) {
  const {
    bookId,
    debounceMs = 60_000,
    onSyncComplete,
    onAuthExpired,
  } = options;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const onSyncCompleteRef = useRef(onSyncComplete);
  const onAuthExpiredRef = useRef(onAuthExpired);

  // Keep refs stable so effects don't re-run on callback identity changes
  onSyncCompleteRef.current = onSyncComplete;
  onAuthExpiredRef.current = onAuthExpired;

  // ── Core sync: read latest from LocalStorage → compare updatedAt → push if newer ──
  const syncMetadata = useCallback(async () => {
    // Guard 1: must be authenticated
    if (!isTokenValid()) return;
    // Guard 2: must be online
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    // Guard 3: no concurrent syncs
    if (syncingRef.current) return;

    syncingRef.current = true;
    try {
      // Always read the LATEST from LocalStorage before syncing (requirement 5)
      const local: LocalProgress | null = getProgressLocalStorage(bookId);

      // Dynamically import to avoid SSR issues
      const { fullSync } = await import("@/lib/gdrive-sync");
      const { exportSyncData } = await import("@/lib/db");

      // Run fullSync (pull remote + push if local is newer)
      const result = await fullSync();

      // Conflict resolution: after fullSync, check if our local data is newer
      // than what ended up on Drive. If so, push just this book's progress.
      if (local) {
        const syncData = await exportSyncData();
        const remoteProgress = syncData.progress.find(
          (p) => p.bookId === bookId,
        );
        const remoteUpdatedAt = remoteProgress?.lastReadAt ?? 0;

        if (local.updatedAt > remoteUpdatedAt) {
          // Local is newer — upload via fullSync again (it will see local > remote)
          await fullSync();
        }
      }

      onSyncCompleteRef.current?.(result);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "TokenExpiredError" ||
          err.message.includes("401"))
      ) {
        clearToken();
        onAuthExpiredRef.current?.();
      }
      // Offline / network errors — data stays in LocalStorage, retry next debounce
    } finally {
      syncingRef.current = false;
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

  // ── 3. Trigger: visibilitychange → sync on hidden ──
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
        syncMetadata();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [syncMetadata]);

  // ── 4. Trigger: unmount → flush pending debounce ──
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        // Best-effort fire-and-forget on unmount
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

  return { scheduleSync, syncImmediate };
}
