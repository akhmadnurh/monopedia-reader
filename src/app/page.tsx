"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { BookOpen, Upload, Settings, AlertCircle, X, CloudCheck, CloudUpload, CloudOff, Loader2, Check, Search, ChevronDown, Plus, RefreshCw } from "lucide-react";
import { saveBook, updateBookMetadata, deleteBookCompletely, db, getProgress } from "@/lib/db";
import { deleteFileFromDrive, uploadSyncData, uploadBookFile } from "@/lib/gdrive-sync";
import { isTokenValid, clearToken } from "@/lib/google-auth";
import { parseEpub, epubFileToBlob } from "@/lib/epub-parser";
import type { BookItem } from "@/types/book";
import { cn } from "@/lib/utils";
import {
  BookActionMenu,
  EditBookModal,
  DeleteBookModal,
} from "@/components/library/BookActionModal";
import { useLibrarySync } from "@/hooks/useLibrarySync";

const ALLOWED_EXTENSIONS = new Set(["epub", "pdf"]);
const ALLOWED_MIMES = new Set([
  "application/epub+zip",
  "application/pdf",
  "application/x-epub+zip",
]);

/* ------------------------------------------------------------------ */
/*  Toast Component                                                     */
/* ------------------------------------------------------------------ */
function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-red-800 bg-red-950 px-4 py-3 shadow-2xl">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
      <span className="text-sm text-red-200">{message}</span>
      <button onClick={onDismiss} className="shrink-0 rounded p-0.5 text-red-400 hover:text-red-200">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Home / Library Page                                                  */
/* ------------------------------------------------------------------ */
export default function Home() {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { status: librarySyncStatus } = useLibrarySync();
  const [showExitModal, setShowExitModal] = useState(false);
  const historyPushedRef = useRef(false);

  // Control bar state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "reading" | "unread" | "finished">("all");
  const [sortBy, setSortBy] = useState<"recently-read" | "recently-added" | "progress-desc" | "title-asc" | "title-desc">("recently-read");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // Close sort dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    }
    if (sortOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortOpen]);

  // Track connection status — react to same-tab and cross-tab changes
  useEffect(() => {
    setIsConnected(isTokenValid());
    function handleStorage() {
      setIsConnected(isTokenValid());
    }
    window.addEventListener("storage", handleStorage);
    const id = setInterval(handleStorage, 2000);
    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(id);
    };
  }, []);

  // Push history entry on mount so Back button triggers popstate
  useEffect(() => {
    if (historyPushedRef.current) return;
    historyPushedRef.current = true;
    history.pushState({ page: "home" }, "", "/");
  }, []);

  // Trap browser Back button
  useEffect(() => {
    function handlePopState() {
      setShowExitModal(true);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Filter (sort applied later after progressMap is available)
  const displayBooks = useMemo(() => {
    if (!books) return [];

    return books.filter((book) => {
      // 1. Logout filter: only show local books when disconnected
      if (!isConnected && book.syncStatus !== "local") return false;

      // 2. Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchTitle = book.title?.toLowerCase().includes(q);
        const matchAuthor = book.author?.toLowerCase().includes(q);
        if (!matchTitle && !matchAuthor) return false;
      }

      return true;
    });
  }, [books, isConnected, searchQuery]);

  // For "reading status" filter, we need progress data. We'll do a second pass
  // using a separate hook in the grid section.
  // Reactive progressMap — automatically updates when sync writes new progress to IndexedDB
  const allProgress = useLiveQuery(() => db.progress.toArray(), []);
  const progressMap = useMemo(() => {
    if (!allProgress) return new Map<number, number>();
    return new Map(allProgress.map((p) => [p.bookId, p.percentage]));
  }, [allProgress]);
  const lastReadAtMap = useMemo(() => {
    if (!allProgress) return new Map<number, number>();
    return new Map(allProgress.map((p) => [p.bookId, p.lastReadAt]));
  }, [allProgress]);

  // Apply reading status filter + sort using progressMap
  const filteredBooks = useMemo(() => {
    let result = displayBooks;

    // Filter by reading status
    if (filterStatus !== "all") {
      result = result.filter((book) => {
        const pct = progressMap.get(book.id!) ?? 0;
        if (filterStatus === "reading") return pct > 0 && pct < 100;
        if (filterStatus === "unread") return pct === 0;
        if (filterStatus === "finished") return pct >= 100;
        return true;
      });
    }

    // Sort
    return [...result].sort((a, b) => {
      if (sortBy === "recently-read") {
        const timeA = lastReadAtMap.get(a.id!) ?? 0;
        const timeB = lastReadAtMap.get(b.id!) ?? 0;
        return timeB - timeA;
      }
      if (sortBy === "recently-added") return (b.addedAt ?? 0) - (a.addedAt ?? 0);
      if (sortBy === "progress-desc") return (progressMap.get(b.id!) ?? 0) - (progressMap.get(a.id!) ?? 0);
      if (sortBy === "title-asc") return (a.title || "").localeCompare(b.title || "");
      if (sortBy === "title-desc") return (b.title || "").localeCompare(a.title || "");
      return 0;
    });
  }, [displayBooks, filterStatus, progressMap, lastReadAtMap, sortBy]);

  // Modal state
  const [editBook, setEditBook] = useState<BookItem | null>(null);
  const [deleteBookTarget, setDeleteBookTarget] = useState<BookItem | null>(null);

  // Toast state
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 4000);
  }

  // Listen for custom toast events (from BookActionMenu when disconnected)
  useEffect(() => {
    function handleToast(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) showToast(detail);
    }
    window.addEventListener("monopedia:toast", handleToast);
    return () => window.removeEventListener("monopedia:toast", handleToast);
  }, []);

  /** Validate a single file — returns true if supported */
  function isFileSupported(file: File): boolean {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ALLOWED_EXTENSIONS.has(ext)) return true;
    if (ALLOWED_MIMES.has(file.type)) return true;
    // Fallback: check magic bytes for PDF
    // (epub is harder to detect by content, extension is reliable enough)
    return false;
  }

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;

    const fileArr = Array.from(files);
    const supported = fileArr.filter(isFileSupported);
    const rejected = fileArr.filter((f) => !isFileSupported(f));

    if (rejected.length > 0) {
      const names = rejected.map((f) => f.name).join(", ");
      showToast(
        `Format file tidak didukung: ${names}. Monopedia Reader hanya mendukung file .epub dan .pdf.`,
      );
    }

    if (supported.length === 0) {
      setImporting(false);
      return;
    }

    setImporting(true);

    for (const file of supported) {
      const ext = file.name.split(".").pop()?.toLowerCase();

      try {
        if (ext === "epub") {
          const blob = epubFileToBlob(file);
          const parsed = await parseEpub(blob, file.name);
          const autoSync = localStorage.getItem("autoSyncNewBooks") === "true";
          const isConnected = isTokenValid();
          const book: Omit<BookItem, "id"> = {
            title: parsed.title,
            author: parsed.author,
            fileType: "epub",
            cover: parsed.cover ?? undefined,
            totalChapters: parsed.chapters.length,
            addedAt: Date.now(),
            fileSize: file.size,
            fileBlob: blob,
            syncStatus: isConnected && autoSync ? "pending" : "local",
          };
          const id = await saveBook(book);
          if (isConnected && autoSync) {
            uploadBookFile(book).then((driveFileId) => {
              if (driveFileId) {
                db.books.update(id, { driveFileId, syncStatus: "synced" });
              }
            }).catch(() => {});
          }
        } else if (ext === "pdf") {
          const { parsePdf } = await import("@/lib/pdf-parser");
          const blob = new Blob([file], { type: "application/pdf" });
          const parsed = await parsePdf(blob, file.name);
          const autoSync = localStorage.getItem("autoSyncNewBooks") === "true";
          const isConnected = isTokenValid();
          const book: Omit<BookItem, "id"> = {
            title: parsed.title,
            author: parsed.author,
            fileType: "pdf",
            cover: parsed.cover ?? undefined,
            totalChapters: parsed.totalPages,
            addedAt: Date.now(),
            fileSize: file.size,
            fileBlob: blob,
            syncStatus: isConnected && autoSync ? "pending" : "local",
          };
          const id = await saveBook(book);
          if (isConnected && autoSync) {
            uploadBookFile(book).then((driveFileId) => {
              if (driveFileId) {
                db.books.update(id, { driveFileId, syncStatus: "synced" });
              }
            }).catch(() => {});
          }
        }
      } catch {
        showToast(`Gagal mengimpor ${file.name}. File mungkin rusak atau tidak valid.`);
      }
    }

    setImporting(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleSaveEdit = useCallback(
    async (title: string, author: string) => {
      if (!editBook?.id) return;
      await updateBookMetadata(editBook.id, { title, author });
      if (isTokenValid()) {
        uploadSyncData().catch(() => {});
      }
    },
    [editBook],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteBookTarget?.id) return;
    const { driveFileId } = await deleteBookCompletely(deleteBookTarget.id);
    if (isTokenValid() && driveFileId) {
      deleteFileFromDrive(driveFileId).catch(() => {});
      uploadSyncData().catch(() => {});
    }
  }, [deleteBookTarget]);

  const handleUploadBook = useCallback(async (book: BookItem) => {
    if (!isTokenValid()) return;
    if (!book.id) return;
    try {
      await db.books.update(book.id, { syncStatus: "pending" });
      const driveFileId = await uploadBookFile(book);
      if (driveFileId) {
        await db.books.update(book.id, { driveFileId, syncStatus: "synced" });
      } else {
        // uploadBookFile returns null on failure (token expired, network error, etc.)
        await db.books.update(book.id, { syncStatus: "local" });
        if (!isTokenValid()) {
          clearToken();
        }
      }
    } catch {
      if (book.id) await db.books.update(book.id, { syncStatus: "local" });
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            <span className="text-lg font-semibold">Monopedia</span>
            {librarySyncStatus === "pulling" && (
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
                <span className="text-blue-400">Syncing</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Mobile: "+" button to import */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="lg:hidden rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              onClick={() => router.push("/settings")}
              className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 py-8">
        {/* Dropzone / Import — hidden on mobile, shown on md+ */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "mx-auto mb-8 hidden lg:flex w-full max-w-2xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
            dragOver
              ? "border-zinc-400 bg-zinc-800/50"
              : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/30",
          )}
        >
          <Upload className="h-10 w-10 text-zinc-500" />
          <div>
            <p className="text-sm font-medium">
              {importing
                ? "Importing..."
                : "Drop EPUB or PDF files here or click to browse"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              All data stays on your device
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,.pdf,application/epub+zip,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* ── Control Bar: Search + Filter + Sort ── */}
        {books && books.length > 0 && (
          <div className="mx-auto mb-6 w-full max-w-5xl space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search by title or author..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-2.5 pl-10 pr-4 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors"
              />
            </div>

            {/* ── Mobile: compact 2-column dropdowns ── */}
            <div className="grid grid-cols-2 gap-2 lg:hidden">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 outline-none focus:border-zinc-600 appearance-none cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="reading">Reading</option>
                <option value="unread">Unread</option>
                <option value="finished">Finished</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 outline-none focus:border-zinc-600 appearance-none cursor-pointer"
              >
                <option value="recently-read">Recently Read</option>
                <option value="recently-added">Recently Added</option>
                <option value="progress-desc">Highest Progress</option>
                <option value="title-asc">Title A-Z</option>
                <option value="title-desc">Title Z-A</option>
              </select>
            </div>

            {/* ── Desktop: filter chips + sort dropdown ── */}
            <div className="hidden lg:flex items-center justify-between gap-3">
              {/* Filter chips */}
              <div className="flex gap-1.5">
                {([
                  ["all", "All"],
                  ["reading", "Reading"],
                  ["unread", "Unread"],
                  ["finished", "Finished"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setFilterStatus(value)}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      filterStatus === value
                        ? "bg-zinc-200 text-zinc-900"
                        : "border border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Sort dropdown */}
              <div ref={sortRef} className="relative shrink-0">
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  {sortBy === "recently-read" && "Recently Read"}
                  {sortBy === "recently-added" && "Recently Added"}
                  {sortBy === "progress-desc" && "Highest Progress"}
                  {sortBy === "title-asc" && "Title A-Z"}
                  {sortBy === "title-desc" && "Title Z-A"}
                  <ChevronDown className={cn("h-3 w-3 transition-transform", sortOpen && "rotate-180")} />
                </button>
                {sortOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                    {([
                      ["recently-read", "Recently Read"],
                      ["recently-added", "Recently Added"],
                      ["progress-desc", "Highest Progress"],
                      ["title-asc", "Title A-Z"],
                      ["title-desc", "Title Z-A"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => { setSortBy(value); setSortOpen(false); }}
                        className={cn(
                          "flex w-full items-center px-3 py-2.5 text-sm transition-colors",
                          sortBy === value
                            ? "bg-zinc-800 text-zinc-100"
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Book Grid */}
        {filteredBooks && filteredBooks.length > 0 ? (
          <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filteredBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onEdit={() => setEditBook(book)}
                onDelete={() => setDeleteBookTarget(book)}
                onUpload={() => handleUploadBook(book)}
              />
            ))}
          </div>
        ) : (
          filteredBooks !== undefined && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-zinc-500">
                {searchQuery || filterStatus !== "all"
                  ? "No books match your search or filter."
                  : "No books yet. Import your first EPUB or PDF above."}
              </p>
            </div>
          )
        )}
      </main>

      {/* Edit Modal */}
      {editBook && (
        <EditBookModal
          book={editBook}
          open={!!editBook}
          onClose={() => setEditBook(null)}
          onSave={handleSaveEdit}
        />
      )}

      {/* Delete Modal */}
      {deleteBookTarget && (
        <DeleteBookModal
          book={deleteBookTarget}
          open={!!deleteBookTarget}
          onClose={() => setDeleteBookTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {/* Toast */}
      {toastMsg && <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />}

      {/* Exit Confirmation Modal */}
      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                <AlertCircle className="h-5 w-5 text-zinc-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Keluar dari Monopedia?</h2>
                <p className="text-xs text-zinc-400">Progress bacaan sudah tersimpan otomatis.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowExitModal(false);
                  history.pushState({ page: "home" }, "", "/");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  setShowExitModal(false);
                  if (window.matchMedia("(display-mode: standalone)").matches) {
                    window.close();
                  } else {
                    history.back();
                  }
                }}
                className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 transition-colors"
              >
                Keluar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sync Badge                                                           */
/* ------------------------------------------------------------------ */
function SyncBadge({ status }: { status: "synced" | "pending" | "local" }) {
  if (status === "synced") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500">
        <CloudCheck className="h-3 w-3" />
        Synced
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-400">
        <CloudUpload className="h-3 w-3 animate-pulse" />
        Syncing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
      <CloudOff className="h-3 w-3" />
      Local
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Book Card                                                           */
/* ------------------------------------------------------------------ */
function BookCard({
  book,
  onEdit,
  onDelete,
  onUpload,
}: {
  book: BookItem;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: () => void;
}) {
  const router = useRouter();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const progress = useLiveQuery(() => getProgress(book.id!), [book.id]);

  if (book.cover && !coverUrl) {
    const url = URL.createObjectURL(book.cover);
    setCoverUrl(url);
  }

  const pct = progress?.percentage ?? 0;
  const isFinished = pct >= 100;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl bg-zinc-900 transition-colors hover:bg-zinc-800">
      <div
        className="flex flex-col cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-action-menu]")) {
            return;
          }
          router.push(`/read/${book.id}`);
        }}
      >
        <div className="relative aspect-[2/3] w-full bg-zinc-800">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={book.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <BookOpen className="h-10 w-10 text-zinc-600" />
            </div>
          )}

          {/* Progress bar at bottom of cover */}
          {pct > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700/60">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 p-3">
          <p className="truncate text-sm font-medium">{book.title}</p>
          <p className="truncate text-xs text-zinc-400">{book.author}</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-500">
                {book.fileType}
              </span>
              <SyncBadge status={book.driveFileId ? "synced" : (book.syncStatus ?? "local")} />
            </div>
            {isFinished ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500">
                <Check className="h-3 w-3" />
                Finished
              </span>
            ) : pct > 0 ? (
              <span className="text-[10px] text-zinc-500 tabular-nums">
                {pct}%
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Action menu — absolutely positioned, stops propagation */}
      <div data-action-menu>
        <BookActionMenu book={book} onEdit={onEdit} onDelete={onDelete} onUpload={onUpload} />
      </div>
    </div>
  );
}
