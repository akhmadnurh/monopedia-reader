import { driveFetchJson, type TokenExpiredError } from "./google-auth";
import { exportSyncData, importSyncData, type SyncPayload } from "./db";
import type { BookItem } from "@/types/book";

const FOLDER_NAME = "Monopedia Reader";
const SYNC_FILENAME = "metadata.json";
const MIME_FOLDER = "application/vnd.google-apps.folder";

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
// 1. Folder Initialisation
// ---------------------------------------------------------------------------

export async function getOrCreateSyncFolder(): Promise<string> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='${MIME_FOLDER}' and trashed=false`,
  );
  const res = await driveFetchJson<{ files: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
  );

  if (res.files.length > 0) return res.files[0].id;

  const created = await driveFetchJson<IdOnly>(
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

  return created.id;
}

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
  const res = await driveFetchJson<{ files: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=1`,
  );
  return res.files.length > 0 ? res.files[0] : null;
}

// ---------------------------------------------------------------------------
// 3. Upload / Update metadata.json
// ---------------------------------------------------------------------------

export async function uploadSyncData(): Promise<void> {
  const folderId = await getOrCreateSyncFolder();
  const payload = await exportSyncData();
  const body = JSON.stringify(payload);
  const blob = new Blob([body], { type: "application/json" });

  const existing = await findFileInFolder(folderId, SYNC_FILENAME);

  if (existing) {
    await driveFetchJson(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`,
      {
        method: "PATCH",
        body: buildMultipartBody(existing.name, blob),
      },
    );
  } else {
    await driveFetchJson(
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
  const folderId = await getOrCreateSyncFolder();
  const file = await findFileInFolder(folderId, SYNC_FILENAME);

  if (!file) return { updated: false, remoteExportedAt: 0 };

  const res = await driveFetchJson<SyncPayload & { exportedAt: number }>(
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
// 5. Upload book file (epub / pdf) to Drive
// ---------------------------------------------------------------------------

export async function uploadBookFile(
  book: Omit<BookItem, "id">,
): Promise<string | null> {
  try {
    const folderId = await getOrCreateSyncFolder();
    const ext = book.fileType === "pdf" ? "pdf" : "epub";
    const safeName = `${book.title.replace(/[^a-zA-Z0-9\-_ ]/g, "_").slice(0, 80)}.${ext}`;

    const existing = await findFileInFolder(folderId, safeName);
    if (existing) return existing.id;

    const created = await driveFetchJson<IdOnly>(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        body: buildMultipartBody(safeName, book.fileBlob, folderId),
      },
    );

    return created.id;
  } catch {
    return null;
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
  const folderId = await getOrCreateSyncFolder();
  const file = await findFileInFolder(folderId, SYNC_FILENAME);

  const local = await exportSyncData();

  if (!file) {
    await uploadSyncData();
    return { direction: "uploaded", remoteExportedAt: local.exportedAt };
  }

  const remote = await driveFetchJson<SyncPayload & { exportedAt: number }>(
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
  const metadata: Record<string, string> = { name };
  if (parentId) metadata.parents = parentId;

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append("file", blob);
  return form;
}

export type { TokenExpiredError };
