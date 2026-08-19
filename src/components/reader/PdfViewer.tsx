"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { saveProgress } from "@/lib/db";
import type { ReadingProgress } from "@/types/book";
import type { ReaderSettings } from "@/lib/reader-settings";
import { THEMES } from "@/lib/reader-settings";

interface PdfViewerProps {
  fileBlob: Blob;
  bookId: number;
  initialPage?: number;
  totalPages?: number;
  onProgress?: (progress: ReadingProgress) => void;
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<Awaited<ReturnType<typeof loadPdf>> | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(totalPagesProp || 0);
  const [ready, setReady] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  async function loadPdf(data: ArrayBuffer) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjsLib.getDocument({ data }).promise;
  }

  // Load PDF + compute initial fit scale before rendering
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fileBlob.arrayBuffer();
      const pdf = await loadPdf(data);
      if (cancelled) return;

      pdfRef.current = pdf;
      setTotalPages(pdf.numPages);

      // Wait a tick for wrapperRef to mount
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) return;

      setReady(true);
    }

    load();
    return () => { cancelled = true; pdfRef.current = null; };
  }, [fileBlob]);

  // Compute fit scale from container + PDF page
  async function getFitScale(): Promise<number> {
    if (!wrapperRef.current || !pdfRef.current) return 1;
    const page = await pdfRef.current.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = wrapperRef.current.clientWidth;
    if (containerWidth <= 0) return 1;
    return containerWidth / viewport.width;
  }

  // Render page whenever currentPage or renderKey changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayerEl = textLayerRef.current;
    const wrapper = wrapperRef.current;
    const pdf = pdfRef.current;
    if (!canvas || !textLayerEl || !wrapper || !pdf || !ready) return;

    let cancelled = false;

    async function renderPage() {
      renderTaskRef.current?.cancel();

      const page = await pdf!.getPage(currentPage);
      if (cancelled) return;

      const dpr = window.devicePixelRatio || 1;
      const fitScale = await getFitScale();
      const viewport = page.getViewport({ scale: fitScale * dpr });

      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      canvas!.width = Math.floor(viewport.width);
      canvas!.height = Math.floor(viewport.height);
      canvas!.style.width = "100%";
      canvas!.style.height = "auto";
      canvas!.style.maxWidth = "100%";

      const renderTask = page.render({ canvas: canvas!, canvasContext: ctx, viewport });
      renderTaskRef.current = renderTask;

      try {
        await renderTask.promise;
      } catch (err: unknown) {
        if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "RenderingCancelledException") return;
        console.warn("PDF render error:", err);
        return;
      }
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
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [currentPage, ready, renderKey]);

  // Text selection → FloatingToolbar
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
    if (!ready || totalPages === 0) return;
    const progress: ReadingProgress = {
      bookId, cfi: `page-${currentPage}`,
      percentage: Math.round((currentPage / totalPages) * 100),
      chapterTitle: `Page ${currentPage} of ${totalPages}`,
      lastReadAt: Date.now(),
    };
    saveProgress(progress);
    onProgress?.(progress);
    document.dispatchEvent(new CustomEvent("monopedia:progress", { detail: progress }));
  }, [currentPage, totalPages, bookId, ready]);

  const goToNext = useCallback(() => setCurrentPage((p) => Math.min(p + 1, totalPages)), [totalPages]);
  const goToPrev = useCallback(() => setCurrentPage((p) => Math.max(p - 1, 1)), []);
  const refit = useCallback(() => setRenderKey((k) => k + 1), []);

  // Refit on resize
  useEffect(() => {
    function handleResize() {
      refit();
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [refit]);

  // Listen for bottom bar events
  useEffect(() => {
    function handleNav(e: Event) {
      const dir = (e as CustomEvent).detail;
      if (dir === "prev") goToPrev();
      else if (dir === "next") goToNext();
    }
    function handleZoom(e: Event) {
      const action = (e as CustomEvent).detail;
      if (action === "in" || action === "out" || action === "fit") {
        refit();
      }
    }
    document.addEventListener("monopedia:pdf-nav", handleNav);
    document.addEventListener("monopedia:pdf-zoom", handleZoom);
    return () => {
      document.removeEventListener("monopedia:pdf-nav", handleNav);
      document.removeEventListener("monopedia:pdf-zoom", handleZoom);
    };
  }, [goToNext, goToPrev, refit]);

  // Keyboard nav
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goToNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goToPrev();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNext, goToPrev]);

  // Swipe nav
  useEffect(() => {
    const el = wrapperRef.current;
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

  return (
    <div
      ref={wrapperRef}
      className="flex h-full w-full flex-col items-center overflow-auto"
      style={{ background: themeCfg.bg }}
    >
      <style>{`
        .pdf-text-layer {
          position: absolute; overflow: hidden; opacity: 0.25; line-height: 1;
          color: ${themeCfg.fg};
          font-family: ${settings.fontFamily === "serif" ? "Georgia, serif" : settings.fontFamily === "mono" ? "monospace" : "system-ui, sans-serif"};
          font-size: ${settings.fontSize}%;
        }
        .pdf-text-layer ::selection { background: rgba(0, 100, 200, 0.3); }
        .pdf-text-layer span { color: transparent; position: absolute; white-space: pre; transform-origin: 0% 0%; cursor: text; }
        .pdf-text-layer span::selection { background: rgba(0, 100, 200, 0.3); color: transparent; }
      `}</style>

      {!ready ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        </div>
      ) : (
        <div className="relative w-full" style={{ maxWidth: "100%", padding: `1em ${settings.margin}em` }}>
          <canvas ref={canvasRef} className="block shadow-lg" />
          <div ref={textLayerRef} className="pdf-text-layer" />
        </div>
      )}
    </div>
  );
}
