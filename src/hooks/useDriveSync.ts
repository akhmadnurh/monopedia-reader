"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTokenValid, TokenExpiredError, clearToken } from "@/lib/google-auth";
import { fullSync, uploadBookFile, downloadAllBooks } from "@/lib/gdrive-sync";
import type { BookItem } from "@/types/book";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

interface UseDriveSyncOptions {
  autoSyncInterval?: number;
  debounceMs?: number;
  onSyncComplete?: (result: { direction: string; remoteExportedAt: number }) => void;
  onAuthExpired?: () => void;
}

const SYNC_TIMEOUT_MS = 120_000;

function isAutoSyncEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("autoSyncProgress") !== "false";
}

function isAutoSyncNewBooksEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("autoSyncNewBooks") === "true";
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

  /** Debounced push — call this on progress changes; batches to every `debounceMs` */
  const scheduleUpload = useCallback(() => {
    try {
      if (!isTokenValid()) return;
      if (!isAutoSyncEnabled()) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        doSync();
      }, debounceMs);
    } catch {
      // Silently ignore — offline mode continues working
    }
  }, [debounceMs, doSync]);

  /** Immediate sync (no debounce) — never throws */
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

  // ── Periodic interval ──
  useEffect(() => {
    if (!isTokenValid()) return;

    doSync();

    intervalRef.current = setInterval(() => {
      if (isTokenValid() && isAutoSyncEnabled()) doSync();
    }, autoSyncInterval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoSyncInterval, doSync]);

  // ── Cross-device pull on tab focus / visibility change ──
  useEffect(() => {
    function handlePull() {
      if (!isTokenValid()) return;
      if (!isAutoSyncEnabled()) return;
      if (syncingRef.current) return;

      // 1. Progress sync first (fast — metadata.json only)
      doSync().then(() => {
        // 2. Then sync book blobs in background if auto-sync new books is enabled
        if (isAutoSyncNewBooksEnabled()) {
          downloadAllBooks().catch(() => {});
        }
      });
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
  }, [doSync]);

  // ── Cleanup debounce timer ──
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
