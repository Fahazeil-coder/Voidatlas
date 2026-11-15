import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapActivity } from "@/lib/blissvoid/dto";
import type { StatsDTO } from "@/lib/blissvoid/types";

export const runtime = "nodejs";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const [workflowRows, executions, aiAgg, credentialCount, activity] = await Promise.all([
      db.workflow.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
      db.execution.findMany({
        select: {
          workflowId: true,
          status: true,
          startedAt: true,
          durationMs: true,
        },
      }),
      db.aiUsage.aggregate({ _count: { _all: true }, _sum: { cost: true } }),
      db.credential.count(),
      db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    ]);

    const workflowNames = new Map(workflowRows.map((w) => [w.id, w.name]));
    const activeWorkflows = await db.workflow.count({
      where: { deletedAt: null, active: true },
    });

    /* ---- Totals ---- */
    const finished = executions.filter((e) => e.status === "success" || e.status === "error");
    const successCount = finished.filter((e) => e.status === "success").length;
    const successRate =
      finished.length > 0
        ? Math.round((successCount / finished.length) * 1000) / 10
        : 100;
    const durations = executions
      .map((e) => e.durationMs)
      .filter((d): d is number => typeof d === "number" && d > 0);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    /* ---- Runs per day (last 14 days) ---- */
    const dayMap = new Map<string, { total: number; success: number; error: number }>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      dayMap.set(dayKey(d), { total: 0, success: 0, error: 0 });
    }
    for (const execution of executions) {
      const key = dayKey(execution.startedAt);
      const entry = dayMap.get(key);
      if (!entry) continue;
      entry.total += 1;
      if (execution.status === "success") entry.success += 1;
      if (execution.status === "error") entry.error += 1;
    }
    const runsPerDay = [...dayMap.entries()].map(([date, v]) => ({ date, ...v }));

    /* ---- Durations by workflow ---- */
    const byWorkflow = new Map<string, { runs: number; failures: number; durationSum: number; durationCount: number }>();
    for (const execution of executions) {
      if (!workflowNames.has(execution.workflowId)) continue;
      const entry =
        byWorkflow.get(execution.workflowId) ??
        { runs: 0, failures: 0, durationSum: 0, durationCount: 0 };
      entry.runs += 1;
      if (execution.status === "error") entry.failures += 1;
      if (typeof execution.durationMs === "number" && execution.durationMs > 0) {
        entry.durationSum += execution.durationMs;
        entry.durationCount += 1;
      }
      byWorkflow.set(execution.workflowId, entry);
    }

    const durationsByWorkflow = [...byWorkflow.entries()]
      .sort((a, b) => b[1].runs - a[1].runs)
      .slice(0, 6)
      .map(([workflowId, v]) => ({
        workflowId,
        name: workflowNames.get(workflowId) ?? "Unknown",
        avgDurationMs: v.durationCount > 0 ? Math.round(v.durationSum / v.durationCount) : 0,
        runs: v.runs,
      }));

    const topFailing = [...byWorkflow.entries()]
      .filter(([, v]) => v.failures > 0)
      .sort((a, b) => b[1].failures - a[1].failures)
      .slice(0, 4)
      .map(([workflowId, v]) => ({
        workflowId,
        name: workflowNames.get(workflowId) ?? "Unknown",
        failures: v.failures,
        runs: v.runs,
      }));

    /* ---- Status breakdown ---- */
    const statusCounts = new Map<string, number>();
    for (const execution of executions) {
      statusCounts.set(execution.status, (statusCounts.get(execution.status) ?? 0) + 1);
    }
    const statusBreakdown = [...statusCounts.entries()].map(([status, count]) => ({ status, count }));

    const stats: StatsDTO = {
      totals: {
        workflows: workflowRows.length,
        activeWorkflows,
        executions: executions.length,
        successRate,
        avgDurationMs,
        aiCalls: aiAgg._count._all,
        aiCost: Math.round((aiAgg._sum.cost ?? 0) * 1e6) / 1e6,
        credentials: credentialCount,
      },
      runsPerDay,
      durationsByWorkflow,
      topFailing,
      statusBreakdown,
      recentActivity: activity.map(mapActivity),
    };

    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
