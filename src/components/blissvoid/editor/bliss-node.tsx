"use client";

import * as React from "react";
import {
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { CheckCircle2, CircleSlash, Loader2, Pin, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { renderIcon } from "./icon-map";
import { getNodeDef, OPERATORS } from "@/lib/blissvoid/node-catalog";
import type {
  Assignment,
  Condition,
  NodeDefinition,
  WorkflowNode,
} from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   BLISSVOID custom React Flow node ("bliss") and custom edge ("bliss").
   The node renders a compact glass card with an accent hairline, live run
   status and a short humanized parameter summary. The edge renders the
   standard bezier path plus an optional item-count pill.
--------------------------------------------------------------------------- */

export type RunStatus = "idle" | "running" | "success" | "error";

/** Data carried by every canvas node — extends Record<string, unknown> (v12). */
export type BlissNodeData = {
  def: NodeDefinition;
  name: string;
  parameters: Record<string, unknown>;
  settings?: WorkflowNode["settings"];
  notes?: string;
  pinnedData?: unknown[] | null;
  pinned?: boolean;
  disabled?: boolean;
  status?: RunStatus;
  itemCount?: number;
  lastRunNote?: string;
} & Record<string, unknown>;

export type BlissFlowNode = Node<BlissNodeData, "bliss">;

export type BlissEdgeData = {
  count?: number;
} & Record<string, unknown>;

export type BlissFlowEdge = Edge<BlissEdgeData>;

/* ------------------------------ helpers ---------------------------------- */

/** Even vertical distribution for stacked handles. */
function handleTops(count: number): string[] {
  if (count <= 1) return ["50%"];
  if (count === 2) return ["32%", "68%"];
  if (count === 3) return ["27%", "50%", "73%"];
  return Array.from(
    { length: count },
    (_, i) => `${Math.round(((i + 1) / (count + 1)) * 100)}%`
  );
}

function operatorLabel(op: string): string {
  return OPERATORS.find((o) => o.value === op)?.label ?? op;
}

type SummaryLine = { text: string; mono: boolean };

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 2-3 compact, humanized key-param lines for the node body. */
export function summarizeParams(
  def: NodeDefinition | undefined,
  params: Record<string, unknown>
): SummaryLine[] {
  if (!def) return [];
  const lines: SummaryLine[] = [];

  const conditions = params.conditions;
  if (Array.isArray(conditions) && conditions.length > 0) {
    const c = conditions[0] as Condition;
    const text = `${c.left} ${operatorLabel(c.operator)}${c.right ? ` ${c.right}` : ""}`;
    lines.push({ text: truncate(text, 46), mono: true });
  }

  const assignments = params.assignments;
  if (Array.isArray(assignments) && assignments.length > 0) {
    const names = (assignments as Assignment[])
      .map((a) => a.name)
      .filter(Boolean)
      .join(", ");
    if (names) lines.push({ text: truncate(`set ${names}`, 46), mono: false });
  }

  for (const field of def.params) {
    if (lines.length >= 3) break;
    if (
      field.type === "conditions" ||
      field.type === "assignments" ||
      field.type === "boolean"
    ) {
      continue;
    }
    const raw = params[field.key];
    if (
      raw === undefined ||
      raw === null ||
      raw === "" ||
      (Array.isArray(raw) && raw.length === 0)
    ) {
      continue;
    }
    if (field.type === "code") {
      lines.push({
        text: `${String(raw).split("\n").length} lines of JavaScript`,
        mono: false,
      });
      continue;
    }
    if (field.type === "json" || field.type === "keyvals") {
      continue;
    }
    const label = field.label.split(" (")[0];
    lines.push({
      text: truncate(`${label}: ${String(raw)}`, 46),
      mono: /{{/.test(String(raw)),
    });
  }

  return lines.slice(0, 3);
}

/* ------------------------------- node ------------------------------------ */

function BlissNode({ data }: NodeProps<BlissFlowNode>) {
  const def = data.def;
  const accent = def?.accent ?? "#7C5CFF";
  const status: RunStatus = data.status ?? "idle";
  const itemCount = data.itemCount ?? 0;
  const pinned =
    data.pinned ?? (data.pinnedData != null && (data.pinnedData as unknown[]).length > 0);
  const disabled = data.disabled === true;

  const inputs = def?.inputs ?? ["main"];
  const outputs = def?.outputs ?? ["main"];
  const inputTops = handleTops(inputs.length);
  const outputTops = handleTops(outputs.length);

  const lines = summarizeParams(def, data.parameters);

  return (
    <div
      className={cn(
        "bliss-node glow-hover relative w-[248px] overflow-visible rounded-xl glass px-0 py-0 transition-opacity",
        status === "running" && "node-running",
        disabled && "opacity-50"
      )}
      style={
        status === "success"
          ? {
              borderColor: "rgba(44,245,160,0.45)",
              boxShadow:
                "0 0 0 1px rgba(44,245,160,0.25), 0 0 26px rgba(44,245,160,0.12)",
            }
          : status === "error"
            ? {
                borderColor: "rgba(255,92,122,0.55)",
                boxShadow:
                  "0 0 0 1px rgba(255,92,122,0.3), 0 0 28px rgba(255,92,122,0.16)",
              }
            : undefined
      }
    >
      {/* accent hairline */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 top-0 h-[2px] rounded-t-xl"
        style={{ background: `linear-gradient(90deg, ${accent}, transparent)`, opacity: 0.6 }}
      />

      {/* header */}
      <div className="flex h-11 items-center gap-2.5 px-3">
        <span
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${accent}2E`, color: accent }}
        >
          {renderIcon(def?.icon ?? "CircleDashed", {
            size: 13,
            strokeWidth: 1.8,
            "aria-hidden": true,
          })}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-[#F2F4FF]" title={data.name}>
          {data.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {pinned && <Pin size={12} className="text-[#7C5CFF]" aria-label="Pinned data" />}
          {disabled && (
            <CircleSlash size={13} className="text-[#6B7199]" aria-label="Node disabled" />
          )}
          {status === "running" && (
            <Loader2 size={13} className="animate-spin text-[#7C5CFF]" aria-label="Running" />
          )}
          {status === "success" && (
            <CheckCircle2 size={13} className="text-[#2CF5A0]" aria-label="Succeeded" />
          )}
          {status === "error" && (
            <XCircle size={13} className="text-[#FF5C7A]" aria-label="Failed" />
          )}
          {itemCount > 0 && (
            <span
              className="rounded-full border border-[#F2F4FF]/[0.08] bg-[#F2F4FF]/[0.06] px-1.5 font-[family-name:var(--font-jetbrains)] text-[9px] leading-4 text-[#A8AECF]"
              title={`${itemCount} items produced in the last run`}
            >
              ×{itemCount}
            </span>
          )}
        </span>
      </div>

      {/* body — compact parameter summary */}
      <div className="flex flex-col gap-1 border-t border-[#F2F4FF]/[0.06] px-3 py-2">
        {lines.length > 0 ? (
          lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "truncate text-[11px] text-[#A8AECF]",
                line.mono && "font-[family-name:var(--font-jetbrains)] text-[10.5px]"
              )}
              title={line.text}
            >
              {line.text}
            </div>
          ))
        ) : (
          <div className="truncate text-[11px] text-[#6B7199]" title={def?.description}>
            {def?.description ?? "No parameters"}
          </div>
        )}
        {data.lastRunNote ? (
          <div
            className="truncate text-[10px] text-[#FF5C7A]"
            title={data.lastRunNote}
            role="note"
          >
            {data.lastRunNote}
          </div>
        ) : null}
      </div>

      {/* input handles (left) */}
      {inputs.map((handleId, i) => (
        <Handle
          key={handleId}
          id={handleId}
          type="target"
          position={Position.Left}
          style={{ top: inputTops[i] }}
        />
      ))}

      {/* output handles (right) */}
      {outputs.map((handleId, i) => (
        <Handle
          key={handleId}
          id={handleId}
          type="source"
          position={Position.Right}
          style={{ top: outputTops[i] }}
        />
      ))}

      {/* tiny output labels for branching nodes */}
      {outputs.length > 1 &&
        outputs.map((handleId, i) => (
          <span
            key={`label-${handleId}`}
            aria-hidden="true"
            className="pointer-events-none absolute whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A8AECF] drop-shadow-[0_1px_3px_rgba(5,6,15,0.9)]"
            style={{
              left: "calc(100% + 9px)",
              top: outputTops[i],
              transform: "translateY(-50%)",
            }}
          >
            {handleId}
          </span>
        ))}

      {/* screen-reader context */}
      <span className="sr-only">{`Node ${data.name}, type ${def?.type ?? "unknown"}${
        status !== "idle" ? `, status ${status}` : ""
      }`}</span>
    </div>
  );
}

/* ------------------------------- edge ------------------------------------ */

function BlissEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
  animated,
}: EdgeProps<BlissFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const count = data?.count;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        className={animated ? "edge-flowing" : undefined}
      />
      {typeof count === "number" && count > 0 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute flex h-[17px] min-w-[22px] items-center justify-center rounded-full border border-[#F2F4FF]/10 bg-[#0A0C1A] px-1.5 font-[family-name:var(--font-jetbrains)] text-[9px] text-[#A8AECF]"
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
          >
            ×{count}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/* ------------------------------ type maps -------------------------------- */

export const nodeTypes: NodeTypes = {
  bliss: BlissNode,
};

export const edgeTypes: EdgeTypes = {
  bliss: BlissEdge,
};

/* --------------------------- domain converters ---------------------------- */

/** Builds canvas node data from a persisted WorkflowNode. */
export function toBlissNodeData(wf: WorkflowNode): BlissNodeData {
  const def = getNodeDef(wf.type);
  if (!def) {
    // Unknown type: synthesize a ghost definition so the node still renders.
    return {
      def: {
        type: wf.type,
        label: wf.name,
        description: "Unknown node type",
        category: "action",
        icon: "CircleDashed",
        accent: "#6B7199",
        inputs: ["main"],
        outputs: ["main"],
        params: [],
        defaultParams: {},
      },
      name: wf.name,
      parameters: wf.parameters,
      settings: wf.settings,
      notes: wf.notes,
      pinnedData: wf.pinnedData ?? null,
      pinned: wf.pinnedData != null && wf.pinnedData.length > 0,
      disabled: wf.disabled ?? false,
      status: "idle",
      itemCount: 0,
    };
  }
  return {
    def,
    name: wf.name,
    parameters: wf.parameters,
    settings: wf.settings,
    notes: wf.notes,
    pinnedData: wf.pinnedData ?? null,
    pinned: wf.pinnedData != null && wf.pinnedData.length > 0,
    disabled: wf.disabled ?? false,
    status: "idle",
    itemCount: 0,
  };
}

/** Serializes a canvas node back to the persisted WorkflowNode shape. */
export function toWorkflowNode(node: BlissFlowNode): WorkflowNode {
  const d = node.data;
  return {
    id: node.id,
    type: d.def.type,
    name: d.name,
    position: { x: node.position.x, y: node.position.y },
    parameters: d.parameters,
    settings: d.settings,
    notes: d.notes,
    pinnedData: d.pinnedData ?? null,
    disabled: d.disabled === true ? true : undefined,
  };
}
