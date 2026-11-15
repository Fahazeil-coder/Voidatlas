import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  edgeSchema,
  mapWorkflow,
  nodeSchema,
  normalizeEdges,
  normalizeNodes,
} from "@/lib/blissvoid/dto";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  active: z.boolean().optional(),
  folder: z.string().max(80).nullish(),
  tags: z.array(z.string()).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
});

function fail(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Internal error";
  return NextResponse.json({ error: message }, { status });
}

async function summarize(workflowId: string) {
  const [latest, count] = await Promise.all([
    db.execution.findFirst({ where: { workflowId }, orderBy: { startedAt: "desc" } }),
    db.execution.count({ where: { workflowId } }),
  ]);
  return { latest, count };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const workflow = await db.workflow.findFirst({ where: { id, deletedAt: null } });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    const summary = await summarize(workflow.id);
    return NextResponse.json({
      workflow: mapWorkflow(workflow, summary.latest, summary.count),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const workflow = await db.workflow.findFirst({ where: { id, deletedAt: null } });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Invalid patch payload: ${parsed.error.issues[0]?.message ?? "unknown"}` },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim() || "Untitled flow";
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.active !== undefined) data.active = input.active;
    if (input.folder !== undefined) data.folder = input.folder ?? null;
    if (input.tags !== undefined) data.tags = JSON.stringify(input.tags);
    if (input.nodes !== undefined) data.nodes = JSON.stringify(input.nodes);
    if (input.edges !== undefined) data.edges = JSON.stringify(input.edges);

    const updated = await db.workflow.update({ where: { id: workflow.id }, data });
    const summary = await summarize(workflow.id);
    return NextResponse.json({
      workflow: mapWorkflow(updated, summary.latest, summary.count),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const workflow = await db.workflow.findFirst({ where: { id, deletedAt: null } });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    await db.workflow.update({
      where: { id: workflow.id },
      data: { deletedAt: new Date(), active: false },
    });
    await db.activityLog.create({
      data: {
        kind: "workflow.deleted",
        message: `Workflow "${workflow.name}" was deleted`,
        workflowId: workflow.id,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
