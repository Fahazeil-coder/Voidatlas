/* ---------------------------------------------------------------------------
   BLISSVOID core domain types — shared by engine, API routes and the UI.
--------------------------------------------------------------------------- */

export type NodeCategory = "trigger" | "action" | "logic" | "data" | "ai" | "integration";

export type NodeType =
  // Triggers
  | "manualTrigger"
  | "webhook"
  | "schedule"
  | "formTrigger"
  | "chatTrigger"
  | "errorTrigger"
  // Actions
  | "httpRequest"
  | "slack"
  | "email"
  | "notion"
  | "googleSheets"
  | "telegram"
  | "discord"
  | "github"
  | "stripe"
  // Logic
  | "if"
  | "switch"
  | "merge"
  | "wait"
  | "loop"
  // Data
  | "set"
  | "filter"
  | "code"
  | "sort"
  | "aggregate"
  // AI
  | "aiChat"
  | "aiSummarize"
  | "aiClassify"
  | "aiSentiment"
  | "aiAgent"
  // Output
  | "respond"
  | "noOp";

export type ParamFieldType =
  | "string"
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "code"
  | "json"
  | "conditions"
  | "assignments"
  | "keyvals";

export interface Condition {
  left: string;
  operator: string;
  right: string;
  combinator?: "and" | "or";
}

export interface Assignment {
  name: string;
  value: string;
}

export interface ParamField {
  key: string;
  label: string;
  type: ParamFieldType;
  options?: { label: string; value: string }[];
  default?: unknown;
  placeholder?: string;
  hint?: string;
  showIf?: { key: string; equals: unknown };
}

export interface NodeDefinition {
  type: NodeType;
  label: string;
  description: string;
  category: NodeCategory;
  icon: string; // lucide icon name
  accent: string; // hex accent color
  inputs: string[]; // input handle ids
  outputs: string[]; // output handle ids
  params: ParamField[];
  defaultParams: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  position: { x: number; y: number };
  parameters: Record<string, unknown>;
  settings?: {
    retry?: boolean;
    maxRetries?: number;
    timeoutMs?: number;
    continueOnFail?: boolean;
  };
  notes?: string;
  pinnedData?: unknown[] | null;
  disabled?: boolean;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export type ExecutionStatus = "running" | "success" | "error" | "canceled";

export type WorkflowDTO = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  folder: string | null;
  tags: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
  lastRunStatus?: ExecutionStatus | null;
  lastRunAt?: string | null;
  runCount?: number;
  executionCount?: number;
};

export type NodeRunDTO = {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: ExecutionStatus;
  startedAt: string;
  durationMs: number;
  input: unknown[] | null;
  output: unknown[] | null;
  error: string | null;
  attempt: number;
};

export type ExecutionDTO = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  mode: string;
  triggerType: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  aiTokens: number;
  aiCost: number;
  nodeRuns?: NodeRunDTO[];
};

export type CredentialDTO = {
  id: string;
  name: string;
  type: string;
  status: string;
  lastTestedAt: string | null;
  createdAt: string;
  maskedPreview?: string;
};

export type TemplateDTO = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  gradient: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  uses: number;
  featured: boolean;
};

export type ActivityDTO = {
  id: string;
  kind: string;
  message: string;
  workflowId: string | null;
  createdAt: string;
};

export type StatsDTO = {
  totals: {
    workflows: number;
    activeWorkflows: number;
    executions: number;
    successRate: number;
    avgDurationMs: number;
    aiCalls: number;
    aiCost: number;
    credentials: number;
  };
  runsPerDay: { date: string; total: number; success: number; error: number }[];
  durationsByWorkflow: { workflowId: string; name: string; avgDurationMs: number; runs: number }[];
  topFailing: { workflowId: string; name: string; failures: number; runs: number }[];
  statusBreakdown: { status: string; count: number }[];
  recentActivity: ActivityDTO[];
};

export const CREDENTIAL_TYPES = [
  { value: "httpHeaderAuth", label: "HTTP Header Auth" },
  { value: "httpBearerAuth", label: "Bearer Token" },
  { value: "basicAuth", label: "Basic Auth" },
  { value: "slackApi", label: "Slack API" },
  { value: "openaiApi", label: "OpenAI API" },
  { value: "anthropicApi", label: "Anthropic API" },
  { value: "gmailOAuth2", label: "Gmail OAuth2" },
  { value: "googleSheetsOAuth2", label: "Google Sheets OAuth2" },
  { value: "notionApi", label: "Notion API" },
  { value: "telegramApi", label: "Telegram Bot" },
  { value: "githubApi", label: "GitHub Token" },
  { value: "stripeApi", label: "Stripe API" },
] as const;
