"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import type { NavItem } from "epubjs/types/navigation";
import { saveProgress } from "@/lib/db";
import type { ReadingProgress } from "@/types/book";

interface EpubViewerProps {
  fileBlob: Blob;
  bookId: number;
  initialCfi?: string;
  onProgress?: (progress: ReadingProgress) => void;
  theme?: "light" | "dark" | "sepia";
  fontSize?: number;
}

export default function EpubViewer({
  fileBlob,
  bookId,
  initialCfi,
  onProgress,
  theme = "light",
  fontSize = 100,
}: EpubViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentChapter, setCurrentChapter] = useState("");
  const [percentage, setPercentage] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    async function init() {
      const arrayBuffer = await fileBlob.arrayBuffer();
      const book = ePub(arrayBuffer);

      if (destroyed) {
        book.destroy();
        return;
      }

      bookRef.current = book;

      await book.ready;

      const navigation = await book.loaded.navigation;
      if (destroyed) return;
      setToc(navigation.toc);

      const rendition = book.renderTo(containerRef.current!, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
      });

      if (destroyed) {
        rendition.destroy();
        book.destroy();
        return;
      }

      renditionRef.current = rendition;

      applyTheme(rendition, theme, fontSize);

      if (initialCfi) {
        rendition.display(initialCfi);
      } else {
        rendition.display();
      }

      rendition.on("relocated", (location: { start: { cfi: string; percentage: number; displayed: { page: number; total: number } }; end: { cfi: string } }) => {
        if (destroyed) return;

        const { cfi, percentage: pct, displayed } = location.start;
        setPercentage(Math.round(pct * 100));

        const currentNavItem = navigation.toc.find((item) => {
          const href = book.path?.resolve(item.href) ?? item.href;
          return cfi.includes(href) || location.start.cfi.startsWith(book.canonical(item.href));
        });
        const chapterTitle = currentNavItem?.label?.trim() || `Page ${displayed.page}`;

        setCurrentChapter(chapterTitle);

        const progress: ReadingProgress = {
          bookId,
          cfi,
          percentage: Math.round(pct * 100),
          chapterTitle,
          lastReadAt: Date.now(),
        };

        saveProgress(progress);
        onProgress?.(progress);
      });
    }

    init();

    return () => {
      destroyed = true;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
  }, [fileBlob, bookId]);

  useEffect(() => {
    if (renditionRef.current) {
      applyTheme(renditionRef.current, theme, fontSize);
    }
  }, [theme, fontSize]);

  const goToNext = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const goToPrev = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const goToHref = useCallback((href: string) => {
    renditionRef.current?.display(href);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goToNext();
      if (e.key === "ArrowLeft") goToPrev();
    }

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      (containerRef.current as unknown as Record<string, number>)?._touchStartX;
      containerRef.current?.setAttribute("data-touch-x", String(touch.clientX));
    }

    function handleTouchEnd(e: TouchEvent) {
      const startX = Number(containerRef.current?.getAttribute("data-touch-x") || 0);
      const endX = e.changedTouches[0].clientX;
      const diff = startX - endX;

      if (Math.abs(diff) > 50) {
        if (diff > 0) goToNext();
        else goToPrev();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    const el = containerRef.current;
    el?.addEventListener("touchstart", handleTouchStart, { passive: true });
    el?.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      el?.removeEventListener("touchstart", handleTouchStart);
      el?.removeEventListener("touchend", handleTouchEnd);
    };
  }, [goToNext, goToPrev]);

  return (
    <div className="flex h-full w-full">
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ minHeight: 0 }}
      />
      {/* TOC Sidebar rendered by parent */}
      <EpubTocPanel
        toc={toc}
        currentChapter={currentChapter}
        onNavigate={goToHref}
      />
    </div>
  );
}

function EpubTocPanel({
  toc,
  currentChapter,
  onNavigate,
}: {
  toc: NavItem[];
  currentChapter: string;
  onNavigate: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 right-4 z-20 rounded-full bg-zinc-800 p-3 text-zinc-300 shadow-lg hover:bg-zinc-700 transition-colors md:hidden"
        aria-label="Toggle table of contents"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />
      )}

      <aside
        className={`
          fixed top-0 right-0 z-40 h-full w-72 overflow-y-auto bg-background border-l border-zinc-800
          transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "translate-x-full"}
          md:relative md:translate-x-0 md:w-64 md:z-0
        `}
      >
        <div className="p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Table of Contents
          </h3>
          <nav className="flex flex-col gap-0.5">
            {toc.map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  onNavigate(item.href);
                  setOpen(false);
                }}
                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  currentChapter === item.label.trim()
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                {item.label.trim()}
              </button>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
}

function applyTheme(rendition: Rendition, theme: string, fontSize: number) {
  const themes: Record<string, object> = {
    light: { body: { color: "#171717", background: "#ffffff" } },
    dark: { body: { color: "#ededed", background: "#0a0a0a" } },
    sepia: { body: { color: "#5b4636", background: "#f4ecd8" } },
  };

  rendition.themes.register("light", themes.light);
  rendition.themes.register("dark", themes.dark);
  rendition.themes.register("sepia", themes.sepia);

  rendition.themes.select(theme);
  rendition.themes.fontSize(`${fontSize}%`);
}
