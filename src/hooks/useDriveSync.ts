"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTokenValid, TokenExpiredError } from "@/lib/google-auth";
import { fullSync, uploadSyncData, uploadBookFile } from "@/lib/gdrive-sync";
import type { BookItem } from "@/types/book";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

interface UseDriveSyncOptions {
  autoSyncInterval?: number;
  debounceMs?: number;
  onSyncComplete?: (result: { direction: string; remoteExportedAt: number }) => void;
  onAuthExpired?: () => void;
}

export function useDriveSync(options: UseDriveSyncOptions = {}) {
  const {
    autoSyncInterval = 60_000,
    debounceMs = 2_000,
    onSyncComplete,
    onAuthExpired,
  } = options;

  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSync = useCallback(async () => {
    if (!isTokenValid() || syncingRef.current) return;

    syncingRef.current = true;
    setStatus("syncing");
    setError(null);

    try {
      const result = await fullSync();
      setStatus("success");
      setLastSyncAt(Date.now());
      onSyncComplete?.(result);
      // Reset to idle after a brief "success" flash
      setTimeout(() => setStatus((s) => (s === "success" ? "idle" : s)), 3000);
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        setStatus("error");
        setError("Google Drive token expired. Please reconnect.");
        onAuthExpired?.();
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Sync failed");
      }
    } finally {
      syncingRef.current = false;
    }
  }, [onSyncComplete, onAuthExpired]);

  /** Debounced upload — call this frequently; it batches to every `debounceMs` */
  const scheduleUpload = useCallback(() => {
    if (!isTokenValid()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSync();
    }, debounceMs);
  }, [debounceMs, doSync]);

  /** Immediate upload (no debounce) */
  const uploadNow = useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await doSync();
  }, [doSync]);

  const syncBook = useCallback(
    async (book: Omit<BookItem, "id">) => {
      if (!isTokenValid()) return null;
      return uploadBookFile(book);
    },
    [],
  );

  // Initial sync + periodic interval
  useEffect(() => {
    if (!isTokenValid()) return;

    // Run initial sync immediately
    doSync();

    intervalRef.current = setInterval(() => {
      if (isTokenValid()) doSync();
    }, autoSyncInterval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoSyncInterval, doSync]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    status,
    lastSyncAt,
    error,
    doSync,
    scheduleUpload,
    uploadNow,
    syncBook,
  };
}
