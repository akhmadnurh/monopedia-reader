export type FileType = "epub" | "pdf";
export type SyncStatus = "synced" | "pending" | "local";

export interface BookItem {
  id?: number;
  title: string;
  author: string;
  fileType: FileType;
  cover?: Blob;
  coverUrl?: string;
  totalChapters: number;
  addedAt: number;
  fileSize: number;
  fileBlob: Blob;
  driveFileId?: string;
  syncStatus?: SyncStatus;
}

export interface ReadingProgress {
  bookId: number;
  cfi: string;
  percentage: number;
  chapterTitle: string;
  lastReadAt: number;
}

export interface Highlight {
  id?: number;
  bookId: number;
  cfiRange: string;
  text: string;
  color: string;
  note?: string;
  createdAt: number;
}
