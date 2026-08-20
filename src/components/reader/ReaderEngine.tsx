"use client";

import dynamic from "next/dynamic";
import type { BookItem, ReadingProgress } from "@/types/book";
import type { ReaderSettings } from "@/lib/reader-settings";

const EpubViewer = dynamic(() => import("./EpubViewer"), { ssr: false });
const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });
const NativePdfViewer = dynamic(() => import("./NativePdfViewer"), { ssr: false });

interface ReaderEngineProps {
  book: BookItem;
  progress?: ReadingProgress;
  onProgress?: (progress: ReadingProgress) => void;
  onRenderFail?: () => void;
  settings: ReaderSettings;
}

export default function ReaderEngine({
  book,
  progress,
  onProgress,
  onRenderFail,
  settings,
}: ReaderEngineProps) {
  if (book.fileType === "pdf") {
    const initialPage = progress?.cfi.startsWith("page-")
      ? parseInt(progress.cfi.replace("page-", ""), 10)
      : 1;

    if (settings.useNativeViewer) {
      return (
        <NativePdfViewer
          fileBlob={book.fileBlob}
          bookId={book.id!}
          driveFileId={book.driveFileId}
          initialPage={initialPage}
          totalPages={book.totalChapters}
          onProgress={onProgress}
          settings={settings}
        />
      );
    }

    return (
      <PdfViewer
        fileBlob={book.fileBlob}
        bookId={book.id!}
        driveFileId={book.driveFileId}
        initialPage={initialPage}
        totalPages={book.totalChapters}
        onProgress={onProgress}
        onRenderFail={onRenderFail}
        settings={settings}
      />
    );
  }

  return (
    <EpubViewer
      fileBlob={book.fileBlob}
      bookId={book.id!}
      driveFileId={book.driveFileId}
      initialCfi={progress?.cfi}
      onProgress={onProgress}
      settings={settings}
    />
  );
}
