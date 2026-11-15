import type {
  CredentialDTO,
  ExecutionDTO,
  StatsDTO,
  TemplateDTO,
  WorkflowDTO,
  WorkflowEdge,
  WorkflowNode,
} from "./types";

/* ---------------------------------------------------------------------------
   BLISSVOID typed API client (all requests are relative, same-origin).
--------------------------------------------------------------------------- */

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

/* ------------------------------ Workflows ------------------------------ */

export function listWorkflows() {
  return req<{ workflows: WorkflowDTO[] }>("/api/workflows");
}

export function getWorkflow(id: string) {
  return req<{ workflow: WorkflowDTO }>(`/api/workflows/${id}`);
}

export function createWorkflow(input: {
  name: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  tags?: string[];
}) {
  return req<{ workflow: WorkflowDTO }>("/api/workflows", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWorkflow(
  id: string,
  patch: Partial<Pick<WorkflowDTO, "name" | "description" | "active" | "tags" | "nodes" | "edges" | "folder">>
) {
  return req<{ workflow: WorkflowDTO }>(`/api/workflows/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteWorkflow(id: string) {
  return req<{ ok: true }>(`/api/workflows/${id}`, { method: "DELETE" });
}

export function duplicateWorkflow(id: string) {
  return req<{ workflow: WorkflowDTO }>(`/api/workflows/${id}/duplicate`, { method: "POST" });
}

export function runWorkflow(id: string, input?: unknown[]) {
  return req<{ execution: ExecutionDTO }>(`/api/workflows/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

/* ------------------------------ Executions ------------------------------ */

export function listExecutions(params?: { limit?: number; status?: string; workflowId?: string }) {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.status) q.set("status", params.status);
  if (params?.workflowId) q.set("workflowId", params.workflowId);
  const qs = q.toString();
  return req<{ executions: ExecutionDTO[] }>(`/api/executions${qs ? `?${qs}` : ""}`);
}

export function getExecution(id: string) {
  return req<{ execution: ExecutionDTO }>(`/api/executions/${id}`);
}

export function deleteExecution(id: string) {
  return req<{ ok: true }>(`/api/executions/${id}`, { method: "DELETE" });
}

export function retryExecution(id: string) {
  return req<{ execution: ExecutionDTO }>(`/api/executions/${id}/retry`, { method: "POST" });
}

/* ------------------------------ Credentials ------------------------------ */

export function listCredentials() {
  return req<{ credentials: CredentialDTO[] }>("/api/credentials");
}

export function createCredential(input: { name: string; type: string; data: Record<string, string> }) {
  return req<{ credential: CredentialDTO }>("/api/credentials", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteCredential(id: string) {
  return req<{ ok: true }>(`/api/credentials/${id}`, { method: "DELETE" });
}

export function testCredential(id: string) {
  return req<{ ok: boolean; message: string }>(`/api/credentials/${id}/test`, { method: "POST" });
}

/* ------------------------------ Templates ------------------------------ */

export function listTemplates() {
  return req<{ templates: TemplateDTO[] }>("/api/templates");
}

export function useTemplate(id: string) {
  return req<{ workflow: WorkflowDTO }>(`/api/templates/${id}/use`, { method: "POST" });
}

/* ------------------------------ Stats ------------------------------ */

export function getStats() {
  return req<StatsDTO>("/api/stats");
}

/* ------------------------------ AI ------------------------------ */

export function aiBuildWorkflow(prompt: string) {
  return req<{ workflow: WorkflowDTO; note?: string }>("/api/ai/build-workflow", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export function aiNodeAssistant(input: { task: string; context?: string }) {
  return req<{ result: string }>("/api/ai/node-assistant", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function aiExecutionDoctor(executionId: string) {
  return req<{ diagnosis: string }>("/api/ai/execution-doctor", {
    method: "POST",
    body: JSON.stringify({ executionId }),
  });
}

/* ------------------------------ System ------------------------------ */

export function seedIfNeeded() {
  return req<{ seeded: boolean }>("/api/seed", { method: "POST" });
}

export function listVariables() {
  return req<{ variables: { id: string; key: string; value: string }[] }>("/api/variables");
}

export function setVariable(input: { key: string; value: string }) {
  return req<{ ok: true }>("/api/variables", { method: "POST", body: JSON.stringify(input) });
}

export function deleteVariable(id: string) {
  return req<{ ok: true }>(`/api/variables/${id}`, { method: "DELETE" });
}
