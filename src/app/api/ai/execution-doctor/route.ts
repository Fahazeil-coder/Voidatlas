import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { callLLM } from "@/lib/engine/executors";

export const runtime = "nodejs";

const bodySchema = z.object({
  executionId: z.string().min(1),
});

function heuristicDiagnosis(nodeName: string, nodeType: string, error: string): string {
  const where = `${nodeName} (${nodeType})`;
  if (/HTTP 4\d\d/.test(error)) {
    return [
      `What happened: ${where} was rejected by the remote API with "${error.slice(0, 140)}".`,
      "Why: 4xx responses mean the request itself was refused — most often a missing or expired credential, a wrong URL, or rate limiting.",
      "How to fix: re-test the credential attached to this node, double-check the URL and query params, and if you sent data, verify the body shape. Add a retry with backoff for 429 responses.",
    ].join("\n");
  }
  if (/timeout|timed out|abort/i.test(error)) {
    return [
      `What happened: ${where} stopped responding — "${error.slice(0, 140)}".`,
      "Why: the remote side or the model took longer than the configured timeout.",
      "How to fix: raise the node's timeout (for HTTP) or reduce the payload size, enable retry with backoff, and consider splitting very large batches into smaller runs.",
    ].join("\n");
  }
  if (/parse|JSON|expression|\$json|is not a function|undefined/i.test(error)) {
    return [
      `What happened: ${where} could not read the data it received — "${error.slice(0, 140)}".`,
      "Why: the upstream item shape changed, so the expression or code pointed at a field that does not exist.",
      "How to fix: open the failing node's input panel, inspect the actual item JSON, and update the expression to match (for example $json.body.email instead of $json.email).",
    ].join("\n");
  }
  return [
    `What happened: ${where} failed with "${error.slice(0, 140)}".`,
    "Why: the node reported an error that is not covered by the common patterns.",
    "How to fix: inspect the node's input and output panels, simplify the parameters to the defaults, then re-enable one setting at a time until the culprit shows itself.",
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide an executionId to diagnose." }, { status: 400 });
    }
    const { executionId } = parsed.data;

    const execution = await db.execution.findUnique({
      where: { id: executionId },
      include: {
        workflow: { select: { name: true } },
        nodeRuns: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!execution) {
      return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    }

    const failed = execution.nodeRuns.filter((run) => run.status === "error");
    if (failed.length === 0) {
      const healthy = `This execution finished ${execution.status} with no failing nodes. Nothing to prescribe — the void is calm. If the run felt slow, look at the per-node durations in the run panel to find the heaviest step.`;
      return NextResponse.json({ diagnosis: healthy });
    }

    const worst = failed[0];
    const context = [
      `Workflow: ${execution.workflow?.name ?? "Unknown"}`,
      `Execution status: ${execution.status}, mode: ${execution.mode}`,
      `Failed node: ${worst.nodeName} (${worst.nodeType}), attempts: ${worst.attempt}`,
      `Error: ${worst.error ?? "unknown"}`,
      `Node input: ${(worst.inputJson ?? "[]").slice(0, 800)}`,
      `Node output: ${(worst.outputJson ?? "null").slice(0, 800)}`,
      failed.length > 1 ? `Other failing nodes: ${failed.slice(1).map((f) => f.nodeName).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const system =
      "You are the BLISSVOID Execution Doctor. Diagnose the failure and prescribe a fix in 3 short sections: What happened / Why / How to fix. Be warm, precise, and use no more than 120 words.";
    const reply = await callLLM(system, context);

    return NextResponse.json({
      diagnosis: reply ?? heuristicDiagnosis(worst.nodeName, worst.nodeType, worst.error ?? "unknown error"),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
