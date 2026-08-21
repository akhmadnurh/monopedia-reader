"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { saveBook } from "@/lib/db";
import { isTokenValid } from "@/lib/google-auth";
import { parseEpub } from "@/lib/epub-parser";
import type { BookItem } from "@/types/book";

interface PendingFile {
  fileName: string;
  fileType: "pdf" | "epub";
  mimeType: string;
  arrayBuffer: ArrayBuffer;
  createdAt: number;
}

const SAFETY_TIMEOUT_MS = 5000;

function openPendingDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("MonopediaPendingImport", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("files", { keyPath: "createdAt" });
    };
  });
}

async function getPendingFiles(): Promise<PendingFile[]> {
  const db = await openPendingDB();
  try {
    if (!db.objectStoreNames.contains("files")) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const store = tx.objectStore("files");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function clearPendingFile(createdAt: number): Promise<void> {
  const db = await openPendingDB();
  try {
    if (!db.objectStoreNames.contains("files")) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(createdAt);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function importSingleFile(item: PendingFile): Promise<boolean> {
  const ext = item.fileName.split(".").pop()?.toLowerCase();

  if (ext === "epub") {
    const blob = new Blob([item.arrayBuffer], { type: "application/epub+zip" });
    const parsed = await parseEpub(blob, item.fileName);
    const autoSync = localStorage.getItem("autoSyncNewBooks") === "true";
    const connected = isTokenValid();
    const book: Omit<BookItem, "id"> = {
      title: parsed.title,
      author: parsed.author,
      fileType: "epub",
      cover: parsed.cover ?? undefined,
      totalChapters: parsed.chapters.length,
      addedAt: Date.now(),
      fileSize: item.arrayBuffer.byteLength,
      fileBlob: blob,
      syncStatus: connected && autoSync ? "pending" : "local",
    };
    await saveBook(book);
    return true;
  }

  if (ext === "pdf") {
    const blob = new Blob([item.arrayBuffer], { type: "application/pdf" });
    const { parsePdf } = await import("@/lib/pdf-parser");
    const parsed = await parsePdf(blob, item.fileName);
    const autoSync = localStorage.getItem("autoSyncNewBooks") === "true";
    const connected = isTokenValid();
    const book: Omit<BookItem, "id"> = {
      title: parsed.title,
      author: parsed.author,
      fileType: "pdf",
      cover: parsed.cover ?? undefined,
      totalChapters: parsed.totalPages,
      addedAt: Date.now(),
      fileSize: item.arrayBuffer.byteLength,
      fileBlob: blob,
      syncStatus: connected && autoSync ? "pending" : "local",
    };
    await saveBook(book);
    return true;
  }

  return false;
}

export default function ImportPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Importing eBook...");

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let redirected = false;

    function forceRedirect(path = "/") {
      if (redirected) return;
      redirected = true;
      router.replace(path);
    }

    // SAFETY: Force redirect after 5 seconds no matter what
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        console.warn("[Import] Safety timeout reached — forcing redirect to main page");
        forceRedirect("/");
      }
    }, SAFETY_TIMEOUT_MS);

    async function processImports() {
      try {
        const pending = await getPendingFiles();
        if (pending.length === 0) {
          if (!cancelled) {
            setStatus("error");
            setMessage("No pending import found.");
            setTimeout(() => forceRedirect("/"), 1500);
          }
          return;
        }

        let imported = 0;

        for (const item of pending) {
          if (cancelled) return;

          try {
            const ok = await importSingleFile(item);
            if (ok) imported++;
          } catch (err) {
            console.error(`[Import] Failed to import ${item.fileName}:`, err);
          } finally {
            await clearPendingFile(item.createdAt).catch(() => {});
          }
        }

        if (!cancelled) {
          if (imported > 0) {
            setStatus("success");
            setMessage(`${imported} book${imported > 1 ? "s" : ""} imported successfully!`);
            setTimeout(() => forceRedirect("/"), 1200);
          } else {
            setStatus("error");
            setMessage("Failed to import the file. It may be corrupted or unsupported.");
            setTimeout(() => forceRedirect("/"), 2000);
          }
        }
      } catch (err) {
        console.error("[Import] Error:", err);
        if (!cancelled) {
          setStatus("error");
          setMessage("An error occurred while processing the import.");
          setTimeout(() => forceRedirect("/"), 2000);
        }
      }
    }

    processImports();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-2xl">
        {status === "loading" && (
          <>
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
            <h1 className="text-sm font-semibold text-zinc-100">Importing eBook...</h1>
            <p className="mt-2 text-xs text-zinc-400">Please wait while we process your file.</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
            <h1 className="text-sm font-semibold text-zinc-100">Import Complete</h1>
            <p className="mt-2 text-xs text-zinc-400">{message}</p>
            <p className="mt-3 text-[10px] text-zinc-500">Redirecting to library...</p>
          </>
        )}
        {status === "error" && (
          <>
            <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-400" />
            <h1 className="text-sm font-semibold text-zinc-100">Import Notice</h1>
            <p className="mt-2 text-xs text-zinc-400">{message}</p>
            <button
              onClick={() => router.replace("/")}
              className="mt-4 rounded-lg bg-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-600 transition-colors"
            >
              Back to Library
            </button>
          </>
        )}
      </div>
    </div>
  );
}
