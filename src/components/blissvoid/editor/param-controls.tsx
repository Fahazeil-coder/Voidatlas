"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CodeEditor } from "./code-editor";
import { OPERATORS } from "@/lib/blissvoid/node-catalog";
import type {
  Assignment,
  Condition,
  NodeDefinition,
  ParamField,
} from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   Parameter form controls for the inspector. Renders every ParamField type
   from the node catalog, respects showIf, and shows a live preview chip for
   string values containing {{ $json.… }} expressions.
--------------------------------------------------------------------------- */

/* ------------------------- expression evaluation -------------------------- */

function resolvePath(root: unknown, path: string): unknown {
  const parts = path
    .trim()
    .replace(/^\$json\.?/, "")
    .split(".")
    .filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (Number.isInteger(idx) && idx >= 0 && idx < cur.length) {
        cur = cur[idx];
        continue;
      }
      return undefined;
    }
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return cur;
}

/** Evaluates {{ $json.path }} / {{ $now }} templates against the first input item. */
export function evaluateTemplate(tpl: string, item: unknown): string {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();
    if (trimmed === "$now") return new Date().toISOString();
    if (trimmed === "$json" || trimmed === "$json.") {
      if (item === undefined || item === null) return `{{ ${trimmed} }}`;
      return typeof item === "object" ? JSON.stringify(item) : String(item);
    }
    const value = resolvePath(item, trimmed);
    if (value === undefined || value === null) return `{{ ${trimmed} }}`;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

function ExpressionPreview({ value, sampleItem }: { value: string; sampleItem: unknown }) {
  if (!/{{[\s\S]*?}}/.test(value)) return null;
  const rendered = evaluateTemplate(value, sampleItem);
  return (
    <div className="mt-1.5 flex items-center gap-1.5 overflow-hidden rounded-md border border-[#7C5CFF]/20 bg-[#7C5CFF]/[0.07] px-2 py-1">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#7C5CFF]">
        preview
      </span>
      <span className="truncate font-[family-name:var(--font-jetbrains)] text-[10.5px] text-[#A8AECF]">
        {rendered}
      </span>
    </div>
  );
}

/* ------------------------------ shared styles ----------------------------- */

const inputCls =
  "h-8 rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] placeholder:text-[#6B7199] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60";

const selectTriggerCls =
  "h-8 rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60 w-full";

/* -------------------------------- rows ----------------------------------- */

function RowsControl({
  rows,
  onChange,
  firstPlaceholder,
  secondPlaceholder,
  addLabel,
}: {
  rows: { key: string; value: string }[];
  onChange: (next: { key: string; value: string }[]) => void;
  firstPlaceholder: string;
  secondPlaceholder: string;
  addLabel: string;
}) {
  const update = (i: number, patch: Partial<{ key: string; value: string }>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: "", value: "" }]);

  return (
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 && (
        <p className="text-[11px] italic text-[#6B7199]">No entries yet.</p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={firstPlaceholder}
            aria-label={`${firstPlaceholder} ${i + 1}`}
            className={cn(inputCls, "font-[family-name:var(--font-jetbrains)] min-w-0")}
          />
          <Input
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={secondPlaceholder}
            aria-label={`${secondPlaceholder} ${i + 1}`}
            className={cn(inputCls, "font-[family-name:var(--font-jetbrains)] min-w-0")}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove row ${i + 1}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7199] transition-colors hover:bg-[#FF5C7A]/10 hover:text-[#FF5C7A] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#FF5C7A]/40"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 self-start rounded-md border border-dashed border-[#F2F4FF]/15 px-2.5 py-1 text-[11px] font-medium text-[#A8AECF] transition-colors hover:border-[#7C5CFF]/50 hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
      >
        <Plus size={12} /> {addLabel}
      </button>
    </div>
  );
}

function ConditionsControl({
  value,
  onChange,
}: {
  value: Condition[];
  onChange: (next: Condition[]) => void;
}) {
  const rows = Array.isArray(value) ? value : [];
  const update = (i: number, patch: Partial<Condition>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...rows, { left: "", operator: "equals", right: "", combinator: "and" }]);

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className="text-[11px] italic text-[#6B7199]">No conditions — everything passes.</p>
      )}
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex flex-col gap-1.5 rounded-lg border border-[#F2F4FF]/[0.07] bg-[#0A0C1A]/60 p-2"
        >
          <div className="flex items-center gap-1.5">
            {i > 0 ? (
              <Select
                value={row.combinator ?? "and"}
                onValueChange={(v) => update(i, { combinator: v as "and" | "or" })}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`Combinator for condition ${i + 1}`}
                  className={cn(selectTriggerCls, "w-[64px] shrink-0 px-2 uppercase")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF]">
                  <SelectItem value="and" className="text-xs text-[#A8AECF] focus:bg-[#7C5CFF]/15 focus:text-[#F2F4FF]">
                    AND
                  </SelectItem>
                  <SelectItem value="or" className="text-xs text-[#A8AECF] focus:bg-[#7C5CFF]/15 focus:text-[#F2F4FF]">
                    OR
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="w-[64px] shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#6B7199]">
                {i === 0 ? "when" : ""}
              </span>
            )}
            <Input
              value={row.left}
              onChange={(e) => update(i, { left: e.target.value })}
              placeholder="Field or {{ $json.… }}"
              aria-label={`Left value, condition ${i + 1}`}
              className={cn(inputCls, "min-w-0 font-[family-name:var(--font-jetbrains)]")}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove condition ${i + 1}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7199] transition-colors hover:bg-[#FF5C7A]/10 hover:text-[#FF5C7A] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#FF5C7A]/40"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={row.operator} onValueChange={(v) => update(i, { operator: v })}>
              <SelectTrigger
                size="sm"
                aria-label={`Operator, condition ${i + 1}`}
                className={cn(selectTriggerCls, "w-[108px] shrink-0")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64 border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF]">
                {OPERATORS.map((op) => (
                  <SelectItem
                    key={op.value}
                    value={op.value}
                    className="text-xs text-[#A8AECF] focus:bg-[#7C5CFF]/15 focus:text-[#F2F4FF]"
                  >
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={row.right}
              onChange={(e) => update(i, { right: e.target.value })}
              placeholder="Value"
              aria-label={`Right value, condition ${i + 1}`}
              className={cn(inputCls, "min-w-0")}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 self-start rounded-md border border-dashed border-[#F2F4FF]/15 px-2.5 py-1 text-[11px] font-medium text-[#A8AECF] transition-colors hover:border-[#7C5CFF]/50 hover:text-[#F2F4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7C5CFF]/40"
      >
        <Plus size={12} /> Add condition
      </button>
    </div>
  );
}

function AssignmentsControl({
  value,
  onChange,
}: {
  value: Assignment[];
  onChange: (next: Assignment[]) => void;
}) {
  const rows = (Array.isArray(value) ? value : []).map((a) => ({ key: a.name, value: a.value }));
  return (
    <RowsControl
      rows={rows}
      onChange={(next) => onChange(next.map((r) => ({ name: r.key, value: r.value })))}
      firstPlaceholder="field name"
      secondPlaceholder="value or {{ … }}"
      addLabel="Add field"
    />
  );
}

function JsonControl({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (next: string) => void;
  label: string;
}) {
  const str =
    typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
  let valid = true;
  let parseError: string | null = null;
  if (str.trim() !== "") {
    try {
      JSON.parse(str);
    } catch (err) {
      valid = false;
      parseError = (err as Error).message;
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={str}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        spellCheck={false}
        aria-label={label}
        placeholder='[ { "id": 1 } ]'
        className={cn(
          "min-h-[76px] rounded-md border bg-[#0A0C1A]/80 font-[family-name:var(--font-jetbrains)] text-[11px] leading-5 text-[#F2F4FF] caret-[#7C5CFF] placeholder:text-[#6B7199]",
          valid
            ? "border-[#F2F4FF]/10 focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60"
            : "border-[#FF5C7A]/60 focus-visible:ring-[#FF5C7A]/40 text-[#FFC9D4]"
        )}
      />
      {!valid && (
        <p className="text-[10px] text-[#FF5C7A]" role="alert">
          Invalid JSON — {parseError}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ field switch ------------------------------ */

function FieldControl({
  field,
  value,
  sampleItem,
  onChange,
}: {
  field: ParamField;
  value: unknown;
  sampleItem: unknown;
  onChange: (next: unknown) => void;
}) {
  switch (field.type) {
    case "string": {
      const str = value == null ? "" : String(value);
      return (
        <div>
          <Input
            value={str}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder ?? ""}
            aria-label={field.label}
            className={inputCls}
          />
          <ExpressionPreview value={str} sampleItem={sampleItem} />
        </div>
      );
    }
    case "text": {
      const str = value == null ? "" : String(value);
      return (
        <div>
          <Textarea
            value={str}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            aria-label={field.label}
            placeholder={field.placeholder ?? ""}
            className="min-h-[64px] rounded-md border-[#F2F4FF]/10 bg-[#11142A]/70 text-xs text-[#F2F4FF] caret-[#7C5CFF] placeholder:text-[#6B7199] focus-visible:ring-[#7C5CFF]/40 focus-visible:border-[#7C5CFF]/60"
          />
          <ExpressionPreview value={str} sampleItem={sampleItem} />
        </div>
      );
    }
    case "number": {
      const num = typeof value === "number" ? value : value == null || value === "" ? "" : Number(value);
      return (
        <Input
          type="number"
          value={Number.isFinite(num as number) ? (num as number) : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          aria-label={field.label}
          className={inputCls}
        />
      );
    }
    case "select": {
      const current = value == null ? "" : String(value);
      return (
        <Select value={current} onValueChange={(v) => onChange(v)}>
          <SelectTrigger size="sm" aria-label={field.label} className={selectTriggerCls}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent className="max-h-64 border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF]">
            {(field.options ?? []).map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="text-xs text-[#A8AECF] focus:bg-[#7C5CFF]/15 focus:text-[#F2F4FF]"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "boolean": {
      const checked = value === true || value === "true";
      return (
        <div className="flex items-center justify-between rounded-md border border-[#F2F4FF]/10 bg-[#11142A]/70 px-3 py-1.5">
          <span className="text-xs text-[#A8AECF]">{checked ? "Enabled" : "Disabled"}</span>
          <Switch checked={checked} onCheckedChange={(v) => onChange(v)} aria-label={field.label} />
        </div>
      );
    }
    case "code":
      return (
        <CodeEditor
          value={value == null ? "" : String(value)}
          onChange={(next) => onChange(next)}
          rows={9}
          ariaLabel={field.label}
        />
      );
    case "json":
      return <JsonControl value={value} onChange={(next) => onChange(next)} label={field.label} />;
    case "conditions":
      return (
        <ConditionsControl
          value={Array.isArray(value) ? (value as Condition[]) : []}
          onChange={(next) => onChange(next)}
        />
      );
    case "assignments":
      return (
        <AssignmentsControl
          value={Array.isArray(value) ? (value as Assignment[]) : []}
          onChange={(next) => onChange(next)}
        />
      );
    case "keyvals":
      return (
        <RowsControl
          rows={Array.isArray(value) ? (value as { key: string; value: string }[]) : []}
          onChange={(next) => onChange(next)}
          firstPlaceholder="key"
          secondPlaceholder="value"
          addLabel="Add entry"
        />
      );
    default:
      return null;
  }
}

/* ------------------------------- main entry ------------------------------- */

export function ParamControls({
  def,
  params,
  sampleItem,
  onChange,
}: {
  def: NodeDefinition;
  params: Record<string, unknown>;
  sampleItem: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const visible = def.params.filter(
    (f) => !f.showIf || params[f.showIf.key] === f.showIf.equals
  );

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#F2F4FF]/10 p-4 text-center text-xs text-[#6B7199]">
        This node has no parameters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {visible.map((field) => {
        const value =
          params[field.key] !== undefined ? params[field.key] : field.default;
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-[#A8AECF]">
              {field.label}
            </span>
            <FieldControl
              field={field}
              value={value}
              sampleItem={sampleItem}
              onChange={(next) => onChange(field.key, next)}
            />
            {field.hint && (
              <p className="text-[10px] leading-4 text-[#6B7199]">{field.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
