import type {
  Credential,
  Execution,
  NodeRun,
  Template,
  Workflow,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { NODE_MAP } from "@/lib/blissvoid/node-catalog";
import type {
  ActivityDTO,
  CredentialDTO,
  ExecutionDTO,
  ExecutionStatus,
  NodeRunDTO,
  TemplateDTO,
  WorkflowDTO,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/blissvoid/types";
import { decryptJSON, maskCredential } from "@/lib/engine/crypto";

/* ---------------------------------------------------------------------------
   DB row -> DTO mappers shared by every API route.
   JSON string columns are parsed, dates become ISO strings, and computed
   fields (lastRun*) are layered in by the callers.
--------------------------------------------------------------------------- */

export function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Structural execution shape accepted by mapExecution — Prisma rows with a
 * full or name-only workflow join both fit.
 */
export type ExecutionRow = {
  id: string;
  workflowId: string;
  status: string;
  mode: string;
  triggerType: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  aiTokens: number;
  aiCost: number;
  workflow?: { name: string } | null;
  nodeRuns?: NodeRun[];
};

/** Keep the full Prisma row assignable to the structural type above. */
export type ExecutionWithWorkflow = Execution & {
  workflow?: Workflow | null;
  nodeRuns?: NodeRun[];
};

export function mapWorkflow(
  row: Workflow,
  latest?: Execution | null,
  executionCount?: number
): WorkflowDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    folder: row.folder,
    tags: safeParse<string[]>(row.tags, []),
    nodes: safeParse<WorkflowNode[]>(row.nodes, []),
    edges: safeParse<WorkflowEdge[]>(row.edges, []),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastRunStatus: (latest?.status as ExecutionStatus | undefined) ?? null,
    lastRunAt: latest ? latest.startedAt.toISOString() : null,
    runCount: executionCount ?? 0,
    executionCount: executionCount ?? 0,
  };
}

export function mapNodeRun(row: NodeRun): NodeRunDTO {
  return {
    id: row.id,
    nodeId: row.nodeId,
    nodeName: row.nodeName,
    nodeType: row.nodeType,
    status: row.status as ExecutionStatus,
    startedAt: row.startedAt.toISOString(),
    durationMs: row.durationMs,
    input: safeParse<unknown[] | null>(row.inputJson, null),
    output: safeParse<unknown[] | null>(row.outputJson, null),
    error: row.error,
    attempt: row.attempt,
  };
}

export function mapExecution(
  row: ExecutionRow,
  opts?: { includeNodeRuns?: boolean }
): ExecutionDTO {
  const dto: ExecutionDTO = {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflow?.name ?? "",
    status: row.status as ExecutionStatus,
    mode: row.mode,
    triggerType: row.triggerType,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs,
    aiTokens: row.aiTokens,
    aiCost: row.aiCost,
  };
  if (opts?.includeNodeRuns || row.nodeRuns) {
    dto.nodeRuns = (row.nodeRuns ?? []).map(mapNodeRun);
  }
  return dto;
}

export function mapCredential(row: Credential): CredentialDTO {
  const data = decryptJSON<Record<string, string>>(row.dataEnc);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    maskedPreview: maskCredential(row.type, data),
  };
}

export function mapTemplate(row: Template): TemplateDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    gradient: row.gradient,
    nodes: safeParse<WorkflowNode[]>(row.nodes, []),
    edges: safeParse<WorkflowEdge[]>(row.edges, []),
    uses: row.uses,
    featured: row.featured,
  };
}

export function mapActivity(row: {
  id: string;
  kind: string;
  message: string;
  workflowId: string | null;
  createdAt: Date;
}): ActivityDTO {
  return {
    id: row.id,
    kind: row.kind,
    message: row.message,
    workflowId: row.workflowId,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ------------------------------ API validation ----------------------------- */

export const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().refine((t) => t in NODE_MAP, { message: "Unknown node type" }),
  name: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullish(),
  pinnedData: z.array(z.unknown()).nullish(),
  disabled: z.boolean().optional(),
});

export const edgeSchema = z.object({
  id: z.string().min(1).optional(),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullish(),
});

/** Turn zod-validated node payloads into complete WorkflowNode objects. */
export function normalizeNodes(
  raw: z.infer<typeof nodeSchema>[]
): WorkflowNode[] {
  return raw.map((n) => ({
    id: n.id,
    type: n.type as WorkflowNode["type"],
    name: n.name,
    position: n.position ?? { x: 0, y: 0 },
    parameters: n.parameters ?? {},
    settings: (n.settings ?? undefined) as WorkflowNode["settings"],
    notes: n.notes ?? undefined,
    pinnedData: n.pinnedData ?? null,
    disabled: n.disabled,
  }));
}

/** Turn zod-validated edge payloads into complete WorkflowEdge objects. */
export function normalizeEdges(
  raw: z.infer<typeof edgeSchema>[],
  fallbackIndex = 0
): WorkflowEdge[] {
  return raw.map((e, i) => ({
    id: e.id ?? `edge_${fallbackIndex + i}_${Math.random().toString(36).slice(2, 8)}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
  }));
}

/**
 * For a set of workflow rows, fetch the latest execution + total count of
 * every workflow in ONE query and return a lookup map.
 */
export async function loadExecutionSummaries(
  workflowIds: string[]
): Promise<Map<string, { latest: Execution | null; count: number }>> {
  const map = new Map<string, { latest: Execution | null; count: number }>();
  for (const id of workflowIds) map.set(id, { latest: null, count: 0 });
  if (workflowIds.length === 0) return map;

  const rows = await db.execution.findMany({
    where: { workflowId: { in: workflowIds } },
    select: { workflowId: true, status: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });

  for (const row of rows) {
    const entry = map.get(row.workflowId);
    if (!entry) continue;
    entry.count += 1;
    if (!entry.latest) entry.latest = row as Execution;
  }
  return map;
}
