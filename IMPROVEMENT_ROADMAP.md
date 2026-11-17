# BLISSVOID — Improvement Roadmap (Phase 1 output)

**Purpose:** a dependency-ordered implementation sequence derived from the verified findings in the six sibling audits. It maps to the mission's Phases 2-8 but orders work by *actual technical dependency and risk*, with entry/exit criteria and test evidence required at every stage.
**Rule of engagement (per the mandate):** one stage is selected and completed before the next begins; no large uncontrolled rewrites; every stage lands as logically grouped commits with tests.

---

## Sequence overview

```
Stage 0  Baseline & Safety          (mission Phase 2)      ── prerequisite for everything
Stage 1  Safe Execution Core        (mission Phase 3a)     ── kills the RCE/DoS class
Stage 2  Perimeter Security         (mission Phase 3b)     ── auth, webhooks, SSRF, limits
Stage 3  Execution Infrastructure   (mission Phase 4)      ── Postgres, Redis, workers, scheduler
Stage 4  Engine Correctness         (mission Phase 5)      ── false-success, versions, loops
Stage 5  Connector Framework        (mission Phase 6)      ── real integrations
Stage 6  AI Architecture            (mission Phase 7)      ── providers, validation, approval
Stage 7  Quality Engineering        (mission Phase 8)      ── full test ladder, chaos, perf
```

Stages 1 and 2 can partially overlap (different files), but Stage 1 goes first: there is no point putting a lock on a door that leads into an open reactor.

---

## Stage 0 — Baseline & Safety (mission Phase 2) · Effort: **S**

**Why first:** every later change lands on this baseline; the mission requires v1.0.0 protected and rollback possible.

**Tasks**
1. Create `develop` branch from `v1.0.0` (done with this audit commit); protect `main`; tag remains immutable.
2. Database safety: `scripts/backup.sh` / `restore.sh` (SQLite `VACUUM INTO`), pre-migration backup hook (fixes DB-09).
3. Migration baseline: `prisma migrate dev --name baseline` capturing current schema; delete `--accept-data-loss` from scripts (DB-01).
4. Build honesty: `ignoreBuildErrors: false`, `noImplicitAny: true`, `tsc --noEmit` in CI; re-enable lint rules in batches (TEST-02/03, ARCH-01). *(Measured: 0 current errors in `src/` — this is safe to flip now.)*
5. CI skeleton: install → typecheck → lint → build (TEST-02).
6. Unit-test bootstrap: `vitest` + first suites for `expression.ts`, `crypto.ts`, `serializePayload` (TEST-01 entry).
7. Zero-risk UX truth-fixes that require no architecture: mount the sonner `<Toaster/>` (ARCH-09), correct README claims (ARCH-07), label schedule triggers "scheduler arrives in Phase 4" (ARCH-03 interim).
8. Dependency prune in a single reviewed commit (ARCH-05) with smoke tests.

**Exit criteria:** CI green with unsuppressed typecheck; backup/restore drill documented; baseline migration applies to an empty DB; audit docs + roadmap committed.

**Explicitly out:** any behavior change to the engine or API semantics.

---

## Stage 1 — Safe Execution Core (mission Phase 3a) · Effort: **M-L**

**Why second:** SEC-03/SEC-04 (code node + expressions = RCE and event-loop DoS in the main process) are the highest-severity verified findings; SEC-02 (public fallback master key) and SEC-06 (plaintext secrets) complete the trust failure.

**Tasks**
1. **AST expression interpreter** (SEC-04): parser + whitelist walker (no `constructor`/`__proto__` access, no function construction, step budget). Full compatibility corpus from seeded workflows/templates must produce identical outputs. The client preview (`param-controls.tsx`) adopts the same grammar package so preview == execution semantics (fixes the verified divergence).
2. **Isolated Code-node runner** (SEC-03): out of the main process. *Decision required — options with trade-offs:*
   - (a) `child_process` pool with hardened flags: strongest isolation per effort, ~50-150 ms/node overhead, needs process-lifecycle management;
   - (b) dedicated mini-service (own port, resource-limited): aligns with the Phase 4 worker direction, adds an operational component;
   - (c) isolate/QuickJS VM: best latency, adds a dependency and its own CVE surface.
   Recommendation: (b) if Stage 3 is confirmed (same deployment pattern), else (a) as the interim.
   Hard timeout via SIGKILL (the current `Promise.race` cannot stop sync loops — verified).
3. **Master-key enforcement** (SEC-02): boot fails without `BLISSVOID_MASTER_KEY`; documented generation; rotation command (re-encrypt all rows); per-credential DEK design noted for Stage 5.
4. **Secrets out of node params** (SEC-06 interim): HTTP node gains `credentialId` reference (resolved from vault at run time); token param deprecated with migration importer.
5. **Redaction layer** (SEC-11, SEC-15): all LLM prompts + persisted payloads pass a redactor (key-name + pattern heuristics); unit corpus proves masking.

**Exit criteria (security acceptance subset):** escape corpus fails closed; sync-loop payload cannot block the API > 2 s; boot without key fails; rotation round-trips; redaction assertions on mocked SDK; compatibility corpus green.

**Tests:** security suite from TESTING_AUDIT ladder; engine regression suites.

---

## Stage 2 — Perimeter Security (mission Phase 3b) · Effort: **M**

**Tasks**
1. Authentication + sessions (SEC-01): credentials login, signed httpOnly session cookies; every route behind `requireUser()`.
2. Workspace isolation: `workspaceId` on all domain rows and every query; cross-workspace access → 403 contract-tested.
3. Webhook hardening (SEC-07): HMAC-SHA256 + timestamp window + nonce cache (replay protection), method enforcement, active-only firing, per-path rate limit, 202 + execution id, dedicated `WebhookHook` registration table (INT-06, DB-05).
4. SSRF policy (SEC-05): protocol allowlist, private/loopback/link-local rejection incl. after redirects (`redirect: "manual"` + revalidate), honest response caps (ENG-16).
5. Rate limiting + request size caps (SEC-08): token buckets (in-process now, Redis-backed in Stage 3), prompt/context max lengths.
6. Error hygiene (SEC-12): central error mapper, generic 500s + requestId correlation.
7. Security audit log (SEC-14) + headers/CSP (SEC-13).
8. Mask hardening (SEC-09) and secret-typed variables (SEC-10).

**Exit criteria:** the full security acceptance gate listed at the end of `SECURITY_AUDIT.md`. **Only after this gate passes is any internet exposure permitted** (mandate).

---

## Stage 3 — Execution Infrastructure (mission Phase 4) · Effort: **L-XL**

**Trade-off statement (mandated by "explain architecture changes"):** moving from SQLite+in-process to PostgreSQL + Redis + BullMQ + separate workers adds two operational dependencies and deployment complexity. The justification: verified findings ENG-03/04/05 (no recovery, no cancellation, no idempotency), ARCH-02/03 (in-process execution, nonexistent scheduler), and DB-06/08 (single-writer contention, unbounded growth) are unfixable within the current architecture. BullMQ is chosen over alternatives for: durable Redis-backed jobs, stalled-job detection (heartbeat equivalent), rate/concurrency control, and first-class repeatable jobs (cron) — exactly the four primitives this stage needs. *Exactly-once delivery is NOT claimed*: at-least-once with idempotency keys is the honest contract, documented as a stated limitation.

**Tasks**
1. Postgres migration (DB-08): provider swap, `Json` columns for graphs, enums, DB-03 indexes, DB-04 relations; parity suite on a production-shaped data copy; SQLite local profile kept as documented option.
2. Worker service: consumes a `workflow.run` queue; heartbeats; startup sweep marks stale `running` executions (ENG-03); cancellation flag + `/executions/[id]/cancel` (ENG-04); retry replays persisted trigger data with idempotency keys (ENG-05).
3. Scheduler (ARCH-03): cron evaluation for `active` schedule workflows → queued executions; timezone-aware; dedupe on missed-fire policy (documented).
4. Durable waiting (ENG-09): persist resume-at; scheduler re-enqueues.
5. Execution event history: `ctx.log` wired to persisted events (ENG-15); UI timeline extension.
6. Rate limiter moves to Redis; webhook bursts absorbed by the queue.
7. Stats aggregation pushed to SQL / aggregate table (DB-06).

**Exit criteria:** recovery suite (kill -9 at 3 staged points) green; cancellation honored between nodes; scheduler fires `*/1` cron within 70 s and stops on deactivate; retry reproduces original trigger payload; no stuck `running` rows after worker restart.

---

## Stage 4 — Engine Correctness (mission Phase 5) · Effort: **L**

**Tasks**
1. Graph validation on save + run: cycle detection (loop back-edge exception), single-trigger rule, name uniqueness, connectivity accounting (ENG-02, ENG-12).
2. Honest statuses: `skipped` distinct from `success`; execution counters (`executed/skipped/errored`); success requires **all nodes accounted for** (ENG-01, ENG-07 — fixes both false-success classes).
3. Workflow versioning + execution snapshots (ENG-11): immutable `WorkflowVersion`, executions pin versions, replay/retry use snapshots.
4. Real Loop semantics (ENG-10): `batch`/`done` handles, validated back-edge, iteration caps, per-iteration telemetry.
5. Sub-workflows: `executeWorkflow` node calling a pinned version with input mapping; recursion depth cap.
6. Typed items + binary references: `Item { json, binary? }` with `binary` as a reference (id, mime, size) into object storage — keeps rows small; HTTP node can produce binary refs (files), download-to-text option.
7. Node timeout enforcement engine-wide (ENG-07), artificial latency removal behind a dev-only flag (ENG-06), `$input` semantics fix (ENG-08), aiChat cap visibility (ENG-14).
8. Concurrency: bounded parallel waves + per-item pools (ENG-13).

**Exit criteria:** engine unit suites over a fixture-graph library (diamond, loop, skip, continueOnFail, sub-workflow, timeout) all green; replay of a historical run shows the exact version that ran; 100-node workflow completes under limits.

---

## Stage 5 — Connector Framework (mission Phase 6) · Effort: **L**

**Tasks**
1. Connector SDK (INT-01/02, SEC-06): manifest (auth type, credential schema, operations), param validation, execution pipeline with shared retry/rate-limit/pagination/error-mapping; simulated connectors render as `simulated` status everywhere (never success) until real.
2. Credential binding end-to-end: vault resolution at run time, per-connector test-connection (fixes the 404 button — ARCH-07), rotation from Stage 1 DEK design.
3. First real connectors (small, high-reliability): **HTTP (reference)**, **Slack**, **GitHub**, **Email(SMTP)** — each with mocked-transport test suites, recorded fixtures, and live-verification checklists explicitly marked *outstanding* where credentials are unavailable (mandate's honesty rule).
4. Webhook respond path (INT-03): synchronous bounded-wait mode returning a respond-node payload.

**Exit criteria:** connector contract tests green; real Slack message delivered in live verification (or explicitly reported as outstanding); simulated badges visible in UI; no secret ever in workflow JSON or API responses (invariant test).

---

## Stage 6 — AI Architecture (mission Phase 7) · Effort: **M**

**Tasks**
1. Provider-neutral `AiProvider` interface; adapters with real usage metadata (kills fabricated `bliss-1`/$3-per-1M estimates — INT-05); model registry + fallback chain; per-workspace provider settings wired to the (now real) Settings screen (ARCH-08).
2. Structured outputs: schema-constrained decoding; validation failure = node error, never silent defaults (INT-05).
3. AI workflow generation hardening: drafts validated against the node registry + connector schemas **and** Stage 4 graph validation before save; proposed as a **diff against the current workflow** with human approval for high-impact changes (activation, destructive ops) — per the mandate "AI must never fabricate integrations, results or credentials".
4. Execution Doctor + Node Assistant consume the redaction layer (Stage 1) and cite real telemetry.

**Exit criteria:** provider contract tests; generated-workflow validation tests (registry, schema, graph); approval flow E2E; usage rows match provider-reported tokens (mocked).

---

## Stage 7 — Quality Engineering (mission Phase 8, woven throughout, finalized here) · Effort: **L**

The ladder from `TESTING_AUDIT.md` grows with every stage (unit from Stage 0; security from Stage 1-2; recovery/chaos from Stage 3; engine from Stage 4; connectors from Stage 5; performance from Stage 3+). Stage 7 finalizes:

1. E2E suite coverage of every golden path; visual regression on core views.
2. Performance budgets in CI (dashboard < 300 ms @100k executions; run wall-times; bundle budget for ARCH-06 code-splitting).
3. Chaos drills scheduled and documented (worker kill, Redis blip, DB failover for Postgres).
4. Release checklist, deployment config (Dockerfile, compose with Postgres/Redis/worker/web, health checks), backup/restore runbook update, SECURITY.md with known limitations, CHANGELOG.

**Deliverable checklist (final, per the mandate):** working application · production-oriented architecture · secure credential management · reliable engine · separate workers · real connectors · AI architecture · migrations · automated tests · deployment configuration · backup/restore instructions · documentation · security limitations · known issues · release checklist.

---

## Known limitations to carry forward honestly

- **At-least-once execution** with idempotency keys — exactly-once is not claimed (Stage 3).
- **Code-node isolation** is best-effort process isolation, not a formally verified sandbox; document the chosen option's residual risks.
- **Live connector verification** may be *outstanding* where third-party credentials are unavailable — reported explicitly, never claimed.
- **Single-workspace** until multi-tenancy is scheduled (auth lands first; tenant isolation is a later, explicitly scoped stage).

## Awaiting selection

No implementation work beyond this audit has begun. **Select the stage to start** — recommendation: **Stage 0 (baseline & safety)**, which is small, risk-free, and unblocks everything else.
