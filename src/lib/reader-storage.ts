/**
 * LocalStorage helpers for instant reading-progress persistence.
 *
 * Data structure stored per book:
 *   `reader_progress_{bookId}` → { lastPage, progressPercentage, updatedAt }
 *
 * Wraps every write in try-catch to gracefully handle QuotaExceededError
 * and other storage failures without breaking the reader experience.
 */

export interface LocalProgress {
  lastPage: number;
  progressPercentage: number;
  updatedAt: number; // Date.now() at time of save
}

const PREFIX = "reader_progress_";

function key(bookId: number): string {
  return `${PREFIX}${bookId}`;
}

/**
 * Save progress to LocalStorage (synchronous, instant).
 * Returns `true` if the write succeeded, `false` if storage is full / unavailable.
 */
export function saveProgressLocalStorage(
  bookId: number,
  lastPage: number,
  progressPercentage: number,
): boolean {
  try {
    const data: LocalProgress = {
      lastPage,
      progressPercentage,
      updatedAt: Date.now(),
    };
    localStorage.setItem(key(bookId), JSON.stringify(data));
    return true;
  } catch {
    // QuotaExceededError, SecurityError, or SSR guard — silently fail
    return false;
  }
}

/**
 * Read progress from LocalStorage (synchronous, instant).
 * Returns `null` if no data exists or storage is unavailable.
 */
export function getProgressLocalStorage(
  bookId: number,
): LocalProgress | null {
  try {
    const raw = localStorage.getItem(key(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalProgress;
    if (
      typeof parsed.lastPage === "number" &&
      typeof parsed.progressPercentage === "number" &&
      typeof parsed.updatedAt === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the latest `updatedAt` timestamp for a book from LocalStorage.
 * Used by sync logic to decide whether local data is newer than Drive data.
 */
export function getLocalUpdatedAt(bookId: number): number {
  return getProgressLocalStorage(bookId)?.updatedAt ?? 0;
}
