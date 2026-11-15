import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapExecution } from "@/lib/blissvoid/dto";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const execution = await db.execution.findUnique({
      where: { id },
      include: {
        workflow: { select: { name: true } },
        nodeRuns: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!execution) {
      return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    }
    return NextResponse.json({ execution: mapExecution(execution, { includeNodeRuns: true }) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const execution = await db.execution.findUnique({ where: { id } });
    if (!execution) {
      return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    }
    await db.execution.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
