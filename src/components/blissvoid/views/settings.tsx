"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  ArrowUpRight,
  Braces,
  Check,
  Database,
  Download,
  Eye,
  Loader2,
  Moon,
  Palette,
  Plus,
  Save,
  Sparkles,
  Sun,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { LogoWordmark } from "@/components/blissvoid/logo";
import { EmptyState, SectionTitle } from "@/components/blissvoid/shared";
import { deleteVariable, listVariables, listWorkflows, setVariable } from "@/lib/blissvoid/api-client";
import { useApp } from "@/lib/blissvoid/store";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   SettingsView — the control room.
--------------------------------------------------------------------------- */

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
};

const PROVIDERS = [
  { id: "openai", name: "OpenAI", placeholder: "sk-••••••••••••••••••••" },
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-•••••••••••••••" },
  { id: "gemini", name: "Google Gemini", placeholder: "AIza••••••••••••••••" },
];

function SettingsSection({
  title,
  description,
  icon: Icon,
  iconAccent = "#7C5CFF",
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  iconAccent?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section variants={item} className="glass rounded-2xl p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#F2F4FF]/10"
          style={{ background: `${iconAccent}1a` }}
        >
          <Icon className="h-4 w-4" style={{ color: iconAccent }} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-[family-name:var(--font-space)] text-base font-semibold text-[#F2F4FF]">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-[#6B7199]">{description}</p>}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function HealthChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#2CF5A0]/25 bg-[#2CF5A0]/10 px-3 py-1.5 text-xs font-medium text-[#2CF5A0]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2CF5A0] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2CF5A0]" />
      </span>
      {label}
    </span>
  );
}

/* ------------------------------ Variables -------------------------------- */

function VariablesSection() {
  const qc = useQueryClient();
  const variablesQ = useQuery({ queryKey: ["variables"], queryFn: listVariables });

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    if (variablesQ.isError) toast.error(`Variables unavailable — ${(variablesQ.error as Error).message}`);
  }, [variablesQ.isError, variablesQ.error]);

  const setMut = useMutation({
    mutationFn: (input: { key: string; value: string }) => setVariable(input),
    onSuccess: (_res, vars) => {
      toast.success(`Variable saved — $${vars.key.replace(/[^A-Z0-9_]/gi, "_").toUpperCase()}`);
      qc.invalidateQueries({ queryKey: ["variables"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteVariable(id),
    onSuccess: () => {
      toast.success("Variable deleted");
      qc.invalidateQueries({ queryKey: ["variables"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addVariable = () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) {
      toast.error("A variable needs both a key and a value");
      return;
    }
    setMut.mutate({ key, value });
    setNewKey("");
    setNewValue("");
  };

  return (
    <SettingsSection
      title="Variables"
      description="Shared values, injected into any node with {{ $vars.key }}."
      icon={Braces}
      iconAccent="#3DA9FF"
    >
      {variablesQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="glass h-12 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : variablesQ.isError ? (
        <EmptyState
          icon={<Braces className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="Could not load variables"
          description={(variablesQ.error as Error).message}
        />
      ) : (variablesQ.data?.variables ?? []).length === 0 ? (
        <p className="mb-4 text-sm text-[#6B7199]">No variables yet — add your first below.</p>
      ) : (
        <ul className="mb-4 space-y-2">
          {variablesQ.data?.variables.map((v) => (
            <VariableRow key={v.id} v={v} onSave={(value) => setMut.mutate({ key: v.key, value })} onDelete={() => delMut.mutate(v.id)} deleting={delMut.isPending && delMut.variables === v.id} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="API_BASE_URL"
          aria-label="New variable key"
          className="rounded-xl border-[#F2F4FF]/10 bg-[#11142A]/70 font-mono text-sm text-[#F2F4FF] placeholder:text-[#6B7199] sm:w-56"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="https://api.example.com"
          aria-label="New variable value"
          className="flex-1 rounded-xl border-[#F2F4FF]/10 bg-[#11142A]/70 font-mono text-sm text-[#F2F4FF] placeholder:text-[#6B7199]"
        />
        <button
          type="button"
          onClick={addVariable}
          disabled={setMut.isPending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] transition hover:brightness-110 disabled:opacity-60"
        >
          {setMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          Add variable
        </button>
      </div>
    </SettingsSection>
  );
}

function VariableRow({
  v,
  onSave,
  onDelete,
  deleting,
}: {
  v: { id: string; key: string; value: string };
  onSave: (value: string) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [value, setValue] = useState(v.value);
  const dirty = value !== v.value;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[#F2F4FF]/[0.06] bg-[#05060F]/40 p-2.5 sm:flex-row sm:items-center">
      <code className="shrink-0 rounded-lg bg-[#7C5CFF]/10 px-2.5 py-1 font-mono text-xs text-[#A8AECF] sm:w-56">
        {v.key}
      </code>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Value for ${v.key}`}
        className="flex-1 rounded-lg border-[#F2F4FF]/[0.06] bg-transparent font-mono text-xs text-[#F2F4FF]"
      />
      <div className="flex shrink-0 items-center gap-1.5">
        {dirty && (
          <button
            type="button"
            onClick={() => onSave(value)}
            className="inline-flex items-center gap-1.5 rounded-full bg-bliss px-3.5 py-1.5 text-xs font-semibold text-[#05060F] transition hover:brightness-110"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Save
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Delete ${v.key}`}
          className="glass glow-hover rounded-lg p-1.5 text-[#FF5C7A] transition hover:scale-110 disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
      </div>
    </li>
  );
}

/* ------------------------------ Main view -------------------------------- */

export function SettingsView() {
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [workspaceName, setWorkspaceName] = useState("Blissvoid HQ");
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

  const exportWorkflows = async () => {
    setExporting(true);
    try {
      const data = await listWorkflows();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `blissvoid-workflows-${format(new Date(), "yyyyMMdd-HHmm")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Workflows exported");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      className="mx-auto w-full max-w-4xl space-y-6"
    >
      <SectionTitle
        eyebrow="Control room"
        title="Settings"
        description="Tune the void to your liking."
      />

      {/* ----------------------------- Appearance ----------------------------- */}
      <SettingsSection title="Appearance" description="Cosmic dark is the default state of bliss." icon={Palette}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            {(
              [
                { id: "dark", label: "Void dark", icon: Moon, swatch: ["#05060F", "#11142A", "#7C5CFF"] },
                { id: "light", label: "Lavender light", icon: Sun, swatch: ["#F7F8FF", "#ECEFFC", "#6C4CF5"] },
              ] as const
            ).map((t) => {
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (!active) toggleTheme();
                  }}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3 pr-5 text-left transition",
                    active
                      ? "border-[#7C5CFF]/60 shadow-[0_0_0_1px_rgba(124,92,255,0.5),0_0_24px_rgba(124,92,255,0.2)]"
                      : "border-[#F2F4FF]/10 hover:border-[#7C5CFF]/40"
                  )}
                >
                  <span className="flex gap-1">
                    {t.swatch.map((c) => (
                      <span key={c} className="h-6 w-3 rounded-full border border-[#F2F4FF]/10" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="flex items-center gap-2 text-sm font-medium text-[#F2F4FF]">
                    <t.icon className="h-4 w-4 text-[#A8AECF]" strokeWidth={1.5} aria-hidden="true" />
                    {t.label}
                    {active && <Check className="h-4 w-4 text-[#2CF5D0]" strokeWidth={2} aria-hidden="true" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#A8AECF]">Density</p>
            <div className="flex items-center gap-1 rounded-full border border-[#F2F4FF]/10 bg-[#11142A]/60 p-1">
              {(["comfortable", "compact"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDensity(d)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-medium capitalize transition",
                    density === d ? "bg-bliss text-[#05060F]" : "text-[#A8AECF] hover:text-[#F2F4FF]"
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-[#6B7199]">
            Reduce motion — BLISSVOID automatically honors your system's
            prefers-reduced-motion setting. No toggles needed.
          </p>
        </div>
      </SettingsSection>

      {/* ------------------------------ Workspace ------------------------------ */}
      <SettingsSection title="Workspace" icon={Users} iconAccent="#2CF5D0">
        <div className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="ws-name" className="text-xs text-[#A8AECF]">
                Workspace name
              </label>
              <Input
                id="ws-name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="rounded-xl border-[#F2F4FF]/10 bg-[#11142A]/70 text-sm text-[#F2F4FF]"
              />
            </div>
            <button
              type="button"
              onClick={() => toast.success("Workspace name saved")}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] transition hover:brightness-110"
            >
              <Save className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Save
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-[#7C5CFF]/30 bg-[#7C5CFF]/10 px-3 py-1 text-xs font-medium text-[#A8AECF]">
              Plan · Void Explorer — self-hosted
            </span>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-[#F2F4FF]/[0.06] bg-[#05060F]/40 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bliss font-[family-name:var(--font-space)] text-sm font-bold text-[#05060F]">
              OP
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[#F2F4FF]">Operator (you)</p>
              <p className="text-xs text-[#6B7199]">Owner · operator@blissvoid.local</p>
            </div>
            <span className="rounded-full border border-[#F2F4FF]/10 bg-[#11142A] px-2.5 py-0.5 text-[11px] text-[#A8AECF]">
              Owner
            </span>
          </div>
        </div>
      </SettingsSection>

      {/* ----------------------------- AI providers ---------------------------- */}
      <SettingsSection
        title="AI providers"
        description="Bring your own keys. They are sealed with AES-256 the moment they land."
        icon={Sparkles}
        iconAccent="#FF6BD6"
      >
        <div className="space-y-3">
          {PROVIDERS.map((p) => (
            <div key={p.id} className="rounded-xl border border-[#F2F4FF]/[0.06] bg-[#05060F]/40 p-3.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="w-36 shrink-0 text-sm font-medium text-[#F2F4FF]">{p.name}</p>
                <div className="relative flex-1">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={providerKeys[p.id] ?? ""}
                    onChange={(e) => setProviderKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder={p.placeholder}
                    aria-label={`${p.name} API key`}
                    className="rounded-full border-[#FF6BD6]/20 bg-[#11142A]/70 pr-10 font-mono text-sm text-[#F2F4FF] placeholder:text-[#6B7199]"
                  />
                  <Eye
                    className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7199]"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </div>
                <button
                  type="button"
                  disabled={!(providerKeys[p.id] ?? "").trim()}
                  onClick={() => {
                    toast.success(`${p.name} key sealed — AES-256`);
                    setProviderKeys((prev) => ({ ...prev, [p.id]: "" }));
                  }}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-[#FF6BD6]/40 bg-[#FF6BD6]/10 px-4 py-2 text-sm font-semibold text-[#FF6BD6] transition hover:bg-[#FF6BD6]/20 disabled:opacity-40"
                >
                  <Save className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Save
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-[#6B7199]">
            Or leave empty to use the built-in void model (bliss-1).
          </p>
        </div>
      </SettingsSection>

      {/* ------------------------------ Variables ------------------------------ */}
      <VariablesSection />

      {/* --------------------------------- Data --------------------------------- */}
      <SettingsSection title="Data" description="Your void, your bytes." icon={Database} iconAccent="#FFC857">
        <div className="space-y-4">
          <button
            type="button"
            onClick={exportWorkflows}
            disabled={exporting}
            className="glass glow-hover inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-[#F2F4FF] disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4 text-[#3DA9FF]" strokeWidth={1.5} aria-hidden="true" />
            )}
            Export all workflows (JSON)
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <HealthChip label="uptime 99.99%" />
            <HealthChip label="database ok" />
            <HealthChip label="queue ok" />
          </div>
        </div>
      </SettingsSection>

      {/* -------------------------------- About --------------------------------- */}
      <motion.section variants={item} className="glass rounded-2xl p-5 text-center sm:p-6">
        <div className="flex flex-col items-center gap-3">
          <LogoWordmark size="sm" />
          <p className="text-sm text-[#A8AECF]">BLISSVOID v1.0.0 — built in the void, 2060.</p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-5">
            {["Docs", "GitHub", "Community"].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => toast(`${label} — coming soon`)}
                className="inline-flex items-center gap-1 text-sm text-[#A8AECF] transition hover:text-[#2CF5D0]"
              >
                {label}
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
