"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Sun, Moon, Palette } from "lucide-react";
import { getBookById, getProgress } from "@/lib/db";
import { useDriveSync } from "@/hooks/useDriveSync";
import type { BookItem, ReadingProgress } from "@/types/book";
import ReaderEngine from "@/components/reader/ReaderEngine";

type Theme = "light" | "dark" | "sepia";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "sepia", label: "Sepia", icon: Palette },
];

export default function ReadPage() {
  const params = useParams();
  const router = useRouter();
  const bookId = Number(params.id);

  const [book, setBook] = useState<BookItem | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | undefined>();
  const [theme, setTheme] = useState<Theme>("dark");
  const [fontSize, setFontSize] = useState(100);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const { uploadNow } = useDriveSync({ autoSyncInterval: 60_000 });

  const progressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      const [bookData, progressData] = await Promise.all([
        getBookById(bookId),
        getProgress(bookId),
      ]);

      if (!bookData) {
        router.replace("/");
        return;
      }

      setBook(bookData);
      setProgress(progressData);
      setLoading(false);
    }
    load();
  }, [bookId, router]);

  const handleProgress = useCallback(
    (p: ReadingProgress) => {
      setProgress(p);

      if (progressDebounceRef.current) clearTimeout(progressDebounceRef.current);
      progressDebounceRef.current = setTimeout(() => {
        uploadNow();
      }, 5_000);
    },
    [uploadNow],
  );

  const cycleTheme = useCallback(() => {
    setTheme((t) => {
      const idx = THEME_OPTIONS.findIndex((o) => o.value === t);
      return THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length].value;
    });
  }, []);

  if (loading || !book) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  const themeConfig = THEME_OPTIONS.find((o) => o.value === theme)!;
  const ThemeIcon = themeConfig.icon;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top Bar */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 md:px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            aria-label="Back to library"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">{book.title}</h1>
            {progress && (
              <p className="text-xs text-zinc-500">
                {progress.percentage}% — {progress.chapterTitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={cycleTheme}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            aria-label={`Theme: ${themeConfig.label}`}
          >
            <ThemeIcon className="h-4 w-4" />
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`rounded-md p-2 transition-colors ${
              showSettings
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
            aria-label="Settings"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="mx-auto flex max-w-5xl items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Font</span>
              <button
                onClick={() => setFontSize((s) => Math.max(s - 10, 60))}
                className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
              >
                A−
              </button>
              <span className="min-w-[3ch] text-center text-xs text-zinc-400">{fontSize}%</span>
              <button
                onClick={() => setFontSize((s) => Math.min(s + 10, 200))}
                className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
              >
                A+
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Theme</span>
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`rounded-full p-1.5 transition-colors ${
                      theme === opt.value
                        ? "bg-zinc-700 text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    }`}
                    aria-label={opt.label}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Reader Area */}
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ReaderEngine
          book={book}
          progress={progress}
          onProgress={handleProgress}
          theme={theme}
          fontSize={fontSize}
        />
      </div>
    </div>
  );
}
