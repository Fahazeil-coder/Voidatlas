"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/lib/blissvoid/store";
import { aiBuildWorkflow, createWorkflow } from "@/lib/blissvoid/api-client";
import { toast } from "sonner";
import { Sparkles, Loader2, CornerDownLeft, Lightbulb } from "lucide-react";

/* ---------------------------------------------------------------------------
   Global AI Workflow Builder dialog — describe it, the void drafts the graph.
--------------------------------------------------------------------------- */

const EXAMPLES = [
  "When a new row is added to Google Sheets, summarize it with AI and post it in Slack",
  "Every morning at 9am fetch Hacker News, classify the top stories and email me a digest",
  "Watch GitHub issues, detect bug reports with AI and route urgent ones to Discord",
  "When a customer submits a support form, analyze sentiment and escalate angry messages",
];

export function AiBuilderDialog() {
  const app = useApp();
  const [prompt, setPrompt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const open = app.aiBuilderOpen;

  const close = () => {
    if (!busy) app.setAiBuilderOpen(false);
  };

  const build = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    const t = toast.loading("The void is drafting your workflow…");
    try {
      const r = await aiBuildWorkflow(p);
      toast.success(`“${r.workflow.name}” is ready — review it on the canvas`, { id: t });
      app.setAiBuilderOpen(false);
      setPrompt("");
      app.enterApp("workflows");
      app.openWorkflow(r.workflow.id);
    } catch (e) {
      toast.error((e as Error).message || "The void could not parse that. Try rephrasing.", { id: t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? close() : app.setAiBuilderOpen(true))}>
      <DialogContent className="glass-strong max-w-xl gap-0 overflow-hidden rounded-2xl border-[#F2F4FF]/10 p-0">
        {/* Warm aurora header */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
          style={{
            background:
              "radial-gradient(80% 120% at 50% -20%, rgba(255,107,214,0.18), rgba(124,92,255,0.12) 45%, transparent 75%)",
          }}
        />
        <DialogHeader className="relative px-6 pt-6">
          <DialogTitle className="flex items-center gap-2.5 font-[family-name:var(--font-space)] text-lg font-bold text-[#F2F4FF]">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "linear-gradient(135deg,rgba(255,107,214,0.18),rgba(124,92,255,0.18))" }}
            >
              <Sparkles className="h-4.5 w-4.5 text-[#FF6BD6]" strokeWidth={1.5} />
            </span>
            Build with AI
          </DialogTitle>
          <DialogDescription className="text-sm text-[#A8AECF]">
            Describe your workflow in plain English. BLISSVOID drafts the nodes, connections and
            parameters — you review, tweak and launch.
          </DialogDescription>
        </DialogHeader>

        <div className="relative space-y-4 px-6 pb-6 pt-4">
          <div className="glass group flex items-end gap-2 rounded-2xl p-2.5 focus-within:border-[#FF6BD6]/40">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                  e.preventDefault();
                  build();
                }
              }}
              rows={3}
              disabled={busy}
              placeholder="When a new lead arrives, classify it with AI and post hot ones to Slack…"
              className="max-h-44 min-h-[72px] w-full resize-none bg-transparent px-2 py-1.5 text-sm text-[#F2F4FF] placeholder:text-[#6B7199] focus-visible:outline-none disabled:opacity-60"
              aria-label="Describe your workflow"
            />
            <button
              onClick={build}
              disabled={busy || !prompt.trim()}
              className="mb-0.5 inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-[#05060F] transition enabled:hover:brightness-110 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#FF6BD6,#7C5CFF)" }}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <CornerDownLeft className="h-4 w-4" strokeWidth={2} />
              )}
              Build
            </button>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7199]">
              <Lightbulb className="h-3.5 w-3.5 text-[#FFC857]" strokeWidth={1.5} />
              Try one of these
            </p>
            <div className="flex flex-col gap-1.5">
              {EXAMPLES.map((ex) => (
                <motion.button
                  key={ex}
                  whileHover={{ x: 3 }}
                  transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  onClick={() => setPrompt(ex)}
                  disabled={busy}
                  className="rounded-xl border border-[#F2F4FF]/[0.07] bg-[#11142A]/60 px-3.5 py-2.5 text-left text-[13px] text-[#A8AECF] transition hover:border-[#FF6BD6]/30 hover:text-[#F2F4FF] disabled:opacity-50"
                >
                  {ex}
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
