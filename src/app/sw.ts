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

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// Web Share Target: intercept POST to /import and store file in IndexedDB
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

        // Store in IndexedDB via a lightweight helper
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("MonopediaReaderDB");
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("pendingImport", "readwrite");
            const store = tx.objectStore("pendingImport");
            store.put({
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
            req.result.createObjectStore("pendingImport", { keyPath: "createdAt" });
          };
        });

        // Redirect client to /import page to process the stored file
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          if (client.url.includes("/import")) {
            client.navigate("/import");
            client.focus();
            return new Response(null, { status: 303, headers: { Location: "/import" } });
          }
        }

        // No client on /import yet — open it
        if (clients.length > 0) {
          clients[0].navigate("/import");
          return new Response(null, { status: 303, headers: { Location: "/import" } });
        }

        return new Response("Import queued", { status: 200 });
      } catch (err) {
        console.error("[SW] Share target error:", err);
        return new Response("Import failed", { status: 500 });
      }
    })()
  );
});
