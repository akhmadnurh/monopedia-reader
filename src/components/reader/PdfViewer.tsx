"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { saveProgress } from "@/lib/db";
import type { ReadingProgress } from "@/types/book";
import type { ReaderSettings } from "@/lib/reader-settings";
import { THEMES } from "@/lib/reader-settings";

interface PdfViewerProps {
  fileBlob: Blob;
  bookId: number;
  driveFileId?: string;
  initialPage?: number;
  totalPages?: number;
  onProgress?: (progress: ReadingProgress) => void;
  settings: ReaderSettings;
}

export default function PdfViewer({
  fileBlob,
  bookId,
  driveFileId,
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
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [ready, setReady] = useState(false);
  const isZoomed = scale > fitScale + 0.01;

  const isContinuous = settings.viewMode === "continuous";

  // Compute wrapper classes based on zoom state
  function getWrapperClasses() {
    const base = "flex h-full w-full flex-col";
    if (isContinuous) return `${base} overflow-y-auto overflow-x-hidden`;
    return base;
  }

  async function loadPdf(data: ArrayBuffer) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjsLib.getDocument({ data }).promise;
  }

  // Compute fit-to-width scale from container width and page 1
  // Subtract 2px safety margin to prevent any horizontal overflow
  async function computeFitScale(): Promise<number> {
    if (!wrapperRef.current || !pdfRef.current) return 1;
    const page = await pdfRef.current.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = wrapperRef.current.clientWidth - 2;
    if (containerWidth <= 0) return 1;
    return containerWidth / viewport.width;
  }

  // Load PDF → compute initial fit scale → ready
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fileBlob.arrayBuffer();
      const pdf = await loadPdf(data);
      if (cancelled) return;

      pdfRef.current = pdf;
      setTotalPages(pdf.numPages);

      // Wait for DOM mount
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) return;

      const fitScale = await computeFitScale();
      if (cancelled) return;

      setFitScale(fitScale);
      setScale(fitScale);
      setReady(true);
    }

    load();
    return () => { cancelled = true; pdfRef.current = null; };
  }, [fileBlob]);

  // Render single page (single mode)
  useEffect(() => {
    if (isContinuous) return; // continuous mode uses its own render

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
      const viewport = page.getViewport({ scale: scale * dpr });

      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      canvas!.width = Math.floor(viewport.width);
      canvas!.height = Math.floor(viewport.height);
      const displayWidth = Math.floor(viewport.width / dpr);
      const displayHeight = Math.floor(viewport.height / dpr);
      canvas!.style.width = `${displayWidth}px`;
      canvas!.style.height = `${displayHeight}px`;

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

      const container = textLayerEl!;
      container.innerHTML = "";
      container.style.width = `${displayWidth}px`;
      container.style.height = `${displayHeight}px`;

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
  }, [currentPage, scale, ready, isContinuous]);

  // ── Continuous mode: render all pages into a vertical stack ──
  const continuousCanvasRefs = useRef<Map<number, { canvas: HTMLCanvasElement; textLayer: HTMLDivElement }>>(new Map());

  useEffect(() => {
    if (!isContinuous || !ready || !pdfRef.current || totalPages === 0) return;
    let cancelled = false;

    async function renderAll() {
      const pdf = pdfRef.current!;
      const dpr = window.devicePixelRatio || 1;

      for (let p = 1; p <= totalPages; p++) {
        if (cancelled) return;

        const entry = continuousCanvasRefs.current.get(p);
        if (!entry) continue;

        const page = await pdf.getPage(p);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: scale * dpr });
        const ctx = entry.canvas.getContext("2d");
        if (!ctx) continue;

        entry.canvas.width = Math.floor(viewport.width);
        entry.canvas.height = Math.floor(viewport.height);
        const displayWidth = Math.floor(viewport.width / dpr);
        const displayHeight = Math.floor(viewport.height / dpr);
        entry.canvas.style.width = `${displayWidth}px`;
        entry.canvas.style.height = `${displayHeight}px`;

        const renderTask = page.render({ canvas: entry.canvas, canvasContext: ctx, viewport });
        try { await renderTask.promise; } catch { continue; }
        if (cancelled) return;

        entry.textLayer.innerHTML = "";
        entry.textLayer.style.width = `${displayWidth}px`;
        entry.textLayer.style.height = `${displayHeight}px`;

        const textContent = await page.getTextContent();
        if (cancelled) return;

        const { TextLayer } = await import("pdfjs-dist");
        const tl = new TextLayer({ textContentSource: textContent, container: entry.textLayer, viewport });
        await tl.render();
      }
    }

    renderAll();
    return () => { cancelled = true; };
  }, [isContinuous, ready, scale, totalPages]);

  // Continuous page observer — track which page is visible
  useEffect(() => {
    if (!isContinuous || !ready) return;
    const container = wrapperRef.current;
    if (!container) return;

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        let closest = 1;
        let minDist = Infinity;
        continuousCanvasRefs.current.forEach((_, pageNum) => {
          const el = continuousCanvasRefs.current.get(pageNum)?.canvas;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top);
          if (dist < minDist) { minDist = dist; closest = pageNum; }
        });
        if (closest !== currentPage) setCurrentPage(closest);
      });
    }

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [isContinuous, ready, currentPage]);

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
      driveFileId,
    };
    saveProgress(progress);
    onProgress?.(progress);
    document.dispatchEvent(new CustomEvent("monopedia:progress", { detail: progress }));
  }, [currentPage, totalPages, bookId, ready, driveFileId]);

  // Navigation
  const goToNext = useCallback(() => setCurrentPage((p) => Math.min(p + 1, totalPages)), [totalPages]);
  const goToPrev = useCallback(() => setCurrentPage((p) => Math.max(p - 1, 1)), []);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setScale((s) => {
      const next = s + 0.15;
      // Reset scroll to center when first zooming in from fit
      requestAnimationFrame(() => {
        const container = wrapperRef.current;
        const canvas = canvasRef.current;
        if (container && canvas && s <= fitScale + 0.01) {
          container.scrollLeft = (canvas.clientWidth - container.clientWidth) / 2;
          container.scrollTop = (canvas.clientHeight - container.clientHeight) / 2;
        }
      });
      return next;
    });
  }, [fitScale]);
  const zoomOut = useCallback(() => setScale((s) => Math.max(0.3, s - 0.15)), []);
  const fitWidth = useCallback(() => {
    computeFitScale().then((s) => { setFitScale(s); setScale(s); });
  }, []);

  // Resize → refit (single mode only)
  useEffect(() => {
    if (isContinuous) return;
    function handleResize() { fitWidth(); }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitWidth, isContinuous]);

  // Listen for bottom bar events
  useEffect(() => {
    function handleNav(e: Event) {
      const dir = (e as CustomEvent).detail;
      if (dir === "prev") goToPrev();
      else if (dir === "next") goToNext();
    }
    function handleZoom(e: Event) {
      const action = (e as CustomEvent).detail;
      if (action === "in") zoomIn();
      else if (action === "out") zoomOut();
      else if (action === "fit") fitWidth();
    }
    document.addEventListener("monopedia:pdf-nav", handleNav);
    document.addEventListener("monopedia:pdf-zoom", handleZoom);
    return () => {
      document.removeEventListener("monopedia:pdf-nav", handleNav);
      document.removeEventListener("monopedia:pdf-zoom", handleZoom);
    };
  }, [goToNext, goToPrev, zoomIn, zoomOut, fitWidth]);

  // Keyboard nav — single mode only
  useEffect(() => {
    if (isContinuous) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goToNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goToPrev();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNext, goToPrev, isContinuous]);

  // Swipe nav — single mode only
  useEffect(() => {
    if (isContinuous) return;
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
  }, [goToNext, goToPrev, isContinuous]);

  // Tap Zones — single mode only (25% left=prev, 25% right=next, 50% center=toggle bar)
  useEffect(() => {
    if (isContinuous) return;
    const el = wrapperRef.current;
    if (!el) return;

    function handleTap(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      if (pct < 0.25) goToPrev();
      else if (pct > 0.75) goToNext();
      else document.dispatchEvent(new CustomEvent("monopedia:toggle-bar"));
    }

    el.addEventListener("click", handleTap);
    return () => el.removeEventListener("click", handleTap);
  }, [goToNext, goToPrev, isContinuous]);

  const themeCfg = THEMES[settings.theme];

  return (
    <div
      ref={wrapperRef}
      className={getWrapperClasses()}
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
      ) : isContinuous ? (
        /* ── Continuous scroll: all pages stacked vertically ── */
        <div className="flex flex-col gap-4 w-full items-center py-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <div key={p} className="relative" data-page={p}>
              <canvas
                ref={(el) => {
                  if (el) {
                    const prev = continuousCanvasRefs.current.get(p);
                    continuousCanvasRefs.current.set(p, {
                      canvas: el,
                      textLayer: prev?.textLayer ?? el.parentElement!.querySelector<HTMLDivElement>(".pdf-text-layer")!,
                    });
                  }
                }}
                className="block shadow-lg"
              />
              <div className="pdf-text-layer" ref={(el) => {
                if (el) {
                  const prev = continuousCanvasRefs.current.get(p);
                  if (prev) prev.textLayer = el;
                  else continuousCanvasRefs.current.set(p, { canvas: el.parentElement!.querySelector("canvas")!, textLayer: el });
                }
              }} />
            </div>
          ))}
        </div>
      ) : (
        /* ── Single page mode ── */
        <div className={`w-full h-full px-2 pt-2 pb-20 ${isZoomed ? "overflow-auto touch-pan-x touch-pan-y" : "flex justify-center items-center overflow-hidden"}`}>
          <div className={`relative ${isZoomed ? "m-auto" : ""}`}>
            <canvas ref={canvasRef} className={`block shadow-lg ${isZoomed ? "max-w-none" : ""}`} />
            <div ref={textLayerRef} className="pdf-text-layer" />
          </div>
        </div>
      )}
    </div>
  );
}
