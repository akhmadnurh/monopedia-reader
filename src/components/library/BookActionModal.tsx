"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MoreVertical,
  Pencil,
  Trash2,
  X,
  CloudUpload,
  Loader2,
  Share2,
} from "lucide-react";
import type { BookItem } from "@/types/book";
import { isTokenValid } from "@/lib/google-auth";
import { shareBookFile } from "@/lib/share-file";

/* ------------------------------------------------------------------ */
/*  Action Menu (three-dot button on each card)                         */
/* ------------------------------------------------------------------ */
export function BookActionMenu({
  book,
  onEdit,
  onDelete,
  onUpload,
}: {
  book: BookItem;
  onEdit: () => void;
  onDelete: () => void;
  onUpload?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );

  function handleMenuToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      setMenuPos(null);
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
      setOpen(true);
    }
  }

  function handleEdit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    onEdit();
  }

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    onDelete();
  }

  function handleUpload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    if (!onUpload) return;
    if (!isTokenValid()) {
      window.dispatchEvent(
        new CustomEvent("monopedia:toast", {
          detail: "Connect to Google Drive in Settings first.",
        }),
      );
      return;
    }
    setUploading(true);
    onUpload();
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    setSharing(true);
    try {
      await shareBookFile(book);
    } catch {
      window.dispatchEvent(
        new CustomEvent("monopedia:toast", {
          detail: "Failed to share ebook.",
        }),
      );
    } finally {
      setSharing(false);
    }
  }

  function stopProp(e: React.MouseEvent) {
    e.stopPropagation();
  }

  const isLocal = !book.driveFileId && book.syncStatus !== "synced";
  const showUpload = isLocal;

  return (
    <div
      ref={ref}
      className="absolute top-2 right-2 z-9"
      onClick={stopProp}
      onMouseDown={stopProp}
    >
      <button
        onClick={handleMenuToggle}
        className="rounded-full bg-black/40 p-1.5 text-white transition-colors hover:bg-black/60"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            className="fixed z-[9999] w-44 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
            style={{
              top: menuPos.top,
              right: menuPos.right,
              maxWidth: "calc(100vw - 32px)",
            }}
          >
            <button
              onClick={handleEdit}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Info
            </button>
            <button
              onClick={handleShare}
              disabled={sharing}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <Share2 className="h-3.5 w-3.5" />
              {sharing ? "Sharing..." : "Share Ebook"}
            </button>
            {showUpload && (
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-blue-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-3.5 w-3.5" />
                )}
                {uploading ? "Uploading..." : "Upload to Drive"}
              </button>
            )}
            <button
              onClick={handleDelete}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:bg-zinc-800 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Book
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Edit Metadata Dialog                                                */
/* ------------------------------------------------------------------ */
export function EditBookModal({
  book,
  open,
  onClose,
  onSave,
}: {
  book: BookItem;
  open: boolean;
  onClose: () => void;
  onSave: (title: string, author: string) => void;
}) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);

  // Reset when book changes
  useEffect(() => {
    setTitle(book.title);
    setAuthor(book.author);
  }, [book.title, book.author, open]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedTitle = title.trim();
      const trimmedAuthor = author.trim();
      if (!trimmedTitle) return;
      onSave(trimmedTitle, trimmedAuthor || "-");
      onClose();
    },
    [title, author, onSave, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-sm font-semibold">Edit Book Info</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Author
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete Confirmation Dialog                                          */
/* ------------------------------------------------------------------ */
export function DeleteBookModal({
  book,
  open,
  onClose,
  onConfirm,
}: {
  book: BookItem;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
      onClose();
    }
  }, [onConfirm, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-900/30">
            <Trash2 className="h-5 w-5 text-red-400" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-100">Delete Book</h3>
          <p className="mt-2 text-sm text-zinc-400">
            Are you sure you want to delete{" "}
            <span className="font-medium text-zinc-200">{book.title}</span>?
            {book.driveFileId && (
              <span className="mt-1 block text-xs text-zinc-500">
                This will also remove the file from Google Drive.
              </span>
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
