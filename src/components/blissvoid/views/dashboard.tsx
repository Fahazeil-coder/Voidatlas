"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion, type Variants } from "framer-motion";
import {
  Activity,
  ChevronRight,
  KeyRound,
  LayoutGrid,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EmptyState,
  StatChip,
  StatusBadge,
  formatDuration,
  timeAgo,
} from "@/components/blissvoid/shared";
import { createWorkflow, getStats, listExecutions, listWorkflows } from "@/lib/blissvoid/api-client";
import type { ExecutionStatus } from "@/lib/blissvoid/types";
import { useApp } from "@/lib/blissvoid/store";

/* ---------------------------------------------------------------------------
   DashboardView — the operator's cockpit.
--------------------------------------------------------------------------- */

const STATUS_DOT: Record<string, string> = {
  success: "#2CF5A0",
  error: "#FF5C7A",
  running: "#7C5CFF",
  canceled: "#6B7199",
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
};

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  "workflow.created": Plus,
  "workflow.run": Play,
  "credential.added": KeyRound,
  "workflow.ai_created": Sparkles,
};

function SkeletonRows({ rows = 3, className = "h-16" }: { rows?: number; className?: string }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`glass animate-pulse rounded-xl ${className}`} />
      ))}
    </div>
  );
}

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function DashboardView() {
  const qc = useQueryClient();
  const openWorkflow = useApp((s) => s.openWorkflow);
  const openExecution = useApp((s) => s.openExecution);
  const setAppView = useApp((s) => s.setAppView);
  const setAiBuilderOpen = useApp((s) => s.setAiBuilderOpen);

  const statsQ = useQuery({ queryKey: ["stats"], queryFn: getStats, refetchInterval: 15000 });
  const workflowsQ = useQuery({ queryKey: ["workflows"], queryFn: listWorkflows });
  const executionsQ = useQuery({
    queryKey: ["executions"],
    queryFn: () => listExecutions({ limit: 8 }),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (statsQ.isError) toast.error(`Stats unavailable — ${(statsQ.error as Error).message}`);
    if (workflowsQ.isError) toast.error(`Workflows unavailable — ${(workflowsQ.error as Error).message}`);
    if (executionsQ.isError) toast.error(`Executions unavailable — ${(executionsQ.error as Error).message}`);
  }, [statsQ.isError, statsQ.error, workflowsQ.isError, workflowsQ.error, executionsQ.isError, executionsQ.error]);

  const createMut = useMutation({
    mutationFn: () => createWorkflow({ name: "Untitled flow" }),
    onSuccess: (res) => {
      toast.success("Workflow created");
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      openWorkflow(res.workflow.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = format(new Date(), "EEEE, d MMMM yyyy");

  const totals = statsQ.data?.totals;
  const runs = statsQ.data?.runsPerDay ?? [];
  const workflows = (workflowsQ.data?.workflows ?? []).slice(0, 5);
  const executions = (executionsQ.data?.executions ?? []).slice(0, 5);
  const activity = statsQ.data?.recentActivity ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      {/* ---------------------------- Greeting row ---------------------------- */}
      <motion.div variants={item} initial="hidden" animate="show" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-space)] text-2xl font-bold text-[#F2F4FF]">
            {greeting}, Operator.
          </h1>
          <p className="mt-1 text-sm text-[#6B7199]">{today}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <button
            type="button"
            onClick={() => setAiBuilderOpen(true)}
            className="glass glow-hover inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-[#F2F4FF]"
          >
            <Sparkles className="h-4 w-4 text-[#FF6BD6]" strokeWidth={1.5} aria-hidden="true" />
            Describe with AI
          </button>
          <button
            type="button"
            onClick={() => setAppView("templates")}
            className="glass glow-hover inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-[#F2F4FF]"
          >
            <LayoutGrid className="h-4 w-4 text-[#2CF5D0]" strokeWidth={1.5} aria-hidden="true" />
            Browse templates
          </button>
        </div>
      </motion.div>

      {/* ----------------------------- Stats chips ---------------------------- */}
      {statsQ.isLoading ? (
        <SkeletonRows rows={1} className="h-24" />
      ) : totals ? (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          <motion.div variants={item}>
            <StatChip label="Active workflows" value={String(totals.activeWorkflows)} sub={`${totals.workflows} total`} accent="#7C5CFF" />
          </motion.div>
          <motion.div variants={item}>
            <StatChip label="Executions" value={totals.executions.toLocaleString()} sub="all time" accent="#3DA9FF" />
          </motion.div>
          <motion.div variants={item}>
            <StatChip label="Success rate" value={`${totals.successRate}%`} accent="#2CF5A0" />
          </motion.div>
          <motion.div variants={item}>
            <StatChip label="Avg duration" value={formatDuration(totals.avgDurationMs)} accent="#FFC857" />
          </motion.div>
          <motion.div variants={item}>
            <StatChip label="AI spend" value={`$${totals.aiCost.toFixed(4)}`} sub={`${totals.aiCalls} calls`} accent="#FF6BD6" />
          </motion.div>
        </motion.div>
      ) : null}

      {/* ------------------------------- Chart ------------------------------- */}
      <motion.div variants={item} initial="hidden" animate="show" className="glass rounded-2xl p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
            Runs — last 14 days
          </h2>
          <div className="flex items-center gap-3 text-[11px] text-[#6B7199]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#2CF5A0]" aria-hidden="true" /> success
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#FF5C7A]" aria-hidden="true" /> error
            </span>
          </div>
        </div>
        {statsQ.isLoading ? (
          <div className="h-[260px] animate-pulse rounded-xl bg-[#11142A]/60" />
        ) : runs.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-[#6B7199]">
            No runs yet — trigger a workflow to see the constellation.
          </div>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={runs} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashSuccessGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2CF5A0" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2CF5A0" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="dashErrorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF5C7A" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#FF5C7A" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(242,244,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#6B7199", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  tickFormatter={(v: string) => {
                    const d = new Date(v);
                    return Number.isNaN(d.getTime()) ? v : format(d, "MMM d");
                  }}
                />
                <YAxis tick={{ fill: "#6B7199", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={38} />
                <RTooltip
                  cursor={{ stroke: "rgba(124,92,255,0.35)" }}
                  contentStyle={{
                    background: "#0A0C1A",
                    border: "1px solid rgba(124,92,255,0.25)",
                    borderRadius: 12,
                    color: "#F2F4FF",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="success"
                  stackId="runs"
                  stroke="#2CF5A0"
                  strokeWidth={2}
                  fill="url(#dashSuccessGrad)"
                  activeDot={{ r: 4, fill: "#3DA9FF", stroke: "#05060F" }}
                />
                <Area
                  type="monotone"
                  dataKey="error"
                  stackId="runs"
                  stroke="#FF5C7A"
                  strokeWidth={2}
                  fill="url(#dashErrorGrad)"
                  activeDot={{ r: 4, fill: "#3DA9FF", stroke: "#05060F" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </motion.div>

      {/* --------------------------- Two columns ------------------------------ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent workflows */}
        <motion.div variants={item} initial="hidden" animate="show">
          <Panel
            title="Recent workflows"
            action={
              <button
                type="button"
                onClick={() => setAppView("workflows")}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#A8AECF] transition hover:text-[#F2F4FF]"
              >
                View all <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            }
          >
            {workflowsQ.isLoading ? (
              <SkeletonRows rows={4} className="h-14" />
            ) : workflowsQ.isError ? (
              <EmptyState
                icon={<WorkflowIcon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
                title="Could not load workflows"
                description={(workflowsQ.error as Error).message}
              />
            ) : workflows.length === 0 ? (
              <EmptyState
                icon={<WorkflowIcon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
                title="No workflows yet"
                description="Create your first flow or let the AI draft one for you."
                action={
                  <button
                    type="button"
                    onClick={() => createMut.mutate()}
                    className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] transition hover:brightness-110"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> New workflow
                  </button>
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {workflows.map((w) => {
                  const dot = w.lastRunStatus ? STATUS_DOT[w.lastRunStatus as ExecutionStatus] ?? "#6B7199" : "#6B7199";
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => openWorkflow(w.id)}
                        className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[#F2F4FF]/[0.04]"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: dot, boxShadow: `0 0 8px ${dot}` }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#F2F4FF]">
                          {w.name}
                        </span>
                        <span className="hidden rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2 py-0.5 text-[11px] text-[#A8AECF] sm:inline">
                          {w.nodes.length} nodes
                        </span>
                        <span className="shrink-0 text-xs text-[#6B7199]">{timeAgo(w.updatedAt)}</span>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-[#6B7199] transition group-hover:translate-x-0.5 group-hover:text-[#2CF5D0]"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </motion.div>

        {/* Recent executions */}
        <motion.div variants={item} initial="hidden" animate="show">
          <Panel
            title="Recent executions"
            action={
              <button
                type="button"
                onClick={() => setAppView("executions")}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#A8AECF] transition hover:text-[#F2F4FF]"
              >
                View all <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            }
          >
            {executionsQ.isLoading ? (
              <SkeletonRows rows={4} className="h-14" />
            ) : executionsQ.isError ? (
              <EmptyState
                icon={<Play className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
                title="Could not load executions"
                description={(executionsQ.error as Error).message}
              />
            ) : executions.length === 0 ? (
              <EmptyState
                icon={<Play className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
                title="No executions yet"
                description="Run a workflow and its heartbeat will appear here."
              />
            ) : (
              <ul className="space-y-1.5">
                {executions.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setAppView("executions");
                        openExecution(e.id);
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[#F2F4FF]/[0.04]"
                    >
                      <StatusBadge status={e.status} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#F2F4FF]">
                        {e.workflowName}
                      </span>
                      <span className="hidden rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2 py-0.5 text-[11px] text-[#A8AECF] md:inline">
                        {e.mode}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[#A8AECF]">
                        {e.durationMs != null ? formatDuration(e.durationMs) : "—"}
                      </span>
                      <span className="shrink-0 text-xs text-[#6B7199]">{timeAgo(e.startedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </motion.div>
      </div>

      {/* ----------------------------- Activity ------------------------------- */}
      <motion.div variants={item} initial="hidden" animate="show" className="glass rounded-2xl p-4 sm:p-5">
        <h2 className="mb-3 font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
          Activity
        </h2>
        {statsQ.isLoading ? (
          <SkeletonRows rows={3} className="h-10" />
        ) : activity.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-[#6B7199]">
            <Activity className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Quiet void. Actions will echo here.
          </div>
        ) : (
          <div className="relative max-h-72">
            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {activity.map((a) => {
              const Icon = ACTIVITY_ICONS[a.kind] ?? Activity;
              const accent =
                a.kind === "workflow.ai_created"
                  ? "#FF6BD6"
                  : a.kind === "credential.added"
                    ? "#FFC857"
                    : a.kind === "workflow.run"
                      ? "#3DA9FF"
                      : "#2CF5A0";
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2 transition hover:bg-[#F2F4FF]/[0.04]"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#F2F4FF]/10"
                    style={{ background: `${accent}1a` }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: accent }} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm text-[#A8AECF]">{a.message}</p>
                  <span className="shrink-0 text-xs text-[#6B7199]">{timeAgo(a.createdAt)}</span>
                </li>
              );
            })}
            </ul>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
              style={{ background: "linear-gradient(to bottom, rgba(10,12,26,0), rgba(10,12,26,0.85))" }}
              aria-hidden="true"
            />
          </div>
        )}
      </motion.div>
    </div>
  );
}
