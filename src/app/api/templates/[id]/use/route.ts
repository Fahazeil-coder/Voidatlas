import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapTemplate, mapWorkflow } from "@/lib/blissvoid/dto";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const template = await db.template.findUnique({ where: { id } });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const workflow = await db.workflow.create({
      data: {
        name: template.name,
        description: template.description,
        active: false,
        folder: template.category,
        tags: JSON.stringify(["template", template.category.toLowerCase()]),
        nodes: template.nodes,
        edges: template.edges,
      },
    });

    await db.template.update({
      where: { id: template.id },
      data: { uses: { increment: 1 } },
    });

    await db.activityLog.create({
      data: {
        kind: "workflow.created",
        message: `Workflow "${workflow.name}" was started from the template "${template.name}"`,
        workflowId: workflow.id,
      },
    });

    return NextResponse.json(
      {
        workflow: mapWorkflow(workflow),
        template: mapTemplate({ ...template, uses: template.uses + 1 }),
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
