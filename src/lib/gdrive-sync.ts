import {
  driveFetch,
  driveFetchJson,
  isTokenValid,
  clearToken,
  TokenExpiredError,
} from "./google-auth";
import { exportSyncData, importSyncData, mergeSyncData, saveBook, saveProgress, getAllBooks, type SyncPayload } from "./db";
import type { BookItem, ReadingProgress } from "@/types/book";

const FOLDER_NAME = "Monopedia Reader";
const SYNC_FILENAME = "metadata.json";
const MIME_FOLDER = "application/vnd.google-apps.folder";
const FETCH_TIMEOUT_MS = 60_000;
const FOLDER_CACHE_KEY = "gdrive_monopedia_folder_id";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

interface IdOnly {
  id: string;
}

// ---------------------------------------------------------------------------
// Token guard
// ---------------------------------------------------------------------------

function assertTokenValid(): void {
  if (!isTokenValid()) {
    clearToken();
    throw new TokenExpiredError();
  }
}

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await driveFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchJsonWithTimeout<T = unknown>(
  input: string | URL,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T> {
  const res = await fetchWithTimeout(input, init, timeoutMs);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Folder ID cache (localStorage)
// ---------------------------------------------------------------------------

function getCachedFolderId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(FOLDER_CACHE_KEY);
}

function setCachedFolderId(folderId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FOLDER_CACHE_KEY, folderId);
}

export function clearCachedFolderId(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(FOLDER_CACHE_KEY);
}

// ---------------------------------------------------------------------------
// 1. getOrCreateFolder — explicit, cached, callable from login
// ---------------------------------------------------------------------------

export async function getOrCreateFolder(): Promise<string> {
  assertTokenValid();

  const cached = getCachedFolderId();
  if (cached) return cached;

  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='${MIME_FOLDER}' and trashed=false`,
  );
  const res = await fetchJsonWithTimeout<{ files: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
  );

  if (res.files.length > 0) {
    const folderId = res.files[0].id;
    setCachedFolderId(folderId);
    return folderId;
  }

  const created = await fetchJsonWithTimeout<IdOnly>(
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: MIME_FOLDER,
      }),
    },
  );

  setCachedFolderId(created.id);
  return created.id;
}

const getOrCreateSyncFolder = getOrCreateFolder;

// ---------------------------------------------------------------------------
// 2. Find file by name in folder
// ---------------------------------------------------------------------------

async function findFileInFolder(
  folderId: string,
  fileName: string,
): Promise<DriveFile | null> {
  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${fileName}' and trashed=false`,
  );
  const res = await fetchJsonWithTimeout<{ files: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=1`,
  );
  return res.files.length > 0 ? res.files[0] : null;
}

// ---------------------------------------------------------------------------
// 3. Upload / Update metadata.json
// ---------------------------------------------------------------------------

export async function uploadSyncData(payload?: SyncPayload): Promise<void> {
  console.log("[GDriveSync] ▶ uploadSyncData START");
  assertTokenValid();

  const folderId = await getOrCreateSyncFolder();
  const data = payload ?? await exportSyncData();
  const body = JSON.stringify(data);
  console.log("[GDriveSync] payload size:", body.length, "bytes");
  console.log("[GDriveSync] payload export:", JSON.stringify(data, null, 2));
  const blob = new Blob([body], { type: "application/json" });

  const existing = await findFileInFolder(folderId, SYNC_FILENAME);
  console.log("[GDriveSync] existing metadata.json:", existing ? existing.id + " modified=" + existing.modifiedTime : "NOT FOUND");

  if (existing) {
    console.log("[GDriveSync] PATCH updating existing file...");
    await fetchJsonWithTimeout(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`,
      {
        method: "PATCH",
        body: buildMultipartBody(existing.name, blob),
      },
    );
    console.log("[GDriveSync] ✔ PATCH done");
  } else {
    console.log("[GDriveSync] POST creating new file...");
    await fetchJsonWithTimeout(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        body: buildMultipartBody(SYNC_FILENAME, blob, folderId),
      },
    );
    console.log("[GDriveSync] ✔ POST done");
  }
  console.log("[GDriveSync] ✔ uploadSyncData DONE");
}

// ---------------------------------------------------------------------------
// 4. Download metadata.json & merge into local DB
// ---------------------------------------------------------------------------

export async function downloadSyncData(): Promise<{
  updated: boolean;
  remoteExportedAt: number;
}> {
  console.log("[GDriveSync] ▶ downloadSyncData START");
  assertTokenValid();

  const folderId = await getOrCreateSyncFolder();
  console.log("[GDriveSync] folderId:", folderId);
  const file = await findFileInFolder(folderId, SYNC_FILENAME);
  console.log("[GDriveSync] metadata.json file on Drive:", file ? file.id : "NOT FOUND");

  if (!file) { console.log("[GDriveSync] no metadata.json → return updated=false"); return { updated: false, remoteExportedAt: 0 }; }

  const remote = await fetchJsonWithTimeout<SyncPayload & { exportedAt: number }>(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
  );

  console.log("[GDriveSync] remote.exportedAt:", remote.exportedAt);
  console.log("[GDriveSync] remote.books:", remote.books?.length ?? 0, "entries");
  console.log("[GDriveSync] remote.progress:", remote.progress?.length ?? 0, "entries");
  if (remote.progress?.length) {
    for (const p of remote.progress) {
      console.log("[GDriveSync]   remote progress: bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt);
    }
  }

  if (!remote.exportedAt) { console.log("[GDriveSync] no exportedAt → return updated=false"); return { updated: false, remoteExportedAt: 0 }; }

  const local = await exportSyncData();
  console.log("[GDriveSync] local.books:", local.books?.length ?? 0, "entries");
  console.log("[GDriveSync] local.progress:", local.progress?.length ?? 0, "entries");
  if (local.progress?.length) {
    for (const p of local.progress) {
      console.log("[GDriveSync]   local progress: bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt);
    }
  }

  const merged = mergeSyncData(local, remote);
  console.log("[GDriveSync] merged.books:", merged.books?.length ?? 0, "entries");
  console.log("[GDriveSync] merged.progress:", merged.progress?.length ?? 0, "entries");
  if (merged.progress?.length) {
    for (const p of merged.progress) {
      console.log("[GDriveSync]   merged progress: bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt);
    }
  }

  console.log("[GDriveSync] calling importSyncData...");
  await importSyncData(merged);
  console.log("[GDriveSync] calling uploadSyncData...");
  await uploadSyncData(merged);

  console.log("[GDriveSync] ✔ downloadSyncData DONE, updated=true");
  return { updated: true, remoteExportedAt: remote.exportedAt };
}

// ---------------------------------------------------------------------------
// 5. Upload book file (epub / pdf) to Drive — multipart upload
// ---------------------------------------------------------------------------

export async function uploadBookFile(
  book: Omit<BookItem, "id">,
): Promise<string | null> {
  try {
    assertTokenValid();

    const folderId = await getOrCreateSyncFolder();
    const ext = book.fileType === "pdf" ? "pdf" : "epub";
    const safeName = `${book.title.replace(/[^a-zA-Z0-9\-_ ]/g, "_").slice(0, 80)}.${ext}`;

    const existing = await findFileInFolder(folderId, safeName);
    if (existing) return existing.id;

    const created = await fetchJsonWithTimeout<IdOnly>(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        body: buildMultipartBody(safeName, book.fileBlob, folderId),
      },
    );

    return created.id;
  } catch (err) {
    if (err instanceof Error && err.name === "TokenExpiredError") {
      clearToken();
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5b. Pull all books from Drive — metadata.json is Single Source of Truth
//     - Title/author come from metadata.json, NOT from Drive filename
//     - Cover thumbnail extracted from epub/pdf blob
//     - Reading progress saved to IndexedDB progress table
// ---------------------------------------------------------------------------

export interface PullResult {
  imported: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
}

export async function downloadAllBooks(): Promise<PullResult> {
  assertTokenValid();

  const folderId = await getOrCreateSyncFolder();
  const result: PullResult = { imported: 0, skipped: 0, errors: 0, errorDetails: [] };

  // ── Step 1: Download metadata.json (Single Source of Truth) ──
  let remoteMeta: SyncPayload | null = null;
  const metaFile = await findFileInFolder(folderId, SYNC_FILENAME);
  if (metaFile) {
    try {
      remoteMeta = await fetchJsonWithTimeout<SyncPayload>(
        `https://www.googleapis.com/drive/v3/files/${metaFile.id}?alt=media`,
      );
    } catch {
      // metadata.json unreadable — continue without it
    }
  }

  // Map: driveFileId → { title, author } from metadata.json
  const metaByDriveId = new Map<string, { title: string; author: string }>();
  if (remoteMeta?.books) {
    for (const b of remoteMeta.books) {
      metaByDriveId.set(b.driveFileId, { title: b.title, author: b.author });
    }
  }

  // Map: driveFileId → ReadingProgress from metadata.json
  const progressByDriveId = new Map<string, ReadingProgress>();
  if (remoteMeta?.progress) {
    for (const p of remoteMeta.progress) {
      const dfId = p.driveFileId;
      if (dfId) {
        progressByDriveId.set(dfId, p);
      }
    }
  }

  // ── Step 2: List all epub/pdf files in the sync folder ──
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and (mimeType='application/epub+zip' or mimeType='application/pdf' or name contains '.epub' or name contains '.pdf')`,
  );
  const res = await fetchJsonWithTimeout<{ files: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=1000`,
  );

  const localBooks = await getAllBooks();
  const localDriveIds = new Set(localBooks.map((b) => b.driveFileId).filter(Boolean));

  for (const file of res.files) {
    try {
      // Skip if already synced
      if (localDriveIds.has(file.id)) {
        result.skipped++;
        continue;
      }

      // ── Step 3: Download file blob ──
      const driveRes = await fetchWithTimeout(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      );

      if (driveRes.status === 401) {
        clearToken();
        throw new TokenExpiredError();
      }
      if (!driveRes.ok) throw new Error(`HTTP ${driveRes.status}`);

      const blob = await driveRes.blob();
      if (blob.size === 0) throw new Error("Downloaded file is empty");

      // ── Step 4: Determine file type ──
      const ext = file.name.split(".").pop()?.toLowerCase();
      const fileType: "epub" | "pdf" = ext === "pdf" ? "pdf" : "epub";

      // ── Step 5: Parse blob → extract metadata + cover thumbnail ──
      let parsedTitle = file.name.replace(/\.(epub|pdf)$/i, "").trim();
      let parsedAuthor = "-";
      let totalChapters = 0;
      let cover: Blob | null = null;

      try {
        if (fileType === "epub") {
          const { parseEpub } = await import("./epub-parser");
          const parsed = await parseEpub(blob, file.name);
          if (parsed.title && parsed.title !== "Untitled") parsedTitle = parsed.title;
          if (parsed.author && parsed.author !== "-") parsedAuthor = parsed.author;
          totalChapters = parsed.chapters.length;
          cover = parsed.cover;
        } else {
          const { parsePdf } = await import("./pdf-parser");
          const parsed = await parsePdf(blob, file.name);
          if (parsed.title && parsed.title !== "Untitled PDF") parsedTitle = parsed.title;
          if (parsed.author && parsed.author !== "-") parsedAuthor = parsed.author;
          totalChapters = parsed.totalPages;
          cover = parsed.cover;
        }
      } catch {
        // Non-fatal: use filename-derived values
      }

      // ── Step 6: Override title/author from metadata.json (SSOT) ──
      const remoteBookMeta = metaByDriveId.get(file.id);
      if (remoteBookMeta) {
        if (remoteBookMeta.title) parsedTitle = remoteBookMeta.title;
        if (remoteBookMeta.author && remoteBookMeta.author !== "-") {
          parsedAuthor = remoteBookMeta.author;
        }
      }

      // ── Step 7: Save book to IndexedDB (cover included) ──
      const book: Omit<BookItem, "id"> = {
        title: parsedTitle,
        author: parsedAuthor,
        fileType,
        totalChapters,
        addedAt: Date.now(),
        fileSize: blob.size,
        fileBlob: blob,
        cover: cover ?? undefined,
        driveFileId: file.id,
        syncStatus: "synced",
      };

      const localId = await saveBook(book);

      // ── Step 8: Save reading progress from metadata.json (matched by driveFileId) ──
      const remoteProgress = progressByDriveId.get(file.id);
      if (remoteProgress && remoteProgress.percentage > 0) {
        await saveProgress({
          bookId: localId,
          cfi: remoteProgress.cfi,
          percentage: remoteProgress.percentage,
          chapterTitle: remoteProgress.chapterTitle,
          lastReadAt: remoteProgress.lastReadAt,
          driveFileId: file.id,
        });
      }

      result.imported++;
    } catch (err) {
      result.errors++;

      if (err instanceof Error && err.name === "TokenExpiredError") {
        result.errorDetails.push("Google Drive session expired. Please reconnect.");
        break;
      }

      const msg = err instanceof Error ? err.message : "Unknown error";
      result.errorDetails.push(`${file.name}: ${msg}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 5c. Delete a file from Google Drive by its file ID
// ---------------------------------------------------------------------------

export async function deleteFileFromDrive(fileId: string): Promise<boolean> {
  try {
    assertTokenValid();
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 6. Full bidirectional sync — per-entry merge, no data loss
// ---------------------------------------------------------------------------

export interface SyncResult {
  direction: "uploaded" | "downloaded" | "synced";
  remoteExportedAt: number;
}

export async function fullSync(): Promise<SyncResult> {
  console.log("[GDriveSync] ▶ fullSync START");
  assertTokenValid();

  const folderId = await getOrCreateSyncFolder();
  const file = await findFileInFolder(folderId, SYNC_FILENAME);
  console.log("[GDriveSync] metadata.json on Drive:", file ? file.id : "NOT FOUND");

  const local = await exportSyncData();
  console.log("[GDriveSync] local export: books=" + local.books.length + " progress=" + local.progress.length + " highlights=" + local.highlights.length);
  for (const p of local.progress) {
    console.log("[GDriveSync]   local: bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt);
  }

  // First sync — no remote file yet, just upload
  if (!file) {
    console.log("[GDriveSync] no remote file → uploading local as first sync");
    await uploadSyncData(local);
    return { direction: "uploaded", remoteExportedAt: local.exportedAt };
  }

  // Download remote metadata.json
  const remote = await fetchJsonWithTimeout<SyncPayload & { exportedAt: number }>(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
  );
  console.log("[GDriveSync] remote: books=" + (remote.books?.length ?? 0) + " progress=" + (remote.progress?.length ?? 0) + " exportedAt=" + remote.exportedAt);
  for (const p of (remote.progress ?? [])) {
    console.log("[GDriveSync]   remote: bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt);
  }

  if (!remote.exportedAt) {
    console.log("[GDriveSync] remote has no exportedAt → uploading local");
    await uploadSyncData(local);
    return { direction: "uploaded", remoteExportedAt: local.exportedAt };
  }

  // Per-entry merge: newer timestamp wins per entry
  const merged = mergeSyncData(local, remote);
  console.log("[GDriveSync] merged: books=" + merged.books.length + " progress=" + merged.progress.length);
  for (const p of merged.progress) {
    console.log("[GDriveSync]   merged: bookId=" + p.bookId + " driveFileId=" + p.driveFileId + " cfi=" + p.cfi + " percentage=" + p.percentage + " lastReadAt=" + p.lastReadAt);
  }

  // Write merged result to both local DB and Drive
  console.log("[GDriveSync] calling importSyncData...");
  await importSyncData(merged);
  console.log("[GDriveSync] calling uploadSyncData...");
  await uploadSyncData(merged);

  console.log("[GDriveSync] ✔ fullSync DONE");
  return { direction: "synced", remoteExportedAt: remote.exportedAt };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMultipartBody(
  name: string,
  blob: Blob,
  parentId?: string,
): FormData {
  const metadata: Record<string, unknown> = { name };
  if (parentId) metadata.parents = [parentId];

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append("file", blob);
  return form;
}
