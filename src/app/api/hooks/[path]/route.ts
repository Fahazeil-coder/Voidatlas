import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParse } from "@/lib/blissvoid/dto";
import { startExecution, WorkflowNotFoundError } from "@/lib/engine/engine";
import type { WorkflowNode } from "@/lib/blissvoid/types";
import type { TriggerData } from "@/lib/engine/executors";

export const runtime = "nodejs";

type Params = { params: Promise<{ path: string }> };

async function handle(request: Request, path: string) {
  try {
    // Cheap pre-filter in SQL, exact verification in JS.
    const candidates = await db.workflow.findMany({
      where: { deletedAt: null, nodes: { contains: `"${path}"` } },
    });

    const matching = candidates
      .map((workflow) => {
        const nodes = safeParse<WorkflowNode[]>(workflow.nodes, []);
        const hook = nodes.find(
          (node) => node.type === "webhook" && String(node.parameters?.path ?? "") === path
        );
        return hook ? { workflow, hook } : null;
      })
      .filter((entry): entry is { workflow: (typeof candidates)[number]; hook: WorkflowNode } => entry !== null);

    if (matching.length === 0) {
      return NextResponse.json(
        { error: `No webhook listens on /hooks/${path}` },
        { status: 404 }
      );
    }

    // Prefer an active workflow, otherwise the first match.
    const chosen = matching.find((m) => m.workflow.active);
    if (!chosen) return NextResponse.json({ error: "Webhook workflow is inactive" }, { status: 404 });

    const url = new URL(request.url);
    const query: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams.entries()) query[key] = value;

    let body: unknown = {};
    if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
      const raw = await request.text().catch(() => "");
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = { raw: raw.slice(0, 4000) };
        }
      }
    }

    const headers: Record<string, string> = {};
    for (const header of ["content-type", "user-agent", "authorization", "x-blissvoid-source"]) {
      const value = request.headers.get(header);
      if (value) headers[header] = value;
    }

    const triggerData: TriggerData = {
      method: request.method,
      headers,
      query,
      body,
    };

    await startExecution(chosen.workflow.id, { mode: "trigger", triggerData });
    return NextResponse.json({ ok: true, message: "Signal received. The void is working." });
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

export async function GET(request: Request, { params }: Params) {
  const { path } = await params;
  return handle(request, path);
}

export async function POST(request: Request, { params }: Params) {
  const { path } = await params;
  return handle(request, path);
}

export async function PUT(request: Request, { params }: Params) {
  const { path } = await params;
  return handle(request, path);
}
