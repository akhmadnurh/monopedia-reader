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

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  await db.progress.put(progress);
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

export interface SyncPayload {
  progress: ReadingProgress[];
  highlights: Highlight[];
  exportedAt: number;
}

export async function exportSyncData(): Promise<SyncPayload> {
  const [progress, highlights] = await Promise.all([
    db.progress.toArray(),
    db.highlights.toArray(),
  ]);
  return { progress, highlights, exportedAt: Date.now() };
}

export async function importSyncData(payload: SyncPayload): Promise<void> {
  await db.transaction("rw", [db.progress, db.highlights], async () => {
    for (const p of payload.progress) {
      const existing = await db.progress.get(p.bookId);
      if (!existing || p.lastReadAt > existing.lastReadAt) {
        await db.progress.put(p);
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
