"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useApp, type AppView } from "@/lib/blissvoid/store";
import {
  seedIfNeeded,
  listWorkflows,
  useTemplate as summonTemplate,
  createWorkflow,
  aiBuildWorkflow,
  listTemplates,
} from "@/lib/blissvoid/api-client";
import { AuroraBackground } from "@/components/blissvoid/aurora";
import { LogoGlyph, LogoWordmark } from "@/components/blissvoid/logo";
import { CommandMenu } from "@/components/blissvoid/command-menu";
import { AiBuilderDialog } from "@/components/blissvoid/ai-builder";
import { LandingView } from "@/components/blissvoid/views/landing";
import { DashboardView } from "@/components/blissvoid/views/dashboard";
import { WorkflowsView } from "@/components/blissvoid/views/workflows";
import { ExecutionsView } from "@/components/blissvoid/views/executions";
import { CredentialsView } from "@/components/blissvoid/views/credentials";
import { TemplatesView } from "@/components/blissvoid/views/templates";
import { InsightsView } from "@/components/blissvoid/views/insights";
import { SettingsView } from "@/components/blissvoid/views/settings";
import { WorkflowEditor } from "@/components/blissvoid/editor/editor";
import {
  iconFor,
} from "@/components/blissvoid/editor/icon-map";
import {
  LayoutDashboard,
  Workflow as WorkflowIcon,
  Activity,
  KeyRound,
  LayoutGrid,
  LineChart,
  Settings,
  Sparkles,
  Plus,
  Rocket,
  Command as CommandIcon,
  Sun,
  Moon,
  Menu,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ---------------------------------------------------------------------------
   BLISSVOID — single-page application shell.
   Automate everything. Disappear into the work.
--------------------------------------------------------------------------- */

const NAV: { id: AppView; label: string; icon: string; hint: string }[] = [
  { id: "dashboard", label: "Home", icon: "LayoutDashboard", hint: "Your mission control" },
  { id: "workflows", label: "Workflows", icon: "Workflow", hint: "Every flow you own" },
  { id: "executions", label: "Executions", icon: "Activity", hint: "Live and past runs" },
  { id: "templates", label: "Templates", icon: "LayoutGrid", hint: "Summon a proven flow" },
  { id: "insights", label: "Insights", icon: "LineChart", hint: "Health and analytics" },
  { id: "credentials", label: "Credentials", icon: "KeyRound", hint: "The sealed vault" },
  { id: "settings", label: "Settings", icon: "Settings", hint: "Tune your void" },
];

function AppShell() {
  const app = useApp();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [seeding, setSeeding] = useState(true);

  /* Seed the void once on first entry */
  useEffect(() => {
    let cancelled = false;
    seedIfNeeded()
      .then((r) => {
        if (!cancelled && r.seeded) toast("The void has been seeded with demo magic", { icon: "🌌" });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSeeding(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const editing = app.editingWorkflowId !== null;

  const content = useMemo(() => {
    if (app.editingWorkflowId) {
      return <WorkflowEditor key={app.editingWorkflowId} workflowId={app.editingWorkflowId} />;
    }
    switch (app.appView) {
      case "dashboard":
        return <DashboardView />;
      case "workflows":
        return <WorkflowsView />;
      case "executions":
        return <ExecutionsView />;
      case "credentials":
        return <CredentialsView />;
      case "templates":
        return <TemplatesView />;
      case "insights":
        return <InsightsView />;
      case "settings":
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  }, [editing, app.appView, app.editingWorkflowId]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <AuroraBackground subtle={editing} />

      {/* ------------------------------ Top bar ------------------------------ */}
      <header className="glass-strong z-30 flex h-14 shrink-0 items-center gap-3 border-x-0 border-t-0 px-3 md:px-5">
        <button
          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-[#F2F4FF]/[0.06] focus-visible:outline-2 focus-visible:outline-[#7C5CFF]"
          onClick={() => (app.view === "app" ? app.goLanding() : app.enterApp("dashboard"))}
          aria-label="BLISSVOID home"
        >
          <LogoGlyph size={26} animate />
          <span className="hidden sm:inline-flex">
            <LogoWordmark size="sm" showGlyph={false} />
          </span>
        </button>

        {!editing && app.view === "app" && (
          <button
            onClick={() => setMobileNavOpen((v) => !v)}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition hover:bg-[#F2F4FF]/[0.06] md:hidden"
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X className="h-5 w-5" strokeWidth={1.5} /> : <Menu className="h-5 w-5" strokeWidth={1.5} />}
          </button>
        )}

        {app.view === "app" && (
          <div className="ml-auto hidden items-center gap-1.5 md:flex">
            <button
              onClick={() => app.setCommandOpen(true)}
              className="group flex h-9 items-center gap-2 rounded-full border border-[#F2F4FF]/10 bg-[#11142A]/70 px-3.5 text-sm text-[#6B7199] transition hover:border-[#7C5CFF]/40 hover:text-[#A8AECF]"
            >
              <CommandIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Search everything</span>
              <kbd className="rounded-md border border-[#F2F4FF]/10 bg-[#0A0C1A] px-1.5 py-0.5 font-mono text-[10px] text-[#6B7199]">
                ⌘K
              </kbd>
            </button>
            <IconBtn label="New workflow" onClick={() => app.setAiBuilderOpen(true)}>
              <Plus className="h-4.5 w-4.5" strokeWidth={1.5} />
            </IconBtn>
            <IconBtn
              label={app.theme === "dark" ? "Switch to light" : "Switch to dark"}
              onClick={app.toggleTheme}
            >
              {app.theme === "dark" ? (
                <Sun className="h-4.5 w-4.5" strokeWidth={1.5} />
              ) : (
                <Moon className="h-4.5 w-4.5" strokeWidth={1.5} />
              )}
            </IconBtn>
            <div
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-[#05060F]"
              style={{ background: "linear-gradient(135deg,#7C5CFF,#3DA9FF)" }}
              title="Operator — Owner"
            >
              OP
            </div>
          </div>
        )}
        {app.view === "landing" && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={app.toggleTheme}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition hover:bg-[#F2F4FF]/[0.06]"
              aria-label="Toggle theme"
            >
              {app.theme === "dark" ? <Sun className="h-4.5 w-4.5" strokeWidth={1.5} /> : <Moon className="h-4.5 w-4.5" strokeWidth={1.5} />}
            </button>
            <button
              onClick={() => app.enterApp("dashboard")}
              className="bg-bliss rounded-full px-4 py-2 text-sm font-semibold text-[#05060F] shadow-[0_0_24px_rgba(124,92,255,0.35)] transition hover:brightness-110"
            >
              Open app
            </button>
          </div>
        )}
      </header>

      {/* ------------------------------ Body ------------------------------ */}
      {app.view === "landing" ? (
        <main className="flex-1 overflow-y-auto">
          <LandingView />
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Sidebar (desktop) */}
          {!editing && (
            <nav
              className="hidden w-56 shrink-0 flex-col gap-1 border-r border-[#F2F4FF]/[0.06] bg-card/60 p-3 backdrop-blur-xl md:flex"
              aria-label="Primary"
            >
              {NAV.map((item) => {
                const Icon = iconFor(item.icon);
                const active = app.appView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => app.setAppView(item.id)}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-[#7C5CFF]",
                      active
                        ? "bg-[#11142A] text-[#F2F4FF] shadow-[inset_0_1px_0_rgba(242,244,255,0.06)] dark:bg-[#11142A] dark:text-[#F2F4FF]"
                        : "text-muted-foreground hover:bg-[#F2F4FF]/[0.045] hover:text-foreground"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full"
                        style={{ background: "linear-gradient(180deg,#7C5CFF,#2CF5D0)" }}
                      />
                    )}
                    <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.5} />
                    <span className="flex-1 font-medium">{item.label}</span>
                  </button>
                );
              })}

              <div className="mt-auto space-y-2 p-1">
                <button
                  onClick={() => app.setAiBuilderOpen(true)}
                  className="glass glow-hover flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-[#F2F4FF]"
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg"
                    style={{ background: "rgba(255,107,214,0.14)" }}
                  >
                    <Sparkles className="h-4 w-4 text-[#FF6BD6]" strokeWidth={1.5} />
                  </span>
                  <span className="flex-1">
                    <span className="block font-medium leading-tight">Build with AI</span>
                    <span className="block text-[11px] leading-tight text-[#6B7199]">Describe it. Done.</span>
                  </span>
                </button>
                <div className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-muted-foreground">
                  <Zap className="h-3.5 w-3.5 text-[#2CF5D0]" strokeWidth={1.5} />
                  {seeding ? "Syncing the void…" : "All systems nominal"}
                </div>
              </div>
            </nav>
          )}

          {/* Mobile nav drawer */}
          <AnimatePresence>
            {!editing && mobileNavOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-[#05060F]/70 backdrop-blur-sm md:hidden"
                onClick={() => setMobileNavOpen(false)}
              >
                <motion.nav
                  initial={{ x: 300 }}
                  animate={{ x: 0 }}
                  exit={{ x: 300 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="glass-strong absolute right-0 top-0 flex h-full w-64 flex-col gap-1 p-4 pt-16"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Mobile navigation"
                >
                  {NAV.map((item) => {
                    const Icon = iconFor(item.icon);
                    const active = app.appView === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          app.setAppView(item.id);
                          setMobileNavOpen(false);
                        }}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm",
                          active ? "bg-[#11142A] text-[#F2F4FF]" : "text-[#A8AECF]"
                        )}
                      >
                        <Icon className="h-4.5 w-4.5" strokeWidth={1.5} />
                        <span className="font-medium">{item.label}</span>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      app.setAiBuilderOpen(true);
                      setMobileNavOpen(false);
                    }}
                    className="glass mt-auto flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm text-[#F2F4FF]"
                  >
                    <Sparkles className="h-4 w-4 text-[#FF6BD6]" strokeWidth={1.5} />
                    Build with AI
                  </button>
                </motion.nav>
              </motion.div>
            )}
          </AnimatePresence>

          {/* View content */}
          <main className={cn("min-h-0 min-w-0 flex-1", !editing && "overflow-y-auto")}>
            {editing ? (
              content
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={app.appView}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="p-4 pb-10 md:p-6 md:pb-12"
                >
                  {content}
                </motion.div>
              </AnimatePresence>
            )}
          </main>
        </div>
      )}

      {/* Footer — sticky to the bottom, never overlapping */}
      <footer className="z-20 flex h-9 shrink-0 items-center justify-between border-t border-[#F2F4FF]/[0.06] bg-card/70 px-4 text-[11px] text-muted-foreground backdrop-blur-xl">
        <span className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2CF5A0] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2CF5A0]" />
          </span>
          BLISSVOID v1.0 — self-hosted instance
        </span>
        <span className="hidden sm:block">Automate everything. Disappear into the work.</span>
      </footer>

      {/* Global overlays */}
      <CommandMenu />
      <AiBuilderDialog />
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition hover:bg-[#F2F4FF]/[0.07] hover:text-[#F2F4FF] focus-visible:outline-2 focus-visible:outline-[#7C5CFF]"
    >
      {children}
    </button>
  );
}

export default function Page() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: false, retry: 1 },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <AppShell />
    </QueryClientProvider>
  );
}
