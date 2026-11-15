"use client";

import { createElement, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  ArrowLeft,
  ChevronDown,
  Coins,
  HeartPulse,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Trash2,
  Zap,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { iconFor } from "@/components/blissvoid/editor/icon-map";
import { EmptyState, SectionTitle, StatusBadge, formatDuration, timeAgo } from "@/components/blissvoid/shared";
import {
  aiExecutionDoctor,
  deleteExecution,
  getExecution,
  listExecutions,
  listWorkflows,
  retryExecution,
} from "@/lib/blissvoid/api-client";
import type { ExecutionStatus, NodeRunDTO } from "@/lib/blissvoid/types";
import { NODE_MAP } from "@/lib/blissvoid/node-catalog";
import { useApp } from "@/lib/blissvoid/store";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   ExecutionsView — list + deep observability detail.
--------------------------------------------------------------------------- */

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
};

const STATUS_PILL: Record<string, string> = {
  all: "#A8AECF",
  success: "#2CF5A0",
  error: "#FF5C7A",
  running: "#7C5CFF",
};

const NODE_BAR: Record<string, string> = {
  success: "rgba(61,169,255,0.7)",
  error: "#FF5C7A",
  running: "#7C5CFF",
  canceled: "#6B7199",
};

const NODE_RING: Record<string, string> = {
  success: "#2CF5A0",
  error: "#FF5C7A",
  running: "#7C5CFF",
  canceled: "#6B7199",
};

function catalogIcon(name: string, className: string, color: string) {
  return createElement(iconFor(name), {
    className,
    style: { color },
    strokeWidth: 1.5,
    "aria-hidden": true,
  });
}

function pretty(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function ModeChip({ mode }: { mode: string }) {
  return (
    <span className="rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2 py-0.5 text-[11px] text-[#A8AECF]">
      {mode}
    </span>
  );
}

/* ================================ LIST =================================== */

function ExecutionsList() {
  const qc = useQueryClient();
  const openExecution = useApp((s) => s.openExecution);
  const openWorkflow = useApp((s) => s.openWorkflow);

  const [status, setStatus] = useState("all");
  const [workflowId, setWorkflowId] = useState("all");
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const workflowsQ = useQuery({ queryKey: ["workflows"], queryFn: listWorkflows });
  const executionsQ = useQuery({
    queryKey: ["executions", status, workflowId],
    queryFn: () =>
      listExecutions({
        limit: 60,
        status: status === "all" ? undefined : status,
        workflowId: workflowId === "all" ? undefined : workflowId,
      }),
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (executionsQ.isError) toast.error(`Executions unavailable — ${(executionsQ.error as Error).message}`);
  }, [executionsQ.isError, executionsQ.error]);

  const retryMut = useMutation({
    mutationFn: (id: string) => retryExecution(id),
    onSuccess: (res) => {
      toast.success("Retry dispatched");
      qc.invalidateQueries({ queryKey: ["executions"] });
      openExecution(res.execution.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteExecution(id),
    onSuccess: () => {
      toast.success("Execution deleted");
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["executions"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const q = search.trim().toLowerCase();
  const rows = (executionsQ.data?.executions ?? []).filter((e) => {
    if (!q) return true;
    return (
      e.workflowName.toLowerCase().includes(q) ||
      e.mode.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q)
    );
  });

  const workflowOptions = workflowsQ.data?.workflows ?? [];

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Observability"
        title="Executions"
        description="Every run, every node, every millisecond — nothing disappears in the void."
      />

      {/* ------------------------------ Controls ------------------------------ */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", "success", "error", "running"].map((s) => {
            const active = status === s;
            const color = STATUS_PILL[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-medium capitalize transition",
                  active
                    ? "text-[#F2F4FF] shadow-[0_0_16px_rgba(124,92,255,0.2)]"
                    : "border-[#F2F4FF]/10 bg-[#11142A] text-[#A8AECF] hover:text-[#F2F4FF]"
                )}
                style={active ? { borderColor: `${color}66`, background: `${color}1a` } : undefined}
              >
                {s === "all" ? "All" : s}
              </button>
            );
          })}
        </div>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          {workflowOptions.length > 0 && (
            <Select value={workflowId} onValueChange={setWorkflowId}>
              <SelectTrigger
                aria-label="Filter by workflow"
                className="w-full rounded-full border-[#F2F4FF]/10 bg-[#11142A]/60 text-sm text-[#F2F4FF] sm:w-56"
              >
                <SelectValue placeholder="Workflow" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workflows</SelectItem>
                {workflowOptions.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7199]"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search runs…"
              aria-label="Search executions"
              className="rounded-full border-[#F2F4FF]/10 bg-[#11142A]/60 pl-10 text-sm text-[#F2F4FF] placeholder:text-[#6B7199]"
            />
          </div>
        </div>
      </div>

      {/* -------------------------------- Table ------------------------------- */}
      {executionsQ.isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass h-14 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : executionsQ.isError ? (
        <EmptyState
          icon={<Zap className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="Could not load executions"
          description={(executionsQ.error as Error).message}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Play className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="No executions found"
          description="Runs will materialize here as soon as a workflow fires."
        />
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <div className="max-h-[62vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-[#0A0C1A]/95 backdrop-blur">
                <TableRow className="border-[#F2F4FF]/[0.06] hover:bg-transparent">
                  <TableHead className="text-[#6B7199]">Status</TableHead>
                  <TableHead className="text-[#6B7199]">Workflow</TableHead>
                  <TableHead className="hidden text-[#6B7199] md:table-cell">Mode</TableHead>
                  <TableHead className="text-[#6B7199]">Started</TableHead>
                  <TableHead className="text-[#6B7199]">Duration</TableHead>
                  <TableHead className="hidden text-[#6B7199] lg:table-cell">AI cost</TableHead>
                  <TableHead className="w-24 text-right text-[#6B7199]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow
                    key={e.id}
                    onClick={() => openExecution(e.id)}
                    className="cursor-pointer border-[#F2F4FF]/[0.06] hover:bg-[#F2F4FF]/[0.04]"
                  >
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="max-w-56">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openWorkflow(e.workflowId);
                        }}
                        className="truncate text-sm font-medium text-[#F2F4FF] underline-offset-4 transition hover:text-[#2CF5D0] hover:underline"
                      >
                        {e.workflowName}
                      </button>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <ModeChip mode={e.mode} />
                    </TableCell>
                    <TableCell className="text-xs text-[#6B7199]" title={new Date(e.startedAt).toLocaleString()}>
                      {timeAgo(e.startedAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#A8AECF]">
                      {e.durationMs != null ? formatDuration(e.durationMs) : "—"}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-[#FF6BD6] lg:table-cell">
                      {e.aiCost > 0 ? `$${e.aiCost.toFixed(4)}` : "—"}
                    </TableCell>
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {e.status === "error" && (
                          <button
                            type="button"
                            aria-label="Retry execution"
                            title="Retry"
                            disabled={retryMut.isPending && retryMut.variables === e.id}
                            onClick={() => retryMut.mutate(e.id)}
                            className="glass-strong glow-hover rounded-lg p-1.5 text-[#FFC857] transition hover:scale-110 disabled:opacity-50"
                          >
                            {retryMut.isPending && retryMut.variables === e.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Delete execution"
                          title="Delete"
                          onClick={() => setDeleteId(e.id)}
                          className="glass-strong glow-hover rounded-lg p-1.5 text-[#FF5C7A] transition hover:scale-110"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="glass-strong border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-[family-name:var(--font-space)] text-[#F2F4FF]">
              Delete this execution?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#A8AECF]">
              The run, its node telemetry and captured data will be erased from the void.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-[#F2F4FF]/10 bg-transparent text-[#A8AECF] hover:text-[#F2F4FF]">
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && delMut.mutate(deleteId)}
              className="rounded-full bg-[#FF5C7A] font-semibold text-[#05060F] hover:bg-[#FF5C7A]/85"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ================================ DETAIL ================================= */

function NodeRunCard({
  run,
  selected,
  open,
  onOpenChange,
}: {
  run: NodeRunDTO;
  selected: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const def = NODE_MAP[run.nodeType];
  const accent = def?.accent ?? "#6B7199";

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        id={`noderun-${run.id}`}
        className={cn(
          "glass overflow-hidden rounded-2xl transition-all",
          selected && "shadow-[0_0_0_1px_rgba(124,92,255,0.6),0_0_28px_rgba(124,92,255,0.18)]"
        )}
      >
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#F2F4FF]/[0.04]">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#F2F4FF]/10"
              style={{ background: `${accent}1f` }}
            >
              {catalogIcon(def?.icon ?? "CircleDashed", "h-4 w-4", accent)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#F2F4FF]">{run.nodeName}</span>
              <span className="block text-[11px] text-[#6B7199]">{def?.label ?? run.nodeType}</span>
            </span>
            {run.attempt > 1 && (
              <span className="rounded-full border border-[#FFC857]/30 bg-[#FFC857]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFC857]">
                try {run.attempt}
              </span>
            )}
            <StatusBadge status={run.status} />
            <span className="hidden shrink-0 font-mono text-xs text-[#A8AECF] sm:inline">
              {formatDuration(run.durationMs)}
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-[#6B7199] transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-[#F2F4FF]/[0.06] p-4">
            {run.error && (
              <div className="rounded-xl border border-[#FF5C7A]/30 bg-[#FF5C7A]/10 p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#FF5C7A]">Error</p>
                <p className="font-mono text-xs leading-relaxed break-words text-[#FF5C7A]">{run.error}</p>
              </div>
            )}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7199]">Input</p>
              <pre className="max-h-64 max-w-full overflow-auto whitespace-pre rounded-xl border border-[#F2F4FF]/[0.06] bg-[#05060F]/70 p-3 font-mono text-[11px] leading-relaxed text-[#A8AECF]">
                {pretty(run.input)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7199]">Output</p>
              <pre className="max-h-64 max-w-full overflow-auto whitespace-pre rounded-xl border border-[#F2F4FF]/[0.06] bg-[#05060F]/70 p-3 font-mono text-[11px] leading-relaxed text-[#A8AECF]">
                {pretty(run.output)}
              </pre>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ExecutionDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const closeExecution = useApp((s) => s.closeExecution);
  const openWorkflow = useApp((s) => s.openWorkflow);
  const openExecution = useApp((s) => s.openExecution);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  const execQ = useQuery({
    queryKey: ["execution", id],
    queryFn: () => getExecution(id),
    refetchInterval: (query) => (query.state.data?.execution.status === "running" ? 800 : false),
  });

  const ex = execQ.data?.execution;
  const nodeRuns = useMemo(() => ex?.nodeRuns ?? [], [ex]);

  const gantt = useMemo(() => {
    if (!ex) return { rows: [] as (NodeRunDTO & { offset: number })[], total: 1 };
    const start = new Date(ex.startedAt).getTime();
    const rows = nodeRuns.map((r) => ({
      ...r,
      offset: Math.max(0, new Date(r.startedAt).getTime() - start),
    }));
    const total = Math.max(
      ex.durationMs ?? 0,
      ...rows.map((r) => r.offset + Math.max(r.durationMs, 1)),
      1
    );
    return { rows, total };
  }, [ex, nodeRuns]);

  const doctorMut = useMutation({
    mutationFn: () => aiExecutionDoctor(id),
    onSuccess: () => {
      /* diagnosis rendered from mutation.data */
    },
    onError: (e: Error) => toast.error(`Doctor unavailable — ${e.message}`),
  });

  const retryMut = useMutation({
    mutationFn: () => retryExecution(id),
    onSuccess: (res) => {
      toast.success("Retry dispatched");
      qc.invalidateQueries({ queryKey: ["executions"] });
      openExecution(res.execution.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: () => deleteExecution(id),
    onSuccess: () => {
      toast.success("Execution deleted");
      qc.invalidateQueries({ queryKey: ["executions"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      closeExecution();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectNode = (nodeId: string) => {
    setSelectedNode(nodeId);
    setOpenMap((m) => ({ ...m, [nodeId]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`noderun-${nodeId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  if (execQ.isLoading) {
    return (
      <div className="space-y-4">
        <div className="glass h-10 w-40 animate-pulse rounded-full" />
        <div className="glass h-36 animate-pulse rounded-2xl" />
        <div className="glass h-28 animate-pulse rounded-2xl" />
        <div className="glass h-64 animate-pulse rounded-2xl" />
      </div>
    );
  }

  if (execQ.isError || !ex) {
    return (
      <EmptyState
        icon={<Zap className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
        title="Execution not found"
        description={(execQ.error as Error)?.message ?? "This run has vanished from the void."}
        action={
          <button
            type="button"
            onClick={closeExecution}
            className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] transition hover:brightness-110"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> Back to executions
          </button>
        }
      />
    );
  }

  const firstError = nodeRuns.find((r) => r.status === "error")?.id ?? nodeRuns[0]?.id ?? null;
  const isNodeOpen = (nodeId: string) => openMap[nodeId] ?? nodeId === firstError;

  return (
    <motion.div
      variants={item}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* ------------------------------- Back -------------------------------- */}
      <button
        type="button"
        onClick={closeExecution}
        className="inline-flex items-center gap-2 text-sm font-medium text-[#A8AECF] transition hover:text-[#F2F4FF]"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        All executions
      </button>

      {/* ------------------------------ Header ------------------------------- */}
      <div className="glass rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={ex.status} className="px-3 py-1 text-sm" />
              <ModeChip mode={ex.mode} />
            </div>
            <button
              type="button"
              onClick={() => openWorkflow(ex.workflowId)}
              className="text-left font-[family-name:var(--font-space)] text-xl font-bold text-[#F2F4FF] underline-offset-4 transition hover:text-[#2CF5D0] hover:underline sm:text-2xl"
            >
              {ex.workflowName}
            </button>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6B7199]">
              <span title={new Date(ex.startedAt).toLocaleString()}>
                started {new Date(ex.startedAt).toLocaleString()}
              </span>
              <span className="font-mono text-[#A8AECF]">
                {ex.durationMs != null ? formatDuration(ex.durationMs) : "running…"}
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[#FF6BD6]">
                <Coins className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                {ex.aiTokens.toLocaleString()} tokens · ${ex.aiCost.toFixed(4)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={retryMut.isPending}
              onClick={() => retryMut.mutate()}
              className="glass glow-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[#F2F4FF] disabled:opacity-60"
            >
              {retryMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-4 w-4 text-[#FFC857]" strokeWidth={1.5} aria-hidden="true" />
              )}
              Retry run
            </button>
            <button
              type="button"
              disabled={doctorMut.isPending}
              onClick={() => doctorMut.mutate()}
              className="inline-flex items-center gap-2 rounded-full border border-[#FF6BD6]/40 bg-[#FF6BD6]/10 px-4 py-2 text-sm font-semibold text-[#FF6BD6] transition hover:bg-[#FF6BD6]/20 disabled:opacity-60"
            >
              {doctorMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <HeartPulse className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              )}
              {doctorMut.isPending ? "Consulting…" : "Execution Doctor"}
            </button>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              aria-label="Delete execution"
              className="glass glow-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[#FF5C7A]"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>

        {ex.error && (
          <div className="mt-4 rounded-xl border border-[#FF5C7A]/30 bg-[#FF5C7A]/10 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#FF5C7A]">Execution error</p>
            <p className="mt-1 font-mono text-xs break-words text-[#FF5C7A]">{ex.error}</p>
          </div>
        )}
      </div>

      {/* ---------------------------- Doctor card ---------------------------- */}
      {doctorMut.isPending && (
        <div className="shimmer glass relative h-24 overflow-hidden rounded-2xl" aria-label="Doctor analyzing" />
      )}
      {doctorMut.data && (
        <div className="glass rounded-2xl border-l-4 p-5" style={{ borderLeftColor: "#FF6BD6" }}>
          <h3 className="mb-2 flex items-center gap-2 font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#FF6BD6]">
            <HeartPulse className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Execution Doctor — diagnosis
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#A8AECF]">{doctorMut.data.diagnosis}</p>
        </div>
      )}

      {/* ---------------------------- Replay strip ---------------------------- */}
      {nodeRuns.length > 0 && (
        <div className="glass rounded-2xl p-4 sm:p-5">
          <h3 className="mb-4 font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
            Replay
          </h3>
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-center">
              {nodeRuns.map((r, i) => {
                const def = NODE_MAP[r.nodeType];
                const accent = def?.accent ?? "#6B7199";
                const ring = NODE_RING[r.status] ?? "#6B7199";
                const selected = selectedNode === r.id;
                return (
                  <div key={r.id} className="flex items-center">
                    {i > 0 && (
                      <div
                        className="h-0.5 w-8 shrink-0 rounded-full transition-all"
                        style={{
                          background:
                            nodeRuns[i - 1].status === "success" && r.status !== "canceled"
                              ? "linear-gradient(90deg,#3DA9FF,#2CF5A0)"
                              : "rgba(242,244,255,0.12)",
                          boxShadow:
                            nodeRuns[i - 1].status === "success" && r.status !== "canceled"
                              ? "0 0 10px rgba(44,245,160,0.45)"
                              : undefined,
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => selectNode(r.id)}
                      className={cn(
                        "glass-strong flex w-32 shrink-0 flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition hover:scale-[1.03]",
                        r.status === "running" && "node-running",
                        selected && "shadow-[0_0_0_1px_rgba(124,92,255,0.6)]"
                      )}
                      style={{ borderColor: selected ? undefined : `${ring}55` }}
                      aria-pressed={selected}
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#F2F4FF]/10"
                        style={{ background: `${accent}1f` }}
                      >
                        {catalogIcon(def?.icon ?? "CircleDashed", "h-4 w-4", accent)}
                      </span>
                      <span className="w-full truncate text-center text-xs font-medium text-[#F2F4FF]">
                        {r.nodeName}
                      </span>
                      <span className="font-mono text-[10px] text-[#6B7199]">{formatDuration(r.durationMs)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------- Gantt ------------------------------- */}
      {gantt.rows.length > 0 && (
        <div className="glass rounded-2xl p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
              Timeline
            </h3>
            <span className="font-mono text-[11px] text-[#6B7199]">total {formatDuration(gantt.total)}</span>
          </div>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[#F2F4FF]/[0.05]">
            <div
              className="h-full rounded-full bg-bliss"
              style={{ width: `${Math.min(100, ((ex.durationMs ?? gantt.total) / gantt.total) * 100)}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="space-y-2">
            {gantt.rows.map((r) => {
              const color = NODE_BAR[r.status] ?? "#6B7199";
              const left = (r.offset / gantt.total) * 100;
              const width = Math.max((Math.max(r.durationMs, 1) / gantt.total) * 100, 1.2);
              return (
                <div key={r.id} className="flex items-center gap-3">
                  <p className="w-32 shrink-0 truncate text-xs text-[#A8AECF] sm:w-40" title={r.nodeName}>
                    {r.nodeName}
                  </p>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-lg bg-[#F2F4FF]/[0.04]">
                    <div
                      className={cn("absolute top-0.5 h-4 min-w-[5px] rounded-md", r.status === "running" && "animate-pulse")}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: color,
                        boxShadow: r.status === "error" ? "0 0 12px rgba(255,92,122,0.45)" : undefined,
                      }}
                      title={`${r.nodeName} — ${formatDuration(r.durationMs)}`}
                    />
                  </div>
                  <p className="w-14 shrink-0 text-right font-mono text-[10px] text-[#6B7199]">
                    {formatDuration(r.durationMs)}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-[10px] text-[#6B7199]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: NODE_BAR.success }} /> success
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: NODE_BAR.error }} /> error
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: NODE_BAR.running }} /> running
            </span>
          </div>
        </div>
      )}

      {/* ---------------------------- Node data ------------------------------ */}
      {nodeRuns.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
            Node telemetry
          </h3>
          {nodeRuns.map((r) => (
            <NodeRunCard
              key={r.id}
              run={r}
              selected={selectedNode === r.id}
              open={isNodeOpen(r.id)}
              onOpenChange={(o) => setOpenMap((m) => ({ ...m, [r.id]: o }))}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Play className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="No node telemetry"
          description="This execution has no recorded node runs."
        />
      )}

      {/* --------------------------- Delete confirm --------------------------- */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="glass-strong border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-[family-name:var(--font-space)] text-[#F2F4FF]">
              Delete this execution?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#A8AECF]">
              All node telemetry and captured data for this run will be erased.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-[#F2F4FF]/10 bg-transparent text-[#A8AECF] hover:text-[#F2F4FF]">
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => delMut.mutate()}
              className="rounded-full bg-[#FF5C7A] font-semibold text-[#05060F] hover:bg-[#FF5C7A]/85"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

/* ================================ ROOT =================================== */

export function ExecutionsView() {
  const viewingExecutionId = useApp((s) => s.viewingExecutionId);
  return (
    <div className="mx-auto w-full max-w-7xl">
      {viewingExecutionId ? <ExecutionDetail id={viewingExecutionId} /> : <ExecutionsList />}
    </div>
  );
}
