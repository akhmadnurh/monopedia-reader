"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTokenValid, TokenExpiredError } from "@/lib/google-auth";
import { fullSync, uploadSyncData, uploadBookFile } from "@/lib/gdrive-sync";
import type { BookItem } from "@/types/book";

export type SyncStatus = "idle" | "syncing" | "error" | "success";

interface UseDriveSyncOptions {
  autoSyncInterval?: number;
  onSyncComplete?: (result: { direction: string; remoteExportedAt: number }) => void;
  onAuthExpired?: () => void;
}

export function useDriveSync(options: UseDriveSyncOptions = {}) {
  const {
    autoSyncInterval = 30_000,
    onSyncComplete,
    onAuthExpired,
  } = options;

  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const uploadNow = useCallback(async () => {
    if (!isTokenValid() || syncingRef.current) return;

    syncingRef.current = true;
    setStatus("syncing");
    setError(null);

    try {
      await uploadSyncData();
      setStatus("success");
      setLastSyncAt(Date.now());
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        setStatus("error");
        setError("Google Drive token expired. Please reconnect.");
        onAuthExpired?.();
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    } finally {
      syncingRef.current = false;
    }
  }, [onAuthExpired]);

  const syncBook = useCallback(
    async (book: Omit<BookItem, "id">) => {
      if (!isTokenValid()) return null;
      return uploadBookFile(book);
    },
    [],
  );

  useEffect(() => {
    if (!isTokenValid()) return;

    doSync();

    intervalRef.current = setInterval(() => {
      if (isTokenValid()) doSync();
    }, autoSyncInterval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoSyncInterval, doSync]);

  return {
    status,
    lastSyncAt,
    error,
    doSync,
    uploadNow,
    syncBook,
  };
}
