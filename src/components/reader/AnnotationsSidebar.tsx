"use client";

import { useEffect, useState } from "react";
import { X, Trash2, StickyNote } from "lucide-react";
import { getHighlightsByBook, deleteHighlight } from "@/lib/db";
import type { Highlight } from "@/types/book";

interface AnnotationsSidebarProps {
  bookId: number;
  open: boolean;
  onClose: () => void;
  onJumpTo: (cfiRange: string) => void;
  refreshKey?: number;
}

export default function AnnotationsSidebar({
  bookId,
  open,
  onClose,
  onJumpTo,
  refreshKey,
}: AnnotationsSidebarProps) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [tab, setTab] = useState<"highlights" | "notes">("highlights");

  useEffect(() => {
    if (!open) return;
    getHighlightsByBook(bookId).then(setHighlights);
  }, [bookId, open, refreshKey]);

  const filtered = highlights.filter((h) =>
    tab === "notes" ? h.note : !h.note,
  );

  async function handleDelete(id: number) {
    await deleteHighlight(id);
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} />

      <aside className="fixed top-0 right-0 z-50 flex h-full w-80 flex-col border-l border-zinc-800 bg-background shadow-2xl transition-transform duration-200 md:relative md:z-0 md:shadow-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Annotations</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setTab("highlights")}
            className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
              tab === "highlights"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Highlights ({highlights.filter((h) => !h.note).length})
          </button>
          <button
            onClick={() => setTab("notes")}
            className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
              tab === "notes"
                ? "border-b-2 border-zinc-100 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Notes ({highlights.filter((h) => h.note).length})
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-zinc-500">
              <StickyNote className="h-8 w-8" />
              <p className="text-sm">No {tab} yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((h) => (
                <button
                  key={h.id}
                  onClick={() => onJumpTo(h.cfiRange)}
                  className="group rounded-lg border border-zinc-800 p-3 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-3 flex-1 text-xs leading-relaxed text-zinc-300">
                      {h.text}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (h.id != null) handleDelete(h.id);
                      }}
                      className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {h.note && (
                    <p className="mt-2 rounded bg-zinc-800/50 px-2 py-1.5 text-[11px] text-zinc-400 italic">
                      {h.note}
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: h.color }}
                    />
                    <span className="text-[10px] text-zinc-600">
                      {new Date(h.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
