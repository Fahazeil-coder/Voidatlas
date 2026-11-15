import ZAI from "z-ai-web-dev-sdk";
import type { Assignment, Condition, WorkflowNode } from "@/lib/blissvoid/types";
import {
  buildNodeProxy,
  createContext,
  evaluateConditions,
  keyvals,
  resolveParams,
  resolveString,
  resolveTyped,
  type EvalContext,
  type Item,
} from "./expression";

/* ---------------------------------------------------------------------------
   BLISSVOID node executors — one implementation per catalog node type.
   Integrations are simulated (no external side effects); HTTP requests and
   AI nodes are real.
--------------------------------------------------------------------------- */

export type { Item } from "./expression";

export type NodeResult = Item[] | Record<string, Item[]>;

export interface TriggerData {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface RunContext {
  /** Completed outputs per node id (routing nodes hold handle -> items). */
  nodeOutputs: Map<string, NodeResult>;
  /** Flattened outputs per node NAME — powers $node["Name"].json. */
  nodeByName: Map<string, Item[]>;
  vars: Record<string, string>;
  triggerData?: TriggerData;
  log: (message: string) => void;
  recordAiUsage: (tokensIn: number, tokensOut: number) => void;
  /** Resolve an expression string against a specific item. */
  resolve: (str: string, item: Item) => string;
  /** Full eval context for an item (conditions, assignments, code). */
  contextFor: (item: Item) => EvalContext;
}

/* ------------------------------ Small utils ------------------------------ */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export function randId(prefix: string, len = 10): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}${out}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function wrapItem(value: unknown): Item {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if ("json" in rec && rec.json && typeof rec.json === "object") {
      return { json: asRecord(rec.json) };
    }
    return { json: rec };
  }
  return { json: { value } };
}

function parseSampleItems(params: Record<string, unknown>): Item[] | null {
  const raw = params.sampleData;
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map(wrapItem);
    } catch (err) {
      return [
        {
          json: {
            parseError: `sampleData is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          },
        },
      ];
    }
  }
  if (Array.isArray(raw) && raw.length > 0) return raw.map(wrapItem);
  return null;
}

/* ------------------------------- LLM helper ------------------------------- */

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>;
let zaiInstance: ZAIInstance | null = null;
let llmFailureLogged = false;

/**
 * Call the void model. System prompt travels with the 'assistant' role
 * (SDK contract). Returns null on any failure so callers can fall back.
 */
export async function callLLM(system: string, user: string, timeoutMs = 45000): Promise<string | null> {
  try {
    if (!zaiInstance) zaiInstance = await ZAI.create();
    const response = await Promise.race([
      zaiInstance.chat.completions.create({
        messages: [
          { role: "assistant", content: system },
          { role: "user", content: user },
        ],
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), timeoutMs)
      ),
    ]);
    const text = response.choices?.[0]?.message?.content;
    if (typeof text === "string" && text.trim().length > 0) return text.trim();
    return null;
  } catch (err) {
    if (!llmFailureLogged) {
      llmFailureLogged = true;
      console.error(
        "[blissvoid] LLM unreachable — using offline fallbacks:",
        err instanceof Error ? err.message : String(err)
      );
    }
    return null;
  }
}

/** Tolerant JSON extraction from an LLM reply (strips fences, finds {...}). */
export function tolerantJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const AI_COST_PER_TOKEN = 0.000003; // $3 per 1M tokens

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/* -------------------------------- Executor -------------------------------- */

export async function executeNode(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext
): Promise<NodeResult> {
  const params = node.parameters ?? {};
  switch (node.type) {
    /* ------------------------------- Triggers ------------------------------ */
    case "manualTrigger":
    case "errorTrigger":
      return (
        parseSampleItems(params) ?? [
          node.type === "errorTrigger"
            ? {
                json: {
                  error: "No upstream errors — this is a manual test of the safety net.",
                  workflow: "",
                  at: new Date().toISOString(),
                },
              }
            : wrapItem({ id: 1, note: "Manual trigger with no sample data." }),
        ]
      );

    case "webhook": {
      const sample = parseSampleItems(params);
      if (ctx.triggerData) {
        return [
          {
            json: {
              headers: ctx.triggerData.headers ?? {},
              query: ctx.triggerData.query ?? {},
              body: ctx.triggerData.body ?? {},
              method: ctx.triggerData.method ?? "POST",
              receivedAt: new Date().toISOString(),
            },
          },
        ];
      }
      return (
        sample ?? [
          {
            json: {
              headers: { "content-type": "application/json", "user-agent": "blissvoid-hook" },
              query: {},
              body: {},
              receivedAt: new Date().toISOString(),
            },
          },
        ]
      );
    }

    case "schedule":
      return (
        parseSampleItems(params) ?? [
          {
            json: {
              timestamp: new Date().toISOString(),
              cron: String(params.cron ?? params.mode ?? "0 9 * * *"),
              timezone: String(params.timezone ?? "America/Los_Angeles"),
            },
          },
        ]
      );

    case "formTrigger": {
      const sample = parseSampleItems(params);
      if (sample) return sample;
      const fields = keyvals(params.fields);
      const values: Record<string, unknown> = {
        formTitle: String(params.formTitle ?? "Contact us"),
        submittedAt: new Date().toISOString(),
      };
      for (const field of fields) {
        if (!field.key) continue;
        const type = field.value.toLowerCase();
        values[field.key] =
          type.includes("email") ? "ada@blissvoid.io"
          : type.includes("number") || type.includes("int") ? 42
          : `Sample ${field.key}`;
      }
      return [{ json: values }];
    }

    case "chatTrigger":
      return (
        parseSampleItems(params) ?? [
          {
            json: {
              message: String(params.welcome ?? "Hi! I'm your Blissvoid assistant."),
              session: randId("chat_", 6),
            },
          },
        ]
      );

    /* ------------------------------ HTTP (real) ---------------------------- */
    case "httpRequest":
      return executeHttpRequest(node, items, ctx);

    /* ------------------- Simulated integration deliveries ------------------ */
    case "slack": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        const channel = String(p.channel ?? "#automations");
        const message = String(p.message ?? "");
        ctx.log(`Slack (simulated) -> ${channel}`);
        out.push({
          json: {
            ...item.json,
            ok: true,
            delivered: "simulated",
            channel,
            message,
            ts: `17${Date.now().toString().slice(-8)}.000100`,
            _simulated: true,
          },
        });
      }
      return out;
    }

    case "email": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        out.push({
          json: {
            ...item.json,
            ok: true,
            delivered: "simulated",
            to: String(p.to ?? ""),
            subject: String(p.subject ?? ""),
            body: String(p.body ?? ""),
            messageId: `<${randId("", 12)}@blissvoid.io>`,
            _simulated: true,
          },
        });
      }
      return out;
    }

    case "notion": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        const pageId = randId("page_", 12);
        out.push({
          json: {
            ...item.json,
            ok: true,
            delivered: "simulated",
            database: String(p.database ?? ""),
            title: String(p.title ?? ""),
            properties: keyvals(p.properties),
            pageId,
            url: `https://notion.so/${pageId}`,
            _simulated: true,
          },
        });
      }
      return out;
    }

    case "googleSheets": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        out.push({
          json: {
            ...item.json,
            ok: true,
            delivered: "simulated",
            operation: String(p.operation ?? "append"),
            spreadsheetId: String(p.sheetId ?? ""),
            tabName: String(p.tabName ?? ""),
            columns: keyvals(p.columns),
            row: Math.floor(Math.random() * 900) + 100,
            _simulated: true,
          },
        });
      }
      return out;
    }

    case "telegram": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        out.push({
          json: {
            ...item.json,
            ok: true,
            delivered: "simulated",
            chatId: String(p.chatId ?? ""),
            message: String(p.message ?? ""),
            messageId: randId("tg_", 10),
            _simulated: true,
          },
        });
      }
      return out;
    }

    case "discord": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        out.push({
          json: {
            ...item.json,
            ok: true,
            delivered: "simulated",
            channel: String(p.channel ?? ""),
            message: String(p.message ?? ""),
            messageId: randId("dc_", 10),
            _simulated: true,
          },
        });
      }
      return out;
    }

    case "github": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        const operation = String(p.operation ?? "createIssue");
        const repo = String(p.repo ?? "acme/app");
        if (operation === "comment") {
          out.push({
            json: {
              ...item.json,
              ok: true,
              delivered: "simulated",
              operation,
              repo,
              body: String(p.body ?? ""),
              commentId: Math.floor(Math.random() * 900000) + 100000,
              url: `https://github.com/${repo}/issues`,
              _simulated: true,
            },
          });
        } else {
          const issueNumber = Math.floor(Math.random() * 999) + 1;
          out.push({
            json: {
              ...item.json,
              ok: true,
              delivered: "simulated",
              operation: "createIssue",
              repo,
              title: String(p.title ?? ""),
              body: String(p.body ?? ""),
              issueNumber,
              url: `https://github.com/${repo}/issues/${issueNumber}`,
              _simulated: true,
            },
          });
        }
      }
      return out;
    }

    case "stripe": {
      const out: Item[] = [];
      for (const item of items) {
        const p = resolveParams(params, ctx.contextFor(item));
        out.push({
          json: {
            ...item.json,
            ok: true,
            delivered: "simulated",
            customer: String(p.customer ?? ""),
            amount: Number(p.amount ?? 0) || 0,
            currency: String(p.currency ?? "usd"),
            invoiceId: randId("in_", 12),
            status: "paid",
            _simulated: true,
          },
        });
      }
      return out;
    }

    /* -------------------------------- Logic -------------------------------- */
    case "if": {
      const conditions = (Array.isArray(params.conditions) ? params.conditions : []) as Condition[];
      const pass: Item[] = [];
      const fail: Item[] = [];
      for (const item of items) {
        (evaluateConditions(conditions, ctx.contextFor(item)) ? pass : fail).push(item);
      }
      return { true: pass, false: fail };
    }

    case "switch": {
      const rules = keyvals(params.rules);
      // Ordered routes first, fallback last (nicer telemetry in the UI).
      const routes: Record<string, Item[]> = {};
      rules.forEach((_, index) => {
        routes[`route${index}`] = [];
      });
      routes.fallback = [];
      for (const item of items) {
        const value = ctx.resolve(String(params.value ?? ""), item);
        const match = rules.findIndex((rule) => rule.value === value);
        if (match >= 0) routes[`route${match}`].push(item);
        else routes.fallback.push(item);
      }
      return routes;
    }

    case "merge":
      // The engine already combined incoming edge data before calling.
      return items;

    case "wait": {
      const amount = Number(params.amount ?? 1) || 0;
      const unitMs = params.unit === "m" ? 60000 : 1000;
      const waitedMs = Math.min(Math.max(amount, 0) * unitMs, 8000);
      await sleep(waitedMs);
      return items.map((item) => ({ json: { ...item.json, waitedMs } }));
    }

    case "loop": {
      const batchSize = Math.max(1, Number(params.batchSize ?? 1) || 1);
      return {
        done: items.map((item, index) => ({
          json: { ...item.json, batchIndex: Math.floor(index / batchSize), batchSize },
        })),
      };
    }

    /* --------------------------------- Data -------------------------------- */
    case "set": {
      const assignments = (Array.isArray(params.assignments) ? params.assignments : []) as Assignment[];
      const keepOnlySet = params.keepOnlySet === true;
      return items.map((item) => {
        const next: Record<string, unknown> = keepOnlySet ? {} : { ...item.json };
        for (const assignment of assignments) {
          if (!assignment.name) continue;
          next[assignment.name] = resolveTyped(String(assignment.value ?? ""), ctx.contextFor(item));
        }
        return { json: next };
      });
    }

    case "filter": {
      const conditions = (Array.isArray(params.conditions) ? params.conditions : []) as Condition[];
      return items.filter((item) => evaluateConditions(conditions, ctx.contextFor(item)));
    }

    case "code":
      return executeCode(params, items);

    case "sort": {
      const field = String(params.field ?? "");
      const order = params.order === "asc" ? 1 : -1;
      const numeric = items.every((item) => {
        const v = item.json[field];
        return v !== undefined && v !== null && Number.isFinite(Number(v));
      });
      const sorted = [...items].sort((a, b) => {
        if (numeric) return (Number(a.json[field]) - Number(b.json[field])) * order;
        return String(a.json[field] ?? "").localeCompare(String(b.json[field] ?? "")) * order;
      });
      return sorted;
    }

    case "aggregate": {
      const operation = String(params.operation ?? "count");
      if (operation === "count") {
        return [{ json: { operation, result: items.length, count: items.length } }];
      }
      const field = String(params.field ?? params.fieldAvg ?? "");
      const nums = items
        .map((item) => Number(item.json[field]))
        .filter((n) => Number.isFinite(n));
      const sum = nums.reduce((acc, n) => acc + n, 0);
      const result = operation === "sum" ? sum : nums.length > 0 ? sum / nums.length : 0;
      return [
        {
          json: {
            operation,
            field,
            result: Math.round(result * 100) / 100,
            count: items.length,
          },
        },
      ];
    }

    /* ---------------------------------- AI --------------------------------- */
    case "aiChat":
      return executeAiChat(params, items, ctx);
    case "aiSummarize":
      return executeAiSummarize(params, items, ctx);
    case "aiClassify":
      return executeAiClassify(params, items, ctx);
    case "aiSentiment":
      return executeAiSentiment(params, items, ctx);
    case "aiAgent":
      return executeAiAgent(params, items, ctx);

    /* -------------------------------- Output ------------------------------- */
    case "respond": {
      const first = items[0] ?? { json: {} };
      const message = ctx.resolve(
        String(params.message ?? "Received. The void thanks you."),
        first
      );
      return items.map((item) => ({ json: { ...item.json, responseMessage: message } }));
    }

    case "noOp":
    default:
      return items;
  }
}

/* ----------------------------- HTTP executor ------------------------------ */

async function executeHttpRequest(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext
): Promise<Item[]> {
  const out: Item[] = [];
  for (const item of items) {
    const p = resolveParams(node.parameters ?? {}, ctx.contextFor(item));
    const method = String(p.method ?? "GET").toUpperCase();
    const rawUrl = String(p.url ?? "").trim();
    if (!rawUrl) throw new Error("HTTP Request: no URL configured");

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`HTTP Request: invalid URL "${rawUrl}"`);
    }
    for (const q of keyvals(p.queryParams)) {
      if (q.key) url.searchParams.set(q.key, q.value);
    }

    const headers: Record<string, string> = {};
    for (const kv of keyvals(p.headers)) {
      if (kv.key) headers[kv.key] = kv.value;
    }
    if (p.auth === "bearer" && p.token) {
      headers["Authorization"] = `Bearer ${p.token}`;
    }

    const timeoutMs = Number(p.timeoutMs ?? 15000) || 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      const hasBody = method !== "GET" && method !== "HEAD" && typeof p.body === "string" && p.body.trim() !== "";
      if (hasBody && !headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
      response = await fetch(url.toString(), {
        method,
        headers,
        body: hasBody ? String(p.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`HTTP request timed out after ${timeoutMs}ms`);
      }
      throw new Error(`HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    const rawText = await response.text();
    let data: unknown = rawText;
    if (typeof data === "string" && data.length > 8192) {
      data = data.slice(0, 8192);
    }
    try {
      data = JSON.parse(rawText);
    } catch {
      /* keep text (already capped above) */
    }

    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${truncate(rawText, 200)}`);
    }

    out.push({
      json: {
        statusCode: response.status,
        statusMessage: response.statusText || (response.ok ? "OK" : "Error"),
        headers: { "content-type": response.headers.get("content-type") ?? "" },
        data,
      },
    });
  }
  return out;
}

/* ------------------------------ Code executor ----------------------------- */

const CODE_BLOCKED = /\b(require|process|import|eval|Function|globalThis|window|document)\b/;

async function executeCode(
  params: Record<string, unknown>,
  items: Item[]
): Promise<Item[]> {
  const code = String(params.code ?? "");
  if (!code.trim()) return items;
  if (CODE_BLOCKED.test(code)) {
    throw new Error(
      "Code node rejected: require / process / import / eval / Function / globalThis / window / document are not allowed."
    );
  }

  const fn = new Function("items", "$json", `"use strict";\n${code}`);
  const firstJson = items[0]?.json ?? {};
  const result = await Promise.race([
    Promise.resolve(fn(items, firstJson)),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Code node timed out after 5000ms")), 5000)
    ),
  ]);

  if (result === null || result === undefined) {
    throw new Error("Code node returned nothing — return an array of objects.");
  }
  const arr = Array.isArray(result) ? result : [result];
  const out: Item[] = [];
  for (const element of arr) {
    if (element === null || element === undefined) continue;
    out.push(wrapItem(element));
  }
  return out;
}

/* ------------------------------- AI executors ----------------------------- */

function recordUsage(ctx: RunContext, prompt: string, reply: string) {
  const tokensIn = estimateTokens(prompt);
  const tokensOut = estimateTokens(reply);
  ctx.recordAiUsage(tokensIn, tokensOut);
}

async function executeAiChat(
  params: Record<string, unknown>,
  items: Item[],
  ctx: RunContext
): Promise<Item[]> {
  const systemPrompt = String(params.systemPrompt ?? "You are a concise, brilliant assistant.");
  const out: Item[] = [];
  let calls = 0;
  for (const item of items) {
    const prompt = ctx.resolve(String(params.prompt ?? ""), item);
    let text: string | null = null;
    if (calls < 5) {
      calls += 1;
      text = await callLLM(systemPrompt, prompt);
      if (text) recordUsage(ctx, `${systemPrompt}\n${prompt}`, text);
    }
    const aiResponse =
      text ?? `[The void model is unreachable — offline echo] ${truncate(prompt, 120)}`;
    out.push({
      json: {
        ...item.json,
        aiResponse,
        model: "bliss-1",
        tokensUsed: estimateTokens(prompt) + estimateTokens(aiResponse),
      },
    });
  }
  return out;
}

function fallbackSummary(text: string, style: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  if (style === "sentence") {
    return truncate(sentences[0] ?? text, 240);
  }
  if (style === "brief") {
    return truncate(sentences.slice(0, 3).join(" "), 420);
  }
  const bullets = sentences.slice(0, 4).map((s) => `- ${truncate(s, 140)}`);
  return bullets.length > 0 ? bullets.join("\n") : `- ${truncate(text, 200)}`;
}

async function executeAiSummarize(
  params: Record<string, unknown>,
  items: Item[],
  ctx: RunContext
): Promise<Item[]> {
  const style = String(params.style ?? "bullets");
  const styleHint =
    style === "sentence"
      ? "in exactly one sentence"
      : style === "brief"
        ? "as an executive brief of 3 sentences"
        : "as 3-5 bullet points (each starting with - )";
  const out: Item[] = [];
  for (const item of items) {
    const text = ctx.resolve(String(params.text ?? ""), item);
    const reply = await callLLM(
      `Summarize the user's text ${styleHint}. Reply with only the summary.`,
      truncate(text, 8000)
    );
    const summary = reply ?? fallbackSummary(text, style);
    if (reply) recordUsage(ctx, text, reply);
    out.push({ json: { ...item.json, summary, style } });
  }
  return out;
}

async function executeAiClassify(
  params: Record<string, unknown>,
  items: Item[],
  ctx: RunContext
): Promise<Item[]> {
  const categories = String(params.categories ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const out: Item[] = [];
  for (const item of items) {
    const text = ctx.resolve(String(params.text ?? ""), item);
    const reply = await callLLM(
      `Classify the text into exactly one of: ${categories.join(", ")}. Respond with only JSON {"label": "...", "confidence": 0 to 1}.`,
      truncate(text, 8000)
    );
    let label = categories.includes("question") ? "question" : (categories[0] ?? "question");
    let confidence = 0.5;
    if (reply) {
      const parsed = tolerantJson(reply);
      if (parsed && typeof parsed.label === "string") {
        label = parsed.label;
        confidence = Number(parsed.confidence);
        if (!Number.isFinite(confidence)) confidence = 0.8;
      }
      recordUsage(ctx, text, reply);
    }
    out.push({ json: { ...item.json, label, confidence, categories } });
  }
  return out;
}

const POSITIVE_WORDS = ["love", "great", "awesome", "happy", "excellent", "amazing", "wonderful", "fantastic", "good", "thanks", "delightful", "pleased"];
const NEGATIVE_WORDS = ["hate", "terrible", "awful", "broken", "angry", "bad", "worst", "slow", "bug", "frustrating", "disappointed", "cancel", "refund", "crash"];

function heuristicSentiment(text: string): { score: number; label: string } {
  const lower = text.toLowerCase();
  const pos = POSITIVE_WORDS.filter((w) => lower.includes(w)).length;
  const neg = NEGATIVE_WORDS.filter((w) => lower.includes(w)).length;
  const total = pos + neg;
  const score = total === 0 ? 0 : Math.round(((pos - neg) / total) * 100) / 100;
  const label = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
  return { score, label };
}

async function executeAiSentiment(
  params: Record<string, unknown>,
  items: Item[],
  ctx: RunContext
): Promise<Item[]> {
  const out: Item[] = [];
  for (const item of items) {
    const text = ctx.resolve(String(params.text ?? ""), item);
    const reply = await callLLM(
      'Score the sentiment of the text from -1 (very negative) to 1 (very positive). Respond with only JSON {"score": number, "label": "positive"|"neutral"|"negative"}.',
      truncate(text, 8000)
    );
    let sentiment = heuristicSentiment(text);
    if (reply) {
      const parsed = tolerantJson(reply);
      if (parsed && typeof parsed.label === "string") {
        const score = Number(parsed.score);
        sentiment = {
          score: Number.isFinite(score) ? Math.round(score * 100) / 100 : 0,
          label: parsed.label,
        };
      }
      recordUsage(ctx, text, reply);
    }
    out.push({ json: { ...item.json, sentiment: sentiment.label, score: sentiment.score } });
  }
  return out;
}

async function executeAiAgent(
  params: Record<string, unknown>,
  items: Item[],
  ctx: RunContext
): Promise<Item[]> {
  const persona = String(params.persona ?? "Support agent with a friendly, precise tone");
  const out: Item[] = [];
  for (const item of items) {
    const goal = ctx.resolve(String(params.goal ?? ""), item);
    const contextJson = JSON.stringify(item.json).slice(0, 4000);
    const user = `Goal: ${goal}\n\nItem context (JSON):\n${contextJson}`;
    const reply = await callLLM(
      `You are ${persona}. Complete the goal precisely and concisely.`,
      user
    );
    const finalReply = reply ?? `[Agent offline — echoing goal] ${truncate(goal, 120)}`;
    if (reply) recordUsage(ctx, user, reply);
    out.push({ json: { ...item.json, reply: finalReply, steps: 1, persona } });
  }
  return out;
}

/* --------------------------- Context construction ------------------------- */

/** Build a RunContext bound to live node output maps (engine-owned). */
export function createRunContext(opts: {
  nodeOutputs: Map<string, NodeResult>;
  nodeByName: Map<string, Item[]>;
  vars: Record<string, string>;
  triggerData?: TriggerData;
  log?: (message: string) => void;
  recordAiUsage?: (tokensIn: number, tokensOut: number) => void;
}): RunContext {
  const nodeProxy = buildNodeProxy(opts.nodeByName);
  const contextFor = (item: Item): EvalContext =>
    createContext({
      json: item.json,
      node: nodeProxy,
      input: [item],
      vars: opts.vars,
    });
  return {
    nodeOutputs: opts.nodeOutputs,
    nodeByName: opts.nodeByName,
    vars: opts.vars,
    triggerData: opts.triggerData,
    log: opts.log ?? (() => undefined),
    recordAiUsage: opts.recordAiUsage ?? (() => undefined),
    resolve: (str, item) => resolveString(str, contextFor(item)),
    contextFor,
  };
}
