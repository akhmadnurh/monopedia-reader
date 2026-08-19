import ePub from "epubjs";

export interface ParsedEpub {
  title: string;
  author: string;
  cover: Blob | null;
  chapters: ChapterInfo[];
}

export interface ChapterInfo {
  label: string;
  href: string;
}

export async function parseEpub(file: Blob): Promise<ParsedEpub> {
  const book = ePub(await file.arrayBuffer());

  await book.ready;

  const [metadata, navigation] = await Promise.all([
    book.loaded.metadata,
    book.loaded.navigation,
  ]);

  const title = metadata.title || "Untitled";
  const author = metadata.creator || "Unknown";

  let cover: Blob | null = null;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const res = await fetch(coverUrl);
      cover = await res.blob();
    }
  } catch {
    cover = null;
  }

  const chapters: ChapterInfo[] = [];
  function walkNav(items: typeof navigation.toc) {
    for (const item of items) {
      chapters.push({ label: item.label.trim(), href: item.href });
      if (item.subitems?.length) walkNav(item.subitems);
    }
  }
  walkNav(navigation.toc);

  book.destroy();

  return { title, author, cover, chapters };
}

export function epubFileToBlob(file: File): Blob {
  return new Blob([file], { type: "application/epub+zip" });
}
