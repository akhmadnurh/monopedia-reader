export interface ParsedPdf {
  title: string;
  author: string;
  totalPages: number;
  cover: Blob | null;
}

export async function parsePdf(file: Blob, fileName?: string): Promise<ParsedPdf> {
  const pdfjsLib = await import("pdfjs-dist");

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const metadata = await pdf.getMetadata().catch(() => null);
  const info = metadata?.info as Record<string, string> | null;

  // Fallback: use filename without extension if metadata title is missing
  const fallbackTitle = fileName
    ? fileName.replace(/\.[^/.]+$/, "")
    : "Untitled PDF";
  const title = info?.Title || info?.Subject || fallbackTitle;
  const author = info?.Author || "-";

  const totalPages = pdf.numPages;

  let cover: Blob | null = null;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.7),
    );
    cover = blob;
  } catch {
    cover = null;
  }

  return { title, author, totalPages, cover };
}
