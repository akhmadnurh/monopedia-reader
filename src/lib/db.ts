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

db.version(3).stores({
  books: "++id, title, author, addedAt, driveFileId",
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
  await db.books.update(id, { ...updates, lastUpdatedAt: Date.now() } as Partial<BookItem>);
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
  lastUpdatedAt: number;
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

  console.log("[DB] exportSyncData: allBooks=" + allBooks.length + " progress=" + progress.length + " highlights=" + highlights.length);

  // Only include books that have a driveFileId (already synced to Drive)
  const books: BookMetadata[] = allBooks
    .filter((b) => b.driveFileId)
    .map((b) => ({
      driveFileId: b.driveFileId!,
      title: b.title,
      author: b.author,
      fileType: b.fileType,
      lastUpdatedAt: (b as unknown as { lastUpdatedAt?: number }).lastUpdatedAt ?? b.addedAt,
    }));

  const skippedBooks = allBooks.filter((b) => !b.driveFileId);
  console.log("[DB] exportSyncData: books with driveFileId=" + books.length + " without driveFileId=" + skippedBooks.length);
  for (const b of skippedBooks) {
    console.log("[DB]   SKIP book (no driveFileId): id=" + b.id + " title=" + b.title);
  }

  // Enrich progress entries with driveFileId for cross-device matching
  const bookById = new Map(allBooks.map((b) => [b.id, b]));
  const enrichedProgress = progress.map((p) => {
    const book = bookById.get(p.bookId);
    return {
      ...p,
      driveFileId: p.driveFileId ?? book?.driveFileId,
    };
  });

  console.log("[DB] exportSyncData result: books=" + books.length + " progress=" + enrichedProgress.length);
  for (const p of enrichedProgress) {
    console.log("[DB]   exported progress: bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " cfi=" + p.cfi + " percentage=" + p.percentage);
  }

  return { books, progress: enrichedProgress, highlights, exportedAt: Date.now() };
}

export async function importSyncData(payload: SyncPayload): Promise<void> {
  console.log("[DB] ▶ importSyncData START: books=" + (payload.books?.length ?? 0) + " progress=" + (payload.progress?.length ?? 0) + " highlights=" + (payload.highlights?.length ?? 0));
  await db.transaction("rw", [db.books, db.progress, db.highlights], async () => {
    // ── Step 0: Link orphan books (no driveFileId) to remote by title ──
    if (payload.books?.length) {
      const allLocalBooks = await db.books.toArray();
      const orphanByTitle = new Map<string, BookItem>();
      for (const b of allLocalBooks) {
        if (!b.driveFileId && b.title) orphanByTitle.set(b.title, b);
      }
      console.log("[DB] Step 0: orphan books (no driveFileId):", orphanByTitle.size);
      for (const [title, b] of orphanByTitle) {
        console.log("[DB]   orphan: id=" + b.id + " title=" + title);
      }

      for (const meta of payload.books) {
        const orphan = orphanByTitle.get(meta.title);
        if (orphan?.id) {
          console.log("[DB] Step 0: LINKING orphan id=" + orphan.id + " title=" + meta.title + " → driveFileId=" + meta.driveFileId);
          await db.books.update(orphan.id, {
            driveFileId: meta.driveFileId,
            syncStatus: "synced",
          } as Partial<BookItem>);
          orphanByTitle.delete(meta.title);
        }
      }
    }

    // ── Step 1: Update book metadata (title/author) if already linked ──
    if (payload.books) {
      for (const meta of payload.books) {
        const existing = await db.books
          .where("driveFileId")
          .equals(meta.driveFileId)
          .first();
        if (existing) {
          console.log("[DB] Step 1: updating book id=" + existing.id + " title=" + meta.title);
          await db.books.update(existing.id!, {
            title: meta.title,
            author: meta.author,
          });
        }
      }
    }

    // ── Step 2: Import progress — match by driveFileId (cross-device ID) ──
    const allLocalBooks = await db.books.toArray();
    const bookByDriveId = new Map<string, number>();
    for (const b of allLocalBooks) {
      if (b.driveFileId && b.id) bookByDriveId.set(b.driveFileId, b.id);
    }
    console.log("[DB] Step 2: bookByDriveId map:", bookByDriveId.size, "entries");
    for (const [dfId, localId] of bookByDriveId) {
      console.log("[DB]   driveFileId=" + dfId + " → localBookId=" + localId);
    }

    for (const p of payload.progress) {
      const localBookId = p.driveFileId ? bookByDriveId.get(p.driveFileId) : undefined;
      console.log("[DB] Step 2: progress bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " → localBookId=" + localBookId);
      if (localBookId === undefined) {
        console.log("[DB]   SKIPPED: no matching local book for driveFileId=" + p.driveFileId);
        continue;
      }

      const existing = await db.progress.get(localBookId);
      const shouldUpdate = !existing || p.lastReadAt > existing.lastReadAt;
      console.log("[DB]   existing=" + (existing?.cfi ?? "null") + " shouldUpdate=" + shouldUpdate);
      if (shouldUpdate) {
        console.log("[DB]   IMPORTING progress: bookId=" + localBookId + " cfi=" + p.cfi + " percentage=" + p.percentage);
        await db.progress.put({
          ...p,
          bookId: localBookId,
          driveFileId: p.driveFileId,
        });
      }
    }

    // ── Step 3: Import highlights (deduplicate by id) ──
    for (const h of payload.highlights) {
      const exists = await db.highlights.get(h.id);
      if (!exists) {
        await db.highlights.add(h);
      }
    }
    console.log("[DB] ✔ importSyncData DONE");
  });
}

/**
 * Merge two SyncPayload (local + remote) into one.
 * Per-entry conflict resolution: newer timestamp wins.
 *
 * - Books: matched by driveFileId, lastUpdatedAt decides
 * - Progress: matched by driveFileId, lastReadAt decides
 * - Highlights: matched by id, deduplicated
 */
export function mergeSyncData(local: SyncPayload, remote: SyncPayload): SyncPayload {
  console.log("[DB] ▶ mergeSyncData: local.books=" + local.books.length + " local.progress=" + local.progress.length + " | remote.books=" + remote.books.length + " remote.progress=" + remote.progress.length);

  // ── Books ──
  const bookMap = new Map<string, BookMetadata>();
  for (const b of local.books) bookMap.set(b.driveFileId, b);
  for (const b of remote.books) {
    const existing = bookMap.get(b.driveFileId);
    if (!existing || b.lastUpdatedAt > existing.lastUpdatedAt) {
      console.log("[DB] merge book: driveFileId=" + b.driveFileId + " title=" + b.title + " (remote wins, lastUpdatedAt=" + b.lastUpdatedAt + (existing ? " vs " + existing.lastUpdatedAt : " new") + ")");
      bookMap.set(b.driveFileId, b);
    } else {
      console.log("[DB] merge book: driveFileId=" + b.driveFileId + " title=" + b.title + " (local keeps, local.lastUpdatedAt=" + existing.lastUpdatedAt + " >= remote=" + b.lastUpdatedAt + ")");
    }
  }

  // ── Progress ──
  const progressMap = new Map<string, ReadingProgress>();
  for (const p of local.progress) {
    const key = p.driveFileId ?? `local-${p.bookId}`;
    progressMap.set(key, p);
    console.log("[DB] merge progress add local: key=" + key + " cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt);
  }
  for (const p of remote.progress) {
    const key = p.driveFileId ?? `remote-${p.bookId}`;
    const existing = progressMap.get(key);
    if (!existing || p.lastReadAt > existing.lastReadAt) {
      console.log("[DB] merge progress: key=" + key + " REMOTE WINS cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt + (existing ? " vs local lastReadAt=" + existing.lastReadAt : " new"));
      progressMap.set(key, p);
    } else {
      console.log("[DB] merge progress: key=" + key + " LOCAL KEEPS local.lastReadAt=" + existing.lastReadAt + " >= remote.lastReadAt=" + p.lastReadAt);
    }
  }

  // ── Highlights ──
  const highlightMap = new Map<number, Highlight>();
  for (const h of local.highlights) highlightMap.set(h.id!, h);
  for (const h of remote.highlights) {
    if (!highlightMap.has(h.id!)) highlightMap.set(h.id!, h);
  }

  const result = {
    books: Array.from(bookMap.values()),
    progress: Array.from(progressMap.values()),
    highlights: Array.from(highlightMap.values()),
    exportedAt: Date.now(),
  };
  console.log("[DB] ✔ mergeSyncData: result books=" + result.books.length + " progress=" + result.progress.length);
  return result;
}

export { db };
