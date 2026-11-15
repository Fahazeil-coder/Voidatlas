"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, CircleAlert, Loader2, XCircle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutionStatus } from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   Shared BLISSVOID UI atoms.
--------------------------------------------------------------------------- */

export function StatusBadge({
  status,
  className,
}: {
  status: ExecutionStatus | string;
  className?: string;
}) {
  const map: Record<
    string,
    { label: string; icon: React.ReactNode; cls: string }
  > = {
    success: {
      label: "Success",
      icon: <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
      cls: "text-[#2CF5A0] bg-[#2CF5A0]/10 border-[#2CF5A0]/25",
    },
    error: {
      label: "Error",
      icon: <XCircle className="h-3.5 w-3.5" strokeWidth={1.5} />,
      cls: "text-[#FF5C7A] bg-[#FF5C7A]/10 border-[#FF5C7A]/25",
    },
    running: {
      label: "Running",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />,
      cls: "text-[#7C5CFF] bg-[#7C5CFF]/10 border-[#7C5CFF]/25",
    },
    canceled: {
      label: "Canceled",
      icon: <Ban className="h-3.5 w-3.5" strokeWidth={1.5} />,
      cls: "text-[#A8AECF] bg-[#A8AECF]/10 border-[#A8AECF]/20",
    },
    waiting: {
      label: "Waiting",
      icon: <CircleAlert className="h-3.5 w-3.5" strokeWidth={1.5} />,
      cls: "text-[#FFC857] bg-[#FFC857]/10 border-[#FFC857]/25",
    },
    active: {
      label: "Active",
      icon: <span className="inline-block h-2 w-2 rounded-full bg-[#2CF5A0]" />,
      cls: "text-[#2CF5A0] bg-[#2CF5A0]/10 border-[#2CF5A0]/25",
    },
    inactive: {
      label: "Inactive",
      icon: <span className="inline-block h-2 w-2 rounded-full bg-[#6B7199]" />,
      cls: "text-[#A8AECF] bg-[#A8AECF]/10 border-[#A8AECF]/20",
    },
  };
  const meta = map[status] ?? map.inactive;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        meta.cls,
        className
      )}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-[#6B7199]">
            {eyebrow}
          </p>
        )}
        <h1 className="font-[family-name:var(--font-space)] text-2xl font-bold text-[#F2F4FF] md:text-[1.7rem]">
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-[#A8AECF]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
      className="glass flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
    >
      <div className="relative mb-5">
        <div
          className="absolute inset-0 rounded-full blur-2xl"
          style={{ background: "radial-gradient(circle,rgba(124,92,255,0.28),transparent 70%)" }}
        />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[#F2F4FF]/10 bg-[#11142A] text-[#7C5CFF]">
          {icon}
        </div>
      </div>
      <h3 className="font-[family-name:var(--font-space)] text-lg font-semibold text-[#F2F4FF]">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm text-[#A8AECF]">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

export function StatChip({
  label,
  value,
  sub,
  accent = "#7C5CFF",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="glass glow-hover relative overflow-hidden rounded-xl p-4">
      <div
        className="absolute -right-8 -top-8 h-16 w-16 rounded-full blur-2xl"
        style={{ background: `${accent}14` }}
      />
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#6B7199]">{label}</p>
      <p className="mt-1.5 font-[family-name:var(--font-space)] text-2xl font-bold text-[#F2F4FF]">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-[#6B7199]">{sub}</p>}
    </div>
  );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
