"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  MousePointerClick,
  Rocket,
  Server,
  ShieldCheck,
  Slack,
  Sparkles,
  Webhook,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { LogoHero, LogoWordmark } from "@/components/blissvoid/logo";
import { useApp } from "@/lib/blissvoid/store";

/* ---------------------------------------------------------------------------
   LandingView — the first screen anyone ever sees. Pure cinema.
--------------------------------------------------------------------------- */

const FEATURES: { icon: LucideIcon; title: string; copy: string; accent: string }[] = [
  {
    icon: Sparkles,
    title: "AI-native builder",
    copy: "Describe it. The void drafts the graph, you approve it.",
    accent: "#FF6BD6",
  },
  {
    icon: MousePointerClick,
    title: "Visual canvas",
    copy: "A 300-node canvas that stays under 100ms.",
    accent: "#3DA9FF",
  },
  {
    icon: ShieldCheck,
    title: "Durable executions",
    copy: "Retries, resumes and observability built in.",
    accent: "#2CF5A0",
  },
  {
    icon: Server,
    title: "Self-host first",
    copy: "Your void, your hardware. Docker up and gone.",
    accent: "#7C5CFF",
  },
];

const STATS: { value: string; label: string }[] = [
  { value: "2060", label: "ready for the future" },
  { value: "<100ms", label: "editor interactions" },
  { value: "99.99%", label: "durable execution uptime" },
  { value: "AES-256", label: "secrets at rest" },
];

/* ------------------------------ Demo strip ------------------------------ */

function DemoChip({
  icon: Icon,
  kind,
  label,
  accent,
  badge,
}: {
  icon: LucideIcon;
  kind: string;
  label: string;
  accent: string;
  badge: string;
}) {
  return (
    <div className="glass-strong relative flex w-32 shrink-0 flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-center">
      <span
        className="absolute left-2.5 top-2.5 h-1.5 w-1.5 rounded-full"
        style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
      />
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#F2F4FF]/10"
        style={{ background: `${accent}1f` }}
      >
        <Icon className="h-4 w-4" style={{ color: accent }} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p className="text-xs font-semibold text-[#F2F4FF]">{label}</p>
      <p className="font-mono text-[10px] text-[#6B7199]">{badge}</p>
      <p className="absolute -top-2 right-2 rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2 py-px text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6B7199]">
        {kind}
      </p>
    </div>
  );
}

function FlowConnector({ gradId, delay }: { gradId: string; delay: number }) {
  const path = "M3 20 H53";
  return (
    <svg
      className="h-10 w-14 shrink-0 self-center"
      viewBox="0 0 56 40"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#7C5CFF" />
          <stop offset="0.5" stopColor="#3DA9FF" />
          <stop offset="1" stopColor="#2CF5D0" />
        </linearGradient>
      </defs>
      <path
        d={path}
        stroke={`url(#${gradId})`}
        strokeWidth="2"
        strokeLinecap="round"
        className="edge-flowing"
      />
      <circle r="3" fill="#F2F4FF">
        <animateMotion dur="1.9s" begin={`${delay}s`} repeatCount="indefinite" path={path} />
      </circle>
    </svg>
  );
}

function DemoStrip() {
  return (
    <div className="glass relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl p-5 md:p-6">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-30" aria-hidden="true" />
      <div className="relative mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#6B7199]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2CF5A0] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2CF5A0]" />
          </span>
          <span className="font-mono">live run · morning-digest</span>
        </div>
        <span className="rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2.5 py-0.5 font-mono text-[11px] text-[#A8AECF]">
          812ms
        </span>
      </div>
      <div className="relative overflow-x-auto">
        <div className="mx-auto flex min-w-[520px] items-center justify-center">
          <DemoChip icon={Webhook} kind="Trigger" label="Webhook" accent="#2CF5D0" badge="POST /hooks/inbox" />
          <FlowConnector gradId="demo-flow-a" delay={0} />
          <DemoChip icon={Sparkles} kind="AI" label="Summarizer" accent="#FF6BD6" badge="3 items" />
          <FlowConnector gradId="demo-flow-b" delay={0.65} />
          <DemoChip icon={Slack} kind="Action" label="Slack" accent="#3DA9FF" badge="#automations" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Landing view ------------------------------ */

export function LandingView() {
  const enterApp = useApp((s) => s.enterApp);
  const reduce = useReducedMotion();

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
  };
  const item: Variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.25 } } }
    : {
        hidden: { opacity: 0, y: 16 },
        show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
      };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      {/* ------------------------------- Hero ------------------------------- */}
      <section className="relative flex min-h-[calc(100dvh-104px)] flex-col items-center justify-center px-2 py-10 text-center">
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col items-center space-y-5">
          <motion.div variants={item}>
            <LogoHero size={140} />
          </motion.div>

          <motion.div variants={item}>
            <LogoWordmark size="lg" showGlyph={false} />
          </motion.div>

          <motion.h1
            variants={item}
            className="max-w-3xl font-[family-name:var(--font-space)] text-3xl font-bold leading-tight tracking-wide text-[#F2F4FF] sm:text-4xl md:text-5xl"
          >
            Automate everything.{" "}
            <span className="text-bliss">Disappear into the work.</span>
          </motion.h1>

          <motion.p variants={item} className="max-w-xl text-sm leading-relaxed text-[#A8AECF] sm:text-base">
            The AI-native workflow platform from the future. Describe any workflow in
            plain English — BLISSVOID builds, runs and heals it for you.
          </motion.p>

          <motion.div variants={item} className="flex flex-wrap items-center justify-center gap-3">
            <motion.button
              type="button"
              whileHover={reduce ? undefined : { scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              onClick={() => enterApp("dashboard")}
              className="inline-flex items-center gap-2 rounded-full bg-bliss px-6 py-3 text-sm font-semibold text-[#05060F] shadow-[0_0_28px_rgba(124,92,255,0.4)] transition hover:brightness-110"
            >
              <Rocket className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Enter the Void
            </motion.button>
            <motion.button
              type="button"
              whileHover={reduce ? undefined : { scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              onClick={() => enterApp("templates")}
              className="glass glow-hover inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-[#F2F4FF]"
            >
              <WorkflowIcon className="h-4 w-4 text-[#2CF5D0]" strokeWidth={1.5} aria-hidden="true" />
              Browse templates
            </motion.button>
          </motion.div>

          <motion.div variants={item} className="w-full pt-2">
            <DemoStrip />
          </motion.div>
        </motion.div>
      </section>

      {/* ---------------------------- Feature grid ---------------------------- */}
      <section aria-label="Features" className="pt-6">
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.title}
              variants={item}
              whileHover={reduce ? undefined : { y: -2 }}
              className="glass glow-hover rounded-2xl p-5"
            >
              <div
                className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-[#F2F4FF]/10"
                style={{ background: `${f.accent}1a` }}
              >
                <f.icon className="h-5 w-5" style={{ color: f.accent }} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <h3 className="font-[family-name:var(--font-space)] text-base font-semibold text-[#F2F4FF]">
                {f.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#A8AECF]">{f.copy}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ------------------------------ Stats band ----------------------------- */}
      <section aria-label="Stats" className="pb-6 pt-2">
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="glass grid grid-cols-2 gap-px overflow-hidden rounded-2xl md:grid-cols-4"
        >
          {STATS.map((s) => (
            <motion.div key={s.label} variants={item} className="flex flex-col items-center gap-1 px-4 py-7 text-center">
              <p className="font-[family-name:var(--font-space)] text-2xl font-bold text-bliss md:text-3xl">
                {s.value}
              </p>
              <p className="text-xs text-[#6B7199]">{s.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ------------------------------ CTA row ------------------------------- */}
      <section aria-label="Audience" className="pb-8 text-center">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-xs tracking-wide text-[#6B7199]"
        >
          Built for solo founders, freelancers and the engineers who ship.
        </motion.p>
      </section>
    </div>
  );
}
