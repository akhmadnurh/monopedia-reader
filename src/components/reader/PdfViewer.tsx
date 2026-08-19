"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { saveProgress } from "@/lib/db";
import type { ReadingProgress } from "@/types/book";

interface PdfViewerProps {
  fileBlob: Blob;
  bookId: number;
  initialPage?: number;
  totalPages?: number;
  onProgress?: (progress: ReadingProgress) => void;
  theme?: "light" | "dark" | "sepia";
  fontSize?: number;
}

export default function PdfViewer({
  fileBlob,
  bookId,
  initialPage = 1,
  totalPages: totalPagesProp,
  onProgress,
  theme = "light",
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<Awaited<ReturnType<typeof loadPdf>> | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(totalPagesProp || 0);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);

  async function loadPdf(data: ArrayBuffer) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const task = pdfjsLib.getDocument({ data });
    return task.promise;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fileBlob.arrayBuffer();
      const pdf = await loadPdf(data);
      if (cancelled) return;
      pdfRef.current = pdf;
      setTotalPages(pdf.numPages);
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
      pdfRef.current = null;
    };
  }, [fileBlob]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pdf = pdfRef.current;
    if (!canvas || !pdf || loading) return;

    let cancelled = false;

    async function renderPage() {
      renderTaskRef.current?.cancel();

      const page = await pdf!.getPage(currentPage);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      const ctx = canvas!.getContext("2d")!;

      canvas!.width = viewport.width;
      canvas!.height = viewport.height;

      const renderTask = page.render({
        canvas: canvas!,
        canvasContext: ctx,
        viewport,
      });
      renderTaskRef.current = renderTask;

      try {
        await renderTask.promise;
      } catch {
        // render cancelled
      }
    }

    renderPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [currentPage, scale, loading]);

  useEffect(() => {
    if (loading || totalPages === 0) return;

    const progress: ReadingProgress = {
      bookId,
      cfi: `page-${currentPage}`,
      percentage: Math.round((currentPage / totalPages) * 100),
      chapterTitle: `Page ${currentPage} of ${totalPages}`,
      lastReadAt: Date.now(),
    };

    saveProgress(progress);
    onProgress?.(progress);
  }, [currentPage, totalPages, bookId]);

  useEffect(() => {
    function handleResize() {
      if (!containerRef.current || !pdfRef.current || loading) return;
      pdfRef.current.getPage(1).then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        const containerWidth = containerRef.current!.clientWidth - 32;
        setScale(containerWidth / viewport.width);
      });
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [loading]);

  const goToNext = useCallback(() => {
    setCurrentPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const goToPrev = useCallback(() => {
    setCurrentPage((p) => Math.max(p - 1, 1));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(s + 0.25, 3));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(s - 0.25, 0.5));
  }, []);

  const fitWidth = useCallback(() => {
    if (!containerRef.current || !pdfRef.current || loading) return;
    pdfRef.current.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = containerRef.current!.clientWidth - 32;
      setScale(containerWidth / viewport.width);
    });
  }, [loading]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goToNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goToPrev();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNext, goToPrev]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;

    function onTouchStart(e: TouchEvent) {
      startX = e.touches[0].clientX;
    }

    function onTouchEnd(e: TouchEvent) {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) goToNext();
        else goToPrev();
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [goToNext, goToPrev]);

  const bgColor =
    theme === "dark"
      ? "bg-[#0a0a0a]"
      : theme === "sepia"
        ? "bg-[#f4ecd8]"
        : "bg-white";

  return (
    <div className="flex h-full flex-col">
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto ${bgColor} flex items-start justify-center`}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
          </div>
        ) : (
          <canvas ref={canvasRef} className="my-4 shadow-lg" />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 bg-background px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrev}
            disabled={currentPage <= 1}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-sm text-zinc-500">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={goToNext}
            disabled={currentPage >= totalPages}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            className="rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            −
          </button>
          <button
            onClick={fitWidth}
            className="rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Fit
          </button>
          <button
            onClick={zoomIn}
            className="rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
