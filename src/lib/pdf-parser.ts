import { getPDFium, PdfiumDocument } from "./pdfium-engine";

export interface ParsedPdf {
  title: string;
  author: string;
  totalPages: number;
  cover: Blob | null;
}

export async function parsePdf(file: Blob, fileName?: string): Promise<ParsedPdf> {
  const data = await file.arrayBuffer();
  const pdfium = await getPDFium();
  const doc = await PdfiumDocument.load(pdfium, data);

  const meta = doc.getMetadata();
  const fallbackTitle = fileName
    ? fileName.replace(/\.[^/.]+$/, "")
    : "Untitled PDF";
  const title = meta.title || fallbackTitle;
  const author = meta.author || "-";

  const totalPages = doc.numPages;

  let cover: Blob | null = null;
  try {
    const page = doc.getPage(1);
    const canvas = document.createElement("canvas");
    page.renderToCanvas(canvas, 0.5);
    page.close();

    cover = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.7),
    );
  } catch {
    cover = null;
  }

  doc.close();
  return { title, author, totalPages, cover };
}
