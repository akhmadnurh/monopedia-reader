import type { BookItem } from "@/types/book";

function getFilename(book: BookItem): string {
  const safe = book.title.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return `${safe}.${book.fileType}`;
}

export async function shareBookFile(book: BookItem): Promise<void> {
  const file = new File([book.fileBlob], getFilename(book), {
    type: book.fileType === "pdf" ? "application/pdf" : "application/epub+zip",
  });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: book.title,
        text: `Sharing ${book.title}`,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        fallbackDownload(file);
      }
    }
  } else {
    fallbackDownload(file);
  }
}

function fallbackDownload(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
