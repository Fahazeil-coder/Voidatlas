# BLISSVOID — Integrations Audit (Phase 1)

**Scope:** `src/lib/engine/executors.ts` (integration + HTTP + AI executors), `src/lib/blissvoid/node-catalog.ts`, credentials vault usage, webhook route @ `v1.0.0` (commit `a92d3d0`)
**Method:** every executor read line-by-line and cross-checked against the catalog and the vault. `[VERIFIED]` / `[RISK]` / `[LIMITATION]` as before.

---

## Reality matrix (verified)

| Node type | Category | Runtime behavior | Side effects |
|---|---|---|---|
| `httpRequest` | Action | **REAL** `fetch` with timeout/bearer/query/header resolution (`executors.ts:589-669`) | Real outbound requests |
| `aiChat` / `aiSummarize` / `aiClassify` / `aiSentiment` / `aiAgent` | AI | **REAL** LLM calls via z-ai SDK with silent heuristic fallbacks (`executors.ts:113-141, 716-881`) | Real LLM spend |
| `slack`, `email`, `notion`, `googleSheets`, `telegram`, `discord`, `github`, `stripe` | Integration | **SIMULATED** — return `ok: true, delivered: "simulated", _simulated: true` (`executors.ts:266-449`) | None |
| `respond` | Action | **DECORATIVE** — tags items with `responseMessage`; the webhook caller always receives a fixed `{ok: true, message: "Signal received…"}` JSON (`hooks/[path]/route.ts:69`) because execution is fire-and-forget | None |
| `schedule`, `formTrigger`, `chatTrigger`, `webhook` (manual run) | Trigger | **FABRICATED** sample payloads (e.g., `ada@blissvoid.io` form data, mock webhook headers) (`executors.ts:188-259`) | None |
| `code` | Data | REAL (sandboxed weakly — see SECURITY_AUDIT SEC-03) | Arbitrary |

## Findings

### INT-01 — Simulated connectors report success for actions that never happened

- **Severity:** High (per the engineering mandate: "Never mark simulated integration outputs as successful production actions")
- **Classification:** `[VERIFIED]` `[LIMITATION]` (deliberate demo design, but must not persist into production semantics)
- **Affected files:** `executors.ts:266-449` (all 8 connectors), `engine.ts:364-374` (any non-throwing executor ⇒ `NodeRun.status = "success"`), UI run panel (renders these as green deliveries)
- **Technical explanation:** Each simulated connector emits `ok: true, delivered: "simulated"` and the engine records success. The `_simulated` flag exists in the payload but nothing — engine status, execution status, UI badges, activity feed — distinguishes simulated from real delivery. A "Send Slack alert" step that never reached Slack shows identically to a real one.
- **User impact:** Users cannot tell what is real; demo-to-production transition silently no-ops.
- **Proposed solution:** Phase 6 — Connector SDK where production connectors perform real API calls, and until a connector is real, the node must present as `simulated` end-to-end: distinct status ("simulated"/"warning"), UI badge, execution summary count ("3 real actions, 2 simulated"). Never `success`.
- **Dependencies:** SEC-06 (vault-bound credentials), Phase 6 SDK.
- **Required tests:** engine test asserting simulated nodes yield a distinguishable status; UI snapshot shows the badge.

### INT-02 — Credentials vault is never used by any executor

- **Severity:** Critical (for the production mission) / `[VERIFIED]`
- **Affected files:** `executors.ts` (zero `db.credential` reads — vault consulted only by API routes for create/mask/delete), `node-catalog.ts` (no credential-reference param on any integration node)
- **Technical explanation:** The 12 credential types and AES-256-GCM vault exist, but no node can *use* a stored credential. HTTP auth is a raw token param (SEC-06). This makes the vault decorative for execution.
- **Proposed solution:** Phase 6 — connector SDK auth pipeline: node references `credentialId`; executor resolves + decrypts at run time; per-connector credential schema validation; test-connection endpoint implemented for real (fixes the currently 404ing UI button, ARCH-07).
- **Dependencies:** SEC-02 (real master key), SEC-06.
- **Required tests:** connector unit test resolves vault credential and signs a request (mocked transport); missing/invalid credential → clear node error; test-connection route returns provider verdict.

### INT-03 — Webhook callers cannot receive workflow output

- **Severity:** High / `[VERIFIED]`
- **Affected files:** `hooks/[path]/route.ts:68-69` (immediate fixed response), `executors.ts:572-579` (`respond` node is a no-op tagger)
- **Technical explanation:** The hook returns before any node runs (fire-and-forget), so request/response automation (echo enriched data, acknowledge, proxy) is impossible. The `respond` node implies otherwise.
- **Proposed solution:** Phase 4/6 — synchronous webhook mode: queue job with `await`-on-first-respond-node (bounded wait, e.g., ≤30 s) returning the respond node's payload; default stays 202 + execution id. Requires workers + durable state.
- **Dependencies:** Phase 4.
- **Required tests:** integration test: webhook → respond node payload returned to caller (sync mode); timeout degrades to 202 with id.

### INT-04 — HTTP connector robustness gaps

- **Severity:** Medium / `[VERIFIED]`
- **Affected files:** `executors.ts:589-669`
- **Technical explanation (verified list):** no redirect policy (follows anywhere — SSRF angle in SEC-05); no response schema validation (raw text/parsed JSON passthrough); no pagination; `status >= 400` always throws (no "save 404 as data" option); per-item sequential requests (ENG-13); JSON cap dead code (ENG-16); no per-request cost/time telemetry beyond NodeRun duration.
- **Proposed solution:** Phase 6 — HTTP becomes the reference Connector SDK implementation: URL policy (SEC-05), response mapping (status/header/body selection), retry classification (idempotent methods only, honor Retry-After), optional pagination (cursor/offset), typed output schema.
- **Dependencies:** SEC-05.
- **Required tests:** redirect-to-private rejected; 404-as-data mode; Retry-After honored; pagination walks 3 pages (mocked server).

### INT-05 — AI "provider" surface is a single hardcoded dependency with fabricated metadata

- **Severity:** Medium / `[VERIFIED]`
- **Affected files:** `executors.ts:105-160` (module-level ZAI singleton; `model: "bliss-1"`, `provider: "bliss"` labels; `AI_COST_PER_TOKEN = 0.000003` hardcoded; `estimateTokens = ceil(len/4)`), engine.ts:415-426 (usage rows labeled with the fabricated names)
- **Technical explanation:** All AI features call one SDK. Token counts are estimates and costs are a made-up constant; `AiUsage` rows therefore don't meter anything real. There is no model selection, fallback, or structured-output enforcement (`tolerantJson` best-effort, silent defaults on parse failure — e.g., classify falls back to `label: categories[0], confidence: 0.5` and reports success).
- **Proposed solution (Phase 7):** provider-neutral `AiProvider` interface (complete(prompt, {schema}) → typed result); adapters per provider with real usage metadata from the response; provider fallback chain; structured outputs via schema-constrained decoding with validation failure = node error (never silent defaults); honest cost table per model.
- **Dependencies:** Phase 6 SDK patterns (auth/retry), SEC-11 redaction.
- **Required tests:** provider adapter contract tests (mocked transports); invalid model output → node error, not default; usage rows match mocked response usage fields.

### INT-06 — Webhook trigger registration/selection is fragile

- **Severity:** Medium / `[VERIFIED]`
- **Affected files:** `hooks/[path]/route.ts:15-37` (SQL `contains` prefilter on the raw nodes JSON column then JS exact match; first-active-wins ambiguity; `method` param ignored; inactive workflows still fire)
- **Proposed solution:** Phase 3 (SEC-07 covers auth/method/active) + Phase 4: persist hook registrations in a dedicated table (`WebhookHook { path unique, workflowId, nodeId, method, auth }`) maintained on workflow save; route looks up the table; uniqueness enforced.
- **Dependencies:** SEC-07.
- **Required tests:** duplicate path rejected at save; lookup returns exact registration; renamed path updates registration.

### INT-07 — Trigger sample data fabricates realistic-looking payloads

- **Severity:** Medium (honesty) / `[VERIFIED]`
- **Affected files:** `executors.ts:188-259` (webhook mock headers/body, form values `ada@blissvoid.io`, chat welcome, schedule timestamp), catalog `sampleData` params
- **Technical explanation:** Manual runs of trigger nodes inject synthetic data without a visible marker (webhook manual output includes fake `headers`/`body`); users can mistake it for a real capture.
- **Proposed solution:** mark fabricated items `_synthetic: true` and render a "sample data" chip in the run panel; keep sample data as an explicit, visible testing feature.
- **Dependencies:** none.
- **Required tests:** manual-run trigger items carry `_synthetic`; UI displays chip.

---

## Connector framework target (Phase 6 design brief, derived from the above)

1. **SDK contract per connector:** `manifest` (id, auth type, credential schema, operations), `validateParams`, `execute(op, params, items, auth)` with typed results; shared concerns (retry, rate-limit handling, pagination, error mapping, logging) in the framework, not per connector.
2. **Real first set (small, high-reliability):** HTTP (reference), Slack (webhook/API), GitHub (issues/comments), Email (SMTP). Each with: real auth from vault, schema validation, error taxonomy, unit tests against mocked transport, and a live-verification checklist (live tests marked *outstanding* when credentials are unavailable, per the mission's honesty rule).
3. **Simulated connectors stay visually distinct until replaced** (INT-01).

## Summary counts

| Severity | Count |
|---|---|
| Critical (production mission) | 1 (INT-02) |
| High | 3 (INT-01, INT-03, + INT-02 critical counted) — see table above |
| Medium | 4 (INT-04, INT-05, INT-06, INT-07) |
