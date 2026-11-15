import { NextResponse } from "next/server";
import { z } from "zod";
import { callLLM } from "@/lib/engine/executors";

export const runtime = "nodejs";

const bodySchema = z.object({
  task: z.string().min(1, "Tell the assistant what you need"),
  context: z.string().optional(),
});

const FALLBACK_CHEATSHEET = [
  "Here is the BLISSVOID quick reference while the model is offline:",
  "",
  "Expressions live inside double curly braces and plain JavaScript is allowed:",
  '- Current item fields: {{ $json.email }} or {{ $json.price * 1.2 }}',
  '- Reference an upstream node by name: {{ $node["HTTP Request"].json.data.name }}',
  '- Timestamp of this run: {{ $now }}',
  '- All incoming items: {{ $input.length }}',
  '- Instance variables: {{ $vars.SLACK_CHANNEL }}',
  "",
  "Code nodes receive `items` (an array of { json }) and must return an array of objects:",
  "return items.map(item => ({ ...item.json, processedAt: new Date().toISOString() }));",
  "",
  "Conditions compare a resolved left side with a right side (equals, contains, gt, regex and more).",
  "If you tell me the exact field shapes, I can sketch the precise expression for your case.",
].join("\n");

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Tell the node assistant what you need (task, and optionally node context)." },
        { status: 400 }
      );
    }
    const { task, context } = parsed.data;

    const system = [
      "You are the BLISSVOID node assistant.",
      "You help workflow builders write expressions, JavaScript code, conditions and field mappings.",
      "Be concise, practical and friendly. Prefer short answers with copy-pasteable snippets.",
      "Expression syntax: {{ $json.field }}, $node[\"Node Name\"].json, $now, $input, $vars.KEY.",
    ].join(" ");
    const user = context
      ? `Task: ${task}\n\nNode / workflow context:\n${context.slice(0, 4000)}`
      : `Task: ${task}`;

    const reply = await callLLM(system, user);
    return NextResponse.json({ result: reply ?? FALLBACK_CHEATSHEET });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
