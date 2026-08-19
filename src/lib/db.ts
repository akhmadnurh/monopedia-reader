import Dexie, { type EntityTable } from "dexie";
import type { BookItem, Highlight, ReadingProgress } from "@/types/book";

const db = new Dexie("MonopediaReaderDB") as Dexie & {
  books: EntityTable<BookItem, "id">;
  progress: EntityTable<ReadingProgress, "bookId">;
  highlights: EntityTable<Highlight, "id">;
};

db.version(1).stores({
  books: "++id, title, author, addedAt",
  progress: "bookId, lastReadAt",
  highlights: "++id, bookId, createdAt",
});

db.version(2).stores({
  progress: "bookId, lastReadAt, driveFileId",
});

export async function saveBook(book: Omit<BookItem, "id">): Promise<number> {
  const id = await db.books.add(book as BookItem);
  return id!;
}

export async function getAllBooks(): Promise<BookItem[]> {
  return db.books.orderBy("addedAt").reverse().toArray();
}

export async function getBookById(id: number): Promise<BookItem | undefined> {
  return db.books.get(id);
}

export async function deleteBook(id: number): Promise<void> {
  await db.transaction("rw", [db.books, db.progress, db.highlights], async () => {
    await db.books.delete(id);
    await db.progress.delete(id);
    await db.highlights.where("bookId").equals(id).delete();
  });
}

export async function updateBookMetadata(
  id: number,
  updates: Partial<Pick<BookItem, "title" | "author">>,
): Promise<void> {
  await db.books.update(id, updates);
}

export async function deleteBookCompletely(id: number): Promise<{ driveFileId?: string }> {
  const book = await db.books.get(id);
  const driveFileId = book?.driveFileId;
  await deleteBook(id);
  return { driveFileId };
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  const existing = await db.progress.get(progress.bookId);
  // Max progress: only allow percentage to increase, never decrease
  const maxPercentage = Math.max(existing?.percentage ?? 0, progress.percentage);
  const finalProgress: ReadingProgress = {
    ...progress,
    percentage: maxPercentage,
    // Preserve existing driveFileId if not provided
    driveFileId: progress.driveFileId ?? existing?.driveFileId,
  };
  // Auto-finished: if user reached last page, mark 100%
  if (progress.cfi.startsWith("page-")) {
    const parts = progress.cfi.replace("page-", "").split("/");
    const pageNum = parseInt(parts[0], 10);
    // We check chapterTitle for "Page X of Y" to detect last page
    const match = progress.chapterTitle.match(/Page \d+ of (\d+)/);
    if (match) {
      const total = parseInt(match[1], 10);
      if (pageNum >= total) {
        finalProgress.percentage = 100;
        finalProgress.chapterTitle = "Finished";
      }
    }
  }
  await db.progress.put(finalProgress);
}

export async function getProgress(bookId: number): Promise<ReadingProgress | undefined> {
  return db.progress.get(bookId);
}

export async function saveHighlight(highlight: Omit<Highlight, "id">): Promise<number> {
  const id = await db.highlights.add(highlight as Highlight);
  return id!;
}

export async function getHighlightsByBook(bookId: number): Promise<Highlight[]> {
  return db.highlights.where("bookId").equals(bookId).toArray();
}

export async function deleteHighlight(id: number): Promise<void> {
  await db.highlights.delete(id);
}

export interface BookMetadata {
  driveFileId: string;
  title: string;
  author: string;
  fileType: "epub" | "pdf";
}

export interface SyncPayload {
  books: BookMetadata[];
  progress: ReadingProgress[];
  highlights: Highlight[];
  exportedAt: number;
}

export async function exportSyncData(): Promise<SyncPayload> {
  const [allBooks, progress, highlights] = await Promise.all([
    db.books.toArray(),
    db.progress.toArray(),
    db.highlights.toArray(),
  ]);

  // Only include books that have a driveFileId (already synced to Drive)
  const books: BookMetadata[] = allBooks
    .filter((b) => b.driveFileId)
    .map((b) => ({
      driveFileId: b.driveFileId!,
      title: b.title,
      author: b.author,
      fileType: b.fileType,
    }));

  // Enrich progress entries with driveFileId for cross-device matching
  const bookById = new Map(allBooks.map((b) => [b.id, b]));
  const enrichedProgress = progress.map((p) => {
    const book = bookById.get(p.bookId);
    return {
      ...p,
      driveFileId: p.driveFileId ?? book?.driveFileId,
    };
  });

  return { books, progress: enrichedProgress, highlights, exportedAt: Date.now() };
}

export async function importSyncData(payload: SyncPayload): Promise<void> {
  await db.transaction("rw", [db.books, db.progress, db.highlights], async () => {
    // Merge book metadata — update title/author if we already have the book locally
    if (payload.books) {
      for (const meta of payload.books) {
        const existing = await db.books
          .where("driveFileId")
          .equals(meta.driveFileId)
          .first();
        if (existing) {
          await db.books.update(existing.id!, {
            title: meta.title,
            author: meta.author,
          });
        }
      }
    }

    for (const p of payload.progress) {
      const existing = await db.progress.get(p.bookId);
      // Accept if: no existing entry, or remote is newer, or remote has driveFileId we don't
      const shouldUpdate = !existing
        || p.lastReadAt > existing.lastReadAt
        || (p.driveFileId && !existing.driveFileId);
      if (shouldUpdate) {
        await db.progress.put({
          ...p,
          driveFileId: p.driveFileId ?? existing?.driveFileId,
        });
      }
    }
    for (const h of payload.highlights) {
      const exists = await db.highlights.get(h.id);
      if (!exists) {
        await db.highlights.add(h);
      }
    }
  });
}

export { db };
