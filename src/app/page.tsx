"use client";

import { useCallback, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Upload, Settings, Trash2 } from "lucide-react";
import { getAllBooks, saveBook, deleteBook } from "@/lib/db";
import { parseEpub, epubFileToBlob } from "@/lib/epub-parser";
import type { BookItem } from "@/types/book";
import { cn } from "@/lib/utils";

export default function Home() {
  const books = useLiveQuery(() => getAllBooks(), []);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);

    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase();

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

  const handleDelete = useCallback(async (id: number) => {
    await deleteBook(id);
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
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
            accept=".epub,.pdf"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Book Grid */}
        {books && books.length > 0 ? (
          <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {books.map((book) => (
              <BookCard key={book.id} book={book} onDelete={handleDelete} />
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
    </div>
  );
}

function BookCard({
  book,
  onDelete,
}: {
  book: BookItem;
  onDelete: (id: number) => void;
}) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  if (book.cover && !coverUrl) {
    const url = URL.createObjectURL(book.cover);
    setCoverUrl(url);
  }

  return (
    <a
      href={`/read/${book.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-zinc-900 transition-colors hover:bg-zinc-800"
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

      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (book.id != null) onDelete(book.id);
        }}
        className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-zinc-400 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </a>
  );
}
