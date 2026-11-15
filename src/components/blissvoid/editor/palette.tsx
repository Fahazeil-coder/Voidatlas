"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { PanelLeftClose, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { renderIcon } from "./icon-map";
import { CATEGORY_META, NODE_CATALOG } from "@/lib/blissvoid/node-catalog";
import type {
  NodeCategory,
  NodeDefinition,
  NodeType,
} from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   Left dock — searchable node palette grouped by category.
   Supports HTML5 drag-to-canvas and click-to-add.
--------------------------------------------------------------------------- */

interface PaletteProps {
  isNarrow: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onAddNode: (type: NodeType) => void;
}

export const BLISS_NODE_DRAG_MIME = "application/blissvoid-node";

function PaletteItem({
  def,
  onAddNode,
}: {
  def: NodeDefinition;
  onAddNode: (type: NodeType) => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BLISS_NODE_DRAG_MIME, def.type);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onAddNode(def.type)}
      title={def.description}
      aria-label={`Add ${def.label} node`}
      className="group flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[#7C5CFF]/25 hover:bg-[#7C5CFF]/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40 active:cursor-grabbing"
    >
      <span
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md"
        style={{ background: `${def.accent}2E`, color: def.accent }}
      >
        {renderIcon(def.icon, { size: 12, strokeWidth: 1.8, "aria-hidden": true })}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-[#F2F4FF]">{def.label}</span>
      <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center text-[#7C5CFF] opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-[14px] leading-none">+</span>
      </span>
    </button>
  );
}

export function Palette({ isNarrow, collapsed, onToggleCollapse, onAddNode }: PaletteProps) {
  const [query, setQuery] = React.useState("");
  const [narrowOpen, setNarrowOpen] = React.useState(false);

  const railMode = isNarrow ? !narrowOpen : collapsed;
  const q = query.trim().toLowerCase();

  const groups = React.useMemo(() => {
    return (Object.keys(CATEGORY_META) as NodeCategory[])
      .map((cat) => ({
        cat,
        meta: CATEGORY_META[cat],
        defs: NODE_CATALOG.filter(
          (d) =>
            d.category === cat &&
            (q === "" ||
              d.label.toLowerCase().includes(q) ||
              d.description.toLowerCase().includes(q) ||
              d.type.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.defs.length > 0);
  }, [q]);

  const expand = () => {
    if (isNarrow) setNarrowOpen(true);
    else if (collapsed) onToggleCollapse();
  };

  /* ------------------------------- icon rail ------------------------------ */
  if (railMode) {
    return (
      <aside
        aria-label="Node palette"
        className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-[#F2F4FF]/[0.06] bg-[#0A0C1A]/70 py-2 backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={expand}
          aria-label="Expand node palette"
          title="Expand node palette"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition-colors hover:bg-[#7C5CFF]/12 hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
        >
          <Search size={15} strokeWidth={1.8} />
        </button>
        {(Object.keys(CATEGORY_META) as NodeCategory[]).map((cat) => {
          const meta = CATEGORY_META[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={expand}
              aria-label={`${meta.label} nodes`}
              title={meta.label}
              className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-[#7C5CFF]/12 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
              style={{ color: meta.accent }}
            >
              {renderIcon(meta.icon, { size: 15, strokeWidth: 1.8, "aria-hidden": true })}
            </button>
          );
        })}
        {!isNarrow && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand palette"
            title="Expand palette"
            className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg text-[#6B7199] transition-colors hover:bg-[#7C5CFF]/12 hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
          >
            <PanelLeftClose size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </aside>
    );
  }

  /* ------------------------------ full palette ----------------------------- */
  return (
    <>
      {isNarrow && (
        <button
          type="button"
          aria-label="Close palette"
          className="absolute inset-0 z-20 bg-[#05060F]/60 backdrop-blur-[2px]"
          onClick={() => setNarrowOpen(false)}
        />
      )}
      <motion.aside
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        aria-label="Node palette"
        className={cn(
          "flex w-64 shrink-0 flex-col border-r border-[#F2F4FF]/[0.06] bg-[#0A0C1A]/80 backdrop-blur-xl",
          isNarrow && "absolute inset-y-0 left-0 z-30 h-full shadow-2xl shadow-[#05060F]"
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#F2F4FF]/[0.06] px-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7199]">
            Node Library
          </span>
          <button
            type="button"
            onClick={isNarrow ? () => setNarrowOpen(false) : onToggleCollapse}
            aria-label="Collapse palette"
            title="Collapse palette"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#6B7199] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
          >
            {isNarrow ? <X size={14} aria-hidden="true" /> : <PanelLeftClose size={14} aria-hidden="true" />}
          </button>
        </div>

        <div className="shrink-0 px-3 py-2.5">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7199]"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes…"
              aria-label="Search nodes"
              className="h-8 w-full rounded-md border border-[#F2F4FF]/10 bg-[#11142A]/70 pl-8 pr-2 text-xs text-[#F2F4FF] caret-[#7C5CFF] placeholder:text-[#6B7199] outline-none transition-[border-color,box-shadow] focus:border-[#7C5CFF]/60 focus:ring-[3px] focus:ring-[#7C5CFF]/25"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-[11px] text-[#6B7199]">
              No nodes match “{query}”.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.cat} className="mb-3">
              <div className="flex items-center gap-2 px-2 py-1.5">
                {renderIcon(group.meta.icon, {
                  size: 11,
                  style: { color: group.meta.accent },
                  "aria-hidden": true,
                })}
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6B7199]">
                  {group.meta.label}
                </span>
                <span className="ml-auto font-[family-name:var(--font-jetbrains)] text-[9px] text-[#6B7199]">
                  {group.defs.length}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {group.defs.map((def) => (
                  <PaletteItem key={def.type} def={def} onAddNode={onAddNode} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.aside>
    </>
  );
}
