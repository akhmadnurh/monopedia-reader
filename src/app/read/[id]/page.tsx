"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Settings,
  Highlighter,
  CloudCheck,
  CloudOff,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { getBookById, getProgress, saveHighlight } from "@/lib/db";
import { getProgressLocalStorage } from "@/lib/reader-storage";
import { useDriveSync, type SyncStatus } from "@/hooks/useDriveSync";
import { useReaderSync } from "@/hooks/useReaderSync";
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
/*  Sync indicator — derived from book.driveFileId (single source)      */
/* ------------------------------------------------------------------ */
function SyncIndicator({
  bookDriveFileId,
  hookStatus,
  pullingSync,
}: {
  bookDriveFileId?: string;
  hookStatus: SyncStatus;
  pullingSync?: boolean;
}) {
  const isSynced = !!bookDriveFileId;

  // Show syncing during background pull
  if (pullingSync || hookStatus === "syncing") {
    return (
      <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
        <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
        <span className="text-blue-400">Syncing</span>
      </span>
    );
  }

  if (isSynced) {
    return (
      <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
        <CloudCheck className="h-3 w-3 text-emerald-400" />
        <span className="text-emerald-400">Synced</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
      <CloudOff className="h-3 w-3 text-zinc-500" />
      <span className="text-zinc-500">Local</span>
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
  const [pullingSync, setPullingSync] = useState(false);

  const { status: syncStatus } = useDriveSync({
    autoSyncInterval: 60_000,
  });

  const { scheduleSync, syncImmediate } = useReaderSync({
    bookId,
    debounceMs: 60_000,
    onRemoteProgress: async (remotePage) => {
      // Notify PdfViewer/EpubViewer to jump to the remote page
      document.dispatchEvent(
        new CustomEvent("monopedia:remote-page", {
          detail: { page: remotePage },
        }),
      );
      // Re-read progress from IndexedDB (now updated by sync) and update state
      const updatedProgress = await getProgress(bookId);
      if (updatedProgress) setProgress(updatedProgress);
    },
  });

  const [showBar, setShowBar] = useState(true);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const backSyncGuardRef = useRef(false);

  // Load book — LocalStorage first (instant), then IndexedDB (richer data)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // 1. Read from LocalStorage first for instant page jump
        const localProgress = getProgressLocalStorage(bookId);
        let initialProgress: ReadingProgress | undefined;

        if (localProgress) {
          // Convert LocalStorage format to ReadingProgress
          initialProgress = {
            bookId,
            cfi: `page-${localProgress.lastPage}`,
            percentage: localProgress.progressPercentage,
            chapterTitle: `Page ${localProgress.lastPage}`,
            lastReadAt: localProgress.updatedAt,
          };
        }

        // 2. Load full book data + IndexedDB progress (may have richer metadata)
        const [bookData, dbProgress] = await Promise.all([
          getBookById(bookId),
          getProgress(bookId),
        ]);
        if (cancelled) return;
        if (!bookData) {
          router.replace("/");
          return;
        }

        setBook(bookData);
        // Prefer IndexedDB progress if it exists (has chapterTitle, driveFileId, etc.)
        // but fall back to LocalStorage progress for instant mount
        setProgress(dbProgress ?? initialProgress);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bookId, router]);

  // Wake Lock
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        if ("wakeLock" in navigator) {
          const lock = await navigator.wakeLock.request("screen");
          if (!cancelled) wakeLockRef.current = lock;
        }
      } catch {
        /* not supported */
      }
    }
    acquire();
    return () => {
      cancelled = true;
      wakeLockRef.current?.release();
    };
  }, []);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        navigator.wakeLock
          ?.request("screen")
          .then((lock) => {
            wakeLockRef.current = lock;
          })
          .catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Flush sync on tab close / OS back gesture
  useEffect(() => {
    function handleBeforeUnload() {
      syncImmediate();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [syncImmediate]);

  // Listen for toggle-bar from PdfViewer tap zones
  useEffect(() => {
    function handleToggleBar() {
      setShowBar((v) => !v);
    }
    document.addEventListener("monopedia:toggle-bar", handleToggleBar);
    return () =>
      document.removeEventListener("monopedia:toggle-bar", handleToggleBar);
  }, []);

  // Listen for sync-pulling visual feedback
  useEffect(() => {
    function handlePullStart() {
      setPullingSync(true);
    }
    function handlePullEnd() {
      setPullingSync(false);
    }
    document.addEventListener("monopedia:sync-pulling", handlePullStart);
    document.addEventListener("monopedia:sync-pulled", handlePullEnd);
    return () => {
      document.removeEventListener("monopedia:sync-pulling", handlePullStart);
      document.removeEventListener("monopedia:sync-pulled", handlePullEnd);
    };
  }, []);

  const handleProgress = useCallback(
    (p: ReadingProgress) => {
      setProgress(p);
      scheduleSync();
    },
    [scheduleSync],
  );

  const handleHighlight = useCallback(
    async (text: string, cfiRange: string, color: string) => {
      try {
        await saveHighlight({
          bookId,
          cfiRange,
          text,
          color,
          createdAt: Date.now(),
        });
        setHighlightRefreshKey((k) => k + 1);
        scheduleSync();
      } catch {
        /* offline save failed silently */
      }
    },
    [bookId, scheduleSync],
  );

  const handleAddNote = useCallback(
    async (text: string, cfiRange: string) => {
      const note = prompt("Add a note:");
      if (note === null) return;
      try {
        await saveHighlight({
          bookId,
          cfiRange,
          text,
          color: "#93C5FD",
          note,
          createdAt: Date.now(),
        });
        setHighlightRefreshKey((k) => k + 1);
        scheduleSync();
      } catch {
        /* offline save failed silently */
      }
    },
    [bookId, scheduleSync],
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

  // ── Loading state ──
  if (loading || !book) {
    return (
      <div className="flex h-[100dvh] w-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  // ── Invalid file fallback ──
  if (
    !book.fileBlob ||
    book.fileBlob.size === 0 ||
    (book.fileType !== "epub" && book.fileType !== "pdf")
  ) {
    return (
      <div className="flex h-[100dvh] w-screen flex-col items-center justify-center bg-background gap-4 p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-900/30">
          <AlertCircle className="h-8 w-8 text-red-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-100">
          File Tidak Valid
        </h2>
        <p className="max-w-sm text-sm text-zinc-400">
          File buku ini tidak dapat dibuka. Kemungkinan file rusak atau format
          yang tidak didukung.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-2 rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white transition-colors"
        >
          Kembali ke Library
        </button>
      </div>
    );
  }

  const themeCfg = THEMES[settings.theme];
  const isPdf = book.fileType === "pdf";

  return (
    <div
      className="flex w-screen flex-col overflow-hidden bg-background"
      style={{ height: "100dvh", background: themeCfg.bg }}
    >
      {/* ── Top Header ── */}
      <header
        className="flex w-full flex-none items-center justify-between border-b border-zinc-800 px-4 pt-[env(safe-area-inset-top)] z-30"
        style={{ height: "3.5rem", background: themeCfg.bg }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={async () => {
              if (backSyncGuardRef.current) return;
              backSyncGuardRef.current = true;
              await syncImmediate();
              router.push("/");
            }}
            className="flex-none rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1
              className="truncate text-sm font-medium"
              style={{ color: themeCfg.fg }}
            >
              {book.title}
            </h1>
            {progress && (
              <p className="text-xs" style={{ color: `${themeCfg.fg}88` }}>
                {progress.percentage}% — {progress.chapterTitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-none items-center gap-1">
          <SyncIndicator
            bookDriveFileId={book.driveFileId}
            hookStatus={syncStatus}
            pullingSync={pullingSync}
          />
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

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div
          className="w-full flex-none border-b border-zinc-800 px-4 py-4 z-20"
          style={{ background: themeCfg.bg }}
        >
          <div className="mx-auto max-w-5xl space-y-3">
            {/* Theme */}
            <div className="flex items-center gap-3">
              <span
                className="w-16 text-xs font-medium"
                style={{ color: themeCfg.fg }}
              >
                Theme
              </span>
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
              <span
                className="w-16 text-xs font-medium"
                style={{ color: themeCfg.fg }}
              >
                Font
              </span>
              <div className="flex gap-1">
                {(Object.keys(FONT_FAMILIES) as FontFamily[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => updateSettings({ fontFamily: key })}
                    className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                      settings.fontFamily === key
                        ? "bg-zinc-600 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-800"
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
              <span
                className="w-16 text-xs font-medium"
                style={{ color: themeCfg.fg }}
              >
                Size
              </span>
              <button
                onClick={() =>
                  updateSettings({
                    fontSize: Math.max(60, settings.fontSize - 10),
                  })
                }
                className="rounded px-2 py-1 text-sm"
                style={{ color: themeCfg.fg }}
              >
                A−
              </button>
              <input
                type="range"
                min={60}
                max={200}
                value={settings.fontSize}
                onChange={(e) =>
                  updateSettings({ fontSize: Number(e.target.value) })
                }
                className="max-w-[200px] flex-1 accent-zinc-400"
              />
              <button
                onClick={() =>
                  updateSettings({
                    fontSize: Math.min(200, settings.fontSize + 10),
                  })
                }
                className="rounded px-2 py-1 text-sm"
                style={{ color: themeCfg.fg }}
              >
                A+
              </button>
              <span
                className="min-w-[4ch] text-center text-xs"
                style={{ color: `${themeCfg.fg}88` }}
              >
                {settings.fontSize}%
              </span>
            </div>

            {/* Line Height */}
            <div className="flex items-center gap-3">
              <span
                className="w-16 text-xs font-medium"
                style={{ color: themeCfg.fg }}
              >
                Lines
              </span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={settings.lineHeight}
                onChange={(e) =>
                  updateSettings({ lineHeight: Number(e.target.value) })
                }
                className="max-w-[200px] flex-1 accent-zinc-400"
              />
              <span
                className="min-w-[4ch] text-center text-xs"
                style={{ color: `${themeCfg.fg}88` }}
              >
                {settings.lineHeight}
              </span>
            </div>

            {/* Margin */}
            <div className="flex items-center gap-3">
              <span
                className="w-16 text-xs font-medium"
                style={{ color: themeCfg.fg }}
              >
                Margin
              </span>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={settings.margin}
                onChange={(e) =>
                  updateSettings({ margin: Number(e.target.value) })
                }
                className="max-w-[200px] flex-1 accent-zinc-400"
              />
              <span
                className="min-w-[4ch] text-center text-xs"
                style={{ color: `${themeCfg.fg}88` }}
              >
                {settings.margin}em
              </span>
            </div>

            {/* View Mode */}
            <div className="flex items-center gap-3">
              <span
                className="w-16 text-xs font-medium"
                style={{ color: themeCfg.fg }}
              >
                Mode
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => updateSettings({ viewMode: "single" })}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    settings.viewMode === "single"
                      ? "bg-zinc-600 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  Single Page
                </button>
                <button
                  hidden
                  onClick={() => updateSettings({ viewMode: "continuous" })}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    settings.viewMode === "continuous"
                      ? "bg-zinc-600 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  Continuous
                </button>
              </div>
            </div>

            {/* Navigation Mode */}
            <div className="flex items-center gap-3">
              <span
                className="w-16 text-xs font-medium"
                style={{ color: themeCfg.fg }}
              >
                Navigation
              </span>
              <div className="flex gap-1">
                {(
                  [
                    ["swipe", "Swipe Only"],
                    ["tap", "Tap Edges"],
                    ["both", "Both"],
                    ["none", "None"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => updateSettings({ navigationMode: value })}
                    className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                      settings.navigationMode === value
                        ? "bg-zinc-600 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content: viewer fills all remaining space ── */}
      <main className="relative min-h-0 flex-1 w-full overflow-hidden">
        <ReaderEngine
          book={book}
          progress={progress}
          onProgress={handleProgress}
          settings={settings}
        />

        {/* Annotations Sidebar — overlays on mobile, inline on desktop */}
        <AnnotationsSidebar
          bookId={bookId}
          open={showAnnotations}
          onClose={() => setShowAnnotations(false)}
          onJumpTo={handleJumpTo}
          refreshKey={highlightRefreshKey}
        />
      </main>

      {/* ── Floating Bottom Bar (PDF single mode only) ── */}
      {isPdf && settings.viewMode === "single" && showBar && (
        <PdfBottomBar book={book} settings={settings} />
      )}

      {/* ── Floating Toolbar for text selection ── */}
      <FloatingToolbar
        onHighlight={handleHighlight}
        onAddNote={handleAddNote}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PDF Floating Bottom Bar                                              */
/* ------------------------------------------------------------------ */
function PdfBottomBar({
  book,
  settings,
}: {
  book: BookItem;
  settings: ReaderSettings;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = book.totalChapters;
  const themeCfg = THEMES[settings.theme];

  useEffect(() => {
    function handlePdfProgress(e: Event) {
      const detail = (e as CustomEvent<ReadingProgress>).detail;
      if (detail?.cfi?.startsWith("page-")) {
        setCurrentPage(parseInt(detail.cfi.replace("page-", ""), 10));
      }
    }
    document.addEventListener(
      "monopedia:progress",
      handlePdfProgress as EventListener,
    );
    return () =>
      document.removeEventListener(
        "monopedia:progress",
        handlePdfProgress as EventListener,
      );
  }, []);

  function nav(dir: string) {
    document.dispatchEvent(
      new CustomEvent("monopedia:pdf-nav", { detail: dir }),
    );
  }
  function zoom(action: string) {
    document.dispatchEvent(
      new CustomEvent("monopedia:pdf-zoom", { detail: action }),
    );
  }

  return (
    <div
      className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-700 px-4 py-2 text-xs shadow-xl backdrop-blur-md"
      style={{
        background: `${themeCfg.bg}E6`,
        color: themeCfg.fg,
        paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
      }}
    >
      <button
        onClick={() => nav("prev")}
        disabled={currentPage <= 1}
        className="rounded px-2 py-1 hover:bg-zinc-700 disabled:opacity-30 transition-colors"
      >
        Prev
      </button>
      <span className="min-w-[5ch] text-center tabular-nums text-zinc-400">
        {currentPage}/{totalPages}
      </span>
      <button
        onClick={() => nav("next")}
        disabled={currentPage >= totalPages}
        className="rounded px-2 py-1 hover:bg-zinc-700 disabled:opacity-30 transition-colors"
      >
        Next
      </button>

      <div className="mx-1 h-4 w-px bg-zinc-700" />

      <button
        onClick={() => zoom("out")}
        className="rounded px-2 py-1 hover:bg-zinc-700 transition-colors"
      >
        −
      </button>
      <button
        onClick={() => zoom("fit")}
        className="rounded px-2 py-1 hover:bg-zinc-700 transition-colors"
      >
        Fit
      </button>
      <button
        onClick={() => zoom("in")}
        className="rounded px-2 py-1 hover:bg-zinc-700 transition-colors"
      >
        +
      </button>
    </div>
  );
}
