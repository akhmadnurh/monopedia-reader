"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Settings, Bookmark, Highlighter, Sun, Moon, Palette, Circle } from "lucide-react";
import { getBookById, getProgress, saveHighlight } from "@/lib/db";
import { useDriveSync } from "@/hooks/useDriveSync";
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
  const { uploadNow } = useDriveSync({ autoSyncInterval: 60_000 });
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
        // Wake Lock not supported or denied
      }
    }
    acquire();
    return () => {
      cancelled = true;
      wakeLockRef.current?.release();
    };
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

  // Listen for text selection events from viewers
  useEffect(() => {
    function handleTextSelected(e: Event) {
      const detail = (e as CustomEvent).detail;
      // FloatingToolbar handles this globally via its own listener
    }
    document.addEventListener("epub:text-selected", handleTextSelected);
    document.addEventListener("pdf:text-selected", handleTextSelected);
    return () => {
      document.removeEventListener("epub:text-selected", handleTextSelected);
      document.removeEventListener("pdf:text-selected", handleTextSelected);
    };
  }, []);

  const handleProgress = useCallback(
    (p: ReadingProgress) => {
      setProgress(p);
      if (progressDebounceRef.current) clearTimeout(progressDebounceRef.current);
      progressDebounceRef.current = setTimeout(() => uploadNow(), 5_000);
    },
    [uploadNow],
  );

  const handleHighlight = useCallback(
    async (text: string, cfiRange: string, color: string) => {
      const h: Omit<Highlight, "id"> = {
        bookId, cfiRange, text, color, createdAt: Date.now(),
      };
      await saveHighlight(h);
      setHighlightRefreshKey((k) => k + 1);
      uploadNow();
    },
    [bookId, uploadNow],
  );

  const handleAddNote = useCallback(
    async (text: string, cfiRange: string) => {
      const note = prompt("Add a note:");
      if (note === null) return;
      const h: Omit<Highlight, "id"> = {
        bookId, cfiRange, text, color: "#93C5FD", note, createdAt: Date.now(),
      };
      await saveHighlight(h);
      setHighlightRefreshKey((k) => k + 1);
      uploadNow();
    },
    [bookId, uploadNow],
  );

  const handleJumpTo = useCallback((_cfiRange: string) => {
    // For EPUB, navigate by CFI; for PDF, parse page number
    // The viewer handles this internally
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

  return (
    <div className="flex h-screen flex-col" style={{ background: THEMES[settings.theme].bg }}>
      {/* Top Bar */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 md:px-4" style={{ background: THEMES[settings.theme].bg }}>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push("/")}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium" style={{ color: THEMES[settings.theme].fg }}>{book.title}</h1>
            {progress && (
              <p className="text-xs" style={{ color: `${THEMES[settings.theme].fg}88` }}>
                {progress.percentage}% — {progress.chapterTitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button onClick={() => setShowAnnotations(!showAnnotations)}
            className={`rounded-md p-2 transition-colors ${showAnnotations ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}>
            <Highlighter className="h-4 w-4" />
          </button>
          <button onClick={() => setShowSettings(!showSettings)}
            className={`rounded-md p-2 transition-colors ${showSettings ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}>
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b border-zinc-800 px-4 py-4" style={{ background: `${THEMES[settings.theme].bg}DD` }}>
          <div className="mx-auto max-w-5xl space-y-4">
            {/* Theme */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: THEMES[settings.theme].fg }}>Theme</span>
              <div className="flex gap-2">
                {(Object.keys(THEMES) as ThemeName[]).map((name) => {
                  const t = THEMES[name];
                  return (
                    <button key={name} onClick={() => updateSettings({ theme: name })}
                      className={`h-8 w-8 rounded-full border-2 transition-transform ${settings.theme === name ? "scale-110 border-white" : "border-zinc-600"}`}
                      style={{ background: t.bg }} aria-label={t.label} />
                  );
                })}
              </div>
            </div>

            {/* Font Family */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: THEMES[settings.theme].fg }}>Font</span>
              <div className="flex gap-1">
                {(Object.keys(FONT_FAMILIES) as FontFamily[]).map((key) => (
                  <button key={key} onClick={() => updateSettings({ fontFamily: key })}
                    className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                      settings.fontFamily === key ? "bg-zinc-600 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"
                    }`}
                    style={{ fontFamily: FONT_FAMILIES[key].css }}>{FONT_FAMILIES[key].label}</button>
                ))}
              </div>
            </div>

            {/* Font Size */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: THEMES[settings.theme].fg }}>Size</span>
              <button onClick={() => updateSettings({ fontSize: Math.max(60, settings.fontSize - 10) })}
                className="rounded px-2 py-1 text-sm" style={{ color: THEMES[settings.theme].fg }}>A−</button>
              <input type="range" min={60} max={200} value={settings.fontSize}
                onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
                className="flex-1 max-w-[200px] accent-zinc-400" />
              <button onClick={() => updateSettings({ fontSize: Math.min(200, settings.fontSize + 10) })}
                className="rounded px-2 py-1 text-sm" style={{ color: THEMES[settings.theme].fg }}>A+</button>
              <span className="min-w-[4ch] text-center text-xs" style={{ color: `${THEMES[settings.theme].fg}88` }}>{settings.fontSize}%</span>
            </div>

            {/* Line Height */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: THEMES[settings.theme].fg }}>Lines</span>
              <input type="range" min={1} max={3} step={0.1} value={settings.lineHeight}
                onChange={(e) => updateSettings({ lineHeight: Number(e.target.value) })}
                className="flex-1 max-w-[200px] accent-zinc-400" />
              <span className="min-w-[4ch] text-center text-xs" style={{ color: `${THEMES[settings.theme].fg}88` }}>{settings.lineHeight}</span>
            </div>

            {/* Margin */}
            <div className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium" style={{ color: THEMES[settings.theme].fg }}>Margin</span>
              <input type="range" min={0} max={15} step={1} value={settings.margin}
                onChange={(e) => updateSettings({ margin: Number(e.target.value) })}
                className="flex-1 max-w-[200px] accent-zinc-400" />
              <span className="min-w-[4ch] text-center text-xs" style={{ color: `${THEMES[settings.theme].fg}88` }}>{settings.margin}em</span>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
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

      {/* Floating Toolbar for text selection */}
      <FloatingToolbar onHighlight={handleHighlight} onAddNote={handleAddNote} />
    </div>
  );
}
