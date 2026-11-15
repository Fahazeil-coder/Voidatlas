"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import { Gauge, Sparkles, TriangleAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { EmptyState, SectionTitle, StatChip, formatDuration } from "@/components/blissvoid/shared";
import { getStats } from "@/lib/blissvoid/api-client";

/* ---------------------------------------------------------------------------
   InsightsView — the observatory.
--------------------------------------------------------------------------- */

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
};

const TOOLTIP_STYLE = {
  background: "#0A0C1A",
  border: "1px solid rgba(124,92,255,0.25)",
  borderRadius: 12,
  color: "#F2F4FF",
  fontSize: 12,
} as const;

const STATUS_COLORS: Record<string, string> = {
  success: "#2CF5A0",
  error: "#FF5C7A",
  running: "#7C5CFF",
  canceled: "#6B7199",
};

export function InsightsView() {
  const statsQ = useQuery({ queryKey: ["stats"], queryFn: getStats, refetchInterval: 30000 });

  useEffect(() => {
    if (statsQ.isError) toast.error(`Insights unavailable — ${(statsQ.error as Error).message}`);
  }, [statsQ.isError, statsQ.error]);

  const totals = statsQ.data?.totals;
  const runs = statsQ.data?.runsPerDay ?? [];

  const pieData = useMemo(
    () =>
      (statsQ.data?.statusBreakdown ?? []).map((s) => ({
        name: s.status,
        value: s.count,
      })),
    [statsQ.data]
  );
  const pieTotal = pieData.reduce((acc, d) => acc + d.value, 0);

  const durationData = useMemo(
    () =>
      (statsQ.data?.durationsByWorkflow ?? [])
        .slice(0, 8)
        .map((d) => ({
          name: d.name.length > 22 ? `${d.name.slice(0, 21)}…` : d.name,
          seconds: +(d.avgDurationMs / 1000).toFixed(2),
          runs: d.runs,
        })),
    [statsQ.data]
  );

  const failing = statsQ.data?.topFailing ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <SectionTitle
        eyebrow="Observatory"
        title="Insights"
        description="The long view — runs, failures, latency and the cost of intelligence."
      />

      {/* ----------------------------- Stat chips ----------------------------- */}
      {statsQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass h-24 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : statsQ.isError ? (
        <EmptyState
          icon={<Gauge className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="Could not read the observatory"
          description={(statsQ.error as Error).message}
        />
      ) : (
        <>
          {totals && (
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.05 } } }}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            >
              <motion.div variants={item}>
                <StatChip label="Executions" value={totals.executions.toLocaleString()} accent="#3DA9FF" />
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
              <motion.div variants={item}>
                <StatChip label="Active workflows" value={String(totals.activeWorkflows)} sub={`${totals.workflows} total`} accent="#7C5CFF" />
              </motion.div>
            </motion.div>
          )}

          {/* --------------------------- Charts row 1 --------------------------- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Runs per day */}
            <motion.div variants={item} initial="hidden" animate="show" className="glass rounded-2xl p-4 sm:p-5 lg:col-span-2">
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
              {runs.length === 0 ? (
                <div className="flex h-[240px] items-center justify-center text-sm text-[#6B7199]">
                  No runs yet — the chart awaits data.
                </div>
              ) : (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={runs} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="insightSuccessGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2CF5A0" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#2CF5A0" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="insightErrorGrad" x1="0" y1="0" x2="0" y2="1">
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
                      <RTooltip cursor={{ stroke: "rgba(124,92,255,0.35)" }} contentStyle={TOOLTIP_STYLE} />
                      <Area type="monotone" dataKey="success" stackId="runs" stroke="#2CF5A0" strokeWidth={2} fill="url(#insightSuccessGrad)" />
                      <Area type="monotone" dataKey="error" stackId="runs" stroke="#FF5C7A" strokeWidth={2} fill="url(#insightErrorGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </motion.div>

            {/* Status donut */}
            <motion.div variants={item} initial="hidden" animate="show" className="glass rounded-2xl p-4 sm:p-5">
              <h2 className="mb-2 font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
                Status breakdown
              </h2>
              {pieData.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-[#6B7199]">
                  Nothing executed yet.
                </div>
              ) : (
                <>
                  <div className="relative h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={62}
                          outerRadius={86}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {pieData.map((d) => (
                            <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? "#6B7199"} />
                          ))}
                        </Pie>
                        <RTooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <p className="font-[family-name:var(--font-space)] text-2xl font-bold text-[#F2F4FF]">
                        {pieTotal.toLocaleString()}
                      </p>
                      <p className="text-[11px] text-[#6B7199]">total runs</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[11px] text-[#A8AECF]">
                    {pieData.map((d) => (
                      <span key={d.name} className="inline-flex items-center gap-1.5 capitalize">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: STATUS_COLORS[d.name] ?? "#6B7199" }}
                          aria-hidden="true"
                        />
                        {d.name} · {d.value}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          </div>

          {/* --------------------------- Charts row 2 --------------------------- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Durations by workflow */}
            <motion.div variants={item} initial="hidden" animate="show" className="glass rounded-2xl p-4 sm:p-5">
              <h2 className="mb-4 font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
                Avg duration by workflow
              </h2>
              {durationData.length === 0 ? (
                <div className="flex h-[180px] items-center justify-center text-sm text-[#6B7199]">
                  No completed runs to measure yet.
                </div>
              ) : (
                <div style={{ height: Math.max(180, durationData.length * 44) }} className="w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={durationData} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="insightDurGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop stopColor="#7C5CFF" />
                          <stop offset="1" stopColor="#3DA9FF" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(242,244,255,0.06)" horizontal={false} />
                      <XAxis
                        type="number"
                        unit="s"
                        tick={{ fill: "#6B7199", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={150}
                        tick={{ fill: "#6B7199", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <RTooltip cursor={{ fill: "rgba(124,92,255,0.08)" }} contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="seconds" radius={[0, 6, 6, 0]} barSize={16}>
                        {durationData.map((d) => (
                          <Cell key={d.name} fill="url(#insightDurGrad)" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </motion.div>

            {/* Top failing */}
            <motion.div variants={item} initial="hidden" animate="show" className="glass rounded-2xl p-4 sm:p-5">
              <h2 className="mb-4 flex items-center gap-2 font-[family-name:var(--font-space)] text-sm font-semibold uppercase tracking-[0.14em] text-[#A8AECF]">
                <TriangleAlert className="h-4 w-4 text-[#FF5C7A]" strokeWidth={1.5} aria-hidden="true" />
                Top failing workflows
              </h2>
              {failing.length === 0 ? (
                <div className="flex h-[180px] items-center justify-center gap-2 text-sm text-[#6B7199]">
                  <Zap className="h-4 w-4 text-[#2CF5A0]" strokeWidth={1.5} aria-hidden="true" />
                  Nothing is failing. Bliss achieved.
                </div>
              ) : (
                <ul className="max-h-72 space-y-3.5 overflow-y-auto pr-1">
                  {failing.map((f) => {
                    const pct = f.runs > 0 ? Math.min(100, (f.failures / f.runs) * 100) : 0;
                    return (
                      <li key={f.workflowId}>
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-medium text-[#F2F4FF]">{f.name}</span>
                          <span className="shrink-0 font-mono text-xs text-[#FF5C7A]">
                            {f.failures}/{f.runs} · {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#FF5C7A]/10">
                          <div
                            className="h-full rounded-full bg-[#FF5C7A] transition-all"
                            style={{ width: `${Math.max(pct, 2)}%`, boxShadow: "0 0 10px rgba(255,92,122,0.4)" }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          </div>

          {/* ---------------------------- AI spend panel ---------------------------- */}
          {totals && (
            <motion.div
              variants={item}
              initial="hidden"
              animate="show"
              className="glass relative overflow-hidden rounded-2xl p-5 sm:p-6"
            >
              <div
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl"
                style={{ background: "rgba(255,107,214,0.16)" }}
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-center gap-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#FF6BD6]/25 bg-[#FF6BD6]/10">
                  <Sparkles className="h-6 w-6 text-[#FF6BD6]" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#6B7199]">AI spend</p>
                  <p className="mt-1 font-[family-name:var(--font-space)] text-3xl font-bold text-[#F2F4FF]">
                    ${totals.aiCost.toFixed(4)}
                    <span className="ml-3 align-middle font-sans text-sm font-normal text-[#A8AECF]">
                      {totals.aiCalls.toLocaleString()} calls
                    </span>
                  </p>
                  <p className="mt-1.5 text-sm text-[#A8AECF]">
                    Bring your own key — track per-execution cost here.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
