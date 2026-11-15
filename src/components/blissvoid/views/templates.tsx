"use client";

import { createElement, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import { ArrowRight, Flame, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { iconFor } from "@/components/blissvoid/editor/icon-map";
import { EmptyState, SectionTitle } from "@/components/blissvoid/shared";
import { listTemplates, useTemplate as summonTemplate } from "@/lib/blissvoid/api-client";
import type { TemplateDTO } from "@/lib/blissvoid/types";
import { NODE_MAP } from "@/lib/blissvoid/node-catalog";
import { useApp } from "@/lib/blissvoid/store";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   TemplatesView — the summoning gallery.
--------------------------------------------------------------------------- */

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
};

function catalogIcon(name: string, className: string, color: string) {
  return createElement(iconFor(name), {
    className,
    style: { color },
    strokeWidth: 1.5,
    "aria-hidden": true,
  });
}

function NodePreview({ template }: { template: TemplateDTO }) {
  const nodes = template.nodes.slice(0, 4);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {nodes.map((n, i) => {
        const def = NODE_MAP[n.type];
        return (
          <span key={n.id} className="flex items-center gap-1.5">
            {i > 0 && <ArrowRight className="h-3 w-3 text-[#6B7199]" strokeWidth={1.5} aria-hidden="true" />}
            <span className="inline-flex max-w-32 items-center gap-1 truncate rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2 py-0.5 text-[11px] text-[#A8AECF]">
              {catalogIcon(def?.icon ?? "CircleDashed", "h-3 w-3 shrink-0", def?.accent ?? "#A8AECF")}
              <span className="truncate">{n.name}</span>
            </span>
          </span>
        );
      })}
      {template.nodes.length > 4 && (
        <span className="text-[11px] text-[#6B7199]">+{template.nodes.length - 4} more</span>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  featured,
  onUse,
  pending,
}: {
  template: TemplateDTO;
  featured: boolean;
  onUse: () => void;
  pending: boolean;
}) {
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -2 }}
      className={cn(
        "glass glow-hover flex flex-col rounded-2xl",
        featured ? "bliss-ring p-6" : "p-5"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#F2F4FF]/10 bg-[#11142A]">
          <div className="absolute inset-0 opacity-[0.18]" style={{ background: template.gradient }} aria-hidden="true" />
          {catalogIcon(template.icon, "relative h-6 w-6", "#F2F4FF")}
        </div>
        {featured && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFC857]/30 bg-[#FFC857]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FFC857]">
            <Flame className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            Featured
          </span>
        )}
      </div>

      <h3 className="mt-4 font-[family-name:var(--font-space)] text-base font-semibold text-[#F2F4FF]">
        {template.name}
      </h3>
      <p className={cn("mt-1.5 flex-1 text-sm leading-relaxed text-[#A8AECF]", featured ? "line-clamp-3" : "line-clamp-2")}>
        {template.description}
      </p>

      <div className="mt-4">
        <NodePreview template={template} />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#F2F4FF]/[0.06] pt-4">
        <span className="text-[11px] text-[#6B7199]">
          {template.nodes.length} nodes · used {template.uses.toLocaleString()} times
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={onUse}
          className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2 text-sm font-semibold text-[#05060F] shadow-[0_0_24px_rgba(124,92,255,0.35)] transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          Use template
        </button>
      </div>
    </motion.div>
  );
}

export function TemplatesView() {
  const qc = useQueryClient();
  const openWorkflow = useApp((s) => s.openWorkflow);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const templatesQ = useQuery({ queryKey: ["templates"], queryFn: listTemplates });

  const categories = useMemo(() => {
    const set = new Set<string>();
    (templatesQ.data?.templates ?? []).forEach((t) => set.add(t.category));
    return Array.from(set).sort();
  }, [templatesQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (templatesQ.data?.templates ?? []).filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templatesQ.data, category, search]);

  const useMut = useMutation({
    mutationFn: (id: string) => summonTemplate(id),
    onSuccess: (res, id) => {
      const t = templatesQ.data?.templates.find((x) => x.id === id);
      toast.success(`Template summoned — ${t?.name ?? res.workflow.name}`);
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      openWorkflow(res.workflow.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const featured = filtered.filter((t) => t.featured);
  const rest = filtered.filter((t) => !t.featured);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <SectionTitle
        eyebrow="Gallery"
        title="Template gallery"
        description="Battle-tested flows from the future. One click and they're yours."
      />

      {/* ------------------------------ Controls ------------------------------ */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7199]"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            aria-label="Search templates"
            className="rounded-full border-[#F2F4FF]/10 bg-[#11142A]/60 pl-10 text-sm text-[#F2F4FF] placeholder:text-[#6B7199]"
          />
        </div>
        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {["all", ...categories].map((c) => {
              const active = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium capitalize transition",
                    active
                      ? "border-[#7C5CFF]/60 bg-[#7C5CFF]/15 text-[#F2F4FF] shadow-[0_0_16px_rgba(124,92,255,0.25)]"
                      : "border-[#F2F4FF]/10 bg-[#11142A] text-[#A8AECF] hover:border-[#7C5CFF]/40 hover:text-[#F2F4FF]"
                  )}
                >
                  {c === "all" ? "All" : c}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* -------------------------------- Body -------------------------------- */}
      {templatesQ.isLoading ? (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="glass h-64 animate-pulse rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass h-56 animate-pulse rounded-2xl" />
            ))}
          </div>
        </>
      ) : templatesQ.isError ? (
        <EmptyState
          icon={<Sparkles className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="Could not open the gallery"
          description={(templatesQ.error as Error).message}
        />
      ) : (templatesQ.data?.templates ?? []).length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="No templates yet"
          description="The gallery is still materializing. Check back soon."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="No matches"
          description="Nothing matches that search in this category."
        />
      ) : (
        <>
          {featured.length > 0 && (
            <section aria-label="Featured templates" className="space-y-3">
              <h2 className="font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.18em] text-[#A8AECF]">
                Featured
              </h2>
              <motion.div
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.07 } } }}
                className="grid grid-cols-1 gap-5 md:grid-cols-2"
              >
                {featured.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    featured
                    pending={useMut.isPending && useMut.variables === t.id}
                    onUse={() => useMut.mutate(t.id)}
                  />
                ))}
              </motion.div>
            </section>
          )}
          {rest.length > 0 && (
            <section aria-label="All templates" className="space-y-3">
              {featured.length > 0 && (
                <h2 className="font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.18em] text-[#A8AECF]">
                  All templates
                </h2>
              )}
              <motion.div
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.04 } } }}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {rest.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    featured={false}
                    pending={useMut.isPending && useMut.variables === t.id}
                    onUse={() => useMut.mutate(t.id)}
                  />
                ))}
              </motion.div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
