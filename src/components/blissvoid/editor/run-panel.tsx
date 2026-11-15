"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, RotateCcw, Stethoscope, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge, formatDuration } from "@/components/blissvoid/shared";
import { aiExecutionDoctor } from "@/lib/blissvoid/api-client";
import type { ExecutionDTO } from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   Bottom-left execution console — live status, elapsed timer, per-node log
   lines derived from the polled execution, plus the AI Execution Doctor.
--------------------------------------------------------------------------- */

type LogTone = "info" | "success" | "error" | "running";
type LogLine = { time: string; text: string; tone: LogTone };

const toneCls: Record<LogTone, string> = {
  info: "text-[#A8AECF]",
  success: "text-[#2CF5A0]",
  error: "text-[#FF5C7A]",
  running: "text-[#7C5CFF]",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

function itemSuffix(items: unknown[] | null): string {
  if (!items || items.length === 0) return "";
  return ` (${items.length} item${items.length === 1 ? "" : "s"})`;
}

function ms(n: number | null | undefined): number {
  return Math.max(0, Math.round(n ?? 0));
}

export function RunPanel({
  execution,
  running,
  onClose,
  onRetry,
}: {
  execution: ExecutionDTO | null;
  running: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const [doctorOpen, setDoctorOpen] = React.useState(false);
  const [doctorLoading, setDoctorLoading] = React.useState(false);
  const [doctorText, setDoctorText] = React.useState<string | null>(null);
  const [doctorError, setDoctorError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  /* live elapsed timer */
  React.useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [running]);

  /* derived log lines */
  const logs = React.useMemo<LogLine[]>(() => {
    if (!execution) return [];
    const lines: LogLine[] = [
      {
        time: fmtTime(execution.startedAt),
        text: `Execution started · mode ${execution.mode}`,
        tone: "info",
      },
    ];
    const runs = [...(execution.nodeRuns ?? [])].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
    for (const r of runs) {
      const time = fmtTime(r.startedAt);
      if (r.status === "running") {
        lines.push({ time, text: `${r.nodeName} is running…`, tone: "running" });
      } else if (r.status === "success") {
        lines.push({
          time,
          text: `${r.nodeName} finished in ${ms(r.durationMs)}ms${itemSuffix(r.output)}`,
          tone: "success",
        });
      } else if (r.status === "error") {
        lines.push({
          time,
          text: `${r.nodeName} failed after ${ms(r.durationMs)}ms${r.error ? ` — ${r.error}` : ""}`,
          tone: "error",
        });
      } else {
        lines.push({ time, text: `${r.nodeName} canceled`, tone: "info" });
      }
    }
    if (execution.status !== "running") {
      const time = fmtTime(execution.finishedAt ?? execution.startedAt);
      if (execution.status === "success") {
        lines.push({
          time,
          text: `Workflow finished in ${formatDuration(execution.durationMs ?? 0)}`,
          tone: "success",
        });
      } else if (execution.status === "error") {
        lines.push({
          time,
          text: `Workflow failed${execution.error ? ` — ${execution.error}` : ""}`,
          tone: "error",
        });
      } else {
        lines.push({ time, text: "Workflow canceled", tone: "info" });
      }
    }
    return lines;
  }, [execution]);

  /* autoscroll */
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, collapsed]);

  const askDoctor = async () => {
    if (!execution || doctorLoading) return;
    if (doctorText) return; // already diagnosed
    setDoctorLoading(true);
    setDoctorError(null);
    try {
      const { diagnosis } = await aiExecutionDoctor(execution.id);
      setDoctorText(diagnosis);
    } catch (err) {
      setDoctorError((err as Error).message);
    } finally {
      setDoctorLoading(false);
    }
  };

  if (!execution) return null;

  const elapsed = running
    ? now - new Date(execution.startedAt).getTime()
    : (execution.durationMs ?? 0);
  const finished = !running && execution.status !== "running";

  return (
    <motion.div
      data-floating=""
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      className="glass-strong absolute bottom-16 left-4 z-20 w-[340px] max-w-[calc(100%-2rem)] overflow-hidden rounded-xl"
      role="region"
      aria-label="Execution console"
    >
      {/* header */}
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-[#F2F4FF]/[0.06] px-3">
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6B7199]">
          Execution console
        </span>
        <StatusBadge status={execution.status} className="px-2 py-0 text-[10px]" />
        <span className="font-[family-name:var(--font-jetbrains)] text-[10px] text-[#A8AECF]">
          {formatDuration(elapsed)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand console" : "Collapse console"}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#6B7199] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
        >
          {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close console"
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#6B7199] transition-colors hover:bg-[#FF5C7A]/10 hover:text-[#FF5C7A] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#FF5C7A]/40"
        >
          <X size={13} />
        </button>
      </div>

      {!collapsed && (
        <div className="flex flex-col">
          {/* error banner */}
          {execution.error && (
            <div className="mx-3 mt-2 rounded-lg border border-[#FF5C7A]/25 bg-[#FF5C7A]/[0.08] px-3 py-2">
              <p className="break-words text-[11px] leading-4 text-[#FF5C7A]" role="alert">
                {execution.error}
              </p>
              <Popover
                open={doctorOpen}
                onOpenChange={(open) => {
                  setDoctorOpen(open);
                  if (open) void askDoctor();
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-[#FF6BD6]/35 bg-[#FF6BD6]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#FF6BD6] transition-colors hover:bg-[#FF6BD6]/[0.16] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#FF6BD6]/40"
                  >
                    <Stethoscope size={12} aria-hidden="true" />
                    Ask the Execution Doctor
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="w-[340px] rounded-xl border-[#FF6BD6]/30 bg-[#0A0C1A] p-0 shadow-[0_16px_48px_rgba(2,3,10,0.6)]"
                >
                  <div className="flex items-center gap-2 border-b border-[#FF6BD6]/20 px-3 py-2">
                    <Stethoscope size={13} className="text-[#FF6BD6]" aria-hidden="true" />
                    <span className="text-xs font-semibold text-[#F2F4FF]">Execution Doctor</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto px-3 py-2.5">
                    {doctorLoading ? (
                      <p className="flex items-center gap-2 text-[11px] text-[#FF6BD6]">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#FF6BD6]" />
                        Diagnosing the void…
                      </p>
                    ) : doctorError ? (
                      <p className="text-[11px] text-[#FF5C7A]" role="alert">
                        {doctorError}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap font-[family-name:var(--font-jetbrains)] text-[11px] leading-5 text-[#F2F4FF]">
                        {doctorText ?? "Describe the failure and ask for a diagnosis."}
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* log lines */}
          <div
            ref={scrollRef}
            className="max-h-64 overflow-y-auto px-3 py-2 font-[family-name:var(--font-jetbrains)] text-[10.5px] leading-5"
            aria-live="polite"
          >
            {logs.map((line, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-[#6B7199]">{line.time}</span>
                <span className={`min-w-0 break-words ${toneCls[line.tone]}`}>{line.text}</span>
              </div>
            ))}
          </div>

          {/* footer actions */}
          {finished && (
            <div className="flex items-center gap-2 border-t border-[#F2F4FF]/[0.06] px-3 py-2">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#7C5CFF]/30 bg-[#7C5CFF]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#A8AECF] transition-colors hover:bg-[#7C5CFF]/[0.18] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
              >
                <RotateCcw size={12} aria-hidden="true" />
                Retry run
              </button>
              <span className="ml-auto font-[family-name:var(--font-jetbrains)] text-[10px] text-[#6B7199]">
                {execution.id}
              </span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
