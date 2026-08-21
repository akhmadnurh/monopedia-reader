import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";

type PdfiumAny = WrappedPdfiumModule & {
  pdfium: { HEAPU8: Uint8Array & { buffer: ArrayBuffer } };
};

let pdfiumInstance: PdfiumAny | null = null;

export async function getPDFium(): Promise<PdfiumAny> {
  if (pdfiumInstance) return pdfiumInstance;
  const response = await fetch("/pdfium.wasm");
  const wasmBinary = await response.arrayBuffer();
  const mod = (await init({ wasmBinary })) as PdfiumAny;
  mod.PDFiumExt_Init();
  pdfiumInstance = mod;
  return pdfiumInstance;
}

export class PdfiumDocument {
  private pdfium: PdfiumAny;
  private docPtr: number;
  private filePtr: number;
  readonly numPages: number;

  private constructor(
    pdfium: PdfiumAny,
    docPtr: number,
    filePtr: number,
    numPages: number,
  ) {
    this.pdfium = pdfium;
    this.docPtr = docPtr;
    this.filePtr = filePtr;
    this.numPages = numPages;
  }

  static async load(
    pdfium: PdfiumAny,
    data: ArrayBuffer,
  ): Promise<PdfiumDocument> {
    const bytes = new Uint8Array(data);
    const filePtr = pdfium.pdfium.wasmExports.malloc(bytes.length);
    pdfium.pdfium.HEAPU8.set(bytes, filePtr);
    const docPtr = pdfium.FPDF_LoadMemDocument(
      filePtr,
      bytes.length,
      0 as unknown as string,
    );
    if (!docPtr) {
      const error = pdfium.FPDF_GetLastError();
      pdfium.pdfium.wasmExports.free(filePtr);
      throw new Error(`Failed to load PDF: error code ${error}`);
    }
    const numPages = pdfium.FPDF_GetPageCount(docPtr);
    return new PdfiumDocument(pdfium, docPtr, filePtr, numPages);
  }

  getPage(pageNum: number): PdfiumPage {
    if (pageNum < 1 || pageNum > this.numPages) {
      throw new Error(
        `Invalid page ${pageNum}: document has ${this.numPages} pages`,
      );
    }
    const pagePtr = this.pdfium.FPDF_LoadPage(this.docPtr, pageNum - 1);
    if (!pagePtr) {
      throw new Error(`Failed to load page ${pageNum}`);
    }
    return new PdfiumPage(this.pdfium, pagePtr);
  }

  getMetadata(): { title: string; author: string } {
    const bufSize = 512;
    const bufPtr = this.pdfium.pdfium.wasmExports.malloc(bufSize * 2);
    try {
      this.pdfium.FPDF_GetMetaText(
        this.docPtr,
        "Title",
        bufPtr,
        bufSize,
      );
      const title = this.pdfium.pdfium.UTF16ToString(bufPtr);
      this.pdfium.FPDF_GetMetaText(
        this.docPtr,
        "Author",
        bufPtr,
        bufSize,
      );
      const author = this.pdfium.pdfium.UTF16ToString(bufPtr);
      return { title: title || "", author: author || "-" };
    } finally {
      this.pdfium.pdfium.wasmExports.free(bufPtr);
    }
  }

  close(): void {
    if (this.docPtr) {
      this.pdfium.FPDF_CloseDocument(this.docPtr);
      this.docPtr = 0;
    }
    if (this.filePtr) {
      this.pdfium.pdfium.wasmExports.free(this.filePtr);
      this.filePtr = 0;
    }
  }
}

export class PdfiumPage {
  private pdfium: PdfiumAny;
  private pagePtr: number;
  readonly width: number;
  readonly height: number;

  constructor(pdfium: PdfiumAny, pagePtr: number) {
    this.pdfium = pdfium;
    this.pagePtr = pagePtr;
    this.width = pdfium.FPDF_GetPageWidthF(pagePtr);
    this.height = pdfium.FPDF_GetPageHeightF(pagePtr);
  }

  getViewport({ scale }: { scale: number }): { width: number; height: number } {
    return {
      width: this.width * scale,
      height: this.height * scale,
    };
  }

  renderToCanvas(
    canvas: HTMLCanvasElement,
    scale: number,
    dpr: number = window.devicePixelRatio || 1,
  ): void {
    const effectiveScale = scale * dpr;
    const w = Math.floor(this.width * effectiveScale);
    const h = Math.floor(this.height * effectiveScale);

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${Math.floor(this.width * scale)}px`;
    canvas.style.height = `${Math.floor(this.height * scale)}px`;

    const bitmapPtr = this.pdfium.FPDFBitmap_Create(w, h, 0);
    if (!bitmapPtr) throw new Error("Failed to create bitmap");

    try {
      this.pdfium.FPDFBitmap_FillRect(bitmapPtr, 0, 0, w, h, 0xffffffff);
      this.pdfium.FPDF_RenderPageBitmap(
        bitmapPtr,
        this.pagePtr,
        0,
        0,
        w,
        h,
        0,
        0,
      );

      const bufferPtr = this.pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
      if (!bufferPtr) throw new Error("Failed to get bitmap buffer");

      const bufferSize = w * h * 4;
      const raw = new Uint8Array(
        this.pdfium.pdfium.HEAPU8.buffer,
        this.pdfium.pdfium.HEAPU8.byteOffset + bufferPtr,
        bufferSize,
      );

      const buffer = new Uint8ClampedArray(bufferSize);
      const pixelCount = w * h;
      for (let i = 0; i < pixelCount * 4; i += 4) {
        buffer[i] = raw[i + 2];     // R ← raw[2]
        buffer[i + 1] = raw[i + 1]; // G ← raw[1]
        buffer[i + 2] = raw[i];     // B ← raw[0]
        buffer[i + 3] = raw[i + 3]; // A ← raw[3]
      }

      const imageData = new ImageData(buffer, w, h);

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2D context");
      ctx.putImageData(imageData, 0, 0);
    } finally {
      this.pdfium.FPDFBitmap_Destroy(bitmapPtr);
    }
  }

  async getTextContent(): Promise<{
    items: { str: string; x: number; y: number; w: number; h: number }[];
  }> {
    const textPagePtr = this.pdfium.FPDFText_LoadPage(this.pagePtr);
    if (!textPagePtr) {
      return { items: [] };
    }

    try {
      const charCount = this.pdfium.FPDFText_CountChars(textPagePtr);
      if (charCount <= 0) {
        return { items: [] };
      }

      const items: {
        str: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }[] = [];

      const leftBuf = new Float64Array(1);
      const bottomBuf = new Float64Array(1);
      const rightBuf = new Float64Array(1);
      const topBuf = new Float64Array(1);

      let currentWord = "";
      let wordX = 0;
      let wordY = 0;
      let wordW = 0;
      let wordH = 0;
      let wordStarted = false;

      const flushWord = () => {
        if (currentWord.length > 0) {
          items.push({
            str: currentWord,
            x: wordX,
            y: wordY,
            w: wordW,
            h: wordH,
          });
          currentWord = "";
          wordStarted = false;
        }
      };

      for (let i = 0; i < charCount; i++) {
        const unicode = this.pdfium.FPDFText_GetUnicode(textPagePtr, i);
        const ch = String.fromCharCode(unicode);

        if (ch === "\n" || ch === "\r") {
          flushWord();
          continue;
        }

        const gotBox = this.pdfium.FPDFText_GetCharBox(
          textPagePtr,
          i,
          leftBuf as unknown as number,
          bottomBuf as unknown as number,
          rightBuf as unknown as number,
          topBuf as unknown as number,
        );
        if (!gotBox) {
          flushWord();
          continue;
        }

        const left = leftBuf[0];
        const bottom = bottomBuf[0];
        const right = rightBuf[0];
        const top = topBuf[0];

        const x = Math.min(left, right);
        const y = Math.min(top, bottom);
        const cw = Math.abs(right - left);
        const chHeight = Math.abs(top - bottom);

        if (cw <= 0 || chHeight <= 0) {
          flushWord();
          continue;
        }

        if (ch === " " || ch === "\t") {
          flushWord();
          continue;
        }

        if (!wordStarted) {
          wordX = x;
          wordY = y;
          wordW = cw;
          wordH = chHeight;
          currentWord = ch;
          wordStarted = true;
        } else {
          currentWord += ch;
          wordW = x + cw - wordX;
          wordH = Math.max(wordH, chHeight);
        }
      }
      flushWord();

      return { items };
    } finally {
      this.pdfium.FPDFText_ClosePage(textPagePtr);
    }
  }

  close(): void {
    if (this.pagePtr) {
      this.pdfium.FPDF_ClosePage(this.pagePtr);
      this.pagePtr = 0;
    }
  }
}

export function renderTextLayer(
  textContent: {
    items: { str: string; x: number; y: number; w: number; h: number }[];
  },
  container: HTMLDivElement,
  pageWidth: number,
  pageHeight: number,
  scale: number,
): void {
  container.innerHTML = "";

  for (const item of textContent.items) {
    const span = document.createElement("span");
    span.textContent = item.str;

    const displayX = item.x * scale;
    const displayY = (pageHeight - item.y - item.h) * scale;
    const displayW = item.w * scale;
    const displayH = item.h * scale;

    span.style.left = `${displayX}px`;
    span.style.top = `${displayY}px`;
    span.style.fontSize = `${displayH}px`;
    span.style.height = `${displayH}px`;

    if (item.str.length > 1 && displayW > 0) {
      span.style.width = `${displayW}px`;
      span.style.wordSpacing = `${(displayW - displayH * item.str.length * 0.5) / Math.max(1, item.str.length - 1)}px`;
    }

    container.appendChild(span);
  }
}
