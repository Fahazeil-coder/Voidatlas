import { db } from "@/lib/db";
import { NODE_MAP } from "@/lib/blissvoid/node-catalog";
import { encryptJSON } from "@/lib/engine/crypto";
import type { NodeType, WorkflowEdge, WorkflowNode } from "@/lib/blissvoid/types";

/* ---------------------------------------------------------------------------
   BLISSVOID demo seeder — a rich, believable instance: 6 workflows,
   14 templates, 4 credentials, 14 days of execution history with node runs,
   AI usage, activity log and instance variables. Deterministic-ish via a
   seeded PRNG so every seed looks hand-lived-in but stable.
--------------------------------------------------------------------------- */

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: T[], r: Rng): T {
  return list[Math.floor(r() * list.length)];
}

function nd(
  id: string,
  type: NodeType,
  name: string,
  x: number,
  y: number,
  parameters: Record<string, unknown>,
  extra?: Partial<WorkflowNode>
): WorkflowNode {
  return { id, type, name, position: { x, y }, parameters, ...extra };
}

function eg(source: string, target: string, handle: string | null = null): WorkflowEdge {
  return {
    id: `e_${source}_${target}${handle ? `_${handle}` : ""}`,
    source,
    target,
    sourceHandle: handle,
  };
}

function linearChain(
  items: { type: NodeType; params: Record<string, unknown>; name?: string }[]
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes = items.map((item, i) =>
    nd(`t${i}`, item.type, item.name ?? NODE_MAP[item.type]?.label ?? item.type, i * 270, 0, {
      ...(NODE_MAP[item.type]?.defaultParams ?? {}),
      ...item.params,
    })
  );
  const edges: WorkflowEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push(eg(nodes[i].id, nodes[i + 1].id));
  return { nodes, edges };
}

/* ------------------------------ Demo workflows ---------------------------- */

interface WorkflowSeed {
  name: string;
  description: string;
  tags: string[];
  folder: string | null;
  active: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  hasAi: boolean;
}

const LEAD_MESSAGES = [
  "We need 50 seats for our engineering team this quarter — can you send pricing today?",
  "Just browsing for now, we might revisit tooling next year.",
  "Congratulations on winning a free iPhone, click this link to claim your prize now!!!",
  "Our CTO asked for a security review before we commit to a pilot.",
  "Following up on the webinar — what does implementation actually look like?",
];

const INVOICE_CODE = `// Normalize incoming form values before billing.
return items.map(item => {
  const j = item.json;
  const amount = Number(String(j.amount == null ? 0 : j.amount).replace(/[^0-9.]/g, "")) || 0;
  return {
    json: {
      ...j,
      amount: Math.round(amount * 100),
      currency: String(j.currency || "usd").toLowerCase(),
      receivedAt: new Date().toISOString()
    }
  };
});`;

const WATCHDOG_CODE = `// Count the open issues fetched from GitHub.
const issues = items[0] && items[0].json.data;
const open = Array.isArray(issues) ? issues.length : 0;
return [{ json: { openIssues: open, repo: "vercel/next.js", checkedAt: new Date().toISOString() } }];`;

function demoWorkflows(): WorkflowSeed[] {
  return [
    {
      name: "AI Lead Triage",
      description:
        "Scores inbound leads with a classifier, pings sales the moment a hot one lands and files the rest to a nurture sheet.",
      tags: ["sales", "ai"],
      folder: "Revenue",
      active: true,
      hasAi: true,
      nodes: [
        nd("triage_trigger", "manualTrigger", "Lead Form Submission", 0, 0, {
          sampleData: JSON.stringify(
            [
              { name: "Ada Lovelace", email: "ada@analytical.io", company: "Analytical Engines Ltd", message: LEAD_MESSAGES[0], score: 92 },
              { name: "Alan Turing", email: "alan@enigma.dev", company: "Enigma Breakers Inc", message: LEAD_MESSAGES[1], score: 41 },
              { name: "Grace Hopper", email: "grace@compiler.co", company: "Compiler Co", message: LEAD_MESSAGES[2], score: 12 },
            ],
            null,
            0
          ),
        }),
        nd("triage_classify", "aiClassify", "Classify Lead", 270, 0, {
          text: "{{ $json.message }}",
          categories: "hot lead, nurture, spam",
        }),
        nd("triage_if", "if", "Is Hot Lead?", 540, 0, {
          conditions: [{ left: "{{ $json.label }}", operator: "equals", right: "hot lead", combinator: "and" }],
        }),
        nd("triage_slack", "slack", "Alert Sales", 810, 140, {
          channel: "#sales-fire",
          message: "Hot lead inbound: {{ $json.name }} ({{ $json.company }}) — {{ $json.message }}",
        }),
        nd("triage_email", "email", "Send Intro Email", 810, 300, {
          to: "{{ $json.email }}",
          subject: "Quick question about {{ $json.company }}",
          body: "Hi {{ $json.name }}, thanks for reaching out — here is what the next step looks like.",
        }),
        nd("triage_sheet", "googleSheets", "Append to Nurture Sheet", 810, -140, {
          operation: "append",
          sheetId: "1AbCx9LeAdsQ2tRiaged",
          tabName: "Nurture",
          columns: [
            { key: "name", value: "{{ $json.name }}" },
            { key: "email", value: "{{ $json.email }}" },
            { key: "label", value: "{{ $json.label }}" },
          ],
        }),
      ],
      edges: [
        eg("triage_trigger", "triage_classify"),
        eg("triage_classify", "triage_if"),
        eg("triage_if", "triage_slack", "true"),
        eg("triage_if", "triage_email", "true"),
        eg("triage_if", "triage_sheet", "false"),
      ],
    },
    {
      name: "Daily Standup Digest",
      description:
        "Every morning at 9am: pull repository vitals from GitHub, summarize them with AI and post the digest to the standup channel.",
      tags: ["ops"],
      folder: "Ops",
      active: true,
      hasAi: true,
      nodes: [
        nd("standup_schedule", "schedule", "Every Morning 9am", 0, 0, {
          mode: "0 9 * * *",
          cron: "0 9 * * *",
          timezone: "America/Los_Angeles",
        }),
        nd("standup_http", "httpRequest", "Fetch Repo Vitals", 270, 0, {
          method: "GET",
          url: "https://api.github.com/repos/vercel/next.js",
          headers: [
            { key: "User-Agent", value: "blissvoid-agent" },
            { key: "Accept", value: "application/vnd.github+json" },
          ],
          queryParams: [],
          body: "",
          auth: "none",
          token: "",
          timeoutMs: 15000,
        }),
        nd("standup_summarize", "aiSummarize", "Summarize Vitals", 540, 0, {
          text: "Repo: {{ $json.data.name }} — {{ $json.data.description }}. Stars: {{ $json.data.stargazers_count }}, open issues: {{ $json.data.open_issues_count }}.",
          style: "bullets",
        }),
        nd("standup_slack", "slack", "Post to Standup", 810, 0, {
          channel: "#standup",
          message: "Morning digest — {{ $json.summary }}",
        }),
      ],
      edges: [
        eg("standup_schedule", "standup_http"),
        eg("standup_http", "standup_summarize"),
        eg("standup_summarize", "standup_slack"),
      ],
    },
    {
      name: "Support Sentiment Radar",
      description:
        "Webhook intake for support tickets. Every message gets a sentiment score; angry customers escalate to Slack instantly.",
      tags: ["support", "ai"],
      folder: null,
      active: true,
      hasAi: true,
      nodes: [
        nd("radar_hook", "webhook", "Support Inbox Hook", 0, 0, {
          path: "support-inbox",
          method: "POST",
          auth: "none",
        }),
        nd("radar_set", "set", "Extract Ticket Fields", 270, 0, {
          assignments: [
            { name: "ticketId", value: "{{ $json.body.ticketId }}" },
            { name: "customer", value: "{{ $json.body.customer }}" },
            { name: "message", value: "{{ $json.body.message }}" },
          ],
          keepOnlySet: true,
        }),
        nd("radar_sentiment", "aiSentiment", "Score Sentiment", 540, 0, {
          text: "{{ $json.message }}",
        }),
        nd("radar_switch", "switch", "Route by Sentiment", 810, 0, {
          value: "{{ $json.sentiment }}",
          rules: [
            { key: "Negative — escalate", value: "negative" },
            { key: "Positive — log", value: "positive" },
          ],
        }),
        nd("radar_slack", "slack", "Escalate to Support", 1080, 140, {
          channel: "#support-escalations",
          message: "Escalate ticket {{ $json.ticketId }} from {{ $json.customer }}: {{ $json.message }}",
        }),
        nd("radar_noop", "noOp", "Log Quietly", 1080, -140, {}),
      ],
      edges: [
        eg("radar_hook", "radar_set"),
        eg("radar_set", "radar_sentiment"),
        eg("radar_sentiment", "radar_switch"),
        eg("radar_switch", "radar_slack", "route0"),
        eg("radar_switch", "radar_noop", "route1"),
      ],
    },
    {
      name: "Content Repurposing Engine",
      description:
        "Turns one long-form article into summaries for Notion and Telegram — one piece of content, everywhere at once.",
      tags: ["content", "ai"],
      folder: "Marketing",
      active: false,
      hasAi: true,
      nodes: [
        nd("content_trigger", "manualTrigger", "Article Draft", 0, 0, {
          sampleData: JSON.stringify(
            [
              {
                title: "Why local-first software wins",
                article:
                  "Local-first software keeps your data on your device and syncs quietly in the background. Teams ship faster because reads are instant and writes never wait on a network round trip. The pattern pairs beautifully with CRDTs and optimistic UIs.",
              },
              {
                title: "The end of the manualOps era",
                article:
                  "Automation platforms used to need a dedicated engineer. Modern AI-native builders let anyone describe a process in plain language and get a running workflow with retries, routing and observability included.",
              },
            ],
            null,
            0
          ),
        }),
        nd("content_summarize", "aiSummarize", "Summarize Article", 270, 0, {
          text: "{{ $json.article }}",
          style: "bullets",
        }),
        nd("content_notion", "notion", "Save to Notion", 540, 0, {
          database: "Content pipeline",
          title: "{{ $json.title }}",
          properties: [{ key: "status", value: "summarized" }],
        }),
        nd("content_telegram", "telegram", "Broadcast to Telegram", 810, 0, {
          chatId: "@blissvoid_channel",
          message: "New piece: {{ $json.title }} — {{ $json.summary }}",
        }),
      ],
      edges: [
        eg("content_trigger", "content_summarize"),
        eg("content_summarize", "content_notion"),
        eg("content_notion", "content_telegram"),
      ],
    },
    {
      name: "Invoice Intake Pipeline",
      description:
        "A public form collects invoices, code normalizes the amounts, Stripe charges and finance gets an email receipt.",
      tags: ["finance"],
      folder: "Finance",
      active: false,
      hasAi: false,
      nodes: [
        nd("invoice_form", "formTrigger", "Invoice Submission Form", 0, 0, {
          formTitle: "Submit an invoice",
          fields: [
            { key: "vendor", value: "text" },
            { key: "amount", value: "number" },
            { key: "currency", value: "text" },
          ],
        }),
        nd("invoice_code", "code", "Normalize Amounts", 270, 0, { code: INVOICE_CODE }),
        nd("invoice_stripe", "stripe", "Charge via Stripe", 540, 0, {
          customer: "{{ $json.vendor }}",
          amount: "{{ $json.amount }}",
          currency: "{{ $json.currency }}",
        }),
        nd("invoice_email", "email", "Notify Finance", 810, 0, {
          to: "finance@blissvoid.io",
          subject: "Invoice processed — {{ $json.vendor }}",
          body: "An invoice from {{ $json.vendor }} was charged {{ $json.amount }} {{ $json.currency }}.",
        }),
      ],
      edges: [
        eg("invoice_form", "invoice_code"),
        eg("invoice_code", "invoice_stripe"),
        eg("invoice_stripe", "invoice_email"),
      ],
    },
    {
      name: "Repo Watchdog",
      description:
        "Checks open issues on the flagship repo every hour. More than three open spikes? File a GitHub issue and ping Discord.",
      tags: ["devops"],
      folder: null,
      active: true,
      hasAi: false,
      nodes: [
        nd("watchdog_schedule", "schedule", "Every Hour", 0, 0, {
          mode: "0 * * * *",
          cron: "0 * * * *",
          timezone: "America/Los_Angeles",
        }),
        nd("watchdog_http", "httpRequest", "Fetch Open Issues", 270, 0, {
          method: "GET",
          url: "https://api.github.com/repos/vercel/next.js/issues",
          headers: [{ key: "User-Agent", value: "blissvoid-agent" }],
          queryParams: [{ key: "per_page", value: "5" }],
          body: "",
          auth: "none",
          token: "",
          timeoutMs: 15000,
        }),
        nd("watchdog_code", "code", "Count Open Issues", 540, 0, { code: WATCHDOG_CODE }),
        nd("watchdog_if", "if", "Spike Detected?", 810, 0, {
          conditions: [{ left: "{{ $json.openIssues }}", operator: "gt", right: "3", combinator: "and" }],
        }),
        nd("watchdog_github", "github", "File Ops Issue", 1080, 140, {
          operation: "createIssue",
          repo: "acme/ops-reports",
          title: "Spike detected: {{ $json.openIssues }} open issues",
          body: "Automated watchdog alert filed by BLISSVOID.",
        }),
        nd("watchdog_discord", "discord", "Ping Ops Discord", 1350, 140, {
          channel: "#ops-alerts",
          message: "Watchdog: {{ $json.openIssues }} open issues on {{ $json.repo }}",
        }),
        nd("watchdog_noop", "noOp", "All Clear", 1080, -140, {}),
      ],
      edges: [
        eg("watchdog_schedule", "watchdog_http"),
        eg("watchdog_http", "watchdog_code"),
        eg("watchdog_code", "watchdog_if"),
        eg("watchdog_if", "watchdog_github", "true"),
        eg("watchdog_github", "watchdog_discord"),
        eg("watchdog_if", "watchdog_noop", "false"),
      ],
    },
  ];
}

/* -------------------------------- Templates ------------------------------- */

interface TemplateSeed {
  name: string;
  description: string;
  category: string;
  icon: string;
  gradient: string;
  featured: boolean;
  uses: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function demoTemplates(): TemplateSeed[] {
  const templates: TemplateSeed[] = [];

  const add = (
    seed: Omit<TemplateSeed, "nodes" | "edges">,
    built: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
  ) => templates.push({ ...seed, ...built });

  /* 1 — AI Customer Support Auto-Reply (featured) */
  add(
    {
      name: "AI Customer Support Auto-Reply",
      description:
        "A chat trigger collects the message, an AI agent drafts a warm reply, and the answer ships by email in seconds.",
      category: "AI & Agents",
      icon: "Sparkles",
      gradient: "linear-gradient(135deg, #7C5CFF, #FF6BD6)",
      featured: true,
      uses: 47,
    },
    linearChain([
      { type: "chatTrigger", params: { welcome: "Describe your issue and I will draft a reply." } },
      {
        type: "aiAgent",
        params: {
          goal: "Draft a warm, short reply to this customer message: {{ $json.message }}",
          persona: "Support agent with a friendly, precise tone",
        },
      },
      {
        type: "email",
        params: {
          to: "customer@blissvoid.io",
          subject: "Re: your support request",
          body: "{{ $json.reply }}",
        },
      },
    ])
  );

  /* 2 — YouTube Shorts Announcer (featured) */
  add(
    {
      name: "YouTube Shorts Announcer",
      description:
        "Watches your upload feed on a schedule, summarizes the latest drops and announces them on Telegram and Discord.",
      category: "Social",
      icon: "Youtube",
      gradient: "linear-gradient(135deg, #FF6BD6, #FFC857)",
      featured: true,
      uses: 33,
    },
    linearChain([
      { type: "schedule", params: { mode: "0 9 * * *", cron: "0 9 * * *", timezone: "America/Los_Angeles" } },
      {
        type: "httpRequest",
        params: {
          method: "GET",
          url: "https://api.github.com/repos/vercel/next.js/releases",
          headers: [{ key: "User-Agent", value: "blissvoid-agent" }],
          queryParams: [{ key: "per_page", value: "3" }],
          body: "",
          auth: "none",
          token: "",
          timeoutMs: 15000,
        },
      },
      {
        type: "code",
        params: {
          code: `// Flatten the latest releases into short announcements.
const releases = Array.isArray(items[0].json.data) ? items[0].json.data : [];
return releases.slice(0, 3).map(r => ({
  json: { title: r.name || r.tag_name || "release", publishedAt: r.published_at, url: r.html_url }
}));`,
        },
      },
      { type: "aiSummarize", params: { text: "{{ JSON.stringify($json) }}", style: "bullets" } },
      { type: "telegram", params: { chatId: "@blissvoid_channel", message: "Fresh drops — {{ $json.summary }}" } },
      { type: "discord", params: { channel: "#announcements", message: "{{ $json.summary }}" } },
    ])
  );

  /* 3 — Lead Capture to CRM */
  add(
    {
      name: "Lead Capture to CRM",
      description:
        "A public form catches demo requests, fields are normalized, leads land in a Google Sheet and sales gets a Slack ping.",
      category: "Sales",
      icon: "Briefcase",
      gradient: "linear-gradient(135deg, #3DA9FF, #2CF5D0)",
      featured: false,
      uses: 21,
    },
    linearChain([
      {
        type: "formTrigger",
        params: {
          formTitle: "Book a demo",
          fields: [
            { key: "name", value: "text" },
            { key: "email", value: "email" },
            { key: "company", value: "text" },
          ],
        },
      },
      {
        type: "set",
        params: {
          assignments: [
            { name: "name", value: "{{ $json.name }}" },
            { name: "email", value: "{{ $json.email }}" },
            { name: "company", value: "{{ $json.company }}" },
            { name: "source", value: "demo-form" },
          ],
          keepOnlySet: true,
        },
      },
      {
        type: "googleSheets",
        params: {
          operation: "append",
          sheetId: "1LeAdScRmQ2tDemo",
          tabName: "Leads",
          columns: [
            { key: "name", value: "{{ $json.name }}" },
            { key: "email", value: "{{ $json.email }}" },
            { key: "company", value: "{{ $json.company }}" },
          ],
        },
      },
      { type: "slack", params: { channel: "#sales", message: "New lead: {{ $json.name }} at {{ $json.company }}" } },
    ])
  );

  /* 4 — AI Daily Digest */
  add(
    {
      name: "AI Daily Digest",
      description:
        "Fetches the top stories every morning, keeps the ten hottest, condenses them into bullets and emails you the digest.",
      category: "Productivity",
      icon: "Newspaper",
      gradient: "linear-gradient(135deg, #2CF5D0, #3DA9FF)",
      featured: false,
      uses: 29,
    },
    linearChain([
      { type: "schedule", params: { mode: "0 9 * * *", cron: "0 9 * * *", timezone: "America/Los_Angeles" } },
      {
        type: "httpRequest",
        params: {
          method: "GET",
          url: "https://hacker-news.firebaseio.com/v0/topstories.json",
          headers: [],
          queryParams: [],
          body: "",
          auth: "none",
          token: "",
          timeoutMs: 15000,
        },
      },
      {
        type: "code",
        params: {
          code: `// Keep the top 10 story ids.
const ids = Array.isArray(items[0].json.data) ? items[0].json.data.slice(0, 10) : [];
return [{ json: { top: ids } }];`,
        },
      },
      { type: "aiSummarize", params: { text: "{{ JSON.stringify($json.top) }}", style: "bullets" } },
      {
        type: "email",
        params: { to: "founder@blissvoid.io", subject: "Your morning digest", body: "{{ $json.summary }}" },
      },
    ])
  );

  /* 5 — Social Post Scheduler */
  add(
    {
      name: "Social Post Scheduler",
      description:
        "Drop posts with sample data, stamp them with a schedule and fan them out to Slack, Telegram and Discord in one run.",
      category: "Social",
      icon: "CalendarClock",
      gradient: "linear-gradient(135deg, #FFC857, #FF6BD6)",
      featured: false,
      uses: 17,
    },
    linearChain([
      {
        type: "manualTrigger",
        params: {
          sampleData: JSON.stringify(
            [
              { channel: "launch", content: "BLISSVOID 2.0 is live — AI-native workflows for everyone." },
              { channel: "tips", content: "Tip: use $node[\"HTTP Request\"].json to reference earlier steps." },
            ],
            null,
            0
          ),
        },
      },
      {
        type: "set",
        params: {
          assignments: [
            { name: "content", value: "{{ $json.content }}" },
            { name: "scheduledAt", value: "{{ $now }}" },
          ],
          keepOnlySet: false,
        },
      },
      { type: "slack", params: { channel: "#marketing", message: "{{ $json.content }}" } },
      { type: "telegram", params: { chatId: "@blissvoid_channel", message: "{{ $json.content }}" } },
      { type: "discord", params: { channel: "#marketing", message: "{{ $json.content }}" } },
    ])
  );

  /* 6 — Invoice Processing */
  add(
    {
      name: "Invoice Processing",
      description:
        "Form intake for invoices, a code step normalizes amounts, Stripe charges and finance receives an email receipt.",
      category: "Finance",
      icon: "Receipt",
      gradient: "linear-gradient(135deg, #FFC857, #2CF5D0)",
      featured: false,
      uses: 12,
    },
    linearChain([
      {
        type: "formTrigger",
        params: {
          formTitle: "Submit an invoice",
          fields: [
            { key: "vendor", value: "text" },
            { key: "amount", value: "number" },
            { key: "currency", value: "text" },
          ],
        },
      },
      { type: "code", params: { code: INVOICE_CODE } },
      { type: "stripe", params: { customer: "{{ $json.vendor }}", amount: "{{ $json.amount }}", currency: "{{ $json.currency }}" } },
      {
        type: "email",
        params: {
          to: "finance@blissvoid.io",
          subject: "Invoice processed — {{ $json.vendor }}",
          body: "Charged {{ $json.amount }} {{ $json.currency }} to {{ $json.vendor }}.",
        },
      },
    ])
  );

  /* 7 — AI Content Repurposer (featured) */
  add(
    {
      name: "AI Content Repurposer",
      description:
        "Feed it one long article; get a crisp summary saved to Notion and broadcast to your Telegram channel.",
      category: "Marketing",
      icon: "Recycle",
      gradient: "linear-gradient(135deg, #7C5CFF, #2CF5D0)",
      featured: true,
      uses: 38,
    },
    linearChain([
      {
        type: "manualTrigger",
        params: {
          sampleData: JSON.stringify(
            [
              {
                title: "Why local-first software wins",
                article:
                  "Local-first software keeps your data on your device and syncs quietly in the background. Teams ship faster because reads are instant and writes never wait on a network round trip.",
              },
            ],
            null,
            0
          ),
        },
      },
      { type: "aiSummarize", params: { text: "{{ $json.article }}", style: "bullets" } },
      { type: "notion", params: { database: "Content pipeline", title: "{{ $json.title }}", properties: [] } },
      { type: "telegram", params: { chatId: "@blissvoid_channel", message: "New piece: {{ $json.title }} — {{ $json.summary }}" } },
    ])
  );

  /* 8 — Meeting Notes to Notion */
  add(
    {
      name: "Meeting Notes to Notion",
      description:
        "Paste raw meeting notes, get an executive brief and file it into your Notion meeting database automatically.",
      category: "Productivity",
      icon: "NotebookPen",
      gradient: "linear-gradient(135deg, #3DA9FF, #7C5CFF)",
      featured: false,
      uses: 24,
    },
    linearChain([
      {
        type: "manualTrigger",
        params: {
          sampleData: JSON.stringify(
            [
              {
                title: "Weekly sync",
                article:
                  "Roadmap: ship the expression debugger. Blocked: credential rotation. Decisions: move to weekly releases. Action items: Ada drafts the changelog, Alan benchmarks the engine.",
              },
            ],
            null,
            0
          ),
        },
      },
      { type: "aiSummarize", params: { text: "{{ $json.article }}", style: "brief" } },
      {
        type: "notion",
        params: { database: "Meeting notes", title: "{{ $json.title }} — {{ $now }}", properties: [] },
      },
    ])
  );

  /* 9 — Error Alert to Slack */
  add(
    {
      name: "Error Alert to Slack",
      description:
        "Wire this to your other workflows: whenever anything fails, the error trigger reshapes the payload and pings ops.",
      category: "DevOps",
      icon: "Siren",
      gradient: "linear-gradient(135deg, #FF5C7A, #FFC857)",
      featured: false,
      uses: 19,
    },
    linearChain([
      { type: "errorTrigger", params: { watchAll: true } },
      {
        type: "set",
        params: {
          assignments: [
            { name: "failedWorkflow", value: "{{ $json.workflow }}" },
            { name: "reason", value: "{{ $json.error }}" },
          ],
          keepOnlySet: true,
        },
      },
      {
        type: "slack",
        params: { channel: "#ops-alerts", message: "Workflow failed: {{ $json.reason }} — investigate now." },
      },
    ])
  );

  /* 10 — GitHub Issue Triage with AI (featured) */
  {
    const nodes = [
      nd("t0", "schedule", "Every Hour", 0, 0, { mode: "0 * * * *", cron: "0 * * * *", timezone: "America/Los_Angeles" }),
      nd("t1", "httpRequest", "Fetch Open Issues", 270, 0, {
        method: "GET",
        url: "https://api.github.com/repos/vercel/next.js/issues",
        headers: [{ key: "User-Agent", value: "blissvoid-agent" }],
        queryParams: [{ key: "per_page", value: "5" }],
        body: "",
        auth: "none",
        token: "",
        timeoutMs: 15000,
      }),
      nd("t2", "code", "Count Issues", 540, 0, { code: WATCHDOG_CODE }),
      nd("t3", "aiClassify", "Classify Report", 810, 0, {
        text: "{{ JSON.stringify($json) }}",
        categories: "bug, feature, question",
      }),
      nd("t4", "if", "Is Bug?", 1080, 0, {
        conditions: [{ left: "{{ $json.label }}", operator: "equals", right: "bug", combinator: "and" }],
      }),
      nd("t5", "github", "File Bug Issue", 1350, 140, {
        operation: "createIssue",
        repo: "acme/triage",
        title: "Auto-triaged bug: {{ $json.label }} ({{ $json.confidence }})",
        body: "Filed automatically by BLISSVOID after AI triage.",
      }),
      nd("t6", "noOp", "Ignore", 1350, -140, {}),
    ];
    add(
      {
        name: "GitHub Issue Triage with AI",
        description:
          "Hourly sweep of repository issues, AI labels each report, and probable bugs get a GitHub issue filed automatically.",
        category: "DevOps",
        icon: "GitBranch",
        gradient: "linear-gradient(135deg, #A8AECF, #7C5CFF)",
        featured: true,
        uses: 31,
      },
      {
        nodes,
        edges: [
          eg("t0", "t1"),
          eg("t1", "t2"),
          eg("t2", "t3"),
          eg("t3", "t4"),
          eg("t4", "t5", "true"),
          eg("t4", "t6", "false"),
        ],
      }
    );
  }

  /* 11 — Newsletter Welcome Flow */
  add(
    {
      name: "Newsletter Welcome Flow",
      description:
        "New subscriber webhook, instant welcome email, a one-second breather, then a gentle follow-up. Classic and effective.",
      category: "Marketing",
      icon: "Mail",
      gradient: "linear-gradient(135deg, #FF6BD6, #3DA9FF)",
      featured: false,
      uses: 26,
    },
    linearChain([
      { type: "webhook", params: { path: "newsletter-signup", method: "POST", auth: "none" } },
      {
        type: "set",
        params: {
          assignments: [{ name: "email", value: "{{ $json.body.email }}" }],
          keepOnlySet: true,
        },
      },
      {
        type: "email",
        params: {
          to: "{{ $json.email }}",
          subject: "Welcome to the void",
          body: "You are in. Expect one sharp email a week, no noise.",
        },
      },
      { type: "wait", params: { amount: 1, unit: "s" } },
      {
        type: "email",
        params: {
          to: "{{ $json.email }}",
          subject: "One more thing",
          body: "Here is our best piece from the archive to get you started.",
        },
      },
    ])
  );

  /* 12 — Sentiment-based Routing */
  {
    const nodes = [
      nd("t0", "webhook", "Feedback Hook", 0, 0, { path: "feedback", method: "POST", auth: "none" }),
      nd("t1", "aiSentiment", "Score Sentiment", 270, 0, { text: "{{ $json.body.message }}" }),
      nd("t2", "switch", "Route by Sentiment", 540, 0, {
        value: "{{ $json.sentiment }}",
        rules: [
          { key: "Negative — escalate", value: "negative" },
          { key: "Positive — celebrate", value: "positive" },
        ],
      }),
      nd("t3", "slack", "Alert the Team", 810, 140, {
        channel: "#support-escalations",
        message: "Unhappy feedback received: {{ $json.body.message }}",
      }),
      nd("t4", "noOp", "Log Positive", 810, -140, {}),
    ];
    add(
      {
        name: "Sentiment-based Routing",
        description:
          "One webhook for all feedback. AI scores the mood; negative comments escalate to Slack, positive ones are logged.",
        category: "AI & Agents",
        icon: "HeartPulse",
        gradient: "linear-gradient(135deg, #FF6BD6, #7C5CFF)",
        featured: false,
        uses: 22,
      },
      {
        nodes,
        edges: [eg("t0", "t1"), eg("t1", "t2"), eg("t2", "t3", "route0"), eg("t2", "t4", "route1")],
      }
    );
  }

  /* 13 — Form to Google Sheets */
  add(
    {
      name: "Form to Google Sheets",
      description:
        "The simplest useful automation there is: a public form, one field-mapping step, and every submission lands in a sheet.",
      category: "Ops",
      icon: "Table2",
      gradient: "linear-gradient(135deg, #2CF5D0, #FFC857)",
      featured: false,
      uses: 15,
    },
    linearChain([
      {
        type: "formTrigger",
        params: {
          formTitle: "Contact us",
          fields: [
            { key: "name", value: "text" },
            { key: "email", value: "email" },
          ],
        },
      },
      {
        type: "set",
        params: {
          assignments: [
            { name: "name", value: "{{ $json.name }}" },
            { name: "email", value: "{{ $json.email }}" },
            { name: "submittedAt", value: "{{ $now }}" },
          ],
          keepOnlySet: true,
        },
      },
      {
        type: "googleSheets",
        params: {
          operation: "append",
          sheetId: "1FoRmToSheEts1",
          tabName: "Responses",
          columns: [
            { key: "name", value: "{{ $json.name }}" },
            { key: "email", value: "{{ $json.email }}" },
          ],
        },
      },
    ])
  );

  /* 14 — AI Agent Research Assistant (featured) */
  add(
    {
      name: "AI Agent Research Assistant",
      description:
        "A conversational research desk: chat in, an agent with a researcher persona investigates, and the flow replies inline.",
      category: "AI & Agents",
      icon: "Bot",
      gradient: "linear-gradient(135deg, #7C5CFF, #FF6BD6)",
      featured: true,
      uses: 41,
    },
    linearChain([
      { type: "chatTrigger", params: { welcome: "What should I research today?", mode: "public" } },
      {
        type: "aiAgent",
        params: {
          goal: "Research this question and return a crisp, sourced-in-spirit answer: {{ $json.message }}",
          persona: "Meticulous research analyst who answers in three short paragraphs",
        },
      },
      {
        type: "code",
        params: {
          code: `// Mark the reply as ready for the response.
return items.map(item => ({ json: { ...item.json, ready: true } }));`,
        },
      },
      { type: "respond", params: { message: "{{ $json.reply }}", status: "200" } },
    ])
  );

  return templates;
}

/* ----------------------------- Execution history --------------------------- */

type Item = { json: Record<string, unknown> };

interface NodeSample {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  input: Item[];
  /** Plain items, or handle-routed items for branching nodes (if/switch). */
  output: Array<Item | { handle: string; items: Item[] }>;
}

interface LeadCtx {
  name: string;
  email: string;
  company: string;
  message: string;
  score: number;
}

const NAMES = [
  "Ada Lovelace",
  "Alan Turing",
  "Grace Hopper",
  "Edsger Dijkstra",
  "Katherine Johnson",
  "Margaret Hamilton",
  "Linus Torvalds",
  "Barbara Liskov",
  "Donald Knuth",
  "Radia Perlman",
];

const COMPANIES = [
  "Analytical Engines Ltd",
  "Enigma Breakers Inc",
  "Compiler Co",
  "AlgoRhythms Labs",
  "Apollo Systems",
  "Skynet Research",
  "Lambda Works",
  "Boolean Craft",
];

const SUPPORT_NEGATIVE = [
  "The dashboard keeps crashing when I export reports, this is blocking our launch.",
  "I have tried three times to connect my account and it keeps failing. Very frustrated.",
  "Your billing page shows the wrong plan and support has not replied for two days.",
];

const SUPPORT_POSITIVE = [
  "Just wanted to say the new automations are fantastic, we saved six hours this week.",
  "The onboarding was the smoothest we have seen, thank you for the great docs.",
];

const simStamp = (r: Rng) => `17${Math.floor(10000000 + r() * 89999999)}.000100`;

function leadTriageSamples(r: Rng, leads: LeadCtx[]): NodeSample[] {
  return [
    {
      nodeId: "triage_trigger",
      nodeName: "Lead Form Submission",
      nodeType: "manualTrigger",
      input: [],
      output: leads.map((lead) => ({ json: { ...lead } })),
    },
    {
      nodeId: "triage_classify",
      nodeName: "Classify Lead",
      nodeType: "aiClassify",
      input: leads.map((lead) => ({ json: { ...lead } })),
      output: leads.map((lead, i) => ({
        json: {
          ...lead,
          label: i === 0 ? "hot lead" : i === 1 ? "nurture" : "spam",
          confidence: i === 0 ? 0.93 : i === 1 ? 0.71 : 0.88,
          categories: ["hot lead", "nurture", "spam"],
        },
      })),
    },
    {
      nodeId: "triage_if",
      nodeName: "Is Hot Lead?",
      nodeType: "if",
      input: leads.map((lead, i) => ({ json: { ...lead, label: i === 0 ? "hot lead" : "nurture" } })),
      output: [
        { handle: "true", items: [{ json: { ...leads[0] } }] },
        { handle: "false", items: leads.slice(1).map((lead) => ({ json: { ...lead } })) },
      ],
    },
    {
      nodeId: "triage_slack",
      nodeName: "Alert Sales",
      nodeType: "slack",
      input: [{ json: { ...leads[0], label: "hot lead" } }],
      output: [
        {
          json: {
            ok: true,
            delivered: "simulated",
            channel: "#sales-fire",
            message: `Hot lead inbound: ${leads[0].name} (${leads[0].company})`,
            ts: simStamp(r),
            _simulated: true,
          },
        },
      ],
    },
    {
      nodeId: "triage_email",
      nodeName: "Send Intro Email",
      nodeType: "email",
      input: [{ json: { ...leads[0], label: "hot lead" } }],
      output: [
        {
          json: {
            ok: true,
            delivered: "simulated",
            to: leads[0].email,
            subject: `Quick question about ${leads[0].company}`,
            messageId: `<${Math.floor(r() * 1e12).toString(36)}@blissvoid.io>`,
            _simulated: true,
          },
        },
      ],
    },
    {
      nodeId: "triage_sheet",
      nodeName: "Append to Nurture Sheet",
      nodeType: "googleSheets",
      input: leads.slice(1).map((lead) => ({ json: { ...lead } })),
      output: leads.slice(1).map((lead) => ({
        json: {
          ok: true,
          delivered: "simulated",
          operation: "append",
          spreadsheetId: "1AbCx9LeAdsQ2tRiaged",
          tabName: "Nurture",
          row: Math.floor(r() * 900) + 100,
          name: lead.name,
          email: lead.email,
          _simulated: true,
        },
      })),
    },
  ];
}

function standupSamples(r: Rng): NodeSample[] {
  const stars = 128000 + Math.floor(r() * 1500);
  const openIssues = 2800 + Math.floor(r() * 200);
  const summary = [
    `- next.js remains one of the most active repos on GitHub with ${stars.toLocaleString("en-US")} stars`,
    `- ${openIssues.toLocaleString("en-US")} open issues — steady week over week`,
    "- Release cadence held at roughly one minor per week",
  ].join("\n");
  return [
    {
      nodeId: "standup_schedule",
      nodeName: "Every Morning 9am",
      nodeType: "schedule",
      input: [],
      output: [{ json: { timestamp: new Date().toISOString(), cron: "0 9 * * *", timezone: "America/Los_Angeles" } }],
    },
    {
      nodeId: "standup_http",
      nodeName: "Fetch Repo Vitals",
      nodeType: "httpRequest",
      input: [],
      output: [
        {
          json: {
            statusCode: 200,
            statusMessage: "OK",
            headers: { "content-type": "application/json; charset=utf-8" },
            data: {
              name: "next.js",
              description: "The React Framework for the Web",
              stargazers_count: stars,
              open_issues_count: openIssues,
            },
          },
        },
      ],
    },
    {
      nodeId: "standup_summarize",
      nodeName: "Summarize Vitals",
      nodeType: "aiSummarize",
      input: [],
      output: [{ json: { summary, style: "bullets" } }],
    },
    {
      nodeId: "standup_slack",
      nodeName: "Post to Standup",
      nodeType: "slack",
      input: [{ json: { summary } }],
      output: [
        {
          json: {
            ok: true,
            delivered: "simulated",
            channel: "#standup",
            message: `Morning digest — ${summary.split("\n")[0]}`,
            ts: simStamp(r),
            _simulated: true,
          },
        },
      ],
    },
  ];
}

function radarSamples(r: Rng): NodeSample[] {
  const negative = r() < 0.55;
  const message = negative ? pick(SUPPORT_NEGATIVE, r) : pick(SUPPORT_POSITIVE, r);
  const customer = pick(NAMES, r);
  const ticketId = `TCK-${Math.floor(1000 + r() * 9000)}`;
  const sentiment = negative ? "negative" : "positive";
  const score = negative ? -(0.3 + r() * 0.6) : 0.3 + r() * 0.6;
  return [
    {
      nodeId: "radar_hook",
      nodeName: "Support Inbox Hook",
      nodeType: "webhook",
      input: [],
      output: [
        {
          json: {
            headers: { "content-type": "application/json" },
            query: {},
            body: { ticketId, customer, message },
            receivedAt: new Date().toISOString(),
          },
        },
      ],
    },
    {
      nodeId: "radar_set",
      nodeName: "Extract Ticket Fields",
      nodeType: "set",
      input: [],
      output: [{ json: { ticketId, customer, message } }],
    },
    {
      nodeId: "radar_sentiment",
      nodeName: "Score Sentiment",
      nodeType: "aiSentiment",
      input: [{ json: { ticketId, customer, message } }],
      output: [
        {
          json: {
            ticketId,
            customer,
            message,
            sentiment,
            score: Math.round(score * 100) / 100,
          },
        },
      ],
    },
    {
      nodeId: "radar_switch",
      nodeName: "Route by Sentiment",
      nodeType: "switch",
      input: [],
      output: [
        negative
          ? { handle: "route0", items: [{ json: { ticketId, customer, message, sentiment } }] }
          : { handle: "route1", items: [{ json: { ticketId, customer, message, sentiment } }] },
      ],
    },
    ...(negative
      ? [
          {
            nodeId: "radar_slack",
            nodeName: "Escalate to Support",
            nodeType: "slack",
            input: [{ json: { ticketId, customer, message } }],
            output: [
              {
                json: {
                  ok: true,
                  delivered: "simulated",
                  channel: "#support-escalations",
                  message: `Escalate ticket ${ticketId} from ${customer}`,
                  ts: simStamp(r),
                  _simulated: true,
                },
              },
            ],
          },
        ]
      : [
          {
            nodeId: "radar_noop",
            nodeName: "Log Quietly",
            nodeType: "noOp",
            input: [{ json: { ticketId, customer, message } }],
            output: [{ json: { ticketId, customer, message, logged: true } }],
          },
        ]),
  ];
}

function watchdogSamples(r: Rng): NodeSample[] {
  const openIssues = Math.floor(r() * 6);
  const issueTitles = [
    "Hydration mismatch with dynamic imports",
    "App Router cache revalidation too aggressive",
    "TypeError in generateStaticParams",
    "Dev overlay crashes on unhandled rejection",
    "Metadata API ignores async generateMetadata",
  ];
  const spike = openIssues > 3;
  return [
    {
      nodeId: "watchdog_schedule",
      nodeName: "Every Hour",
      nodeType: "schedule",
      input: [],
      output: [{ json: { timestamp: new Date().toISOString(), cron: "0 * * * *", timezone: "America/Los_Angeles" } }],
    },
    {
      nodeId: "watchdog_http",
      nodeName: "Fetch Open Issues",
      nodeType: "httpRequest",
      input: [],
      output: [
        {
          json: {
            statusCode: 200,
            statusMessage: "OK",
            headers: { "content-type": "application/json; charset=utf-8" },
            data: issueTitles.slice(0, openIssues).map((title, i) => ({
              number: 60000 + Math.floor(r() * 4000) + i,
              title,
              state: "open",
            })),
          },
        },
      ],
    },
    {
      nodeId: "watchdog_code",
      nodeName: "Count Open Issues",
      nodeType: "code",
      input: [],
      output: [{ json: { openIssues, repo: "vercel/next.js", checkedAt: new Date().toISOString() } }],
    },
    {
      nodeId: "watchdog_if",
      nodeName: "Spike Detected?",
      nodeType: "if",
      input: [{ json: { openIssues } }],
      output: [
        {
          handle: spike ? "true" : "false",
          items: [{ json: { openIssues, repo: "vercel/next.js" } }],
        },
      ],
    },
    ...(spike
      ? [
          {
            nodeId: "watchdog_github",
            nodeName: "File Ops Issue",
            nodeType: "github",
            input: [{ json: { openIssues } }],
            output: [
              {
                json: {
                  ok: true,
                  delivered: "simulated",
                  operation: "createIssue",
                  repo: "acme/ops-reports",
                  issueNumber: Math.floor(r() * 999) + 1,
                  url: "https://github.com/acme/ops-reports/issues/42",
                  _simulated: true,
                },
              },
            ],
          },
          {
            nodeId: "watchdog_discord",
            nodeName: "Ping Ops Discord",
            nodeType: "discord",
            input: [],
            output: [
              {
                json: {
                  ok: true,
                  delivered: "simulated",
                  channel: "#ops-alerts",
                  message: `Watchdog: ${openIssues} open issues on vercel/next.js`,
                  _simulated: true,
                },
              },
            ],
          },
        ]
      : [
          {
            nodeId: "watchdog_noop",
            nodeName: "All Clear",
            nodeType: "noOp",
            input: [{ json: { openIssues } }],
            output: [{ json: { openIssues, repo: "vercel/next.js" } }],
          },
        ]),
  ];
}

const ERROR_POOL: { typePattern: RegExp; message: string }[] = [
  { typePattern: /httpRequest/, message: "HTTP 429: rate limit exceeded at HTTP Request node" },
  { typePattern: /^ai/, message: "AI model timeout after 15000ms" },
  { typePattern: /^set$/, message: "ExpressionError: $json.customer.name is not a function" },
  { typePattern: /^slack$/, message: "Slack API error: channel_not_found for #sales-fire" },
  { typePattern: /^code$/, message: "Code node returned a non-array value" },
];

async function createManyChunked(
  model: { createMany: (args: { data: any[] }) => Promise<any> },
  rows: any[],
  chunkSize = 200
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await model.createMany({ data: rows.slice(i, i + chunkSize) });
  }
}

/* --------------------------------- Seeder --------------------------------- */

export async function seedDatabase(): Promise<void> {
  const r = mulberry32(20600114);
  const now = new Date();

  /* ---- Workflows ---- */
  const workflowSeeds = demoWorkflows();
  const workflowIdByName = new Map<string, string>();
  for (const seed of workflowSeeds) {
    const created = await db.workflow.create({
      data: {
        name: seed.name,
        description: seed.description,
        active: seed.active,
        folder: seed.folder,
        tags: JSON.stringify(seed.tags),
        nodes: JSON.stringify(seed.nodes),
        edges: JSON.stringify(seed.edges),
        createdAt: new Date(now.getTime() - (26 + Math.floor(r() * 8)) * 24 * 60 * 60 * 1000),
      },
    });
    workflowIdByName.set(seed.name, created.id);
  }

  /* ---- Templates ---- */
  for (const template of demoTemplates()) {
    await db.template.create({
      data: {
        name: template.name,
        description: template.description,
        category: template.category,
        icon: template.icon,
        gradient: template.gradient,
        nodes: JSON.stringify(template.nodes),
        edges: JSON.stringify(template.edges),
        uses: template.uses,
        featured: template.featured,
      },
    });
  }

  /* ---- Credentials ---- */
  const credentialSeeds = [
    {
      name: "Slack Ops Bot",
      type: "slackApi",
      data: { token: "xoxb-sim-482193558-9021-Xq82jd9kL2" },
      status: "verified",
      daysAgo: 22,
    },
    {
      name: "OpenAI Production",
      type: "openaiApi",
      data: { apiKey: "sk-sim-9f3k202ld93kQp7Tz4" },
      status: "verified",
      daysAgo: 19,
    },
    {
      name: "GitHub CI",
      type: "githubApi",
      data: { token: "ghp_simK39dk21lZ9mQrT48" },
      status: "verified",
      daysAgo: 15,
    },
    {
      name: "Stripe Main",
      type: "stripeApi",
      data: { secretKey: "sk_live_sim51Kd0Pz9wXy" },
      status: "unverified",
      daysAgo: 3,
    },
  ];
  for (const credential of credentialSeeds) {
    await db.credential.create({
      data: {
        name: credential.name,
        type: credential.type,
        dataEnc: encryptJSON(credential.data),
        status: credential.status,
        lastTestedAt:
          credential.status === "verified"
            ? new Date(now.getTime() - Math.floor(r() * 3 * 24 * 60 * 60 * 1000))
            : null,
        createdAt: new Date(now.getTime() - credential.daysAgo * 24 * 60 * 60 * 1000),
      },
    });
  }

  /* ---- Variables ---- */
  await db.variable.createMany({
    data: [
      { key: "SLACK_CHANNEL", value: "#automations" },
      { key: "OWNER_EMAIL", value: "founder@blissvoid.io" },
      { key: "TIMEZONE", value: "America/Los_Angeles" },
      { key: "MAX_RETRY", value: "3" },
    ],
  });

  /* ---- Execution history (past 14 days, active workflows only) ---- */
  interface ExecDraft {
    id: string;
    workflowKey: string;
    status: "success" | "error";
    mode: string;
    startedAt: Date;
    durationMs: number;
    aiTokens: number;
    error: string | null;
    samples: NodeSample[];
    failIndex: number; // -1 when success
  }

  const samplers: Record<string, (rng: Rng) => NodeSample[]> = {
    "AI Lead Triage": () => {
      const used = new Set<string>();
      const leads: LeadCtx[] = [];
      while (leads.length < 3) {
        const name = pick(NAMES, r);
        if (used.has(name)) continue;
        used.add(name);
        leads.push({
          name,
          email: `${name.split(" ")[0].toLowerCase()}@${pick(COMPANIES, r).split(" ")[0].toLowerCase()}.io`,
          company: pick(COMPANIES, r),
          message: pick(LEAD_MESSAGES, r),
          score: 20 + Math.floor(r() * 79),
        });
      }
      return leadTriageSamples(r, leads);
    },
    "Daily Standup Digest": () => standupSamples(r),
    "Support Sentiment Radar": () => radarSamples(r),
    "Repo Watchdog": () => watchdogSamples(r),
  };

  const drafts: ExecDraft[] = [];
  let execCounter = 0;

  for (const seed of workflowSeeds.filter((w) => w.active)) {
    const sampler = samplers[seed.name];
    if (!sampler) continue;
    for (let dayIndex = 13; dayIndex >= 0; dayIndex--) {
      const count = 4 + Math.round(dayIndex * 0.45) + Math.floor(r() * 3);
      for (let i = 0; i < count; i++) {
        execCounter += 1;
        const samples = sampler(r);
        const isError = r() < 0.095;

        let failIndex = -1;
        let errorMessage: string | null = null;
        if (isError) {
          const presentTypes = new Set(samples.map((s) => s.nodeType));
          const candidates = ERROR_POOL.filter((e) =>
            [...presentTypes].some((t) => e.typePattern.test(t))
          );
          const chosen = candidates.length > 0 ? pick(candidates, r) : null;
          if (chosen) {
            failIndex = samples.findIndex((s) => chosen.typePattern.test(s.nodeType));
            errorMessage = chosen.message;
          } else {
            failIndex = samples.length - 1;
            errorMessage = "Node failed unexpectedly";
          }
        }

        const businessHours = r() < 0.8;
        // For "today", keep seeded runs strictly in the past so live runs
        // always surface as the most recent executions.
        const maxHour = dayIndex === 0 ? Math.max(1, now.getHours() - 1) : 24;
        const hour = businessHours
          ? Math.min(8 + Math.floor(r() * 11), maxHour)
          : Math.floor(r() * maxHour);
        const startedAt = new Date(now.getTime() - dayIndex * 24 * 60 * 60 * 1000);
        startedAt.setHours(hour, Math.floor(r() * 60), Math.floor(r() * 60), 0);

        const nodeCount = failIndex >= 0 ? Math.max(1, failIndex + 1) : samples.length;
        const durationMs = Math.min(
          9000,
          700 + nodeCount * (380 + Math.floor(r() * 520))
        );

        let aiTokens = 0;
        if (seed.hasAi && failIndex !== 0) {
          const aiNodesRun = samples
            .slice(0, failIndex >= 0 ? failIndex + 1 : samples.length)
            .filter((s) => s.nodeType.startsWith("ai")).length;
          aiTokens = aiNodesRun * (600 + Math.floor(r() * 2600));
        }

        drafts.push({
          id: `exe_seed_${execCounter.toString().padStart(4, "0")}`,
          workflowKey: seed.name,
          status: isError ? "error" : "success",
          mode: r() < 0.7 ? "trigger" : "manual",
          startedAt,
          durationMs,
          aiTokens,
          error: errorMessage,
          samples,
          failIndex,
        });
      }
    }
  }

  /* ---- Bulk insert executions ---- */
  const workflowIdByKey = workflowIdByName;
  await createManyChunked(
    db.execution,
    drafts.map((draft) => ({
      id: draft.id,
      workflowId: workflowIdByKey.get(draft.workflowKey) ?? "",
      status: draft.status,
      mode: draft.mode,
      triggerType: draft.samples[0]?.nodeType ?? "manual",
      error: draft.error,
      startedAt: draft.startedAt,
      finishedAt: new Date(draft.startedAt.getTime() + draft.durationMs),
      durationMs: draft.durationMs,
      aiTokens: draft.aiTokens,
      aiCost: Math.round(draft.aiTokens * 0.000003 * 1e9) / 1e9,
    }))
  );

  /* ---- Node runs ---- */
  const nodeRunRows: Record<string, unknown>[] = [];
  for (const draft of drafts) {
    const ranSamples =
      draft.failIndex >= 0 ? draft.samples.slice(0, draft.failIndex + 1) : draft.samples;
    const weights = ranSamples.map(() => 0.4 + r());
    const weightSum = weights.reduce((a, b) => a + b, 0);
    let offset = 0;
    ranSamples.forEach((sample, index) => {
      const share = Math.max(60, Math.round((weights[index] / weightSum) * draft.durationMs));
      offset += share;
      const input = sample.input.slice(0, 4);
      const output = sample.output.slice(0, 4);
      const failedHere = draft.failIndex === index;
      nodeRunRows.push({
        executionId: draft.id,
        nodeId: sample.nodeId,
        nodeName: sample.nodeName,
        nodeType: sample.nodeType,
        status: failedHere ? "error" : "success",
        startedAt: new Date(draft.startedAt.getTime() + offset - share),
        durationMs: failedHere ? Math.min(share, 420) : share,
        inputJson: JSON.stringify(input),
        outputJson: failedHere ? null : JSON.stringify(output),
        error: failedHere ? draft.error : null,
        attempt: 1,
      });
    });
  }
  await createManyChunked(db.nodeRun, nodeRunRows, 150);

  /* ---- AI usage rows (sampled from AI executions) ---- */
  const aiExecutions = drafts.filter((d) => d.aiTokens > 0 && d.status === "success");
  const usageRows = aiExecutions
    .filter(() => r() < 0.35)
    .slice(0, 44)
    .map((draft) => {
      const tokensIn = Math.floor(draft.aiTokens * 0.6);
      const tokensOut = draft.aiTokens - tokensIn;
      return {
        executionId: draft.id,
        provider: "bliss",
        model: "bliss-1",
        tokensIn,
        tokensOut,
        cost: Math.round(draft.aiTokens * 0.000003 * 1e9) / 1e9,
        createdAt: draft.startedAt,
      };
    });
  if (usageRows.length > 0) await createManyChunked(db.aiUsage, usageRows);

  /* ---- Activity log ---- */
  const activityRows: Record<string, unknown>[] = [];
  for (const seed of workflowSeeds) {
    activityRows.push({
      kind: "workflow.created",
      message: `Workflow "${seed.name}" was created`,
      workflowId: workflowIdByName.get(seed.name) ?? null,
      createdAt: new Date(now.getTime() - (25 + Math.floor(r() * 6)) * 24 * 60 * 60 * 1000),
    });
    if (seed.active) {
      activityRows.push({
        kind: "workflow.activated",
        message: `Workflow "${seed.name}" was activated`,
        workflowId: workflowIdByName.get(seed.name) ?? null,
        createdAt: new Date(now.getTime() - (20 + Math.floor(r() * 5)) * 24 * 60 * 60 * 1000),
      });
    }
  }
  for (const credential of credentialSeeds) {
    activityRows.push({
      kind: "credential.added",
      message: `Credential "${credential.name}" (${credential.type}) was added to the vault`,
      workflowId: null,
      createdAt: new Date(now.getTime() - credential.daysAgo * 24 * 60 * 60 * 1000),
    });
  }
  const templateHighlights = [
    "Template spotlight: AI Customer Support Auto-Reply crossed 40 installs",
    "Template spotlight: AI Agent Research Assistant is trending this week",
    "Template spotlight: AI Content Repurposer keeps winning hearts",
  ];
  activityRows.push({
    kind: "workflow.ai_created",
    message: 'Workflow "Hacker News Morning Digest" was conjured from the prompt: "Every day at 9am summarize Hacker News and post to Slack"',
    workflowId: null,
    createdAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000),
  });
  templateHighlights.forEach((message, i) => {
    activityRows.push({
      kind: "template.highlighted",
      message,
      workflowId: null,
      createdAt: new Date(now.getTime() - (2 + i * 3) * 24 * 60 * 60 * 1000),
    });
  });
  const notable = drafts
    .filter((d) => d.status === "error")
    .slice(-3)
    .concat(drafts.filter((d) => d.status === "success").slice(-2));
  for (const draft of notable) {
    activityRows.push({
      kind: "workflow.run",
      message:
        draft.status === "error"
          ? `"${draft.workflowKey}" failed — ${draft.error}`
          : `"${draft.workflowKey}" completed in ${(draft.durationMs / 1000).toFixed(1)}s`,
      workflowId: workflowIdByKey.get(draft.workflowKey) ?? null,
      createdAt: draft.startedAt,
    });
  }
  await createManyChunked(db.activityLog, activityRows);
}
