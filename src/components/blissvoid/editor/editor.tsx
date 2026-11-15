"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CircleSlash,
  Copy,
  Download,
  History as HistoryIcon,
  Loader2,
  MoreHorizontal,
  PanelRight,
  PanelRightClose,
  Rocket,
  Save,
  Settings2,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
  Redo2,
  Upload,
} from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/blissvoid/store";
import {
  aiBuildWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  getExecution,
  getWorkflow,
  listExecutions,
  runWorkflow,
  updateWorkflow,
} from "@/lib/blissvoid/api-client";
import { NODE_CATALOG, NODE_MAP, newId } from "@/lib/blissvoid/node-catalog";
import { StatusBadge, formatDuration, timeAgo } from "@/components/blissvoid/shared";
import type {
  ExecutionDTO,
  NodeRunDTO,
  NodeType,
  WorkflowDTO,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/blissvoid/types";
import { Palette, BLISS_NODE_DRAG_MIME } from "./palette";
import { Inspector } from "./inspector";
import { RunPanel } from "./run-panel";
import { renderIcon } from "./icon-map";
import {
  edgeTypes,
  nodeTypes,
  toBlissNodeData,
  toWorkflowNode,
  type BlissFlowEdge,
  type BlissFlowNode,
  type BlissNodeData,
  type RunStatus,
} from "./bliss-node";

/* ---------------------------------------------------------------------------
   BLISSVOID workflow canvas editor — palette / canvas / inspector.
   Owns undo+redo history, autosave-dirty tracking, the test-run polling loop,
   clipboard, quick-add and the floating AI builder bar.
--------------------------------------------------------------------------- */

const EDGE_STROKE = "rgba(190,196,224,0.72)";
const ARROW_END = { type: MarkerType.ArrowClosed, color: EDGE_STROKE };
const NARROW_MS = 768;

type Snapshot = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
type RunEntry = { status: RunStatus; itemCount: number; note?: string };
type ContextMenuState = { x: number; y: number; nodeId: string } | null;

const snap = (v: number) => Math.round(v / 20) * 20;

function toWorkflowEdge(e: BlissFlowEdge): WorkflowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
  };
}

function flowNode(wf: WorkflowNode, extra?: Partial<BlissFlowNode>): BlissFlowNode {
  return {
    id: wf.id,
    type: "bliss",
    position: { x: wf.position.x, y: wf.position.y },
    data: toBlissNodeData(wf),
    ...extra,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/* ========================================================================== */

function EditorInner({ workflowId }: { workflowId: string }) {
  const closeEditor = useApp((s) => s.closeEditor);
  const openWorkflow = useApp((s) => s.openWorkflow);
  const { screenToFlowPosition, fitView } = useReactFlow();

  /* ------------------------------ core state ----------------------------- */
  const [meta, setMeta] = React.useState<WorkflowDTO | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<BlissFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BlissFlowEdge>([]);

  /* chrome */
  const [paletteCollapsed, setPaletteCollapsed] = React.useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState(false);
  const [inspectorTab, setInspectorTab] = React.useState("params");
  const [narrowSettingsOpen, setNarrowSettingsOpen] = React.useState(false);

  /* history + dirty */
  const [historyState, setHistoryState] = React.useState<{
    stack: Snapshot[];
    index: number;
  }>({ stack: [], index: -1 });
  const [graphDirty, setGraphDirty] = React.useState(false);
  const [nameDirty, setNameDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  /* run state */
  const [runState, setRunState] = React.useState<Map<string, RunEntry>>(new Map());
  const [execution, setExecution] = React.useState<ExecutionDTO | null>(null);
  const [currentExecutionId, setCurrentExecutionId] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [runPanelOpen, setRunPanelOpen] = React.useState(false);

  /* overlays */
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const [quickAddQuery, setQuickAddQuery] = React.useState("");
  const [quickAddIndex, setQuickAddIndex] = React.useState(0);
  const [quickAddPos, setQuickAddPos] = React.useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>(null);

  /* responsive */
  const [isNarrow, setIsNarrow] = React.useState(false);
  const [narrowDismissed, setNarrowDismissed] = React.useState(false);

  /* history dropdown + AI bar */
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyExecs, setHistoryExecs] = React.useState<ExecutionDTO[] | null>(null);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiLoading, setAiLoading] = React.useState(false);

  /* refs */
  const loadedRef = React.useRef(false);
  const suppressHistoryRef = React.useRef(false);
  const savedGraphRef = React.useRef("");
  const clipboardRef = React.useRef<WorkflowNode[]>([]);
  const lastPointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const canvasWrapRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const runStateRef = React.useRef<Map<string, RunEntry>>(new Map());
  const quickAddInputRef = React.useRef<HTMLInputElement>(null);

  /* ------------------------------ responsive ------------------------------ */
  React.useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < NARROW_MS);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  /* -------------------------------- load ---------------------------------- */
  React.useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    setLoadError(null);
    setMeta(null);
    setExecution(null);
    setCurrentExecutionId(null);
    setRunning(false);
    setRunPanelOpen(false);
    setRunState(new Map());
    setQuickAddOpen(false);
    setContextMenu(null);
    setHistoryState({ stack: [], index: -1 });
    setGraphDirty(false);
    setNameDirty(false);
    setNarrowDismissed(false);
    setNarrowSettingsOpen(false);

    (async () => {
      try {
        const { workflow: wf } = await getWorkflow(workflowId);
        if (cancelled) return;
        setMeta(wf);
        setName(wf.name);
        setNodes(wf.nodes.map((n) => flowNode(n)));
        setEdges(
          wf.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: null,
          }))
        );
        const snap0: Snapshot = { nodes: wf.nodes, edges: wf.edges };
        setHistoryState({ stack: [snap0], index: 0 });
        savedGraphRef.current = JSON.stringify(snap0);
        loadedRef.current = true;
        if (wf.nodes.length > 0) {
          window.setTimeout(() => fitView({ padding: 0.25, maxZoom: 1.1 }), 80);
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  /* --------------------------- history + dirty ---------------------------- */
  React.useEffect(() => {
    if (!loadedRef.current) return;
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;
      const snapNow = { nodes: nodes.map(toWorkflowNode), edges: edges.map(toWorkflowEdge) };
      setGraphDirty(JSON.stringify(snapNow) !== savedGraphRef.current);
      return;
    }
    const timer = window.setTimeout(() => {
      const snapNow = { nodes: nodes.map(toWorkflowNode), edges: edges.map(toWorkflowEdge) };
      setHistoryState((h) => {
        const current = h.stack[h.index];
        if (current && JSON.stringify(current) === JSON.stringify(snapNow)) return h;
        const stack = [...h.stack.slice(0, h.index + 1), snapNow].slice(-50);
        return { stack, index: stack.length - 1 };
      });
      setGraphDirty(JSON.stringify(snapNow) !== savedGraphRef.current);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [nodes, edges]);

  const applySnapshot = React.useCallback(
    (snap: Snapshot) => {
      suppressHistoryRef.current = true;
      setNodes(
        snap.nodes.map((wf) => {
          const rs = runStateRef.current.get(wf.id);
          const data = toBlissNodeData(wf);
          return flowNode(wf, {
            selected: false,
            data: {
              ...data,
              status: rs?.status ?? "idle",
              itemCount: rs?.itemCount ?? 0,
              lastRunNote: rs?.note,
            },
          });
        })
      );
      setEdges(
        snap.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: null,
        }))
      );
    },
    [setEdges, setNodes]
  );

  const undo = () => {
    if (historyState.index <= 0) return;
    const snap = historyState.stack[historyState.index - 1];
    if (!snap) return;
    applySnapshot(snap);
    setHistoryState((h) => ({ ...h, index: Math.max(0, h.index - 1) }));
  };

  const redo = () => {
    if (historyState.index >= historyState.stack.length - 1) return;
    const snap = historyState.stack[historyState.index + 1];
    if (!snap) return;
    applySnapshot(snap);
    setHistoryState((h) => ({ ...h, index: h.index + 1 }));
  };

  /* --------------------------- run status sync ---------------------------- */
  React.useEffect(() => {
    runStateRef.current = runState;
    setNodes((ns) =>
      ns.map((n) => {
        const rs = runState.get(n.id);
        const status: RunStatus = rs?.status ?? "idle";
        const itemCount = rs?.itemCount ?? 0;
        const note = rs?.note;
        const d = n.data;
        if (d.status === status && d.itemCount === itemCount && d.lastRunNote === note) return n;
        return { ...n, data: { ...d, status, itemCount, lastRunNote: note } };
      })
    );
  }, [runState]);

  /* ------------------------------- polling -------------------------------- */
  React.useEffect(() => {
    if (!currentExecutionId) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const { execution: ex } = await getExecution(currentExecutionId);
        if (stopped) return;
        setExecution(ex);
        const next = new Map<string, RunEntry>();
        for (const nr of ex.nodeRuns ?? []) {
          next.set(nr.nodeId, {
            status:
              nr.status === "running"
                ? "running"
                : nr.status === "success"
                  ? "success"
                  : nr.status === "error"
                    ? "error"
                    : "idle",
            itemCount: nr.output?.length ?? 0,
            note: nr.error ?? undefined,
          });
        }
        setRunState(next);
        if (ex.status !== "running") {
          setRunning(false);
          if (timer !== undefined) window.clearInterval(timer);
          if (ex.status === "success") {
            toast.success(
              `Workflow finished in ${((ex.durationMs ?? 0) / 1000).toFixed(1)}s`
            );
          } else if (ex.status === "error") {
            toast.error(ex.error ? `Workflow failed — ${ex.error}` : "Workflow failed");
          } else {
            toast.info(`Workflow ${ex.status}`);
          }
        }
      } catch {
        if (!stopped) {
          setRunning(false);
          if (timer !== undefined) window.clearInterval(timer);
          toast.error("Lost contact with the execution.");
        }
      }
    };
    timer = window.setInterval(() => void tick(), 700);
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [currentExecutionId]);

  /* ------------------------------- mutations ------------------------------ */
  const patchNode = React.useCallback(
    (id: string, patch: Partial<WorkflowNode>) => {
      setNodes((ns) =>
        ns.map((n): BlissFlowNode => {
          if (n.id !== id) return n;
          const next: BlissNodeData = { ...n.data };
          if (patch.name !== undefined) next.name = patch.name;
          if (patch.parameters !== undefined) next.parameters = patch.parameters;
          if (patch.settings !== undefined) next.settings = patch.settings;
          if (patch.notes !== undefined) next.notes = patch.notes;
          if (patch.pinnedData !== undefined) {
            next.pinnedData = patch.pinnedData;
            next.pinned = patch.pinnedData != null && patch.pinnedData.length > 0;
          }
          if (patch.disabled !== undefined) next.disabled = patch.disabled;
          return { ...n, data: next };
        })
      );
    },
    [setNodes]
  );

  const addNode = React.useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const def = NODE_MAP[type];
      if (!def) return;
      const id = newId("node");
      const wf: WorkflowNode = {
        id,
        type,
        name: def.label,
        position: { x: snap(position.x), y: snap(position.y) },
        parameters: structuredClone(def.defaultParams),
      };
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        flowNode(wf, { selected: true }),
      ]);
    },
    [setNodes]
  );

  const canvasCenter = React.useCallback(() => {
    const el = canvasWrapRef.current;
    if (!el) return { x: 80, y: 120 };
    const rect = el.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [screenToFlowPosition]);

  const addAtCenter = React.useCallback(
    (type: NodeType) => {
      const center = canvasCenter();
      const n = nodes.length;
      addNode(type, {
        x: center.x - 124 + ((n % 4) * 36 - 54),
        y: center.y - 40 + ((n % 4) * 30 - 45),
      });
    },
    [addNode, canvasCenter, nodes.length]
  );

  const duplicateNode = React.useCallback(
    (nodeId: string) => {
      const src = nodes.find((n) => n.id === nodeId);
      if (!src) return;
      const wf = toWorkflowNode(src);
      const copyName = `${wf.name} copy`;
      const copy: WorkflowNode = {
        ...wf,
        id: newId("node"),
        name: copyName,
        position: { x: snap(src.position.x + 40), y: snap(src.position.y + 40) },
      };
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        flowNode(copy, { selected: true }),
      ]);
    },
    [nodes, setNodes]
  );

  const deleteNode = React.useCallback(
    (nodeId: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setEdges, setNodes]
  );

  const onConnect = React.useCallback(
    (conn: Connection) => {
      setEdges((es) => addEdge({ ...conn, id: newId("edge") }, es));
    },
    [setEdges]
  );

  /* ------------------------------ save / run ------------------------------ */
  const save = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!meta || saving) return;
      setSaving(true);
      try {
        const nodesSer = nodes.map(toWorkflowNode);
        const edgesSer = edges.map(toWorkflowEdge);
        const patch: Partial<Pick<WorkflowDTO, "name" | "nodes" | "edges">> = {
          nodes: nodesSer,
          edges: edgesSer,
        };
        const trimmed = name.trim();
        if (trimmed && trimmed !== meta.name) patch.name = trimmed;
        const { workflow: saved } = await updateWorkflow(workflowId, patch);
        savedGraphRef.current = JSON.stringify({ nodes: nodesSer, edges: edgesSer });
        setGraphDirty(false);
        setNameDirty(false);
        setMeta(saved);
        if (!opts?.silent) toast.success("Workflow saved");
      } catch (err) {
        toast.error(`Save failed — ${(err as Error).message}`);
      } finally {
        setSaving(false);
      }
    },
    [edges, meta, name, nodes, saving, workflowId]
  );

  const testRun = React.useCallback(async () => {
    if (running || !meta) return;
    if (nodes.length === 0) {
      toast.error("Add at least one node before running.");
      return;
    }
    setRunning(true);
    try {
      const nodesSer = nodes.map(toWorkflowNode);
      const edgesSer = edges.map(toWorkflowEdge);
      const patch: Partial<Pick<WorkflowDTO, "name" | "nodes" | "edges">> = {
        nodes: nodesSer,
        edges: edgesSer,
      };
      const trimmed = name.trim();
      if (trimmed && trimmed !== meta.name) patch.name = trimmed;
      const { workflow: saved } = await updateWorkflow(workflowId, patch);
      savedGraphRef.current = JSON.stringify({ nodes: nodesSer, edges: edgesSer });
      setGraphDirty(false);
      setNameDirty(false);
      setMeta(saved);

      const { execution: ex } = await runWorkflow(workflowId);
      setExecution(ex);
      setRunPanelOpen(true);
      setRunState(new Map());
      setCurrentExecutionId(ex.id);
    } catch (err) {
      setRunning(false);
      toast.error(`Could not run — ${(err as Error).message}`);
    }
  }, [meta, name, nodes, running, workflowId]);

  /* ---------------------------- meta mutations ---------------------------- */
  const commitName = React.useCallback(async () => {
    if (!meta) return;
    const next = name.trim() || meta.name;
    setName(next);
    if (next === meta.name) {
      setNameDirty(false);
      return;
    }
    try {
      const { workflow: saved } = await updateWorkflow(workflowId, { name: next });
      setMeta(saved);
      setNameDirty(false);
      toast.success("Renamed");
    } catch (err) {
      toast.error(`Could not rename — ${(err as Error).message}`);
    }
  }, [meta, name, workflowId]);

  const handleUpdateWorkflowMeta = React.useCallback(
    async (patch: { name?: string; description?: string | null; tags?: string[]; active?: boolean }) => {
      try {
        const { workflow: saved } = await updateWorkflow(workflowId, patch);
        setMeta(saved);
        if (patch.name != null) setName(patch.name);
        if (patch.active != null) {
          toast.success(patch.active ? "Workflow activated" : "Workflow deactivated");
        }
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [workflowId]
  );

  const handleDeleteWorkflow = React.useCallback(async () => {
    try {
      await deleteWorkflow(workflowId);
      toast.success("Workflow deleted");
      closeEditor();
    } catch (err) {
      toast.error(`Could not delete — ${(err as Error).message}`);
    }
  }, [closeEditor, workflowId]);

  const handleDuplicate = React.useCallback(async () => {
    try {
      const { workflow: copy } = await duplicateWorkflow(workflowId);
      toast.success(`Duplicated as “${copy.name}”`);
    } catch (err) {
      toast.error(`Could not duplicate — ${(err as Error).message}`);
    }
  }, [workflowId]);

  const handleExport = React.useCallback(() => {
    const data = {
      name: name.trim() || meta?.name || "Workflow",
      nodes: nodes.map(toWorkflowNode),
      edges: edges.map(toWorkflowEdge),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workflow")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Workflow exported");
  }, [edges, meta, name, nodes]);

  const handleImportFile = React.useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as {
          name?: string;
          nodes?: Partial<WorkflowNode>[];
          edges?: Partial<WorkflowEdge>[];
        };
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          throw new Error("File must contain { nodes: [], edges: [] }");
        }
        const known = parsed.nodes.filter(
          (n) => typeof n.type === "string" && NODE_MAP[n.type] != null
        );
        if (known.length === 0) throw new Error("No valid nodes found in the file");
        const taken = new Set(nodes.map((n) => n.id));
        const idMap = new Map<string, string>();
        const imported: WorkflowNode[] = known.map((raw) => {
          let id = typeof raw.id === "string" ? raw.id : "";
          if (!id || taken.has(id) || idMap.has(id)) {
            id = newId("node");
          }
          idMap.set(String(raw.id), id);
          taken.add(id);
          const def = NODE_MAP[String(raw.type)];
          return {
            id,
            type: def.type,
            name: typeof raw.name === "string" && raw.name ? raw.name : def.label,
            position: {
              x: snap(typeof raw.position?.x === "number" ? raw.position.x : 80),
              y: snap(typeof raw.position?.y === "number" ? raw.position.y : 80),
            },
            parameters:
              raw.parameters && typeof raw.parameters === "object"
                ? (raw.parameters as Record<string, unknown>)
                : structuredClone(def.defaultParams),
            settings: raw.settings,
            notes: raw.notes,
            pinnedData: raw.pinnedData ?? null,
            disabled: raw.disabled,
          };
        });
        const importedEdges: WorkflowEdge[] = parsed.edges
          .filter((e) => e.source != null && e.target != null)
          .map((e, i) => ({
            id: typeof e.id === "string" && e.id ? e.id : newId("edge"),
            source: idMap.get(String(e.source)) ?? String(e.source),
            target: idMap.get(String(e.target)) ?? String(e.target),
            sourceHandle: e.sourceHandle ?? null,
          }))
          .filter((e) => imported.some((n) => n.id === e.source) && imported.some((n) => n.id === e.target));
        setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...imported.map((wf) => flowNode(wf))]);
        setEdges((es) => [...es, ...importedEdges]);
        if (parsed.name) {
          setName(parsed.name);
          setNameDirty(true);
        }
        toast.success(
          `Imported ${imported.length} node${imported.length === 1 ? "" : "s"}${
            known.length < (parsed.nodes?.length ?? 0)
              ? ` · ${parsed.nodes.length - known.length} skipped (unknown types)`
              : ""
          }`
        );
      } catch (err) {
        toast.error(`Import failed — ${(err as Error).message}`);
      }
    },
    [nodes, setEdges, setNodes]
  );

  /* --------------------------- clipboard actions -------------------------- */
  const copySelection = React.useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    clipboardRef.current = selected.map(toWorkflowNode);
    toast.success(
      `Copied ${selected.length} node${selected.length === 1 ? "" : "s"}`
    );
  }, [nodes]);

  const pasteClipboard = React.useCallback(() => {
    const clip = clipboardRef.current;
    if (clip.length === 0) return;
    const idMap = new Map<string, string>();
    const pasted = clip.map((wf) => {
      const id = newId("node");
      idMap.set(wf.id, id);
      const copy: WorkflowNode = {
        ...wf,
        id,
        name: `${wf.name} copy`,
        position: { x: snap(wf.position.x + 40), y: snap(wf.position.y + 40) },
      };
      return flowNode(copy, { selected: true });
    });
    const pastedEdges = edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        id: newId("edge"),
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: null,
      }));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...pasted]);
    setEdges((es) => [...es, ...pastedEdges]);
  }, [edges, setEdges, setNodes]);

  /* ------------------------------ quick add ------------------------------- */
  const openQuickAdd = React.useCallback(
    (pos?: { x: number; y: number }) => {
      const position =
        pos ??
        (lastPointerRef.current
          ? screenToFlowPosition(lastPointerRef.current)
          : canvasCenter());
      setQuickAddPos(position);
      setQuickAddQuery("");
      setQuickAddIndex(0);
      setQuickAddOpen(true);
    },
    [canvasCenter, screenToFlowPosition]
  );

  const quickAddResults = React.useMemo(() => {
    const q = quickAddQuery.trim().toLowerCase();
    if (!q) return NODE_CATALOG;
    return NODE_CATALOG.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q)
    );
  }, [quickAddQuery]);

  React.useEffect(() => {
    if (quickAddOpen) {
      setQuickAddIndex(0);
      window.setTimeout(() => quickAddInputRef.current?.focus(), 30);
    }
  }, [quickAddOpen]);

  const quickAddSubmit = React.useCallback(
    (type: NodeType) => {
      setQuickAddOpen(false);
      addNode(type, quickAddPos ?? canvasCenter());
    },
    [addNode, canvasCenter, quickAddPos]
  );

  /* ------------------------------- AI build ------------------------------- */
  const handleAiSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const prompt = aiPrompt.trim();
      if (!prompt || aiLoading) return;
      setAiLoading(true);
      const tid = toast.loading("The void is weaving your workflow…");
      try {
        const { workflow: wf, note } = await aiBuildWorkflow(prompt);
        toast.success(note ? `Workflow conjured — ${note}` : "Workflow conjured", {
          id: tid,
        });
        setAiPrompt("");
        openWorkflow(wf.id);
      } catch (err) {
        toast.error((err as Error).message, { id: tid });
      } finally {
        setAiLoading(false);
      }
    },
    [aiLoading, aiPrompt, openWorkflow]
  );

  /* ------------------------------ history list ---------------------------- */
  React.useEffect(() => {
    if (!historyOpen) return;
    let cancelled = false;
    setHistoryExecs(null);
    (async () => {
      try {
        const { executions } = await listExecutions({ workflowId, limit: 8 });
        if (!cancelled) setHistoryExecs(executions);
      } catch {
        if (!cancelled) setHistoryExecs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyOpen, workflowId]);

  /* ------------------------------- selection ------------------------------ */
  const selectedNode = nodes.find((n) => n.selected) ?? null;
  const selectedWfNode = selectedNode ? toWorkflowNode(selectedNode) : null;
  const selectedNodeRun: NodeRunDTO | null = React.useMemo(() => {
    if (!selectedNode || !execution?.nodeRuns) return null;
    const runs = execution.nodeRuns.filter((r) => r.nodeId === selectedNode.id);
    return runs.length > 0 ? runs[runs.length - 1] : null;
  }, [execution, selectedNode]);

  const clearSelection = React.useCallback(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
  }, [setNodes]);

  /* ------------------------------ derived edges --------------------------- */
  const displayEdges = React.useMemo(() => {
    const runsByNode = new Map<string, NodeRunDTO>();
    for (const nr of execution?.nodeRuns ?? []) runsByNode.set(nr.nodeId, nr);
    return edges.map((e) => {
      const srcRun = runsByNode.get(e.source);
      const tgtRun = runsByNode.get(e.target);
      const count = tgtRun?.input?.length ?? srcRun?.output?.length ?? 0;
      const flowing = running && runState.get(e.source)?.status === "success";
      return {
        ...e,
        type: "bliss" as const,
        animated: flowing,
        markerEnd: ARROW_END,
        style: { stroke: EDGE_STROKE },
        data: { ...e.data, count },
      };
    });
  }, [edges, execution, runState, running]);

  const dirty = graphDirty || nameDirty;
  const canUndo = historyState.index > 0;
  const canRedo = historyState.index >= 0 && historyState.index < historyState.stack.length - 1;
  const inspectorVisible = isNarrow
    ? selectedWfNode != null || narrowSettingsOpen
    : !inspectorCollapsed;

  /* ------------------------------- shortcuts ------------------------------ */
  React.useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (e.key === "Escape") {
        setContextMenu((cm) => (cm ? null : cm));
        setQuickAddOpen(false);
        return;
      }
      if (isEditableTarget(e.target)) return;

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "c") {
        copySelection();
        return;
      }
      if (mod && key === "v") {
        pasteClipboard();
        return;
      }
      if (e.key === "Tab" && !quickAddOpen) {
        const target = e.target;
        const inCanvas =
          target === document.body ||
          (target instanceof Node && canvasWrapRef.current?.contains(target) === true);
        if (inCanvas) {
          e.preventDefault();
          openQuickAdd();
        }
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [copySelection, openQuickAdd, pasteClipboard, quickAddOpen, redo, save, undo]);

  /* close context menu on canvas interactions */
  React.useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  /* ------------------------------ load states ----------------------------- */
  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#05060F] p-6">
        <div className="glass flex max-w-md flex-col items-center rounded-2xl px-8 py-10 text-center">
          <p className="font-[family-name:var(--font-space)] text-lg font-semibold text-[#FF5C7A]">
            Could not open this workflow
          </p>
          <p className="mt-2 break-words text-sm text-[#A8AECF]">{loadError}</p>
          <button
            type="button"
            onClick={closeEditor}
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-full border border-[#F2F4FF]/15 px-4 text-sm font-medium text-[#F2F4FF] transition-colors hover:border-[#7C5CFF]/50 hover:bg-[#7C5CFF]/10"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Back to workflows
          </button>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#05060F]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={22} className="animate-spin text-[#7C5CFF]" aria-hidden="true" />
          <p className="text-sm text-[#A8AECF]">Opening the void…</p>
        </div>
      </div>
    );
  }

  const contextNode = contextMenu ? nodes.find((n) => n.id === contextMenu.nodeId) : null;

  /* -------------------------------- render -------------------------------- */
  return (
    <div className="flex h-full w-full overflow-hidden bg-[#05060F]">
      {/* left dock */}
      <Palette
        isNarrow={isNarrow}
        collapsed={paletteCollapsed}
        onToggleCollapse={() => setPaletteCollapsed((c) => !c)}
        onAddNode={addAtCenter}
      />

      {/* center column */}
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-[#F2F4FF]/[0.06] bg-[#0A0C1A]/80 px-2 backdrop-blur-xl sm:gap-2 sm:px-3">
          <button
            type="button"
            onClick={closeEditor}
            aria-label="Back to workflows"
            title="Back to workflows"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#A8AECF] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
          >
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameDirty(e.target.value.trim() !== meta.name);
              }}
              onBlur={() => void commitName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              aria-label="Workflow name"
              title={name}
              className="h-8 min-w-0 max-w-[320px] flex-1 truncate rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-[#F2F4FF] outline-none transition-colors hover:border-[#F2F4FF]/10 focus:border-[#7C5CFF]/60 focus:ring-[3px] focus:ring-[#7C5CFF]/25"
            />
            <span
              title={dirty ? "Unsaved changes" : "All changes saved"}
              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${
                dirty
                  ? "bg-[#2CF5D0] shadow-[0_0_8px_rgba(44,245,208,0.8)]"
                  : "bg-[#6B7199]/50"
              }`}
              aria-hidden="true"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo"
              title="Undo (Ctrl/Cmd+Z)"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
            >
              <Undo2 size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
            >
              <Redo2 size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => void testRun()}
              disabled={running}
              className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-bliss px-3.5 text-xs font-semibold text-[#05060F] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/50"
            >
              {running ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <Rocket size={13} aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{running ? "Running…" : "Test Run"}</span>
            </button>

            <div className="hidden items-center gap-2 rounded-full border border-[#F2F4FF]/10 bg-[#11142A]/60 px-3 py-1 md:flex">
              <Switch
                checked={meta.active}
                onCheckedChange={(v) => void handleUpdateWorkflowMeta({ active: v })}
                aria-label="Toggle workflow active"
                className="scale-90"
              />
              <span className="text-[11px] font-medium text-[#A8AECF]">Active</span>
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              aria-label="Save workflow"
              title="Save (Ctrl/Cmd+S)"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#F2F4FF]/10 px-2.5 text-xs font-medium text-[#F2F4FF] transition-colors hover:border-[#7C5CFF]/40 hover:bg-[#7C5CFF]/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={14} strokeWidth={1.8} aria-hidden="true" />
              )}
              <span className="hidden lg:inline">{saving ? "Saving…" : "Save"}</span>
            </button>

            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Run history"
                  title="Run history"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
                >
                  <HistoryIcon size={15} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[300px] rounded-xl border-[#F2F4FF]/10 bg-[#0A0C1A] p-0"
              >
                <div className="border-b border-[#F2F4FF]/[0.06] px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7199]">
                    Recent runs
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto p-1.5">
                  {historyExecs == null ? (
                    <p className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-[#6B7199]">
                      <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                      Loading runs…
                    </p>
                  ) : historyExecs.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-[#6B7199]">
                      No runs yet — press Test Run.
                    </p>
                  ) : (
                    historyExecs.map((ex) => (
                      <div
                        key={ex.id}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[#7C5CFF]/[0.08]"
                      >
                        <StatusBadge status={ex.status} className="px-2 py-0 text-[10px]" />
                        <span className="font-[family-name:var(--font-jetbrains)] text-[11px] text-[#A8AECF]">
                          {ex.durationMs != null ? formatDuration(ex.durationMs) : "—"}
                        </span>
                        <span className="ml-auto text-[11px] text-[#6B7199]">
                          {timeAgo(ex.startedAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {isNarrow && (
              <button
                type="button"
                onClick={() => {
                  setNarrowSettingsOpen((v) => !v);
                  clearSelection();
                }}
                aria-label="Workflow settings"
                title="Workflow settings"
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40 ${
                  narrowSettingsOpen
                    ? "bg-[#7C5CFF]/15 text-[#F2F4FF]"
                    : "text-[#A8AECF] hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF]"
                }`}
              >
                <Settings2 size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More actions"
                  title="More actions"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
                >
                  <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 rounded-xl border-[#F2F4FF]/10 bg-[#0A0C1A]"
              >
                <DropdownMenuItem
                  onClick={() => void handleDuplicate()}
                  className="gap-2 text-xs text-[#A8AECF] focus:bg-[#7C5CFF]/15 focus:text-[#F2F4FF]"
                >
                  <Copy size={13} aria-hidden="true" />
                  Duplicate workflow
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleExport}
                  className="gap-2 text-xs text-[#A8AECF] focus:bg-[#7C5CFF]/15 focus:text-[#F2F4FF]"
                >
                  <Download size={13} aria-hidden="true" />
                  Export JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 text-xs text-[#A8AECF] focus:bg-[#7C5CFF]/15 focus:text-[#F2F4FF]"
                >
                  <Upload size={13} aria-hidden="true" />
                  Import JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={() => setInspectorCollapsed((c) => !c)}
              aria-label={inspectorCollapsed ? "Open inspector" : "Close inspector"}
              title={inspectorCollapsed ? "Open inspector" : "Close inspector"}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-[#A8AECF] transition-colors hover:bg-[#F2F4FF]/[0.06] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40 md:flex"
            >
              {inspectorCollapsed ? (
                <PanelRight size={15} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <PanelRightClose size={15} strokeWidth={1.8} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        {/* canvas */}
        <div
          ref={canvasWrapRef}
          className="relative min-h-0 flex-1"
          role="application"
          aria-label="Workflow canvas"
          onMouseMove={(e) => {
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onDrop={(event) => {
              event.preventDefault();
              const type = event.dataTransfer.getData(BLISS_NODE_DRAG_MIME);
              if (!type || !NODE_MAP[type]) return;
              const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
              });
              addNode(type as NodeType, position);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setNodes((ns) =>
                ns.map((n) => ({ ...n, selected: n.id === node.id }))
              );
              setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
            }}
            onPaneClick={() => setContextMenu(null)}
            onDoubleClick={(event) => {
              const target = event.target as HTMLElement;
              if (!target.classList.contains("react-flow__pane")) return;
              openQuickAdd(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            }}
            deleteKeyCode={["Backspace", "Delete"]}
            nodesDraggable={!isNarrow}
            nodesConnectable={!isNarrow}
            edgesReconnectable={!isNarrow}
            minZoom={0.2}
            maxZoom={2.2}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.6} color="#1A1E3D" />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) =>
                (n.data as BlissNodeData | undefined)?.def?.accent ?? "#7C5CFF"
              }
              nodeStrokeColor="#1A1E3D"
              nodeStrokeWidth={2}
              nodeBorderRadius={4}
              maskColor="rgba(5, 6, 15, 0.72)"
            />
          </ReactFlow>

          {/* empty canvas hint */}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 160, damping: 18 }}
                className="glass max-w-xs rounded-2xl px-6 py-5 text-center"
              >
                <p className="text-sm leading-6 text-[#F2F4FF]">
                  Press <kbd className="rounded border border-[#F2F4FF]/15 bg-[#11142A] px-1.5 py-0.5 font-[family-name:var(--font-jetbrains)] text-[10px]">Tab</kbd>{" "}
                  or double-click to add a node — or describe it with AI below.
                </p>
              </motion.div>
            </div>
          )}

          {/* run console */}
          {runPanelOpen && execution && (
            <RunPanel
              execution={execution}
              running={running}
              onClose={() => setRunPanelOpen(false)}
              onRetry={() => void testRun()}
            />
          )}

          {/* floating AI builder bar */}
          <motion.form
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24, delay: 0.15 }}
            onSubmit={(e) => void handleAiSubmit(e)}
            className="glass-strong absolute bottom-4 left-1/2 z-20 flex w-[min(520px,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5"
            role="search"
            aria-label="AI workflow builder"
          >
            <Sparkles size={15} className="shrink-0 text-[#FF6BD6]" aria-hidden="true" />
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe your workflow…"
              aria-label="Describe your workflow"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-[#F2F4FF] caret-[#FF6BD6] outline-none placeholder:text-[#6B7199]"
            />
            <button
              type="submit"
              disabled={!aiPrompt.trim() || aiLoading}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-bliss px-4 text-xs font-semibold text-[#05060F] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/50"
            >
              {aiLoading ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <Rocket size={13} aria-hidden="true" />
              )}
              Build
            </button>
          </motion.form>

          {/* quick-add dialog */}
          <AnimatePresence>
            {quickAddOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 z-40 flex items-start justify-center bg-[#05060F]/50 p-4 pt-[12vh] backdrop-blur-[2px]"
                onClick={() => setQuickAddOpen(false)}
              >
                <motion.div
                  initial={{ opacity: 0, y: -12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  className="glass-strong w-full max-w-md overflow-hidden rounded-2xl"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Quick add node"
                >
                  <div className="flex items-center gap-2.5 border-b border-[#F2F4FF]/[0.06] px-4 py-3">
                    {renderIcon("Search", { size: 15, className: "text-[#6B7199]", "aria-hidden": true })}
                    <input
                      ref={quickAddInputRef}
                      value={quickAddQuery}
                      onChange={(e) => {
                        setQuickAddQuery(e.target.value);
                        setQuickAddIndex(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const pick = quickAddResults[quickAddIndex] ?? quickAddResults[0];
                          if (pick) quickAddSubmit(pick.type);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setQuickAddIndex((i) => Math.min(i + 1, quickAddResults.length - 1));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setQuickAddIndex((i) => Math.max(i - 1, 0));
                        }
                      }}
                      placeholder="Search nodes to add…"
                      aria-label="Search nodes to add"
                      className="h-7 min-w-0 flex-1 bg-transparent text-sm text-[#F2F4FF] caret-[#7C5CFF] outline-none placeholder:text-[#6B7199]"
                    />
                    <span className="shrink-0 rounded border border-[#F2F4FF]/15 bg-[#11142A] px-1.5 py-0.5 font-[family-name:var(--font-jetbrains)] text-[9px] text-[#6B7199]">
                      Esc
                    </span>
                  </div>
                  <div className="max-h-80 overflow-y-auto p-1.5">
                    {quickAddResults.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-[#6B7199]">
                        Nothing in the void matches “{quickAddQuery}”.
                      </p>
                    ) : (
                      quickAddResults.slice(0, 40).map((def, i) => (
                        <button
                          key={def.type}
                          type="button"
                          onClick={() => quickAddSubmit(def.type)}
                          onMouseEnter={() => setQuickAddIndex(i)}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                            i === quickAddIndex ? "bg-[#7C5CFF]/[0.16]" : "hover:bg-[#7C5CFF]/[0.1]"
                          }`}
                        >
                          <span
                            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md"
                            style={{ background: `${def.accent}2E`, color: def.accent }}
                          >
                            {renderIcon(def.icon, { size: 12, strokeWidth: 1.8, "aria-hidden": true })}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-[#F2F4FF]">
                              {def.label}
                            </span>
                            <span className="block truncate text-[10px] text-[#6B7199]">
                              {def.description}
                            </span>
                          </span>
                          {i === quickAddIndex && (
                            <span className="shrink-0 rounded border border-[#F2F4FF]/15 bg-[#11142A] px-1.5 py-0.5 font-[family-name:var(--font-jetbrains)] text-[9px] text-[#6B7199]">
                              Enter
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* node context menu */}
          {contextMenu && contextNode && (
            <div
              className="glass-strong fixed z-50 w-44 overflow-hidden rounded-xl py-1"
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 190),
                top: Math.min(contextMenu.y, window.innerHeight - 190),
              }}
              role="menu"
              aria-label="Node actions"
            >
              {[
                {
                  label: "Duplicate",
                  icon: <Copy size={13} aria-hidden="true" />,
                  onClick: () => duplicateNode(contextMenu.nodeId),
                },
                {
                  label: contextNode.data.disabled ? "Enable" : "Disable",
                  icon: <CircleSlash size={13} aria-hidden="true" />,
                  onClick: () =>
                    patchNode(contextMenu.nodeId, { disabled: !contextNode.data.disabled }),
                },
                {
                  label: "Add note",
                  icon: <StickyNote size={13} aria-hidden="true" />,
                  onClick: () => {
                    if (contextNode.data.notes == null) {
                      patchNode(contextMenu.nodeId, { notes: "" });
                    }
                    setInspectorTab("notes");
                    setInspectorCollapsed(false);
                  },
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={item.onClick}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-[#A8AECF] transition-colors hover:bg-[#7C5CFF]/[0.14] hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
              <div className="my-1 h-px bg-[#F2F4FF]/[0.07]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => deleteNode(contextMenu.nodeId)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-[#FF5C7A] transition-colors hover:bg-[#FF5C7A]/[0.14] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#FF5C7A]/40"
              >
                <Trash2 size={13} aria-hidden="true" />
                Delete
              </button>
            </div>
          )}

          {/* narrow-screen notice */}
          {isNarrow && !narrowDismissed && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-[#05060F]/70 p-6 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
                className="glass-strong max-w-sm rounded-2xl p-6 text-center"
                role="alertdialog"
                aria-label="Small screen notice"
              >
                {renderIcon("Eye", { size: 22, className: "mx-auto text-[#7C5CFF]", "aria-hidden": true })}
                <p className="mt-3 font-[family-name:var(--font-space)] text-base font-semibold text-[#F2F4FF]">
                  Canvas editing shines on a larger screen
                </p>
                <p className="mt-1.5 text-sm leading-6 text-[#A8AECF]">
                  You are viewing read-only. Dragging and connecting are disabled on small
                  screens.
                </p>
                <button
                  type="button"
                  onClick={() => setNarrowDismissed(true)}
                  className="mt-5 inline-flex h-9 items-center rounded-full bg-bliss px-5 text-xs font-semibold text-[#05060F] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/50"
                >
                  View read-only
                </button>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      {/* right dock */}
      {inspectorVisible ? (
        <Inspector
          node={selectedWfNode}
          def={selectedNode?.data.def ?? null}
          nodeRun={selectedNodeRun}
          workflow={meta}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          onPatchNode={patchNode}
          onPinData={(id, data) => patchNode(id, { pinnedData: data })}
          onTestNode={() => void testRun()}
          running={running}
          onUpdateWorkflow={(patch) => void handleUpdateWorkflowMeta(patch)}
          onDeleteWorkflow={() => void handleDeleteWorkflow()}
          isNarrow={isNarrow}
          onClose={() => {
            setNarrowSettingsOpen(false);
            clearSelection();
          }}
        />
      ) : (
        !isNarrow && (
          <button
            type="button"
            onClick={() => setInspectorCollapsed(false)}
            aria-label="Open inspector"
            title="Open inspector"
            className="flex w-10 shrink-0 flex-col items-center justify-center gap-2 border-l border-[#F2F4FF]/[0.06] bg-[#0A0C1A]/70 text-[#6B7199] backdrop-blur-xl transition-colors hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#7C5CFF]/40"
          >
            <PanelRight size={15} strokeWidth={1.8} aria-hidden="true" />
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.18em]"
              style={{ writingMode: "vertical-rl" }}
            >
              Inspector
            </span>
          </button>
        )
      )}

      {/* hidden file input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ========================================================================== */

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
  return (
    <ReactFlowProvider>
      <EditorInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}

export default WorkflowEditor;
