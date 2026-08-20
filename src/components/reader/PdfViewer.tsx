"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { saveProgress } from "@/lib/db";
import { saveProgressLocalStorage } from "@/lib/reader-storage";
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
  onRenderFail?: () => void;
  settings: ReaderSettings;
}

export default function PdfViewer({
  fileBlob,
  bookId,
  driveFileId,
  initialPage = 1,
  totalPages: totalPagesProp,
  onProgress,
  onRenderFail,
  settings,
}: PdfViewerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<Awaited<ReturnType<typeof loadPdf>> | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(totalPagesProp || 0);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<{ page: number; message: string } | null>(null);
  const [failedPages, setFailedPages] = useState<Map<number, string>>(new Map());
  const [retryKey, setRetryKey] = useState(0);
  const isZoomed = scale > fitScale + 0.01;

  const onRenderFailRef = useRef(onRenderFail);
  onRenderFailRef.current = onRenderFail;

  const isContinuous = settings.viewMode === "continuous";
  const prevIsContinuousRef = useRef(isContinuous);
  const scrollTargetRef = useRef<number | null>(null);
  const isScrollingToTargetRef = useRef(false);

  // ── Auto-scroll to currentPage when switching to Continuous Mode ──
  useEffect(() => {
    // Detect transition from single → continuous
    if (isContinuous && !prevIsContinuousRef.current) {
      scrollTargetRef.current = currentPage;
      isScrollingToTargetRef.current = true;

      // Retry scroll with increasing delays to handle DOM mount timing
      let attempts = 0;
      const maxAttempts = 10;
      const interval = setInterval(() => {
        attempts++;
        const container = wrapperRef.current;
        const target = scrollTargetRef.current;
        if (target && container) {
          const targetEl = container.querySelector(`[data-page="${target}"]`);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: "instant", block: "start" });
            clearInterval(interval);
            // Allow IntersectionObserver to resume after scroll settles
            setTimeout(() => { isScrollingToTargetRef.current = false; }, 200);
            return;
          }
        }
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          isScrollingToTargetRef.current = false;
        }
      }, 50);

      return () => { clearInterval(interval); isScrollingToTargetRef.current = false; };
    }
    prevIsContinuousRef.current = isContinuous;
  }, [isContinuous]);

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

    const assetUrl = new URL("pdfjs-dist/", import.meta.url).toString();

    return pdfjsLib.getDocument({
      data,
      cMapUrl: `${assetUrl}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetUrl}standard_fonts/`,
    }).promise;
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
      try {
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
        setLoadError(null);
        setReady(true);
      } catch (err) {
        console.error("[PdfViewer] Load error:", err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load PDF");
        if (!cancelled) onRenderFailRef.current?.();
      }
    }

    load();
    return () => { cancelled = true; pdfRef.current = null; };
  }, [fileBlob, retryKey]);

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
      // Wait for any in-progress render to finish before starting new one
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        try { await renderTaskRef.current.promise; } catch { /* expected cancel */ }
        renderTaskRef.current = null;
      }

      const page = await pdf!.getPage(currentPage);
      if (cancelled) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });
      const displayViewport = page.getViewport({ scale });

      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      canvas!.width = Math.floor(viewport.width);
      canvas!.height = Math.floor(viewport.height);
      canvas!.style.width = `${Math.floor(displayViewport.width)}px`;
      canvas!.style.height = `${Math.floor(displayViewport.height)}px`;

      try {
        await page.getOperatorList();
      } catch (err) {
        console.warn("[PdfViewer] getOperatorList failed page " + currentPage + ":", err);
      }
      if (cancelled) return;

      const renderTask = page.render({ canvas: canvas!, canvasContext: ctx, viewport, intent: "display" });
      renderTaskRef.current = renderTask;

      try {
        await renderTask.promise;
        if (!cancelled) setRenderError(null);
      } catch (err: unknown) {
        if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "RenderingCancelledException") return;
        console.warn("[PdfViewer] Render error page " + currentPage + ":", err);
        if (!cancelled) setRenderError({ page: currentPage, message: err instanceof Error ? err.message : "Render failed" });
        if (!cancelled) onRenderFailRef.current?.();
        return;
      }
      if (cancelled) return;

      const container = textLayerEl!;
      container.innerHTML = "";
      container.style.width = `${Math.floor(displayViewport.width)}px`;
      container.style.height = `${Math.floor(displayViewport.height)}px`;

      const textContent = await page.getTextContent();
      if (cancelled) return;

      const { TextLayer } = await import("pdfjs-dist");
      const tl = new TextLayer({ textContentSource: textContent, container, viewport: displayViewport });
      await tl.render();
    }

    renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [currentPage, scale, ready, isContinuous, retryKey]);

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
        const displayViewport = page.getViewport({ scale });
        const ctx = entry.canvas.getContext("2d");
        if (!ctx) continue;

        entry.canvas.width = Math.floor(viewport.width);
        entry.canvas.height = Math.floor(viewport.height);
        entry.canvas.style.width = `${Math.floor(displayViewport.width)}px`;
        entry.canvas.style.height = `${Math.floor(displayViewport.height)}px`;

        try {
          await page.getOperatorList();
        } catch (err) {
          console.warn("[PdfViewer] getOperatorList failed page " + p + ":", err);
        }
        if (cancelled) return;

        const renderTask = page.render({ canvas: entry.canvas, canvasContext: ctx, viewport, intent: "display" });
        try { await renderTask.promise; } catch (err) {
          console.warn("[PdfViewer] Render error page " + p + ":", err);
          if (!cancelled) setFailedPages(prev => new Map(prev).set(p, err instanceof Error ? err.message : "Failed"));
          if (!cancelled) onRenderFailRef.current?.();
          continue;
        }
        if (cancelled) return;

        entry.textLayer.innerHTML = "";
        entry.textLayer.style.width = `${Math.floor(displayViewport.width)}px`;
        entry.textLayer.style.height = `${Math.floor(displayViewport.height)}px`;

        const textContent = await page.getTextContent();
        if (cancelled) return;

        const { TextLayer } = await import("pdfjs-dist");
        const tl = new TextLayer({ textContentSource: textContent, container: entry.textLayer, viewport: displayViewport });
        await tl.render();
      }
    }

    renderAll();
    return () => { cancelled = true; };
  }, [isContinuous, ready, scale, totalPages, retryKey]);

  // Continuous page observer — IntersectionObserver to track which page is visible
  useEffect(() => {
    if (!isContinuous || !ready) return;
    const container = wrapperRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Skip updates while auto-scroll is positioning to target page
        if (isScrollingToTargetRef.current) return;

        // Find the most visible entry (highest intersection ratio)
        let bestEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }
        if (bestEntry) {
          const pageNum = Number((bestEntry.target as HTMLElement).dataset.page);
          if (pageNum && pageNum !== currentPage) {
            setCurrentPage(pageNum);
          }
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -10% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    // Observe all page containers
    continuousCanvasRefs.current.forEach((entry, pageNum) => {
      const pageEl = container.querySelector(`[data-page="${pageNum}"]`);
      if (pageEl) observer.observe(pageEl);
    });

    return () => observer.disconnect();
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

  // Auto-save progress (LocalStorage instant + IndexedDB)
  useEffect(() => {
    if (!ready || totalPages === 0) return;
    const pct = Math.round((currentPage / totalPages) * 100);
    // 1. Instant write to LocalStorage (offline-first, synchronous)
    saveProgressLocalStorage(bookId, currentPage, pct);
    // 2. Write to IndexedDB (richer store, async)
    const progress: ReadingProgress = {
      bookId, cfi: `page-${currentPage}`,
      percentage: pct,
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

  // Retry functions
  const retryLoad = useCallback(() => { setLoadError(null); setReady(false); setRetryKey(k => k + 1); }, []);
  const retryRender = useCallback(() => { setRenderError(null); setRetryKey(k => k + 1); }, []);
  const retryPage = useCallback((page: number) => {
    setFailedPages(prev => { const next = new Map(prev); next.delete(page); return next; });
    setRetryKey(k => k + 1);
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

  // Listen for remote page updates (cross-device sync on focus)
  useEffect(() => {
    function handleRemotePage(e: Event) {
      const detail = (e as CustomEvent).detail;
      const remotePage = detail?.page;
      if (typeof remotePage === "number" && remotePage > 0 && remotePage <= totalPages) {
        setCurrentPage(remotePage);
      }
    }
    document.addEventListener("monopedia:remote-page", handleRemotePage);
    return () => document.removeEventListener("monopedia:remote-page", handleRemotePage);
  }, [totalPages]);

  // Swipe nav — single mode only, conditional on navigationMode
  useEffect(() => {
    if (isContinuous) return;
    if (settings.navigationMode === "tap" || settings.navigationMode === "none") return;
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
  }, [goToNext, goToPrev, isContinuous, settings.navigationMode]);

  // Tap Zones — single mode only, conditional on navigationMode
  useEffect(() => {
    if (isContinuous) return;
    if (settings.navigationMode === "swipe" || settings.navigationMode === "none") return;
    const el = wrapperRef.current;
    if (!el) return;

    function handleTap(e: MouseEvent) {
      // Ignore clicks on buttons (desktop arrow nav, etc.)
      if ((e.target as HTMLElement).closest("button")) return;
      const rect = el!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      if (pct < 0.25) goToPrev();
      else if (pct > 0.75) goToNext();
      else document.dispatchEvent(new CustomEvent("monopedia:toggle-bar"));
    }

    el.addEventListener("click", handleTap);
    return () => el.removeEventListener("click", handleTap);
  }, [goToNext, goToPrev, isContinuous, settings.navigationMode]);

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

      {!ready && !loadError ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="text-red-400 text-sm text-center max-w-md px-4">{loadError}</p>
          <button
            onClick={retryLoad}
            className="rounded-lg bg-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-600 transition-colors"
          >
            Retry
          </button>
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
              {failedPages.has(p) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                  <AlertCircle className="h-6 w-6 text-red-400 mb-1" />
                  <p className="text-red-400 text-xs mb-2">Page {p}: {failedPages.get(p)}</p>
                  <button
                    onClick={() => retryPage(p)}
                    className="rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-100 hover:bg-zinc-600 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ── Single page mode ── */
        <div className={`w-full h-full px-2 pt-2 pb-20 ${isZoomed ? "overflow-auto touch-pan-x touch-pan-y" : "flex justify-center items-center overflow-hidden"}`}>
          <div className={`relative ${isZoomed ? "m-auto" : ""}`}>
            <canvas ref={canvasRef} className={`block shadow-lg ${isZoomed ? "max-w-none" : ""}`} />
            <div ref={textLayerRef} className="pdf-text-layer" />
            {renderError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
                <p className="text-red-400 text-xs text-center mb-1">Page {renderError.page}</p>
                <p className="text-zinc-400 text-xs text-center mb-3 max-w-xs px-2">{renderError.message}</p>
                <button
                  onClick={retryRender}
                  className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Desktop side arrow buttons ── */}
      {!isContinuous && currentPage > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent("monopedia:pdf-nav", { detail: "prev" })); }}
          className="hidden lg:flex fixed left-4 top-1/2 -translate-y-1/2 z-30 items-center justify-center rounded-full bg-background/40 p-3 text-zinc-400 backdrop-blur-md shadow-lg transition-all hover:bg-background/80 hover:text-zinc-100"
          style={{ color: themeCfg.fg }}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {!isContinuous && currentPage < totalPages && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent("monopedia:pdf-nav", { detail: "next" })); }}
          className="hidden lg:flex fixed right-4 top-1/2 -translate-y-1/2 z-30 items-center justify-center rounded-full bg-background/40 p-3 text-zinc-400 backdrop-blur-md shadow-lg transition-all hover:bg-background/80 hover:text-zinc-100"
          style={{ color: themeCfg.fg }}
          aria-label="Next page"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
