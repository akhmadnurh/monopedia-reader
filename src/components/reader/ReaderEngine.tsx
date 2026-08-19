"use client";

import dynamic from "next/dynamic";
import type { BookItem, ReadingProgress } from "@/types/book";
import type { ReaderSettings } from "@/lib/reader-settings";

const EpubViewer = dynamic(() => import("./EpubViewer"), { ssr: false });
const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });

interface ReaderEngineProps {
  book: BookItem;
  progress?: ReadingProgress;
  onProgress?: (progress: ReadingProgress) => void;
  settings: ReaderSettings;
}

export default function ReaderEngine({
  book,
  progress,
  onProgress,
  settings,
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
        settings={settings}
      />
    );
  }

  return (
    <EpubViewer
      fileBlob={book.fileBlob}
      bookId={book.id!}
      initialCfi={progress?.cfi}
      onProgress={onProgress}
      settings={settings}
    />
  );
}
