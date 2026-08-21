/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// ── Web Share Target: intercept POST to /import BEFORE Serwist ──
// Must be registered before serwist.addEventListeners() so our respondWith() wins.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname !== "/import" || event.request.method !== "POST") return;

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get("ebook") as File | null;

        if (!file || !(file instanceof File)) {
          return new Response("No file provided", { status: 400 });
        }

        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext !== "pdf" && ext !== "epub") {
          return new Response("Unsupported file type. Only .pdf and .epub are accepted.", { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();

        // Store in a SEPARATE IndexedDB to avoid version conflicts with the main app DB
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("MonopediaPendingImport", 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("files")) {
              db.close();
              // Upgrade needed — reopen with version bump
              const req2 = indexedDB.open("MonopediaPendingImport", 2);
              req2.onerror = () => reject(req2.error);
              req2.onsuccess = () => {
                const db2 = req2.result;
                const tx = db2.transaction("files", "readwrite");
                tx.objectStore("files").put({
                  fileName: file.name,
                  fileType: ext === "epub" ? "epub" : "pdf",
                  mimeType: file.type,
                  arrayBuffer,
                  createdAt: Date.now(),
                });
                tx.oncomplete = () => { db2.close(); resolve(); };
                tx.onerror = () => { db2.close(); reject(tx.error); };
              };
              req2.onupgradeneeded = () => {
                req2.result.createObjectStore("files", { keyPath: "createdAt" });
              };
              return;
            }
            const tx = db.transaction("files", "readwrite");
            tx.objectStore("files").put({
              fileName: file.name,
              fileType: ext === "epub" ? "epub" : "pdf",
              mimeType: file.type,
              arrayBuffer,
              createdAt: Date.now(),
            });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          };
          req.onupgradeneeded = () => {
            req.result.createObjectStore("files", { keyPath: "createdAt" });
          };
        });

        // Redirect client to /import page — return a real HTML page so the browser navigates
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.location.replace("/import")</script></head><body></body></html>`;

        // Also try to navigate existing clients directly
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          if (client.url.includes("/import")) {
            client.navigate("/import");
            client.focus();
          }
        }

        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (err) {
        console.error("[SW] Share target error:", err);
        // Even on error, redirect to /import so the page can show an error message
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.location.replace("/import")</script></head><body></body></html>`;
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    })()
  );
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
