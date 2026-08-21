"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { saveBook } from "@/lib/db";
import { isTokenValid } from "@/lib/google-auth";
import { parseEpub, epubFileToBlob } from "@/lib/epub-parser";
import type { BookItem } from "@/types/book";

interface PendingImport {
  fileName: string;
  fileType: "pdf" | "epub";
  mimeType: string;
  arrayBuffer: ArrayBuffer;
  createdAt: number;
}

function openPendingDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("MonopediaReaderDB");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("pendingImport", { keyPath: "createdAt" });
    };
  });
}

async function getPendingImports(): Promise<PendingImport[]> {
  const db = await openPendingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendingImport", "readonly");
    const store = tx.objectStore("pendingImport");
    const req = store.getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function clearPendingImport(createdAt: number): Promise<void> {
  const db = await openPendingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendingImport", "readwrite");
    const store = tx.objectStore("pendingImport");
    store.delete(createdAt);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export default function ImportPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Importing eBook...");
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function processImports() {
      try {
        const pending = await getPendingImports();
        if (pending.length === 0) {
          if (!cancelled) {
            setStatus("error");
            setMessage("No pending import found. Share a file from another app to import it.");
          }
          return;
        }

        let imported = 0;

        for (const item of pending) {
          if (cancelled) return;

          try {
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
              imported++;
            } else if (ext === "pdf") {
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
              imported++;
            } else {
              console.warn(`[Import] Skipping unsupported file: ${item.fileName}`);
            }

            await clearPendingImport(item.createdAt);
          } catch (err) {
            console.error(`[Import] Failed to import ${item.fileName}:`, err);
            await clearPendingImport(item.createdAt);
          }
        }

        if (!cancelled) {
          if (imported > 0) {
            setCount(imported);
            setStatus("success");
            setMessage(`${imported} book${imported > 1 ? "s" : ""} imported successfully!`);
            setTimeout(() => router.push("/"), 1500);
          } else {
            setStatus("error");
            setMessage("Failed to import the file. It may be corrupted or unsupported.");
          }
        }
      } catch (err) {
        console.error("[Import] Error:", err);
        if (!cancelled) {
          setStatus("error");
          setMessage("An error occurred while processing the import.");
        }
      }
    }

    processImports();
    return () => { cancelled = true; };
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
            <h1 className="text-sm font-semibold text-zinc-100">Import Failed</h1>
            <p className="mt-2 text-xs text-zinc-400">{message}</p>
            <button
              onClick={() => router.push("/")}
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
