"use client";

import { useEffect, useRef, useState } from "react";

const COLORS = [
  { name: "Yellow", value: "#FDE68A" },
  { name: "Green",  value: "#A7F3D0" },
  { name: "Blue",   value: "#93C5FD" },
];

interface SelectionInfo {
  text: string;
  cfiRange: string;
  rect: DOMRect;
}

interface FloatingToolbarProps {
  onHighlight: (text: string, cfiRange: string, color: string) => void;
  onAddNote: (text: string, cfiRange: string) => void;
}

export default function FloatingToolbar({ onHighlight, onAddNote }: FloatingToolbarProps) {
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [showColors, setShowColors] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleSelect() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setSelection(null);
        return;
      }

      const text = sel.toString().trim();
      if (!text) {
        setSelection(null);
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setSelection({
        text,
        cfiRange: "",
        rect,
      });
      setShowColors(false);
    }

    function handleMouseDown(e: MouseEvent) {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      setShowColors(false);
    }

    document.addEventListener("mouseup", handleSelect);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mouseup", handleSelect);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  if (!selection) return null;

  const top = selection.rect.top + window.scrollY - 50;
  const left = selection.rect.left + selection.rect.width / 2;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 p-1 shadow-xl"
      style={{ top: Math.max(8, top), left: `${Math.min(Math.max(left, 80), window.innerWidth - 80)}px`, transform: "translateX(-50%)" }}
    >
      {showColors ? (
        <div className="flex items-center gap-1 px-1">
          {COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => {
                onHighlight(selection.text, selection.cfiRange, c.value);
                setSelection(null);
              }}
              className="h-6 w-6 rounded-full border border-zinc-600 transition-transform hover:scale-110"
              style={{ background: c.value }}
              aria-label={c.name}
            />
          ))}
          <div className="mx-1 h-4 w-px bg-zinc-600" />
          <button
            onClick={() => {
              onAddNote(selection.text, selection.cfiRange);
              setSelection(null);
            }}
            className="rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Note
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowColors(true)}
            className="rounded px-2.5 py-1.5 text-xs font-medium text-yellow-300 hover:bg-zinc-700"
          >
            Highlight
          </button>
          <button
            onClick={() => {
              onAddNote(selection.text, selection.cfiRange);
              setSelection(null);
            }}
            className="rounded px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Note
          </button>
        </div>
      )}
    </div>
  );
}
