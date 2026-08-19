"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTokenValid, TokenExpiredError, clearToken } from "@/lib/google-auth";
import { fullSync, uploadSyncData, uploadBookFile } from "@/lib/gdrive-sync";
import type { BookItem } from "@/types/book";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

interface UseDriveSyncOptions {
  autoSyncInterval?: number;
  debounceMs?: number;
  onSyncComplete?: (result: { direction: string; remoteExportedAt: number }) => void;
  onAuthExpired?: () => void;
}

const SYNC_TIMEOUT_MS = 120_000; // 2 minutes max per sync cycle

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
    // Guard: don't start if not connected or already syncing
    if (!isTokenValid() || syncingRef.current) return;

    syncingRef.current = true;
    setStatus("syncing");
    setError(null);

    // Timeout wrapper — prevents infinite hang
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Sync timed out")), SYNC_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([fullSync(), timeoutPromise]);
      setStatus("success");
      setLastSyncAt(Date.now());
      onSyncComplete?.(result);
      setTimeout(() => setStatus((s) => (s === "success" ? "idle" : s)), 3000);
    } catch (err) {
      // Never let sync errors crash the UI — degrade gracefully to offline
      if (err instanceof TokenExpiredError || (err instanceof Error && err.name === "TokenExpiredError")) {
        clearToken();
        setError("Sesi Google habis. Silakan hubungkan kembali Google Drive.");
        onAuthExpired?.();
      } else {
        setError(err instanceof Error ? err.message : "Sync failed");
      }
      setStatus("idle");
    } finally {
      syncingRef.current = false;
    }
  }, [onSyncComplete, onAuthExpired]);

  /** Debounced upload — call this frequently; it batches to every `debounceMs` */
  const scheduleUpload = useCallback(() => {
    try {
      if (!isTokenValid()) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        doSync();
      }, debounceMs);
    } catch {
      // Silently ignore — offline mode continues working
    }
  }, [debounceMs, doSync]);

  /** Immediate upload (no debounce) — never throws */
  const uploadNow = useCallback(async () => {
    try {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      await doSync();
    } catch {
      // Silently degrade to offline
    }
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
