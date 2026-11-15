import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { mapWorkflow } from "@/lib/blissvoid/dto";
import { NODE_CATALOG, NODE_MAP, getNodeDef, newId } from "@/lib/blissvoid/node-catalog";
import { callLLM, tolerantJson } from "@/lib/engine/executors";
import type { NodeType, WorkflowEdge, WorkflowNode } from "@/lib/blissvoid/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  prompt: z.string().min(1, "Describe the workflow you want"),
});

interface DraftNode {
  id: string;
  type: string;
  name: string;
  parameters: Record<string, unknown>;
}
interface DraftGraph {
  name: string;
  description: string;
  nodes: DraftNode[];
  edges: { source: string; target: string; sourceHandle?: string | null }[];
}

/* ------------------------------- Auto layout ------------------------------ */

function autoLayout(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  if (nodes.length === 0) return;
  const adjacency = new Map<string, { target: string; handle: string | null }[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push({ target: edge.target, handle: edge.sourceHandle ?? null });
    adjacency.set(edge.source, list);
  }

  const start = nodes[0].id;
  const depth = new Map<string, number>([[start, 0]]);
  const yOffset = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const { target, handle } of adjacency.get(current) ?? []) {
      if (depth.has(target)) continue;
      depth.set(target, (depth.get(current) ?? 0) + 1);
      yOffset.set(target, (yOffset.get(current) ?? 0) + (handle === "false" ? 140 : 0));
      queue.push(target);
    }
  }

  let fallbackIndex = 0;
  for (const node of nodes) {
    const layer = depth.get(node.id);
    if (layer !== undefined) {
      node.position = { x: layer * 270, y: yOffset.get(node.id) ?? 0 };
    } else {
      node.position = { x: fallbackIndex * 270, y: 260 };
      fallbackIndex += 1;
    }
  }
}

/* ------------------------------ Draft finalize ---------------------------- */

function makeNode(type: string, name: string, parameters: Record<string, unknown>): WorkflowNode {
  const def = getNodeDef(type);
  return {
    id: newId("node"),
    type: type as NodeType,
    name,
    position: { x: 0, y: 0 },
    parameters: { ...(def?.defaultParams ?? {}), ...parameters },
  };
}

function finalizeDraft(draft: DraftGraph): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const seen = new Set<string>();
  const nodes: WorkflowNode[] = [];
  for (const raw of draft.nodes) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    nodes.push(makeNode(raw.type, raw.name || NODE_MAP[raw.type]?.label || raw.type, raw.parameters ?? {}));
  }
  if (nodes.length === 0) throw new Error("No nodes in draft");

  const ids = new Set(nodes.map((n) => n.id));
  let edges: WorkflowEdge[] = draft.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: newId("edge"),
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    }));

  // Guarantee a trigger node up front.
  const hasTrigger = nodes.some((n) => NODE_MAP[n.type]?.category === "trigger");
  if (!hasTrigger) {
    const trigger = makeNode("manualTrigger", "Manual Trigger", {});
    nodes.unshift(trigger);
    edges.unshift({
      id: newId("edge"),
      source: trigger.id,
      target: nodes[1].id,
      sourceHandle: null,
    });
  }

  // Guarantee connectivity: chain orphans linearly behind the last placed node.
  const connected = new Set<string>([nodes[0].id]);
  for (const edge of edges) connected.add(edge.target);
  let tail = nodes[0];
  for (const node of nodes) {
    if (connected.has(node.id)) continue;
    edges.push({
      id: newId("edge"),
      source: tail.id,
      target: node.id,
      sourceHandle: null,
    });
    connected.add(node.id);
    tail = node;
  }

  autoLayout(nodes, edges);
  return { nodes, edges };
}

/* ------------------------------- LLM attempt ------------------------------ */

function catalogDescription(): string {
  return NODE_CATALOG.map((d) => `- ${d.type}: ${d.description}`).join("\n");
}

async function draftFromLLM(prompt: string): Promise<DraftGraph | null> {
  const system = [
    "You are BLISSVOID's workflow architect.",
    'Reply with ONLY minified JSON, no markdown fences: {"name": string, "description": string, "nodes": [{"id": string, "type": string, "name": string, "parameters": {}}], "edges": [{"source": string, "target": string, "sourceHandle"?: string}]}.',
    `Allowed node types:\n${catalogDescription()}`,
    'Use manualTrigger as the first node unless the user asks for schedule or webhook. Connect nodes in a sensible chain; use sourceHandle "true"/"false" only for if nodes. Keep parameters aligned with the node purpose.',
  ].join("\n");

  const reply = await callLLM(system, prompt, 40000);
  if (!reply) return null;

  const parsed = tolerantJson(reply) as unknown;
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  const rawNodes = Array.isArray(candidate.nodes) ? candidate.nodes : null;
  const rawEdges = Array.isArray(candidate.edges) ? candidate.edges : [];
  if (!rawNodes || rawNodes.length === 0) return null;

  const nodes: DraftNode[] = [];
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    const type = typeof rec.type === "string" ? rec.type : "";
    if (!(type in NODE_MAP)) return null;
    nodes.push({
      id: typeof rec.id === "string" && rec.id ? rec.id : newId("node"),
      type,
      name: typeof rec.name === "string" && rec.name ? rec.name : NODE_MAP[type].label,
      parameters:
        rec.parameters && typeof rec.parameters === "object" && !Array.isArray(rec.parameters)
          ? (rec.parameters as Record<string, unknown>)
          : {},
    });
  }

  const edges = rawEdges
    .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === "object")
    .map((rec) => ({
      source: String(rec.source ?? ""),
      target: String(rec.target ?? ""),
      sourceHandle: typeof rec.sourceHandle === "string" ? rec.sourceHandle : null,
    }))
    .filter((e) => e.source && e.target);

  return {
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : "Untitled flow",
    description:
      typeof candidate.description === "string" ? candidate.description : prompt.slice(0, 200),
    nodes,
    edges,
  };
}

/* --------------------------- Deterministic fallback ------------------------ */

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ")
    .trim();
}

function buildWorkflowFromPrompt(prompt: string): DraftGraph {
  const lower = prompt.toLowerCase();

  const has = (...words: string[]) => words.some((w) => lower.includes(w));

  /* Trigger */
  let triggerType: NodeType = "manualTrigger";
  let triggerParams: Record<string, unknown> = {};
  if (
    has("every day", "each day", "daily", "every morning", "each morning", "cron", "schedule", "hourly", "every hour", "every week", "weekly", "every monday", "at 9am", "at 9 am", "every night")
  ) {
    triggerType = "schedule";
    triggerParams = { mode: "0 9 * * *", timezone: "America/Los_Angeles" };
    if (has("hourly", "every hour")) triggerParams = { mode: "0 * * * *", timezone: "America/Los_Angeles" };
    if (has("every monday", "weekly", "every week")) triggerParams = { mode: "0 8 * * 1", timezone: "America/Los_Angeles" };
  } else if (has("webhook")) {
    triggerType = "webhook";
    triggerParams = { path: `hook-${Math.random().toString(36).slice(2, 8)}`, method: "POST", auth: "none" };
  }

  /* Body nodes in canonical order: fetch -> AI -> branch -> deliver */
  const detected: { type: NodeType; params: Record<string, unknown> }[] = [];

  if (/\b(http|https|url|api|endpoint|fetch|rss|feed)\b/.test(lower) || lower.includes("hacker news")) {
    detected.push({
      type: "httpRequest",
      params: {
        method: "GET",
        url: lower.includes("hacker news")
          ? "https://hacker-news.firebaseio.com/v0/topstories.json"
          : "https://api.github.com/repos/vercel/next.js",
        headers: [{ key: "User-Agent", value: "blissvoid-agent" }],
        queryParams: [],
        body: "",
        auth: "none",
        token: "",
        timeoutMs: 15000,
      },
    });
  }

  const hasHttp = detected.some((d) => d.type === "httpRequest");
  const aiText = hasHttp ? "{{ $json.data }}" : "{{ $json.message }}";

  if (has("summar", "digest", "tl;dr", "recap")) {
    detected.push({ type: "aiSummarize", params: { text: aiText, style: "bullets" } });
  }
  if (has("classif", "categor", "sort into", "label", "triage")) {
    detected.push({
      type: "aiClassify",
      params: { text: aiText, categories: "urgent, question, praise, spam" },
    });
  }
  if (has("sentiment", "mood", "tone", "emotion")) {
    detected.push({ type: "aiSentiment", params: { text: aiText } });
  }
  if (has("agent", "autonomous", "research assistant")) {
    detected.push({
      type: "aiAgent",
      params: {
        goal: `Complete this using the incoming item as context: ${prompt.slice(0, 180)}`,
        persona: "Diligent research and operations agent",
      },
    });
  } else if (has("reply", "respond", "chat", "answer", "write", "draft", "generate")) {
    detected.push({
      type: "aiChat",
      params: {
        systemPrompt: "You are a concise, brilliant assistant. Answer in at most 3 sentences.",
        prompt: `${prompt.slice(0, 180)} — use this item as context: {{ JSON.stringify($json).slice(0, 1500) }}`,
      },
    });
  }
  if (/\b(wait|delay|pause)\b/.test(lower)) {
    detected.push({ type: "wait", params: { amount: 1, unit: "s" } });
  }

  const wantsBranch =
    (/\b(if|when|whenever|route|branch|split)\b/.test(lower) ||
      detected.some((d) => d.type === "aiClassify" || d.type === "aiSentiment")) &&
    detected.length > 0;
  if (wantsBranch && detected.some((d) => d.type === "aiClassify")) {
    detected.push({
      type: "if",
      params: {
        conditions: [{ left: "{{ $json.label }}", operator: "equals", right: "urgent", combinator: "and" }],
      },
    });
  }

  const summaryUpstream = detected.some((d) => d.type === "aiSummarize");
  const deliverMessage = summaryUpstream ? "{{ $json.summary }}" : undefined;

  const integrations: { match: boolean; type: NodeType; params: Record<string, unknown> }[] = [
    { match: has("slack"), type: "slack", params: deliverMessage ? { message: deliverMessage } : {} },
    {
      match: has("email", "gmail", "e-mail", "newsletter", "mail"),
      type: "email",
      params: deliverMessage ? { subject: "Your BLISSVOID digest", body: deliverMessage } : {},
    },
    { match: has("notion"), type: "notion", params: {} },
    { match: has("sheet", "spreadsheet", "google sheets"), type: "googleSheets", params: {} },
    { match: has("telegram"), type: "telegram", params: deliverMessage ? { message: deliverMessage } : {} },
    { match: has("discord"), type: "discord", params: deliverMessage ? { message: deliverMessage } : {} },
    { match: has("github", "repo", "issue"), type: "github", params: {} },
    { match: has("stripe", "invoice", "payment", "charge"), type: "stripe", params: {} },
  ];
  for (const integration of integrations) {
    if (integration.match) detected.push({ type: integration.type, params: integration.params });
  }

  // The prompt implies delivery but no specific app was named.
  const impliesDelivery = /\b(send|post|notify|alert|announce|publish|deliver)\b/.test(lower);
  if (impliesDelivery && !detected.some((d) => NODE_MAP[d.type]?.category === "integration")) {
    detected.push({ type: "slack", params: deliverMessage ? { message: deliverMessage } : {} });
  }

  if (detected.length === 0) {
    detected.push({
      type: "aiChat",
      params: {
        systemPrompt: "You are a concise, brilliant assistant. Answer in at most 3 sentences.",
        prompt: prompt.slice(0, 300),
      },
    });
  }

  /* Assemble the chain */
  const nodes: DraftNode[] = [
    {
      id: "n_trigger",
      type: triggerType,
      name: NODE_MAP[triggerType]?.label ?? "Trigger",
      parameters: triggerParams,
    },
    ...detected.map((d, i) => ({
      id: `n_${i}_${d.type}`,
      type: d.type,
      name: NODE_MAP[d.type]?.label ?? d.type,
      parameters: d.params,
    })),
  ];

  const edges: DraftGraph["edges"] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ source: nodes[i].id, target: nodes[i + 1].id, sourceHandle: null });
  }

  const label = (t: string) => NODE_MAP[t]?.label ?? t;
  const keyLabels = detected.slice(0, 2).map((d) => label(d.type));
  const triggerWord =
    triggerType === "schedule" ? "Scheduled " : triggerType === "webhook" ? "Webhook " : "";
  const smartName = keyLabels.length
    ? `${triggerWord}${keyLabels.join(" to ")} Flow`
    : titleCase(prompt)
        .split(/\s+/)
        .slice(0, 5)
        .join(" ");

  return {
    name: (smartName || "Untitled flow").slice(0, 60),
    description: prompt.slice(0, 240),
    nodes,
    edges,
  };
}

/* --------------------------------- Route ---------------------------------- */

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Describe the workflow you want in a short prompt." },
        { status: 400 }
      );
    }
    const prompt = parsed.data.prompt.trim();

    let draft: DraftGraph | null = null;
    let note: string | undefined;

    draft = await draftFromLLM(prompt);
    if (!draft) {
      draft = buildWorkflowFromPrompt(prompt);
      note = "The architect model was unreachable — built with the deterministic planner instead.";
    }

    let nodes: WorkflowNode[];
    let edges: WorkflowEdge[];
    try {
      const assembled = finalizeDraft(draft);
      nodes = assembled.nodes;
      edges = assembled.edges;
    } catch {
      const fallback = buildWorkflowFromPrompt(prompt);
      const assembled = finalizeDraft(fallback);
      nodes = assembled.nodes;
      edges = assembled.edges;
      note = "The architect model was unreachable — built with the deterministic planner instead.";
    }

    const workflow = await db.workflow.create({
      data: {
        name: draft.name.slice(0, 120) || "Untitled flow",
        description: draft.description || null,
        active: false,
        tags: JSON.stringify(["ai-built"]),
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
      },
    });

    await db.activityLog.create({
      data: {
        kind: "workflow.ai_created",
        message: `Workflow "${workflow.name}" was conjured from the prompt: "${prompt.slice(0, 120)}"`,
        workflowId: workflow.id,
      },
    });

    return NextResponse.json({ workflow: mapWorkflow(workflow), note }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
