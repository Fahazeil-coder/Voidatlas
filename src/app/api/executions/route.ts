import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapExecution } from "@/lib/blissvoid/dto";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);
    const status = url.searchParams.get("status") ?? undefined;
    const workflowId = url.searchParams.get("workflowId") ?? undefined;

    const where: Record<string, unknown> = {};
    if (status && ["running", "success", "error", "canceled"].includes(status)) {
      where.status = status;
    }
    if (workflowId) where.workflowId = workflowId;

    const rows = await db.execution.findMany({
      where,
      include: { workflow: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ executions: rows.map((row) => mapExecution(row)) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
