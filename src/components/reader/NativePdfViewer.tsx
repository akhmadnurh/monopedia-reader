"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadingProgress } from "@/types/book";
import type { ReaderSettings } from "@/lib/reader-settings";
import { THEMES } from "@/lib/reader-settings";

interface NativePdfViewerProps {
  fileBlob: Blob;
  bookId: number;
  driveFileId?: string;
  initialPage?: number;
  totalPages?: number;
  onProgress?: (progress: ReadingProgress) => void;
  settings: ReaderSettings;
}

/**
 * Native PDF viewer — renders PDF via browser's built-in PDF engine (iframe).
 *
 * Used as a fallback when PDF.js fails to render complex PDFs.
 * Note: Page-level progress tracking is not available in native mode.
 * Progress will only update from cross-device sync.
 */
export default function NativePdfViewer({
  fileBlob,
  bookId,
  driveFileId,
  onProgress,
  settings,
}: NativePdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Create blob URL for iframe
  useEffect(() => {
    const url = URL.createObjectURL(fileBlob);
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setBlobUrl(null);
    };
  }, [fileBlob]);

  // Keyboard navigation (arrow keys)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        // Native viewer handles its own scrolling — no action needed
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        // Native viewer handles its own scrolling — no action needed
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const themeCfg = THEMES[settings.theme];

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full flex-col"
      style={{ background: themeCfg.bg }}
    >
      {loadError ? (
        <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
          <p className="text-red-400 text-sm text-center">{loadError}</p>
          <button
            onClick={() => { setLoadError(null); setBlobUrl(null); setTimeout(() => setBlobUrl(URL.createObjectURL(fileBlob)), 0); }}
            className="rounded-lg bg-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-600 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : blobUrl ? (
        <iframe
          src={blobUrl}
          className="h-full w-full border-0"
          title="PDF Viewer"
        />
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        </div>
      )}
    </div>
  );
}
