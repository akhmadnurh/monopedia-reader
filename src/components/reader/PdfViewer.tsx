"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { saveProgress } from "@/lib/db";
import type { ReadingProgress, Highlight } from "@/types/book";
import type { ReaderSettings } from "@/lib/reader-settings";
import { THEMES } from "@/lib/reader-settings";

interface PdfViewerProps {
  fileBlob: Blob;
  bookId: number;
  initialPage?: number;
  totalPages?: number;
  onProgress?: (progress: ReadingProgress) => void;
  onHighlightCreated?: (h: Highlight) => void;
  settings: ReaderSettings;
}

export default function PdfViewer({
  fileBlob,
  bookId,
  initialPage = 1,
  totalPages: totalPagesProp,
  onProgress,
  settings,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
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
    return pdfjsLib.getDocument({ data }).promise;
  }

  // Load PDF
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
    return () => { cancelled = true; pdfRef.current = null; };
  }, [fileBlob]);

  // Render page with HiDPI + text layer
  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayerEl = textLayerRef.current;
    const pdf = pdfRef.current;
    if (!canvas || !textLayerEl || !pdf || loading) return;

    let cancelled = false;

    async function renderPage() {
      renderTaskRef.current?.cancel();
      const page = await pdf!.getPage(currentPage);
      if (cancelled) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });
      const ctx = canvas!.getContext("2d")!;

      canvas!.width = Math.floor(viewport.width);
      canvas!.height = Math.floor(viewport.height);
      canvas!.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas!.style.height = `${Math.floor(viewport.height / dpr)}px`;

      const renderTask = page.render({ canvas: canvas!, canvasContext: ctx, viewport });
      renderTaskRef.current = renderTask;

      try { await renderTask.promise; } catch { return; }
      if (cancelled) return;

      // Text layer
      const container = textLayerEl!;
      container.innerHTML = "";
      container.style.width = canvas!.style.width;
      container.style.height = canvas!.style.height;

      const textContent = await page.getTextContent();
      if (cancelled) return;

      const { TextLayer } = await import("pdfjs-dist");
      const tl = new TextLayer({ textContentSource: textContent, container, viewport });
      await tl.render();
    }

    renderPage();
    return () => { cancelled = true; renderTaskRef.current?.cancel(); };
  }, [currentPage, scale, loading]);

  // Text selection listener for FloatingToolbar
  useEffect(() => {
    function handleSelect() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      document.dispatchEvent(new CustomEvent("pdf:text-selected", {
        detail: { text, cfiRange: `page-${currentPage}`, rect, source: "pdf" },
      }));
    }
    document.addEventListener("mouseup", handleSelect);
    return () => document.removeEventListener("mouseup", handleSelect);
  }, [currentPage]);

  // Auto-save progress
  useEffect(() => {
    if (loading || totalPages === 0) return;
    const progress: ReadingProgress = {
      bookId, cfi: `page-${currentPage}`,
      percentage: Math.round((currentPage / totalPages) * 100),
      chapterTitle: `Page ${currentPage} of ${totalPages}`,
      lastReadAt: Date.now(),
    };
    saveProgress(progress);
    onProgress?.(progress);
  }, [currentPage, totalPages, bookId]);

  // Responsive scale
  useEffect(() => {
    function handleResize() {
      if (!containerRef.current || !pdfRef.current || loading) return;
      pdfRef.current.getPage(1).then((page) => {
        const vp = page.getViewport({ scale: 1 });
        setScale((containerRef.current!.clientWidth - 32) / vp.width);
      });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [loading]);

  const goToNext = useCallback(() => setCurrentPage((p) => Math.min(p + 1, totalPages)), [totalPages]);
  const goToPrev = useCallback(() => setCurrentPage((p) => Math.max(p - 1, 1)), []);
  const zoomIn = useCallback(() => setScale((s) => Math.min(s + 0.25, 3)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(s - 0.25, 0.5)), []);
  const fitWidth = useCallback(() => {
    if (!containerRef.current || !pdfRef.current || loading) return;
    pdfRef.current.getPage(1).then((page) => {
      const vp = page.getViewport({ scale: 1 });
      setScale((containerRef.current!.clientWidth - 32) / vp.width);
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
    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onTouchEnd = (e: TouchEvent) => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) { diff > 0 ? goToNext() : goToPrev(); }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [goToNext, goToPrev]);

  const themeCfg = THEMES[settings.theme];
  const textColor = themeCfg.fg;
  const bgColor = themeCfg.bg;

  return (
    <div className="flex h-full flex-col">
      <style>{`
        .pdf-text-layer {
          position: absolute; overflow: hidden; opacity: 0.25; line-height: 1;
          color: ${textColor};
          font-family: ${settings.fontFamily === "serif" ? "Georgia, serif" : settings.fontFamily === "mono" ? "monospace" : "system-ui, sans-serif"};
          font-size: ${settings.fontSize}%;
        }
        .pdf-text-layer ::selection { background: rgba(0, 100, 200, 0.3); }
        .pdf-text-layer span { color: transparent; position: absolute; white-space: pre; transform-origin: 0% 0%; cursor: text; }
        .pdf-text-layer span::selection { background: rgba(0, 100, 200, 0.3); color: transparent; }
      `}</style>

      <div ref={containerRef} className={`flex-1 overflow-auto flex items-start justify-center`} style={{ background: bgColor }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
          </div>
        ) : (
          <div className="relative my-4" style={{ padding: `0 ${settings.margin}em` }}>
            <canvas ref={canvasRef} className="block shadow-lg" />
            <div ref={textLayerRef} className="pdf-text-layer" />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 bg-background px-4 py-2">
        <div className="flex items-center gap-2">
          <button onClick={goToPrev} disabled={currentPage <= 1}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-30">Prev</button>
          <span className="text-sm text-zinc-500">{currentPage} / {totalPages}</span>
          <button onClick={goToNext} disabled={currentPage >= totalPages}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-30">Next</button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">−</button>
          <button onClick={fitWidth} className="rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">Fit</button>
          <button onClick={zoomIn} className="rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">+</button>
        </div>
      </div>
    </div>
  );
}
