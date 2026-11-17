import type { Condition } from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   BLISSVOID expression engine.
   Resolves {{ ... }} templates against the current item, upstream node
   outputs, variables and the clock. Plain JavaScript is allowed inside
   the mustaches: {{ $json.price * 1.2 }}.
--------------------------------------------------------------------------- */

export type Item = { json: Record<string, unknown> };

export interface NodeRef {
  json: Record<string, unknown>;
  items: Item[];
}

export interface EvalContext {
  /** Current item json ({{ $json.email }}). */
  json: Record<string, unknown>;
  /** Outputs of previously executed nodes, keyed by node NAME. */
  node: Record<string, NodeRef>;
  /** ISO timestamp captured when the context was created. */
  now: string;
  /** All items currently entering the node. */
  input: Item[];
  /** Instance variables map. */
  vars: Record<string, string>;
  /** Collected resolution warnings (shown in the run panel). */
  warnings: string[];
}

const EXPR_PATTERN = /\{\{([^}]+)\}\}/g;
const BLOCKED_PATTERN = /\b(require|process|globalThis|global|import|eval|Function|constructor|__proto__|prototype|Reflect|Proxy|Bun|Deno|window|document)\b/;

function evaluateRaw(expr: string, ctx: EvalContext): unknown {
  const fn = new Function(
    "$json",
    "$node",
    "$now",
    "$input",
    "$vars",
    `"use strict"; return (${expr});`
  );
  return fn(ctx.json, ctx.node, ctx.now, ctx.input, ctx.vars);
}

/**
 * Resolve every {{ ... }} block inside a string. On failure the original
 * {{ ... }} text is kept (so the UI can show the raw expression) and a
 * warning is collected on the context.
 */
export function resolveString(str: string, ctx: EvalContext): string {
  if (typeof str !== "string" || !str.includes("{{")) return str;
  return str.replace(EXPR_PATTERN, (original, rawExpr: string) => {
    const expr = rawExpr.trim();
    if (!expr) return original;
    if (BLOCKED_PATTERN.test(expr)) {
      ctx.warnings.push(`Expression blocked for safety: {{ ${expr} }}`);
      return original;
    }
    try {
      const value = evaluateRaw(expr, ctx);
      if (value === undefined) return original;
      if (value === null) return "null";
      if (typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    } catch {
      ctx.warnings.push(`Could not resolve {{ ${expr} }}`);
      return original;
    }
  });
}

/**
 * Resolve a value that is exactly one {{ ... }} expression, preserving the
 * underlying type (number, boolean, object) instead of stringifying it.
 * Anything else falls back to string resolution.
 */
export function resolveTyped(value: string, ctx: EvalContext): unknown {
  if (typeof value !== "string") return value;
  const full = value.match(/^\s*\{\{([^}]+)\}\}\s*$/);
  if (!full) return resolveString(value, ctx);
  const expr = full[1].trim();
  if (!expr || BLOCKED_PATTERN.test(expr)) return resolveString(value, ctx);
  try {
    const evaluated = evaluateRaw(expr, ctx);
    if (evaluated === undefined) return resolveString(value, ctx);
    return evaluated;
  } catch {
    ctx.warnings.push(`Could not resolve {{ ${expr} }}`);
    return resolveString(value, ctx);
  }
}

/** Keys whose values are raw user input that must never be templated. */
const RAW_KEYS = new Set(["code", "conditions", "assignments"]);

function resolveDeep(value: unknown, ctx: EvalContext): unknown {
  if (typeof value === "string") return resolveString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = RAW_KEYS.has(k) ? v : resolveDeep(v, ctx);
    }
    return out;
  }
  return value;
}

/**
 * Deep-resolve every string value inside a parameters object.
 * Keys named "code" (and other raw-input keys) are left untouched.
 */
export function resolveParams(
  params: Record<string, unknown> | null | undefined,
  ctx: EvalContext
): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  return resolveDeep(params, ctx) as Record<string, unknown>;
}

export function createContext(opts: {
  json?: Record<string, unknown>;
  node?: Record<string, NodeRef>;
  input?: Item[];
  vars?: Record<string, string>;
}): EvalContext {
  return {
    json: opts.json ?? {},
    node: opts.node ?? {},
    now: new Date().toISOString(),
    input: opts.input ?? [],
    vars: opts.vars ?? {},
    warnings: [],
  };
}

/** Build a lazy $node proxy so $node["Some Name"].json resolves on demand. */
export function buildNodeProxy(nodeByName: Map<string, Item[]>): Record<string, NodeRef> {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        const items = nodeByName.get(prop) ?? [];
        return { json: items[0]?.json ?? {}, items };
      },
    }
  );
}

/* ------------------------------ Conditions ------------------------------ */

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Evaluate a single condition. `left` and `right` are resolved through the
 * expression engine first, then compared with the requested operator.
 * Numeric comparison is used when both sides parse as numbers.
 */
export function evaluateCondition(
  left: string,
  operator: string,
  right: string,
  itemCtx: EvalContext
): boolean {
  const resolvedLeftRaw = resolveString(String(left ?? ""), itemCtx);
  const resolvedRightRaw = resolveString(String(right ?? ""), itemCtx);

  // If the left side still contains an unresolved template, treat the
  // expression text itself as the value (it will usually fail gracefully
  // against an empty right side).
  const leftText = resolvedLeftRaw;
  const rightText = resolvedRightRaw;

  const numL = toNumber(leftText);
  const numR = toNumber(rightText);
  const bothNumeric = numL !== null && numR !== null;

  switch (operator) {
    case "equals":
      return bothNumeric ? numL === numR : leftText === rightText;
    case "notEquals":
      return bothNumeric ? numL !== numR : leftText !== rightText;
    case "contains":
      return leftText.toLowerCase().includes(rightText.toLowerCase());
    case "notContains":
      return !leftText.toLowerCase().includes(rightText.toLowerCase());
    case "startsWith":
      return leftText.toLowerCase().startsWith(rightText.toLowerCase());
    case "endsWith":
      return leftText.toLowerCase().endsWith(rightText.toLowerCase());
    case "gt":
      return bothNumeric ? numL > numR : leftText > rightText;
    case "gte":
      return bothNumeric ? numL >= numR : leftText >= rightText;
    case "lt":
      return bothNumeric ? numL < numR : leftText < rightText;
    case "lte":
      return bothNumeric ? numL <= numR : leftText <= rightText;
    case "isEmpty":
      return isEmptyValue(leftText);
    case "isNotEmpty":
      return !isEmptyValue(leftText);
    case "isTrue":
      return leftText === true.toString() || leftText === "1" || leftText.toLowerCase() === "yes";
    case "isFalse":
      return leftText === false.toString() || leftText === "0" || leftText.toLowerCase() === "no";
    case "regex":
      try {
        return new RegExp(rightText).test(leftText);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Evaluate a full condition list with and/or combination. */
export function evaluateConditions(conditions: Condition[], itemCtx: EvalContext): boolean {
  if (!conditions || conditions.length === 0) return true;
  const useOr = conditions.some((c) => c.combinator === "or");
  const results = conditions.map((c) =>
    evaluateCondition(c.left, c.operator, c.right, itemCtx)
  );
  return useOr ? results.some(Boolean) : results.every(Boolean);
}

/** Normalize keyval param arrays ({ key, value }[] from the inspector). */
export function keyvals(value: unknown): { key: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { key: string; value: string } => !!v && typeof v === "object" && "key" in v)
    .map((v) => ({ key: String(v.key ?? ""), value: String(v.value ?? "") }));
}
