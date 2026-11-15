import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { startExecution, WorkflowNotFoundError } from "@/lib/engine/engine";
import type { Item } from "@/lib/engine/executors";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  input: z.array(z.unknown()).optional(),
});

function toItems(input: unknown[]): Item[] {
  return input
    .map((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const rec = entry as Record<string, unknown>;
        if ("json" in rec && rec.json && typeof rec.json === "object") {
          return { json: rec.json as Record<string, unknown> };
        }
        return { json: rec };
      }
      return { json: { value: entry } };
    })
    .filter((item): item is Item => item !== null);
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body ?? {});
    const inputItems = parsed.success && parsed.data.input ? toItems(parsed.data.input) : undefined;

    const execution = await startExecution(id, { mode: "manual", inputItems });
    return NextResponse.json({ execution }, { status: 201 });
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
