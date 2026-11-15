"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  Bot,
  CreditCard,
  Github,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  NotebookPen,
  Plus,
  Send,
  ShieldCheck,
  Slack,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, SectionTitle, StatusBadge, timeAgo } from "@/components/blissvoid/shared";
import { createCredential, deleteCredential, listCredentials, testCredential } from "@/lib/blissvoid/api-client";
import { CREDENTIAL_TYPES } from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   CredentialsView — the vault.
--------------------------------------------------------------------------- */

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 20 } },
};

const TYPE_META: Record<string, { icon: LucideIcon; accent: string }> = {
  httpHeaderAuth: { icon: KeyRound, accent: "#3DA9FF" },
  httpBearerAuth: { icon: KeyRound, accent: "#3DA9FF" },
  basicAuth: { icon: Globe, accent: "#3DA9FF" },
  slackApi: { icon: Slack, accent: "#7C5CFF" },
  openaiApi: { icon: Bot, accent: "#FF6BD6" },
  anthropicApi: { icon: Bot, accent: "#FF6BD6" },
  gmailOAuth2: { icon: Mail, accent: "#2CF5A0" },
  googleSheetsOAuth2: { icon: Table2, accent: "#2CF5A0" },
  notionApi: { icon: NotebookPen, accent: "#F2F4FF" },
  telegramApi: { icon: Send, accent: "#3DA9FF" },
  githubApi: { icon: Github, accent: "#A8AECF" },
  stripeApi: { icon: CreditCard, accent: "#FFC857" },
};

const CRED_FIELDS: Record<string, { key: string; label: string }[]> = {
  httpHeaderAuth: [
    { key: "name", label: "Header Name" },
    { key: "value", label: "Header Value" },
  ],
  httpBearerAuth: [{ key: "token", label: "Token" }],
  basicAuth: [
    { key: "user", label: "User" },
    { key: "password", label: "Password" },
  ],
  slackApi: [
    { key: "botToken", label: "Bot Token" },
    { key: "channel", label: "Channel" },
  ],
  openaiApi: [{ key: "apiKey", label: "API Key" }],
  anthropicApi: [{ key: "apiKey", label: "API Key" }],
  gmailOAuth2: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret" },
    { key: "refreshToken", label: "Refresh Token" },
  ],
  googleSheetsOAuth2: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret" },
  ],
  notionApi: [{ key: "token", label: "Internal Integration Token" }],
  telegramApi: [{ key: "botToken", label: "Bot Token" }],
  githubApi: [{ key: "pat", label: "Personal Access Token" }],
  stripeApi: [{ key: "secretKey", label: "Secret Key" }],
};

function typeLabel(type: string): string {
  return CREDENTIAL_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function CredentialsView() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const credentialsQ = useQuery({ queryKey: ["credentials"], queryFn: listCredentials });

  const testMut = useMutation({
    mutationFn: (id: string) => testCredential(id),
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message || "Connection verified");
      else toast.error(res.message || "Connection failed");
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteCredential(id),
    onSuccess: () => {
      toast.success("Credential removed from the vault");
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["credentials"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const credentials = credentialsQ.data?.credentials ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <SectionTitle
        eyebrow="Vault"
        title="Credentials"
        description="Sealed connections for every external service your workflows touch."
        action={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] shadow-[0_0_24px_rgba(124,92,255,0.35)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Add credential
          </button>
        }
      />

      {/* --------------------------- Security banner --------------------------- */}
      <div className="glass flex items-start gap-4 rounded-2xl p-5 sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#2CF5A0]/20 bg-[#2CF5A0]/10">
          <ShieldCheck className="h-5 w-5 text-[#2CF5A0]" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-[#F2F4FF]">Encrypted at rest with AES-256-GCM.</p>
          <p className="mt-0.5 text-sm text-[#A8AECF]">Secrets never leave your void in plaintext.</p>
        </div>
      </div>

      {/* -------------------------------- Grid -------------------------------- */}
      {credentialsQ.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass h-44 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : credentialsQ.isError ? (
        <EmptyState
          icon={<KeyRound className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="Could not open the vault"
          description={(credentialsQ.error as Error).message}
        />
      ) : credentials.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />}
          title="The vault is empty"
          description="Add your first credential — API keys, OAuth tokens and logins, all sealed with AES-256."
          action={
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> Add credential
            </button>
          }
        />
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {credentials.map((c) => {
            const meta = TYPE_META[c.type] ?? { icon: KeyRound, accent: "#7C5CFF" };
            const testing = testMut.isPending && testMut.variables === c.id;
            return (
              <motion.div
                key={c.id}
                variants={item}
                whileHover={{ y: -2 }}
                className="glass glow-hover flex flex-col rounded-2xl p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#F2F4FF]/10"
                    style={{ background: `${meta.accent}1a` }}
                  >
                    <meta.icon className="h-5 w-5" style={{ color: meta.accent }} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <StatusBadge status={c.status === "verified" ? "active" : "inactive"} />
                </div>
                <h3 className="mt-4 truncate font-[family-name:var(--font-space)] text-base font-semibold text-[#F2F4FF]">
                  {c.name}
                </h3>
                <p className="mt-0.5 text-xs text-[#6B7199]">{typeLabel(c.type)}</p>
                <p className="mt-3 truncate rounded-lg border border-[#F2F4FF]/[0.06] bg-[#05060F]/60 px-2.5 py-1.5 font-mono text-xs text-[#A8AECF]">
                  {c.maskedPreview ?? "••••••••••••"}
                </p>
                <p className="mt-2 text-[11px] text-[#6B7199]">
                  {c.lastTestedAt ? `tested ${timeAgo(c.lastTestedAt)}` : "never tested"}
                </p>
                <div className="mt-4 flex items-center gap-2 border-t border-[#F2F4FF]/[0.06] pt-4">
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => testMut.mutate(c.id)}
                    className="glass glow-hover inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-[#F2F4FF] disabled:opacity-60"
                  >
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5 text-[#2CF5A0]" strokeWidth={1.5} aria-hidden="true" />
                    )}
                    Test connection
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${c.name}`}
                    title="Delete"
                    onClick={() => setDeleteId(c.id)}
                    className="glass glow-hover rounded-full p-2 text-[#FF5C7A] transition hover:scale-110"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ----------------------------- Add dialog ----------------------------- */}
      <AddCredentialDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["credentials"] });
          qc.invalidateQueries({ queryKey: ["stats"] });
        }}
      />

      {/* --------------------------- Delete confirm --------------------------- */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="glass-strong border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-[family-name:var(--font-space)] text-[#F2F4FF]">
              Remove this credential?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#A8AECF]">
              Nodes using this credential may start failing. The secret will be wiped from the
              vault permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-[#F2F4FF]/10 bg-transparent text-[#A8AECF] hover:text-[#F2F4FF]">
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && delMut.mutate(deleteId)}
              className="rounded-full bg-[#FF5C7A] font-semibold text-[#05060F] hover:bg-[#FF5C7A]/85"
            >
              Remove credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ----------------------------- Add dialog -------------------------------- */

function AddCredentialDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(CREDENTIAL_TYPES[0].value);
  const [data, setData] = useState<Record<string, string>>({});

  const fields = CRED_FIELDS[type] ?? [];
  const valid =
    name.trim().length > 0 && fields.every((f) => (data[f.key] ?? "").trim().length > 0);

  const createMut = useMutation({
    mutationFn: () =>
      createCredential({
        name: name.trim(),
        type,
        data: Object.fromEntries(fields.map((f) => [f.key, (data[f.key] ?? "").trim()])),
      }),
    onSuccess: () => {
      toast.success("Credential sealed in the vault");
      onCreated();
      setName("");
      setData({});
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-[#F2F4FF]/10 bg-[#0A0C1A] text-[#F2F4FF] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-space)] text-[#F2F4FF]">
            Add credential
          </DialogTitle>
          <DialogDescription className="text-[#A8AECF]">
            The secret is encrypted with AES-256-GCM before it touches disk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cred-name" className="text-xs text-[#A8AECF]">
              Name
            </Label>
            <Input
              id="cred-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production Slack bot"
              className="rounded-xl border-[#F2F4FF]/10 bg-[#11142A]/70 text-sm text-[#F2F4FF] placeholder:text-[#6B7199]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-[#A8AECF]">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v);
                setData({});
              }}
            >
              <SelectTrigger className="w-full rounded-xl border-[#F2F4FF]/10 bg-[#11142A]/70 text-sm text-[#F2F4FF]">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {CREDENTIAL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`cred-${f.key}`} className="text-xs text-[#A8AECF]">
                {f.label}
              </Label>
              <Input
                id={`cred-${f.key}`}
                type="password"
                autoComplete="off"
                value={data[f.key] ?? ""}
                onChange={(e) => setData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder="••••••••••••"
                className="rounded-xl border-[#F2F4FF]/10 bg-[#11142A]/70 font-mono text-sm text-[#F2F4FF] placeholder:text-[#6B7199]"
              />
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="glass glow-hover rounded-full px-5 py-2.5 text-sm font-semibold text-[#A8AECF] transition hover:text-[#F2F4FF]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || createMut.isPending}
            onClick={() => createMut.mutate()}
            className="inline-flex items-center gap-2 rounded-full bg-bliss px-5 py-2.5 text-sm font-semibold text-[#05060F] shadow-[0_0_24px_rgba(124,92,255,0.35)] transition hover:brightness-110 disabled:opacity-50"
          >
            {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Seal in vault
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
