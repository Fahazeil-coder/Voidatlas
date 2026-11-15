"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useApp, type AppView } from "@/lib/blissvoid/store";
import { listWorkflows, listTemplates, createWorkflow, useTemplate as summonTemplate } from "@/lib/blissvoid/api-client";
import { iconFor } from "@/components/blissvoid/editor/icon-map";
import { toast } from "sonner";
import {
  Sparkles,
  Plus,
  Sun,
  Moon,
  Rocket,
  Play,
  Search,
} from "lucide-react";

/* ---------------------------------------------------------------------------
   Command palette — Ctrl/Cmd+K. Jump anywhere, run anything.
--------------------------------------------------------------------------- */

const VIEWS: { id: AppView; label: string; icon: string }[] = [
  { id: "dashboard", label: "Go to Home", icon: "LayoutDashboard" },
  { id: "workflows", label: "Go to Workflows", icon: "Workflow" },
  { id: "executions", label: "Go to Executions", icon: "Activity" },
  { id: "templates", label: "Go to Templates", icon: "LayoutGrid" },
  { id: "insights", label: "Go to Insights", icon: "LineChart" },
  { id: "credentials", label: "Go to Credentials", icon: "KeyRound" },
  { id: "settings", label: "Go to Settings", icon: "Settings" },
];

export function CommandMenu() {
  const app = useApp();
  const { data: wfData } = useQuery({ queryKey: ["workflows"], queryFn: listWorkflows });
  const { data: tplData } = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const workflows = wfData?.workflows ?? [];
  const templates = tplData?.templates ?? [];

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        app.setCommandOpen(!app.commandOpen);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [app]);

  const run = (fn: () => void) => {
    app.setCommandOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={app.commandOpen}
      onOpenChange={app.setCommandOpen}
      className="border-[#F2F4FF]/10 bg-[#0A0C1A]/95 backdrop-blur-2xl"
    >
      <CommandInput placeholder="Search workflows, templates, actions… the void is listening" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty className="py-8 text-center text-sm text-[#6B7199]">
          Nothing in the void matches that. Try another spell.
        </CommandEmpty>

        <CommandGroup heading="Actions" className="[&_[cmdk-group-heading]]:text-[#6B7199]">
          <CommandItem
            onSelect={() =>
              run(() => {
                app.setAiBuilderOpen(true);
              })
            }
            className="text-[#F2F4FF] aria-selected:bg-[#11142A]"
          >
            <Sparkles className="mr-2.5 h-4 w-4 text-[#FF6BD6]" strokeWidth={1.5} />
            Build a workflow with AI
            <CommandShortcut className="text-[#6B7199]">describe</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                app.enterApp("dashboard");
                app.setAiBuilderOpen(true);
              })
            }
            className="text-[#F2F4FF] aria-selected:bg-[#11142A]"
          >
            <Plus className="mr-2.5 h-4 w-4 text-[#2CF5D0]" strokeWidth={1.5} />
            New blank workflow
            <CommandShortcut className="text-[#6B7199]">editor</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => app.toggleTheme())}
            className="text-[#F2F4FF] aria-selected:bg-[#11142A]"
          >
            {app.theme === "dark" ? (
              <Sun className="mr-2.5 h-4 w-4 text-[#FFC857]" strokeWidth={1.5} />
            ) : (
              <Moon className="mr-2.5 h-4 w-4 text-[#7C5CFF]" strokeWidth={1.5} />
            )}
            Switch to {app.theme === "dark" ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>

        <CommandSeparator className="bg-[#F2F4FF]/[0.07]" />

        <CommandGroup heading="Navigate" className="[&_[cmdk-group-heading]]:text-[#6B7199]">
          {VIEWS.map((v) => {
            const Icon = iconFor(v.icon);
            return (
              <CommandItem
                key={v.id}
                onSelect={() => run(() => app.setAppView(v.id))}
                className="text-[#F2F4FF] aria-selected:bg-[#11142A]"
              >
                <Icon className="mr-2.5 h-4 w-4 text-[#3DA9FF]" strokeWidth={1.5} />
                {v.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {workflows.length > 0 && (
          <>
            <CommandSeparator className="bg-[#F2F4FF]/[0.07]" />
            <CommandGroup heading="Workflows" className="[&_[cmdk-group-heading]]:text-[#6B7199]">
              {workflows.slice(0, 7).map((w) => (
                <CommandItem
                  key={w.id}
                  value={`workflow ${w.name}`}
                  onSelect={() =>
                    run(() => {
                      app.enterApp("workflows");
                      app.openWorkflow(w.id);
                    })
                  }
                  className="text-[#F2F4FF] aria-selected:bg-[#11142A]"
                >
                  <Rocket className="mr-2.5 h-4 w-4 text-[#7C5CFF]" strokeWidth={1.5} />
                  {w.name}
                  <span className="ml-auto text-[11px] text-[#6B7199]">{w.nodes.length} nodes</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {templates.length > 0 && (
          <>
            <CommandSeparator className="bg-[#F2F4FF]/[0.07]" />
            <CommandGroup heading="Summon a template" className="[&_[cmdk-group-heading]]:text-[#6B7199]">
              {templates.slice(0, 6).map((t) => (
                <CommandItem
                  key={t.id}
                  value={`template ${t.name} ${t.category}`}
                  onSelect={() =>
                    run(() => {
                      app.setAppView("workflows");
                      toast.loading(`Summoning “${t.name}”…`, { id: "tpl" });
                      summonTemplate(t.id)
                        .then((r) => {
                          toast.success(`Template summoned — ${r.workflow.name}`, { id: "tpl" });
                          app.openWorkflow(r.workflow.id);
                        })
                        .catch((e: Error) => toast.error(e.message, { id: "tpl" }));
                    })
                  }
                  className="text-[#F2F4FF] aria-selected:bg-[#11142A]"
                >
                  <Play className="mr-2.5 h-4 w-4 text-[#2CF5D0]" strokeWidth={1.5} />
                  Use template: {t.name}
                  <span className="ml-auto text-[11px] text-[#6B7199]">{t.category}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
