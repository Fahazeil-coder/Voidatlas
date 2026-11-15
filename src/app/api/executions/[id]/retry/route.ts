import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startExecution, WorkflowNotFoundError } from "@/lib/engine/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const execution = await db.execution.findUnique({
      where: { id },
      include: { workflow: { select: { id: true, deletedAt: true } } },
    });
    if (!execution) {
      return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    }
    if (!execution.workflow || execution.workflow.deletedAt) {
      return NextResponse.json(
        { error: "The workflow behind this execution no longer exists" },
        { status: 404 }
      );
    }

    const retry = await startExecution(execution.workflowId, { mode: "retry" });
    return NextResponse.json({ execution: retry }, { status: 201 });
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
