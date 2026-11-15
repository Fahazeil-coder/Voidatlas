"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Copy,
  Pin,
  PinOff,
  Play,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { renderIcon } from "./icon-map";
import { ParamControls } from "./param-controls";
import { timeAgo } from "@/components/blissvoid/shared";
import { aiNodeAssistant } from "@/lib/blissvoid/api-client";
import { CATEGORY_META } from "@/lib/blissvoid/node-catalog";
import type {
  NodeDefinition,
  NodeRunDTO,
  WorkflowDTO,
  WorkflowNode,
} from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   Right dock — inspector for the selected node (Parameters / Input / Output /
   Settings / Notes + Ask AI) or workflow settings when nothing is selected.
--------------------------------------------------------------------------- */

export interface InspectorProps {
  node: WorkflowNode | null;
  def: NodeDefinition | null;
  nodeRun: NodeRunDTO | null;
  workflow: WorkflowDTO;
  tab: string;
  onTabChange: (tab: string) => void;
  onPatchNode: (id: string, patch: Partial<WorkflowNode>) => void;
  onPinData: (id: string, data: unknown[] | null) => void;
  onTestNode: (id: string) => void;
  running: boolean;
  onUpdateWorkflow: (patch: {
    name?: string;
    description?: string | null;
    tags?: string[];
    active?: boolean;
  }) => void;
  onDeleteWorkflow: () => void;
  isNarrow: boolean;
  onClose: () => void;
}

/* ------------------------------ JSON blocks ------------------------------- */

function colorizeJson(json: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) parts.push(<span key={k++}>{json.slice(last, m.index)}</span>);
    parts.push(
      <span key={k++} className="text-[#7C5CFF]">
        {m[1]}
      </span>
    );
    parts.push(<span key={k++}>{m[2]}</span>);
    last = m.index + m[0].length;
  }
  if (last < json.length) parts.push(<span key={k++}>{json.slice(last)}</span>);
  return parts;
}

function JsonBlock({ value, maxHeight = "240px" }: { value: unknown; maxHeight?: string }) {
  const json = React.useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? "null";
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <pre
      className="overflow-auto rounded-lg border border-[#F2F4FF]/[0.07] bg-[#0A0C1A]/80 p-2.5 font-[family-name:var(--font-jetbrains)] text-[11px] leading-5 text-[#A8AECF]"
      style={{ maxHeight }}
    >
      {colorizeJson(json)}
    </pre>
  );
}

const MAX_ITEMS = 20;

function ItemsView({ items, emptyHint }: { items: unknown[] | null; emptyHint: string }) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#F2F4FF]/10 px-4 py-6 text-center text-xs text-[#6B7199]">
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[#6B7199]">
        {items.length} item{items.length === 1 ? "" : "s"}
        {items.length > MAX_ITEMS ? ` · showing first ${MAX_ITEMS}` : ""}
      </p>
      {items.slice(0, MAX_ITEMS).map((item, i) => (
        <div key={i}>
          <div className="mb-1 font-[family-name:var(--font-jetbrains)] text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6B7199]">
            item {i}
          </div>
          <JsonBlock value={item} maxHeight="180px" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Ask AI dialog ----------------------------- */

function AskAiDialog({
  open,
  onOpenChange,
  node,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: WorkflowNode;
}) {
  const [task, setTask] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTask("");
      setResult(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const submit = async () => {
    if (!task.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await aiNodeAssistant({
        task: task.trim(),
        context: JSON.stringify({ nodeType: node.type, parameters: node.parameters }),
      });
      setResult(res.result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-[family-name:var(--font-space)]">
            <Wand2 size={15} className="text-[#FF6BD6]" aria-hidden="true" />
            Ask AI — {node.name}
          </DialogTitle>
          <DialogDescription className="text-[#A8AECF]">
            The assistant knows this node&apos;s type and parameters.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          disabled={loading}
          aria-label="Ask the AI assistant"
          placeholder="What do you need? (e.g. write an expression to extract the domain from an email)"
          className="min-h-[72px] rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] caret-[#7C5CFF] placeholder:text-[#6B7199] focus-visible:ring-[#FF6BD6]/40 focus-visible:border-[#FF6BD6]/60"
        />

        {loading && (
          <p className="flex items-center gap-2 text-xs text-[#FF6BD6]">
            <Sparkles size={13} className="animate-pulse" aria-hidden="true" />
            Thinking…
          </p>
        )}
        {error && (
          <p className="text-xs text-[#FF5C7A]" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div className="flex flex-col gap-2">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[#FF6BD6]/20 bg-[#05060F]/70 p-3 font-[family-name:var(--font-jetbrains)] text-[11px] leading-5 text-[#F2F4FF]">
              {result}
            </pre>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(result)
                  .then(() => toast.success("Copied to clipboard"))
                  .catch(() => toast.error("Could not copy"));
              }}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-[#F2F4FF]/15 px-2.5 py-1 text-[11px] font-medium text-[#A8AECF] transition-colors hover:border-[#7C5CFF]/40 hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
            >
              <Copy size={12} aria-hidden="true" />
              Copy
            </button>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading || !task.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bliss px-3.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/50"
          >
            <Sparkles size={13} aria-hidden="true" />
            {loading ? "Thinking…" : "Ask"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- workflow settings --------------------------- */

function WorkflowSettings({
  workflow,
  onUpdateWorkflow,
  onDeleteWorkflow,
  isNarrow,
  onClose,
}: Pick<InspectorProps, "workflow" | "onUpdateWorkflow" | "onDeleteWorkflow" | "isNarrow" | "onClose">) {
  const [name, setName] = React.useState(workflow.name);
  const [description, setDescription] = React.useState(workflow.description ?? "");
  const [tags, setTags] = React.useState(workflow.tags.join(", "));
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    setName(workflow.name);
    setDescription(workflow.description ?? "");
    setTags(workflow.tags.join(", "));
  }, [workflow.id, workflow.name, workflow.description, workflow.tags]);

  const commitName = () => {
    const next = name.trim() || "Untitled workflow";
    setName(next);
    if (next !== workflow.name) onUpdateWorkflow({ name: next });
  };
  const commitDescription = () => {
    if ((description.trim() || null) !== workflow.description) {
      onUpdateWorkflow({ description: description.trim() || null });
    }
  };
  const commitTags = () => {
    const next = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (next.join(",") !== workflow.tags.join(",")) onUpdateWorkflow({ tags: next });
  };

  const fieldLabel = "text-xs font-medium uppercase tracking-wider text-[#A8AECF]";
  const fieldCls =
    "h-8 rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] placeholder:text-[#6B7199] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#F2F4FF]/[0.06] px-3">
        <Settings2 size={14} className="text-[#7C5CFF]" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F2F4FF]">
          Workflow settings
        </span>
        <span className="flex-1" />
        {isNarrow && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#6B7199] hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wf-name" className={fieldLabel}>
              Name
            </label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className={fieldCls}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wf-desc" className={fieldLabel}>
              Description
            </label>
            <Textarea
              id="wf-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitDescription}
              rows={3}
              placeholder="What does this workflow do?"
              className="min-h-[64px] rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] placeholder:text-[#6B7199] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wf-tags" className={fieldLabel}>
              Tags
            </label>
            <Input
              id="wf-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={commitTags}
              placeholder="ops, sales, ai"
              className={fieldCls}
            />
            {workflow.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {workflow.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-[#7C5CFF]/25 bg-[#7C5CFF]/[0.08] px-2 py-0.5 text-[10px] text-[#A8AECF]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#F2F4FF]/10 bg-[#11142A]/70 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-[#F2F4FF]">Active</p>
              <p className="text-[10px] text-[#6B7199]">Triggers run automatically when active.</p>
            </div>
            <Switch
              checked={workflow.active}
              onCheckedChange={(v) => onUpdateWorkflow({ active: v })}
              aria-label="Toggle workflow active"
            />
          </div>

          <div className="rounded-lg border border-[#F2F4FF]/[0.07] bg-[#0A0C1A]/60 p-3 text-[11px] leading-5 text-[#6B7199]">
            <p>Updated {timeAgo(workflow.updatedAt)}</p>
            <p>
              {workflow.nodes.length} node{workflow.nodes.length === 1 ? "" : "s"} ·{" "}
              {workflow.edges.length} connection{workflow.edges.length === 1 ? "" : "s"}
              {workflow.executionCount != null ? ` · ${workflow.executionCount} runs` : ""}
            </p>
          </div>

          {/* danger zone */}
          <div className="rounded-lg border border-[#FF5C7A]/25 bg-[#FF5C7A]/[0.05] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#FF5C7A]">
              <AlertTriangle size={13} aria-hidden="true" />
              Danger zone
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[#A8AECF]">
              Deleting a workflow removes its nodes and execution history. This cannot be undone.
            </p>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-[#FF5C7A]/40 bg-[#FF5C7A]/[0.1] px-2.5 py-1.5 text-[11px] font-medium text-[#FF5C7A] transition-colors hover:bg-[#FF5C7A]/[0.2] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#FF5C7A]/40"
            >
              <Trash2 size={12} aria-hidden="true" />
              Delete workflow
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="border-[#FF5C7A]/30 bg-[#0A0C1A] text-[#F2F4FF]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-[family-name:var(--font-space)]">
              Delete “{workflow.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#A8AECF]">
              This permanently removes the workflow, its nodes and execution history. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#F2F4FF]/15 bg-transparent text-[#A8AECF] hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteWorkflow}
              className="bg-[#FF5C7A] text-white hover:bg-[#FF5C7A]/85"
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------------- inspector ------------------------------- */

export function Inspector({
  node,
  def,
  nodeRun,
  workflow,
  tab,
  onTabChange,
  onPatchNode,
  onPinData,
  onTestNode,
  running,
  onUpdateWorkflow,
  onDeleteWorkflow,
  isNarrow,
  onClose,
}: InspectorProps) {
  const [aiOpen, setAiOpen] = React.useState(false);

  const sampleItem = React.useMemo(() => {
    const raw =
      nodeRun?.input && nodeRun.input.length > 0
        ? nodeRun.input[0]
        : node?.pinnedData && node.pinnedData.length > 0
          ? node.pinnedData[0]
          : null;
    if (raw && typeof raw === "object" && "json" in (raw as Record<string, unknown>)) {
      return (raw as { json: unknown }).json;
    }
    return raw;
  }, [nodeRun, node]);

  const handleParamChange = (key: string, value: unknown) => {
    if (!node) return;
    onPatchNode(node.id, { parameters: { ...node.parameters, [key]: value } });
  };

  const handleSettingsChange = (patch: Partial<NonNullable<WorkflowNode["settings"]>>) => {
    if (!node) return;
    onPatchNode(node.id, { settings: { ...node.settings, ...patch } });
  };

  const fieldLabel = "text-xs font-medium uppercase tracking-wider text-[#A8AECF]";

  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "flex w-[340px] shrink-0 flex-col border-l border-[#F2F4FF]/[0.06] bg-[#0A0C1A]/80 backdrop-blur-xl",
        isNarrow && "absolute inset-y-0 right-0 z-30 h-full shadow-2xl shadow-[#05060F]"
      )}
    >
      {!node ? (
        <WorkflowSettings
          workflow={workflow}
          onUpdateWorkflow={onUpdateWorkflow}
          onDeleteWorkflow={onDeleteWorkflow}
          isNarrow={isNarrow}
          onClose={onClose}
        />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/* node header */}
          <div className="shrink-0 border-b border-[#F2F4FF]/[0.06] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: `${def?.accent ?? "#7C5CFF"}2E`,
                  color: def?.accent ?? "#7C5CFF",
                }}
              >
                {renderIcon(def?.icon ?? "CircleDashed", {
                  size: 13,
                  strokeWidth: 1.8,
                  "aria-hidden": true,
                })}
              </span>
              <input
                value={node.name}
                onChange={(e) => onPatchNode(node.id, { name: e.target.value })}
                aria-label="Node name"
                className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium text-[#F2F4FF] outline-none transition-colors hover:border-[#F2F4FF]/10 focus:border-[#7C5CFF]/60 focus:ring-[3px] focus:ring-[#7C5CFF]/25"
              />
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                aria-label="Ask AI about this node"
                title="Ask AI about this node"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#FF6BD6]/30 bg-[#FF6BD6]/[0.08] text-[#FF6BD6] transition-colors hover:bg-[#FF6BD6]/[0.18] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#FF6BD6]/40"
              >
                <Wand2 size={13} aria-hidden="true" />
              </button>
              {isNarrow && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close inspector"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7199] hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 pl-1">
              <span className="font-[family-name:var(--font-jetbrains)] text-[10px] text-[#6B7199]">
                {node.type}
              </span>
              {def && (
                <span
                  className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em]"
                  style={{
                    color: CATEGORY_META[def.category]?.accent ?? "#A8AECF",
                    background: `${CATEGORY_META[def.category]?.accent ?? "#A8AECF"}14`,
                  }}
                >
                  {CATEGORY_META[def.category]?.label ?? def.category}
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => onTestNode(node.id)}
                disabled={running}
                title="Runs the full workflow"
                className="inline-flex items-center gap-1 rounded-md border border-[#2CF5D0]/30 bg-[#2CF5D0]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#2CF5D0] transition-colors hover:bg-[#2CF5D0]/[0.16] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#2CF5D0]/40"
              >
                <Play size={10} aria-hidden="true" />
                Test this node
              </button>
            </div>
          </div>

          {/* tabs */}
          <Tabs value={tab} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="shrink-0 border-b border-[#F2F4FF]/[0.06] px-3 py-2">
              <TabsList className="grid h-8 w-full grid-cols-5 bg-[#11142A]/70 p-[3px]">
                {[
                  ["params", "Params"],
                  ["input", "Input"],
                  ["output", "Output"],
                  ["settings", "Settings"],
                  ["notes", "Notes"],
                ].map(([value, label]) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="rounded-md text-[10px] font-medium uppercase tracking-[0.08em] text-[#6B7199] data-[state=active]:bg-[#7C5CFF]/[0.16] data-[state=active]:text-[#F2F4FF] data-[state=active]:shadow-none"
                  >
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
              <TabsContent value="params" className="m-0">
                {def ? (
                  <ParamControls
                    def={def}
                    params={node.parameters}
                    sampleItem={sampleItem}
                    onChange={handleParamChange}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-[#FFC857]/30 bg-[#FFC857]/[0.05] p-3 text-xs text-[#FFC857]">
                    Unknown node type “{node.type}” — parameters cannot be edited.
                  </div>
                )}
              </TabsContent>

              <TabsContent value="input" className="m-0">
                <ItemsView
                  items={nodeRun?.input ?? null}
                  emptyHint="No input data yet — run the workflow to see what flows into this node."
                />
              </TabsContent>

              <TabsContent value="output" className="m-0">
                <div className="flex flex-col gap-3">
                  {node.pinnedData && node.pinnedData.length > 0 ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[#7C5CFF]/30 bg-[#7C5CFF]/[0.08] px-3 py-2">
                      <Pin size={13} className="shrink-0 text-[#7C5CFF]" aria-hidden="true" />
                      <p className="flex-1 text-[11px] leading-4 text-[#A8AECF]">
                        Pinned data active — previews use this instead of live input.
                      </p>
                      <button
                        type="button"
                        onClick={() => onPinData(node.id, null)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#F2F4FF]/15 px-2 py-1 text-[10px] font-medium text-[#A8AECF] transition-colors hover:border-[#FF5C7A]/40 hover:text-[#FF5C7A] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
                      >
                        <PinOff size={11} aria-hidden="true" />
                        Unpin
                      </button>
                    </div>
                  ) : nodeRun?.output && nodeRun.output.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => onPinData(node.id, nodeRun.output ?? null)}
                      className="inline-flex items-center gap-1.5 self-start rounded-md border border-[#7C5CFF]/30 bg-[#7C5CFF]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#A8AECF] transition-colors hover:bg-[#7C5CFF]/[0.18] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
                    >
                      <Pin size={12} aria-hidden="true" />
                      Pin this data
                    </button>
                  ) : null}
                  <ItemsView
                    items={nodeRun?.output ?? null}
                    emptyHint="No output data yet — run the workflow to see results."
                  />
                </div>
              </TabsContent>

              <TabsContent value="settings" className="m-0">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between rounded-lg border border-[#F2F4FF]/10 bg-[#11142A]/70 px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium text-[#F2F4FF]">Enabled</p>
                      <p className="text-[10px] text-[#6B7199]">Disabled nodes are skipped at runtime.</p>
                    </div>
                    <Switch
                      checked={!node.disabled}
                      onCheckedChange={(v) => onPatchNode(node.id, { disabled: !v })}
                      aria-label="Toggle node enabled"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-[#F2F4FF]/10 bg-[#11142A]/70 px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium text-[#F2F4FF]">Retry on failure</p>
                      <p className="text-[10px] text-[#6B7199]">Re-run this node when it errors.</p>
                    </div>
                    <Switch
                      checked={node.settings?.retry === true}
                      onCheckedChange={(v) => handleSettingsChange({ retry: v })}
                      aria-label="Toggle retry on failure"
                    />
                  </div>

                  {node.settings?.retry && (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="insp-max-retries" className={fieldLabel}>
                        Max retries
                      </label>
                      <Input
                        id="insp-max-retries"
                        type="number"
                        min={1}
                        max={5}
                        value={node.settings?.maxRetries ?? 2}
                        onChange={(e) =>
                          handleSettingsChange({
                            maxRetries: e.target.value === "" ? 1 : Math.max(1, Number(e.target.value)),
                          })
                        }
                        className="h-8 rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="insp-timeout" className={fieldLabel}>
                      Timeout (ms)
                    </label>
                    <Input
                      id="insp-timeout"
                      type="number"
                      min={100}
                      step={500}
                      value={node.settings?.timeoutMs ?? 30000}
                      onChange={(e) =>
                        handleSettingsChange({
                          timeoutMs: e.target.value === "" ? 30000 : Number(e.target.value),
                        })
                      }
                      className="h-8 rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-[#F2F4FF]/10 bg-[#11142A]/70 px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium text-[#F2F4FF]">Continue on fail</p>
                      <p className="text-[10px] text-[#6B7199]">
                        Let the workflow keep going when this node errors.
                      </p>
                    </div>
                    <Switch
                      checked={node.settings?.continueOnFail === true}
                      onCheckedChange={(v) => handleSettingsChange({ continueOnFail: v })}
                      aria-label="Toggle continue on fail"
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="m-0">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="insp-notes" className={fieldLabel}>
                    Notes
                  </label>
                  <Textarea
                    id="insp-notes"
                    value={node.notes ?? ""}
                    onChange={(e) => onPatchNode(node.id, { notes: e.target.value })}
                    rows={8}
                    placeholder="Why does this node exist? Any caveats?"
                    className="min-h-[140px] rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs leading-5 text-[#F2F4FF] placeholder:text-[#6B7199] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60"
                  />
                </div>
              </TabsContent>
            </div>
          </Tabs>

          <AskAiDialog open={aiOpen} onOpenChange={setAiOpen} node={node} />
        </div>
      )}
    </aside>
  );
}
