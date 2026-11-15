"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  Copy,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, SectionTitle, StatusBadge, timeAgo } from "@/components/blissvoid/shared";
import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  listWorkflows,
  runWorkflow,
  updateWorkflow,
} from "@/lib/blissvoid/api-client";
import type { WorkflowDTO } from "@/lib/blissvoid/types";
import { useApp } from "@/lib/blissvoid/store";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   WorkflowsView — the fleet overview.
--------------------------------------------------------------------------- */

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
};

function TagChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2 py-0.5 text-[11px] text-[#A8AECF]">
      {label}
    </span>
  );
}

export function WorkflowsView() {
  const qc = useQueryClient();
  const openWorkflow = useApp((s) => s.openWorkflow);
  const openExecution = useApp((s) => s.openExecution);
  const setAppView = useApp((s) => s.setAppView);
  const setAiBuilderOpen = useApp((s) => s.setAiBuilderOpen);

  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("all");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDTO | null>(null);

  const workflowsQ = useQuery({ queryKey: ["workflows"], queryFn: listWorkflows });

  const folders = useMemo(() => {
    const set = new Set<string>();
    (workflowsQ.data?.workflows ?? []).forEach((w) => {
      if (w.folder) set.add(w.folder);
    });
    return Array.from(set).sort();
  }, [workflowsQ.data]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    (workflowsQ.data?.workflows ?? []).forEach((w) => w.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [workflowsQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (workflowsQ.data?.workflows ?? []).filter((w) => {
      if (q && !w.name.toLowerCase().includes(q) && !(w.description ?? "").toLowerCase().includes(q)) return false;
      if (folder !== "all" && w.folder !== folder) return false;
      if (activeTags.length > 0 && !w.tags.some((t) => activeTags.includes(t))) return false;
      return true;
    });
  }, [workflowsQ.data, search, folder, activeTags]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workflows"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const createMut = useMutation({
    mutationFn: () => createWorkflow({ name: "Untitled flow" }),
    onSuccess: (res) => {
      toast.success("Workflow created");
      invalidate();
      openWorkflow(res.workflow.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMut = useMutation({
    mutationFn: (id: string) => runWorkflow(id),
    onSuccess: (res) => {
      toast.success("Execution started");
      qc.invalidateQueries({ queryKey: ["executions"] });
      setAppView("executions");
      openExecution(res.execution.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateWorkflow(id, { active }),
    onSuccess: (_res, vars) => {
      toast.success(vars.active ? "Workflow activated" : "Workflow deactivated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dupMut = useMutation({
    mutationFn: (id: string) => duplicateWorkflow(id),
    onSuccess: (res) => {
      toast.success(`Duplicated — ${res.workflow.name}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteWorkflow(id),
    onSuccess: () => {
      toast.success("Workflow deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busyId = (id: string) =>
    (runMut.isPending && runMut.variables === id) ||
    (dupMut.isPending && dupMut.variables === id) ||
    (delMut.isPending && delMut.variables === id);

  const cardActions = (w: WorkflowDTO, align: "overlay" | "inline") => (
    <div
      className={cn(
        "flex items-center gap-1",
        align === "overlay" &&
          "absolute right-3 top-3 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      )}
    >
      <button
        type="button"
        aria-label={`Run ${w.name}`}
        title="Run now"
        disabled={busyId(w.id)}
        onClick={(e) => {
          e.stopPropagation();
          runMut.mutate(w.id);
        }}
        className="glass-strong glow-hover rounded-lg p-1.5 text-[#2CF5A0] transition hover:scale-110 disabled:opacity-50"
      >
        {runMut.isPending && runMut.variables === w.id ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        aria-label={`Duplicate ${w.name}`}
        title="Duplicate"
        disabled={busyId(w.id)}
        onClick={(e) => {
          e.stopPropagation();
          dupMut.mutate(w.id);
        }}
        className="glass-strong glow-hover rounded-lg p-1.5 text-[#3DA9FF] transition hover:scale-110 disabled:opacity-50"
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Delete ${w.name}`}
        title="Delete"
        disabled={busyId(w.id)}
        onClick={(e) => {
          e.stopPropagation();
          setDeleteTarget(w);
        }}
        className="glass-strong glow-hover rounded-lg p-1.5 text-[#FF5C7A] transition hover:scale-110 disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );

  const newWorkflowButton = (
    <button
      type="button"
      disabled={createMut.isPending}
      onClick={() => createMut.mutate()}
      className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] shadow-[0_0_24px_rgba(124,92,255,0.35)] transition hover:brightness-110 disabled:opacity-60"
    >
      {createMut.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      )}
      New workflow
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <SectionTitle
        eyebrow="Fleet"
        title="Workflows"
        description="Every automation in your void — active, dormant or still being dreamt up."
        action={newWorkflowButton}
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
            placeholder="Search workflows…"
            aria-label="Search workflows"
            className="rounded-full border-[#F2F4FF]/10 bg-[#11142A]/60 pl-10 text-sm text-[#F2F4FF] placeholder:text-[#6B7199]"
          />
        </div>
        {folders.length > 0 && (
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger
              aria-label="Filter by folder"
              className="w-full rounded-full border-[#F2F4FF]/10 bg-[#11142A]/60 text-sm text-[#F2F4FF] sm:w-48"
            >
              <SelectValue placeholder="Folder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All folders</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1 rounded-full border border-[#F2F4FF]/10 bg-[#11142A]/60 p-1">
          <button
            type="button"
            aria-label="Grid view"
            title="Grid view"
            onClick={() => setView("grid")}
            className={cn(
              "rounded-full p-2 transition",
              view === "grid" ? "bg-bliss text-[#05060F]" : "text-[#A8AECF] hover:text-[#F2F4FF]"
            )}
          >
            <LayoutGrid className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="List view"
            title="List view"
            onClick={() => setView("list")}
            className={cn(
              "rounded-full p-2 transition",
              view === "list" ? "bg-bliss text-[#05060F]" : "text-[#A8AECF] hover:text-[#F2F4FF]"
            )}
          >
            <List className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((t) => {
            const active = activeTags.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setActiveTags((prev) => (active ? prev.filter((x) => x !== t) : [...prev, t]))
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition",
                  active
                    ? "border-[#7C5CFF]/60 bg-[#7C5CFF]/15 text-[#F2F4FF] shadow-[0_0_16px_rgba(124,92,255,0.25)]"
                    : "border-[#F2F4FF]/10 bg-[#11142A] text-[#A8AECF] hover:border-[#7C5CFF]/40 hover:text-[#F2F4FF]"
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}

      {/* ------------------------------- Content ------------------------------ */}
      {workflowsQ.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass h-44 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : workflowsQ.isError ? (
        <EmptyState
          icon={<WorkflowIcon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="Could not load workflows"
          description={(workflowsQ.error as Error).message}
        />
      ) : (workflowsQ.data?.workflows ?? []).length === 0 ? (
        <EmptyState
          icon={<WorkflowIcon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="The void is empty"
          description="Create your first workflow from scratch — or describe it and let the AI draft the graph."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => createMut.mutate()}
                className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] transition hover:brightness-110"
              >
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> New workflow
              </button>
              <button
                type="button"
                onClick={() => setAiBuilderOpen(true)}
                className="glass glow-hover inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-[#F2F4FF]"
              >
                <Sparkles className="h-4 w-4 text-[#FF6BD6]" strokeWidth={1.5} aria-hidden="true" /> Describe with AI
              </button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="No matches"
          description="Nothing in the void matches those filters. Try clearing the search."
        />
      ) : view === "grid" ? (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.04 } } }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((w) => (
            <motion.div
              key={w.id}
              variants={item}
              whileHover={{ y: -2 }}
              onClick={() => openWorkflow(w.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") openWorkflow(w.id);
              }}
              className="glass glow-hover group relative cursor-pointer rounded-2xl p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF]"
            >
              {cardActions(w, "overlay")}
              <h3 className="line-clamp-1 pr-20 font-[family-name:var(--font-space)] text-base font-semibold text-[#F2F4FF]">
                {w.name}
              </h3>
              <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm text-[#A8AECF]">
                {w.description ?? "No description yet."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <TagChip label={`${w.nodes.length} nodes`} />
                {w.tags.map((t) => (
                  <TagChip key={t} label={t} />
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#F2F4FF]/[0.06] pt-3.5">
                <StatusBadge status={w.lastRunStatus ?? "inactive"} />
                <span className="text-xs text-[#6B7199]">updated {timeAgo(w.updatedAt)}</span>
                <span onClick={(e) => e.stopPropagation()} role="presentation">
                  <Switch
                    checked={w.active}
                    aria-label={`Toggle ${w.name} active`}
                    onCheckedChange={(checked) => toggleMut.mutate({ id: w.id, active: checked })}
                  />
                </span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-[#F2F4FF]/[0.06] hover:bg-transparent">
                  <TableHead className="text-[#6B7199]">Workflow</TableHead>
                  <TableHead className="text-[#6B7199]">Status</TableHead>
                  <TableHead className="hidden text-[#6B7199] md:table-cell">Nodes</TableHead>
                  <TableHead className="hidden text-[#6B7199] lg:table-cell">Tags</TableHead>
                  <TableHead className="text-[#6B7199]">Updated</TableHead>
                  <TableHead className="text-[#6B7199]">Active</TableHead>
                  <TableHead className="w-28 text-right text-[#6B7199]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((w) => (
                  <TableRow
                    key={w.id}
                    onClick={() => openWorkflow(w.id)}
                    className="cursor-pointer border-[#F2F4FF]/[0.06] hover:bg-[#F2F4FF]/[0.04]"
                  >
                    <TableCell className="max-w-56">
                      <p className="truncate font-medium text-[#F2F4FF]">{w.name}</p>
                      <p className="truncate text-xs text-[#6B7199]">{w.description ?? "—"}</p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={w.lastRunStatus ?? "inactive"} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-[#A8AECF] md:table-cell">{w.nodes.length}</TableCell>
                    <TableCell className="hidden max-w-48 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {w.tags.length > 0 ? (
                          w.tags.map((t) => <TagChip key={t} label={t} />)
                        ) : (
                          <span className="text-xs text-[#6B7199]">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-[#6B7199]">{timeAgo(w.updatedAt)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={w.active}
                        aria-label={`Toggle ${w.name} active`}
                        onCheckedChange={(checked) => toggleMut.mutate({ id: w.id, active: checked })}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">{cardActions(w, "inline")}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* --------------------------- Delete confirm --------------------------- */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="glass-strong border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-[family-name:var(--font-space)] text-[#F2F4FF]">
              Dissolve this workflow?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#A8AECF]">
              {deleteTarget?.name} and its execution history will be permanently removed from the
              void. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-[#F2F4FF]/10 bg-transparent text-[#A8AECF] hover:text-[#F2F4FF]">
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && delMut.mutate(deleteTarget.id)}
              className="rounded-full bg-[#FF5C7A] font-semibold text-[#05060F] hover:bg-[#FF5C7A]/85"
            >
              Delete workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
