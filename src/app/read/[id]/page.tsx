"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Settings, Highlighter, Cloud, Check, Loader2, AlertCircle } from "lucide-react";
import { getBookById, getProgress, saveHighlight } from "@/lib/db";
import { useDriveSync, type SyncStatus } from "@/hooks/useDriveSync";
import type { BookItem, ReadingProgress, Highlight } from "@/types/book";
import {
  type ReaderSettings,
  type ThemeName,
  type FontFamily,
  loadReaderSettings,
  saveReaderSettings,
  THEMES,
  FONT_FAMILIES,
} from "@/lib/reader-settings";
import ReaderEngine from "@/components/reader/ReaderEngine";
import FloatingToolbar from "@/components/reader/FloatingToolbar";
import AnnotationsSidebar from "@/components/reader/AnnotationsSidebar";

/* ------------------------------------------------------------------ */
/*  Sync indicator icon                                                 */
/* ------------------------------------------------------------------ */
function SyncIndicator({ status }: { status: SyncStatus }) {
  return (
    <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors">
      {status === "syncing" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
          <span className="text-blue-400">Syncing</span>
        </>
      )}
      {status === "success" && (
        <>
          <Check className="h-3 w-3 text-emerald-400" />
          <span className="text-emerald-400">Synced</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-3 w-3 text-red-400" />
          <span className="text-red-400">Error</span>
        </>
      )}
      {status === "idle" && (
        <>
          <Cloud className="h-3 w-3 text-zinc-500" />
          <span className="text-zinc-500">Cloud</span>
        </>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Reader page                                                         */
/* ------------------------------------------------------------------ */
export default function ReadPage() {
  const params = useParams();
  const router = useRouter();
  const bookId = Number(params.id);

  const [book, setBook] = useState<BookItem | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | undefined>();
  const [settings, setSettings] = useState<ReaderSettings>(loadReaderSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [highlightRefreshKey, setHighlightRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const { status: syncStatus, scheduleUpload, uploadNow } = useDriveSync({
    autoSyncInterval: 60_000,
    debounceMs: 2_000,
  });
  const progressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Load book
  useEffect(() => {
    async function load() {
      const [bookData, progressData] = await Promise.all([
        getBookById(bookId), getProgress(bookId),
      ]);
      if (!bookData) { router.replace("/"); return; }
      setBook(bookData);
      setProgress(progressData);
      setLoading(false);
    }
    load();
  }, [bookId, router]);

  // Wake Lock — keep screen on while reading
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        if ("wakeLock" in navigator) {
          const lock = await navigator.wakeLock.request("screen");
          if (!cancelled) wakeLockRef.current = lock;
        }
      } catch { /* not supported or denied */ }
    }
    acquire();
    return () => { cancelled = true; wakeLockRef.current?.release(); };
  }, []);

  // Re-acquire wake lock on visibility change (browsers release on tab switch)
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        navigator.wakeLock?.request("screen").then((lock) => {
          wakeLockRef.current = lock;
        }).catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Debounced progress sync
  const handleProgress = useCallback(
    (p: ReadingProgress) => {
      setProgress(p);
      if (progressDebounceRef.current) clearTimeout(progressDebounceRef.current);
      progressDebounceRef.current = setTimeout(() => scheduleUpload(), 2_000);
    },
    [scheduleUpload],
  );

  // Save highlight
  const handleHighlight = useCallback(
    async (text: string, cfiRange: string, color: string) => {
      const h: Omit<Highlight, "id"> = {
        bookId, cfiRange, text, color, createdAt: Date.now(),
      };
      await saveHighlight(h);
      setHighlightRefreshKey((k) => k + 1);
      scheduleUpload();
    },
    [bookId, scheduleUpload],
  );

  // Save note
  const handleAddNote = useCallback(
    async (text: string, cfiRange: string) => {
      const note = prompt("Add a note:");
      if (note === null) return;
      const h: Omit<Highlight, "id"> = {
        bookId, cfiRange, text, color: "#93C5FD", note, createdAt: Date.now(),
      };
      await saveHighlight(h);
      setHighlightRefreshKey((k) => k + 1);
      scheduleUpload();
    },
    [bookId, scheduleUpload],
  );

  const handleJumpTo = useCallback((_cfiRange: string) => {
    setShowAnnotations(false);
  }, []);

  function updateSettings(partial: Partial<ReaderSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveReaderSettings(next);
      return next;
    });
  }

  if (loading || !book) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  const themeCfg = THEMES[settings.theme];
  const isPdf = book.fileType === "pdf";

  return (
    <div className="flex h-screen flex-col" style={{ background: themeCfg.bg }}>

      {/* ── Top Header ── */}
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-background px-3 pt-[env(safe-area-inset-top)] md:px-4 z-20"
        style={{ background: themeCfg.bg }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => router.push("/")}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium" style={{ color: themeCfg.fg }}>
              {book.title}
            </h1>
            {progress && (
              <p className="text-xs" style={{ color: `${themeCfg.fg}88` }}>
                {progress.percentage}% — {progress.chapterTitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <SyncIndicator status={syncStatus} />
          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            className={`rounded-md p-2 transition-colors ${showAnnotations ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}
          >
            <Highlighter className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`rounded-md p-2 transition-colors ${showSettings ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Settings Panel (dropdown) ── */}
      {showSettings && (
        <div
          className="border-b border-zinc-800 px-4 py-4 z-20"
          style={{ background: `${themeCfg.bg}EE` }}
        >
          <div className="mx-auto max-w-5xl space-y-3">
            {/* Theme */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: themeCfg.fg }}>Theme</span>
              <div className="flex gap-2">
                {(Object.keys(THEMES) as ThemeName[]).map((name) => {
                  const t = THEMES[name];
                  return (
                    <button
                      key={name}
                      onClick={() => updateSettings({ theme: name })}
                      className={`h-8 w-8 rounded-full border-2 transition-transform ${settings.theme === name ? "scale-110 border-white" : "border-zinc-600"}`}
                      style={{ background: t.bg }}
                      aria-label={t.label}
                    />
                  );
                })}
              </div>
            </div>

            {/* Font Family */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: themeCfg.fg }}>Font</span>
              <div className="flex gap-1">
                {(Object.keys(FONT_FAMILIES) as FontFamily[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => updateSettings({ fontFamily: key })}
                    className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                      settings.fontFamily === key ? "bg-zinc-600 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"
                    }`}
                    style={{ fontFamily: FONT_FAMILIES[key].css }}
                  >
                    {FONT_FAMILIES[key].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: themeCfg.fg }}>Size</span>
              <button
                onClick={() => updateSettings({ fontSize: Math.max(60, settings.fontSize - 10) })}
                className="rounded px-2 py-1 text-sm"
                style={{ color: themeCfg.fg }}
              >A−</button>
              <input
                type="range" min={60} max={200} value={settings.fontSize}
                onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
                className="flex-1 max-w-[200px] accent-zinc-400"
              />
              <button
                onClick={() => updateSettings({ fontSize: Math.min(200, settings.fontSize + 10) })}
                className="rounded px-2 py-1 text-sm"
                style={{ color: themeCfg.fg }}
              >A+</button>
              <span className="min-w-[4ch] text-center text-xs" style={{ color: `${themeCfg.fg}88` }}>
                {settings.fontSize}%
              </span>
            </div>

            {/* Line Height */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: themeCfg.fg }}>Lines</span>
              <input
                type="range" min={1} max={3} step={0.1} value={settings.lineHeight}
                onChange={(e) => updateSettings({ lineHeight: Number(e.target.value) })}
                className="flex-1 max-w-[200px] accent-zinc-400"
              />
              <span className="min-w-[4ch] text-center text-xs" style={{ color: `${themeCfg.fg}88` }}>
                {settings.lineHeight}
              </span>
            </div>

            {/* Margin */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: themeCfg.fg }}>Margin</span>
              <input
                type="range" min={0} max={15} step={1} value={settings.margin}
                onChange={(e) => updateSettings({ margin: Number(e.target.value) })}
                className="flex-1 max-w-[200px] accent-zinc-400"
              />
              <span className="min-w-[4ch] text-center text-xs" style={{ color: `${themeCfg.fg}88` }}>
                {settings.margin}em
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Reader */}
        <div className="flex-1" style={{ minHeight: 0 }}>
          <ReaderEngine
            book={book}
            progress={progress}
            onProgress={handleProgress}
            settings={settings}
          />
        </div>

        {/* Annotations Sidebar */}
        <AnnotationsSidebar
          bookId={bookId}
          open={showAnnotations}
          onClose={() => setShowAnnotations(false)}
          onJumpTo={handleJumpTo}
          refreshKey={highlightRefreshKey}
        />
      </div>

      {/* ── Floating Bottom Bar (PDF nav + zoom) ── */}
      {isPdf && (
        <PdfBottomBar
          book={book}
          settings={settings}
          onProgress={handleProgress}
        />
      )}

      {/* ── Floating Toolbar for text selection (EPUB + PDF) ── */}
      <FloatingToolbar onHighlight={handleHighlight} onAddNote={handleAddNote} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PDF Floating Bottom Bar — page nav + zoom                            */
/* ------------------------------------------------------------------ */
function PdfBottomBar({
  book,
  settings,
  onProgress,
}: {
  book: BookItem;
  settings: ReaderSettings;
  onProgress: (p: ReadingProgress) => void;
}) {
  // We expose internal PDF page state via a global event channel
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = book.totalChapters;
  const themeCfg = THEMES[settings.theme];

  // Listen for page changes from PdfViewer via custom event
  useEffect(() => {
    function handlePdfProgress(e: Event) {
      const detail = (e as CustomEvent<ReadingProgress>).detail;
      if (detail?.cfi?.startsWith("page-")) {
        setCurrentPage(parseInt(detail.cfi.replace("page-", ""), 10));
      }
    }
    // PdfViewer dispatches this via onProgress → handleProgress in parent
    // We listen to the reader's own progress state changes
    document.addEventListener("monopedia:progress", handlePdfProgress as EventListener);
    return () => document.removeEventListener("monopedia:progress", handlePdfProgress as EventListener);
  }, []);

  // Sync from parent progress prop
  // (this component re-renders when parent state changes)

  function goToPrev() {
    document.dispatchEvent(new CustomEvent("monopedia:pdf-nav", { detail: "prev" }));
  }
  function goToNext() {
    document.dispatchEvent(new CustomEvent("monopedia:pdf-nav", { detail: "next" }));
  }
  function zoomIn() {
    document.dispatchEvent(new CustomEvent("monopedia:pdf-zoom", { detail: "in" }));
  }
  function zoomOut() {
    document.dispatchEvent(new CustomEvent("monopedia:pdf-zoom", { detail: "out" }));
  }
  function fitWidth() {
    document.dispatchEvent(new CustomEvent("monopedia:pdf-zoom", { detail: "fit" }));
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-700 bg-background/80 px-4 py-2 text-xs shadow-lg backdrop-blur-md"
      style={{
        background: `${themeCfg.bg}CC`,
        color: themeCfg.fg,
        paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
      }}
    >
      <button onClick={goToPrev} disabled={currentPage <= 1}
        className="rounded px-2 py-1 hover:bg-zinc-700 disabled:opacity-30 transition-colors">
        Prev
      </button>
      <span className="min-w-[5ch] text-center tabular-nums text-zinc-400">
        {currentPage}/{totalPages}
      </span>
      <button onClick={goToNext} disabled={currentPage >= totalPages}
        className="rounded px-2 py-1 hover:bg-zinc-700 disabled:opacity-30 transition-colors">
        Next
      </button>

      <div className="mx-1 h-4 w-px bg-zinc-700" />

      <button onClick={zoomOut} className="rounded px-2 py-1 hover:bg-zinc-700 transition-colors">−</button>
      <button onClick={fitWidth} className="rounded px-2 py-1 hover:bg-zinc-700 transition-colors">Fit</button>
      <button onClick={zoomIn} className="rounded px-2 py-1 hover:bg-zinc-700 transition-colors">+</button>
    </div>
  );
}
