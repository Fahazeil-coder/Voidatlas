import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  edgeSchema,
  loadExecutionSummaries,
  mapWorkflow,
  nodeSchema,
  normalizeEdges,
  normalizeNodes,
} from "@/lib/blissvoid/dto";
import { getNodeDef, newId } from "@/lib/blissvoid/node-catalog";
import type { WorkflowEdge, WorkflowNode } from "@/lib/blissvoid/types";

export const runtime = "nodejs";

/* ------------------------------ Validation ------------------------------ */

const createSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
  tags: z.array(z.string()).optional(),
  folder: z.string().optional(),
});

function fail(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Internal error";
  return NextResponse.json({ error: message }, { status });
}

/* -------------------------------- GET list ------------------------------- */

export async function GET() {
  try {
    const rows = await db.workflow.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    const summaries = await loadExecutionSummaries(rows.map((r) => r.id));
    const workflows = rows.map((row) => {
      const summary = summaries.get(row.id);
      return mapWorkflow(row, summary?.latest ?? null, summary?.count ?? 0);
    });
    return NextResponse.json({ workflows });
  } catch (err) {
    return fail(err);
  }
}

/* -------------------------------- POST create ---------------------------- */

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Invalid workflow payload: ${parsed.error.issues[0]?.message ?? "unknown"}` },
        { status: 400 }
      );
    }
    const input = parsed.data;

    let nodes: WorkflowNode[] = input.nodes ? normalizeNodes(input.nodes) : [];
    let edges: WorkflowEdge[] = input.edges ? normalizeEdges(input.edges) : [];
    if (nodes.length === 0) {
      const trigger = getNodeDef("manualTrigger");
      nodes = [
        {
          id: newId("node"),
          type: "manualTrigger",
          name: "Manual Trigger",
          position: { x: 0, y: 0 },
          parameters: { ...(trigger?.defaultParams ?? {}) },
        },
      ];
      edges = [];
    } else {
      // Ensure edges only reference provided node ids.
      const ids = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }

    const workflow = await db.workflow.create({
      data: {
        name: input.name?.trim() || "Untitled flow",
        description: input.description ?? null,
        tags: JSON.stringify(input.tags ?? []),
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
        folder: input.folder ?? null,
        active: false,
      },
    });

    await db.activityLog.create({
      data: {
        kind: "workflow.created",
        message: `Workflow "${workflow.name}" was created`,
        workflowId: workflow.id,
      },
    });

    return NextResponse.json({ workflow: mapWorkflow(workflow) }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
