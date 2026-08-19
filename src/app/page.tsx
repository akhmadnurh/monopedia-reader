"use client";

import { useCallback, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Upload, Settings, AlertCircle, X } from "lucide-react";
import { getAllBooks, saveBook, updateBookMetadata, deleteBookCompletely } from "@/lib/db";
import { deleteFileFromDrive, uploadSyncData } from "@/lib/gdrive-sync";
import { isTokenValid } from "@/lib/google-auth";
import { parseEpub, epubFileToBlob } from "@/lib/epub-parser";
import type { BookItem } from "@/types/book";
import { cn } from "@/lib/utils";
import {
  BookActionMenu,
  EditBookModal,
  DeleteBookModal,
} from "@/components/library/BookActionModal";

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
  const books = useLiveQuery(() => getAllBooks(), []);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          const parsed = await parseEpub(blob);
          const book: Omit<BookItem, "id"> = {
            title: parsed.title,
            author: parsed.author,
            fileType: "epub",
            cover: parsed.cover ?? undefined,
            totalChapters: parsed.chapters.length,
            addedAt: Date.now(),
            fileSize: file.size,
            fileBlob: blob,
          };
          await saveBook(book);
        } else if (ext === "pdf") {
          const { parsePdf } = await import("@/lib/pdf-parser");
          const blob = new Blob([file], { type: "application/pdf" });
          const parsed = await parsePdf(blob);
          const book: Omit<BookItem, "id"> = {
            title: parsed.title,
            author: parsed.author,
            fileType: "pdf",
            cover: parsed.cover ?? undefined,
            totalChapters: parsed.totalPages,
            addedAt: Date.now(),
            fileSize: file.size,
            fileBlob: blob,
          };
          await saveBook(book);
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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            <span className="text-lg font-semibold">Monopedia</span>
          </div>
          <a
            href="/settings"
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <Settings className="h-5 w-5" />
          </a>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 py-8">
        {/* Dropzone / Import */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "mx-auto mb-8 flex w-full max-w-2xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
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

        {/* Book Grid */}
        {books && books.length > 0 ? (
          <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onEdit={() => setEditBook(book)}
                onDelete={() => setDeleteBookTarget(book)}
              />
            ))}
          </div>
        ) : (
          books !== undefined && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-zinc-500">
                No books yet. Import your first EPUB or PDF above.
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Book Card                                                           */
/* ------------------------------------------------------------------ */
function BookCard({
  book,
  onEdit,
  onDelete,
}: {
  book: BookItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  if (book.cover && !coverUrl) {
    const url = URL.createObjectURL(book.cover);
    setCoverUrl(url);
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl bg-zinc-900 transition-colors hover:bg-zinc-800">
      {/* Cover image — entire card is clickable EXCEPT the action menu */}
      <a
        href={`/read/${book.id}`}
        className="flex flex-col"
        onClick={(e) => {
          // Don't navigate if action menu was clicked
          if ((e.target as HTMLElement).closest("[data-action-menu]")) {
            e.preventDefault();
          }
        }}
      >
        <div className="aspect-[2/3] w-full bg-zinc-800">
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
        </div>

        <div className="flex flex-col gap-1 p-3">
          <p className="truncate text-sm font-medium">{book.title}</p>
          <p className="truncate text-xs text-zinc-400">{book.author}</p>
          <span className="inline-block self-start rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-500">
            {book.fileType}
          </span>
        </div>
      </a>

      {/* Action menu — absolutely positioned, stops propagation */}
      <div data-action-menu>
        <BookActionMenu book={book} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}
