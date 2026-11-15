import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapWorkflow } from "@/lib/blissvoid/dto";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const workflow = await db.workflow.findFirst({ where: { id, deletedAt: null } });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const copyMatch = workflow.name.match(/\(copy(?: (\d+))?\)$/);
    const copyName = copyMatch
      ? workflow.name.replace(/\(copy.*\)$/, `(copy ${Number(copyMatch[1] ?? 1) + 1})`)
      : `${workflow.name} (copy)`;

    const duplicate = await db.workflow.create({
      data: {
        name: copyName.slice(0, 120),
        description: workflow.description,
        active: false,
        folder: workflow.folder,
        tags: workflow.tags,
        nodes: workflow.nodes,
        edges: workflow.edges,
      },
    });

    await db.activityLog.create({
      data: {
        kind: "workflow.created",
        message: `Workflow "${workflow.name}" was duplicated as "${duplicate.name}"`,
        workflowId: duplicate.id,
      },
    });

    return NextResponse.json({ workflow: mapWorkflow(duplicate) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
