"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   Lightweight code editor — JetBrains Mono textarea with a line-number
   gutter and tab-to-indent. No external dependencies.
--------------------------------------------------------------------------- */

export function CodeEditor({
  value,
  onChange,
  rows = 8,
  ariaLabel = "Code editor",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const lineCount = React.useMemo(() => value.split("\n").length, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(next);
      // Restore caret after React re-renders the new value.
      requestAnimationFrame(() => {
        ta.selectionStart = start + 2;
        ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-lg border border-[#F2F4FF]/10 bg-[#0A0C1A]/80 focus-within:border-[#7C5CFF]/60 focus-within:ring-[3px] focus-within:ring-[#7C5CFF]/25 transition-[border-color,box-shadow]",
        className
      )}
    >
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="w-9 shrink-0 select-none overflow-hidden border-r border-[#F2F4FF]/[0.06] bg-[#05060F]/60 py-2 text-right font-[family-name:var(--font-jetbrains)] text-[11px] leading-5 text-[#6B7199]"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="pr-2">
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        rows={rows}
        spellCheck={false}
        wrap="off"
        aria-label={ariaLabel}
        className="h-auto w-full resize-none overflow-auto bg-transparent px-3 py-2 font-[family-name:var(--font-jetbrains)] text-[11px] leading-5 text-[#F2F4FF] caret-[#7C5CFF] outline-none placeholder:text-[#6B7199]"
        placeholder="// your code…"
      />
    </div>
  );
}
