import {
  driveFetch,
  driveFetchJson,
  isTokenValid,
  clearToken,
  TokenExpiredError,
} from "./google-auth";
import { exportSyncData, importSyncData, saveBook, getAllBooks, type SyncPayload } from "./db";
import type { BookItem } from "@/types/book";

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

  // 1a. Return cached folderId if available
  const cached = getCachedFolderId();
  if (cached) return cached;

  // 1b. Query Drive for existing folder
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

  // 1c. Folder doesn't exist — create it in My Drive root
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

// Alias — all internal callers use this
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

export async function uploadSyncData(): Promise<void> {
  assertTokenValid();

  const folderId = await getOrCreateSyncFolder();
  const payload = await exportSyncData();
  const body = JSON.stringify(payload);
  const blob = new Blob([body], { type: "application/json" });

  const existing = await findFileInFolder(folderId, SYNC_FILENAME);

  if (existing) {
    await fetchJsonWithTimeout(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`,
      {
        method: "PATCH",
        body: buildMultipartBody(existing.name, blob),
      },
    );
  } else {
    await fetchJsonWithTimeout(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        body: buildMultipartBody(SYNC_FILENAME, blob, folderId),
      },
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Download metadata.json & merge into local DB
// ---------------------------------------------------------------------------

export async function downloadSyncData(): Promise<{
  updated: boolean;
  remoteExportedAt: number;
}> {
  assertTokenValid();

  const folderId = await getOrCreateSyncFolder();
  const file = await findFileInFolder(folderId, SYNC_FILENAME);

  if (!file) return { updated: false, remoteExportedAt: 0 };

  const res = await fetchJsonWithTimeout<SyncPayload & { exportedAt: number }>(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
  );

  if (!res.exportedAt) return { updated: false, remoteExportedAt: 0 };

  const local = await exportSyncData();

  if (res.exportedAt <= local.exportedAt) {
    return { updated: false, remoteExportedAt: res.exportedAt };
  }

  await importSyncData(res);
  return { updated: true, remoteExportedAt: res.exportedAt };
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

    // Check if file already exists on Drive
    const existing = await findFileInFolder(folderId, safeName);
    if (existing) return existing.id;

    // Multipart upload — metadata + binary blob in single request
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
// 5b. Download all books from Drive that are not yet in local DB
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

  // List all epub/pdf files in the sync folder
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and (mimeType='application/epub+zip' or mimeType='application/pdf' or name contains '.epub' or name contains '.pdf')`,
  );
  const res = await fetchJsonWithTimeout<{ files: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=1000`,
  );

  const localBooks = await getAllBooks();
  const localTitles = new Set(localBooks.map((b) => b.title.toLowerCase()));
  const localDriveIds = new Set(localBooks.map((b) => b.driveFileId).filter(Boolean));

  for (const file of res.files) {
    try {
      if (localDriveIds.has(file.id)) {
        result.skipped++;
        continue;
      }

      const title = file.name.replace(/\.(epub|pdf)$/i, "").trim();
      if (localTitles.has(title.toLowerCase())) {
        result.skipped++;
        continue;
      }

      const driveRes = await fetchWithTimeout(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      );

      if (driveRes.status === 401) {
        clearToken();
        throw new TokenExpiredError();
      }
      if (!driveRes.ok) {
        throw new Error(`HTTP ${driveRes.status}`);
      }

      const blob = await driveRes.blob();

      if (blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      const ext = file.name.split(".").pop()?.toLowerCase();
      const fileType: "epub" | "pdf" = ext === "pdf" ? "pdf" : "epub";

      // Parse metadata from the downloaded blob
      let parsedTitle = title;
      let parsedAuthor = "-";
      let totalChapters = 0;

      try {
        if (fileType === "epub") {
          const { parseEpub } = await import("./epub-parser");
          const parsed = await parseEpub(blob, file.name);
          if (parsed.title && parsed.title !== "Untitled") parsedTitle = parsed.title;
          if (parsed.author && parsed.author !== "-") parsedAuthor = parsed.author;
          totalChapters = parsed.chapters.length;
        } else {
          const { parsePdf } = await import("./pdf-parser");
          const parsed = await parsePdf(blob, file.name);
          if (parsed.title && parsed.title !== "Untitled PDF") parsedTitle = parsed.title;
          if (parsed.author && parsed.author !== "-") parsedAuthor = parsed.author;
          totalChapters = parsed.totalPages;
        }
      } catch {
        // Metadata parsing failed — use filename-derived values (non-fatal)
      }

      const book: Omit<BookItem, "id"> = {
        title: parsedTitle,
        author: parsedAuthor,
        fileType,
        totalChapters,
        addedAt: Date.now(),
        fileSize: blob.size,
        fileBlob: blob,
        driveFileId: file.id,
        syncStatus: "synced",
      };

      await saveBook(book);
      localTitles.add(parsedTitle.toLowerCase());
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
// 6. Full bidirectional sync
// ---------------------------------------------------------------------------

export interface SyncResult {
  direction: "uploaded" | "downloaded" | "up-to-date";
  remoteExportedAt: number;
}

export async function fullSync(): Promise<SyncResult> {
  assertTokenValid();

  const folderId = await getOrCreateSyncFolder();
  const file = await findFileInFolder(folderId, SYNC_FILENAME);

  const local = await exportSyncData();

  if (!file) {
    await uploadSyncData();
    return { direction: "uploaded", remoteExportedAt: local.exportedAt };
  }

  const remote = await fetchJsonWithTimeout<SyncPayload & { exportedAt: number }>(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
  );

  if (!remote.exportedAt) {
    await uploadSyncData();
    return { direction: "uploaded", remoteExportedAt: local.exportedAt };
  }

  if (remote.exportedAt > local.exportedAt) {
    await importSyncData(remote);
    return { direction: "downloaded", remoteExportedAt: remote.exportedAt };
  }

  if (local.exportedAt > remote.exportedAt) {
    await uploadSyncData();
    return { direction: "uploaded", remoteExportedAt: local.exportedAt };
  }

  return { direction: "up-to-date", remoteExportedAt: remote.exportedAt };
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
