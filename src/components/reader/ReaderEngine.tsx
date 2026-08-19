"use client";

import dynamic from "next/dynamic";
import type { BookItem, ReadingProgress } from "@/types/book";

const EpubViewer = dynamic(() => import("./EpubViewer"), { ssr: false });
const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });

interface ReaderEngineProps {
  book: BookItem;
  progress?: ReadingProgress;
  onProgress?: (progress: ReadingProgress) => void;
  theme?: "light" | "dark" | "sepia";
  fontSize?: number;
}

export default function ReaderEngine({
  book,
  progress,
  onProgress,
  theme = "light",
  fontSize = 100,
}: ReaderEngineProps) {
  if (book.fileType === "pdf") {
    const initialPage = progress?.cfi.startsWith("page-")
      ? parseInt(progress.cfi.replace("page-", ""), 10)
      : 1;

    return (
      <PdfViewer
        fileBlob={book.fileBlob}
        bookId={book.id!}
        initialPage={initialPage}
        totalPages={book.totalChapters}
        onProgress={onProgress}
        theme={theme}
        fontSize={fontSize}
      />
    );
  }

  return (
    <EpubViewer
      fileBlob={book.fileBlob}
      bookId={book.id!}
      initialCfi={progress?.cfi}
      onProgress={onProgress}
      theme={theme}
      fontSize={fontSize}
    />
  );
}
