export type ThemeName = "light" | "dark" | "sepia" | "oled";

export interface ThemeConfig {
  name: ThemeName;
  label: string;
  bg: string;
  fg: string;
  ui: string;
}

export const THEMES: Record<ThemeName, ThemeConfig> = {
  light: { name: "light", label: "Light", bg: "#ffffff", fg: "#171717", ui: "bg-white" },
  dark:  { name: "dark",  label: "Dark",  bg: "#1F2937", fg: "#E5E7EB", ui: "bg-[#1F2937]" },
  sepia: { name: "sepia", label: "Sepia", bg: "#FBF0D9", fg: "#5B4636", ui: "bg-[#FBF0D9]" },
  oled:  { name: "oled",  label: "OLED",  bg: "#000000", fg: "#ededed", ui: "bg-black" },
};

export type FontFamily = "sans" | "serif" | "mono";

export const FONT_FAMILIES: Record<FontFamily, { label: string; css: string }> = {
  sans:  { label: "Sans-serif", css: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  serif: { label: "Serif",       css: "Georgia, 'Times New Roman', serif" },
  mono:  { label: "Monospace",   css: "'SF Mono', 'Fira Code', monospace" },
};

export type ViewMode = "single" | "continuous";

export interface ReaderSettings {
  theme: ThemeName;
  fontFamily: FontFamily;
  fontSize: number;
  lineHeight: number;
  margin: number;
  viewMode: ViewMode;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "dark",
  fontFamily: "sans",
  fontSize: 100,
  lineHeight: 1.6,
  margin: 5,
  viewMode: "single",
};

const STORAGE_KEY = "monopedia-reader-settings";

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    return { ...DEFAULT_READER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
