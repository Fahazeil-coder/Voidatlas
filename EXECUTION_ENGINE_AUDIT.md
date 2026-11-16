# BLISSVOID — Execution Engine Audit (Phase 1)

**Scope:** `src/lib/engine/engine.ts`, `src/lib/engine/executors.ts`, `src/lib/engine/expression.ts`, run/retry/hooks routes, `prisma/schema.prisma` @ `v1.0.0` (commit `a92d3d0`)
**Method:** complete line-level read of the engine and executors by the principal engineer; every claim below cites the exact mechanism. `[VERIFIED]` / `[RISK]` / `[LIMITATION]` as before.

---

## How execution actually works (verified)

1. `startExecution()` loads the workflow, parses `nodes`/`edges`, creates an `Execution` row (`status: "running"`), and **fire-and-forgets** `runExecution()` inside the API process (`engine.ts:36-71`).
2. `runExecution()` performs a **wave traversal**: a node is *ready* when all its incoming edges have fired (or it is the start node); ready nodes are executed **sequentially** within each wave (`engine.ts:201-393`).
3. Inputs are the concatenation of all incoming edge payloads; `merge` in `combine` mode zips by index (`engine.ts:231-239`).
4. Node outcomes are persisted as `NodeRun` rows (status, duration, input/output JSON capped at 15 KB, attempt count).
5. Execution finalizes as `success` unless a **hard fail** occurred (node error without `continueOnFail`) or the run exceeded `MAX_NODE_RUNS = 40` **with nodes still pending** (`engine.ts:395-413`).
6. Retries: `settings.retry` grants `maxRetries + 1` attempts with exponential backoff `400ms * 2^(attempt-1)` (`engine.ts:345-362`).
7. An artificial delay of **250 ms (triggers) / 350-650 ms (all other nodes)** is injected before every execution (`engine.ts:325-326`).

---

## Findings

### ENG-01 — False success: `continueOnFail` errors are erased at execution level

- **Severity:** Critical
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/engine.ts:386-387` (error + continueOnFail → `fireOutgoing(nodeId, [])`), `:274-290` (zero-item downstream nodes recorded `status: "success"` with `note: "skipped (no items)"`), `:400` (final status only reflects `hardFailMessage`)
- **Technical explanation:** When a node fails with `continueOnFail: true`, it emits **zero items**. Every downstream node then takes the "no items incoming" path, which writes `NodeRun.status = "success"` with a note. The execution-level status is computed solely from `hardFailMessage`/limit-exceeded — node errors under `continueOnFail` are invisible to it. Result: an execution in which a node **threw an error** is reported as `success`, and the run panel shows an unbroken chain of green nodes.
- **User impact:** Users trust runs that partially failed; alerts-on-failure never fire; this is precisely the "false-success scenario" the engineering mandate forbids.
- **Proposed solution (Phase 5):** introduce `NodeRun.status = "skipped"` distinct from success; track `erroredNodes`/`skippedNodes` counters on the Execution; final status = `success` only when zero errors and zero unaccounted nodes; `warning` status when errors occurred but were configured to continue; surface counters in the UI.
- **Dependencies:** schema change (Execution counters) → migration discipline (Phase 2), UI run-panel update.
- **Required tests:** engine unit tests: (a) continueOnFail error → execution status `warning`/`error-with-continuation`, NodeRun shows error; (b) all-clean run → `success`; (c) counters match nodeRun rows.

### ENG-02 — False success: cycles and unreachable nodes are silently unexecuted

- **Severity:** Critical
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/engine.ts:201-211` (`ready.length === 0` → `break`), `:399-400` (`exceededLimit` only true when the 40-run cap was hit; a graph that deadlocks is not accounted)
- **Technical explanation:** The wave loop stops when no node is ready. For a **cyclic** graph (e.g., connecting a node's output back to an ancestor, the natural way a user would draw a loop), no node's incoming edges are ever all-fired, so the loop breaks with `pending.size > 0` and `nodeExecutionCount === 0`. `exceededLimit` is false, `hardFailMessage` is null → status **`success` with zero nodes executed**. The same holds for any disconnected/orphan node set: only the start node's connected component runs; everything else is silently ignored. There is **no graph validation** anywhere (no cycle detection, no connectivity check, no duplicate-name check at save or run time).
- **User impact:** A user draws a loop-back (a reasonable automation shape) and receives a green "success" while nothing ran. Data integrity: `success` is meaningless for such graphs.
- **Proposed solution (Phase 5):** (1) validate graphs on save *and* run: cycle detection (except through explicit loop nodes), single trigger, name uniqueness; reject with actionable errors. (2) Final accounting: an execution may be `success` only if every non-disabled node is either executed or explicitly `skipped` with reason; otherwise `error` ("N nodes unreachable"). (3) Real iteration semantics for the Loop node (ENG-10).
- **Dependencies:** none.
- **Required tests:** cyclic graph → validation error at save/run, never `success`; disconnected graph → execution error listing unreachable nodes; duplicate names rejected.

### ENG-03 — No crash recovery: executions orphan as `running` forever

- **Severity:** Critical
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/engine.ts` (no heartbeat, no lease, no startup sweep anywhere in the repo)
- **Technical explanation:** Execution state lives only in the process memory plus DB rows. If the process exits (crash, deploy, OOM from an unbounded LLM call), in-flight executions remain `status: "running"` in SQLite forever. There is no restart hook, no lease/heartbeat column, and the UI polls `running` executions indefinitely (editor poll self-clears only on terminal status or fetch error).
- **User impact:** Dashboard shows phantom "running" executions; success-rate stats are wrong; no way to distinguish "slow" from "dead".
- **Proposed solution (Phase 4):** worker-based execution with heartbeat column (or BullMQ stalled-job detection), startup/maintenance sweep marking stale runs as `error: "worker lost"`, and recovery strategy options (resume from last persisted NodeRun — requires ENG-11 snapshots — or mark-failed with retry).
- **Dependencies:** Phase 4 infrastructure; ENG-11 for resume.
- **Required tests:** recovery suite: kill worker (a) before first node, (b) mid-node, (c) after last node before finalize; assert sweep marks/repairs correctly and no double side-effects (idempotency keys).

### ENG-04 — No cancellation; deleting a running execution corrupts the run

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/api/executions/[id]/route.ts:38` (hard `delete`), `engine.ts` run loop (no cancellation check; `finalizeError` swallows update failures `.catch(() => undefined)`)
- **Technical explanation:** The `canceled` status exists in the type union but **no code path can produce it**. The only mutation is hard-delete; if it targets a running execution, the cascade deletes its NodeRun rows while the background `runExecution` continues and its next `db.nodeRun.create` throws (P2025) — caught by the outer handler, logged to console, and the user sees nothing. Side-effectful nodes (HTTP/AI) keep executing after the "delete".
- **User impact:** No way to stop a runaway workflow; destructive action produces invisible inconsistency.
- **Proposed solution (Phase 4):** cancellation flag (checked between nodes and before side-effectful executors) + `POST /executions/[id]/cancel`; refuse hard-delete of running executions (or cancel-then-delete); workers honor job removal.
- **Dependencies:** Phase 4.
- **Required tests:** cancel mid-run → status `canceled`, no further node side effects (mocked executors record calls); delete-while-running → 409 or graceful cancel.

### ENG-05 — Retry does not replay the original input; no idempotency

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/api/executions/[id]/retry/route.ts:26` (`startExecution(workflowId, { mode: "retry" })` — no `inputItems`, no `triggerData`), `engine.ts:36-58` (no concurrency guard)
- **Technical explanation:** "Retry" re-runs the **whole current workflow** with **no original trigger data** (a webhook-triggered run retries with an empty/default trigger payload — different behavior than the original run). It also doesn't check source status (`success` can be "retried"). Concurrent runs of the same workflow are unrestricted; there are no idempotency keys, so webhook retries (which real senders do) duplicate side effects.
- **Proposed solution (Phase 4/5):** persist trigger data + input items with the execution; retry replays them (from failed node per ENG-11, or from start with same input); per-webhook idempotency window (HMAC nonce cache from SEC-07 covers replays; execution-level idempotency key for run API).
- **Dependencies:** SEC-07 (nonce cache), ENG-11 (snapshots).
- **Required tests:** retry of a webhook run reproduces the original trigger payload (assert nodeRun input identical); duplicate webhook within window → single execution.

### ENG-06 — Artificial per-node latency simulates work

- **Severity:** Medium (honest-engine violation)
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/engine.ts:325-326` (`await sleep(isTrigger ? 250 : 350 + Math.floor(Math.random() * 300))` before every node)
- **Technical explanation:** Every node sleeps 350-650 ms to make the UI feel alive. Durations and Gantt telemetry are inflated by construction; a 10-node workflow wastes ~4-6 s. With retries, sleeps compound (retry backoff adds 400/800 ms).
- **User impact:** Misleading performance telemetry; slower runs; the "product from 2060" runs 10x slower than it could.
- **Proposed solution:** remove the sleep (or make it a dev-only "demo pacing" flag, default off) — a Phase 5 one-liner kept separate from larger engine changes for clean attribution.
- **Dependencies:** none.
- **Required tests:** timing test: 10-node no-op workflow completes < 500 ms engine time.

### ENG-07 — Node-run accounting and limits conflate skipped/pinned/disabled; `settings.timeoutMs` unenforced

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `engine.ts:20` (`MAX_NODE_RUNS = 40`), `:213-310` (skipped/pinned/disabled all consume the budget and record `success`), `types.ts` `settings.timeoutMs` (never read by the engine — only HTTP/code nodes implement their own timeouts; other node types, incl. all AI nodes with 45 s LLM waits, have **no** engine-level timeout)
- **Technical explanation:** A 40+-node workflow errors at the cap even if most nodes were skipped. `timeoutMs` from the node settings UI is silently ignored for non-HTTP/code nodes. Pinned-data and disabled nodes record `success` rows with 0 ms (conflates with real execution in telemetry).
- **Proposed solution (Phase 5):** distinct statuses (executed/skipped/pinned/disabled); budget counts only real executions (raise cap or make it a workflow setting); engine-level per-node timeout wrapper (`Promise.race`) for all executors.
- **Dependencies:** none.
- **Required tests:** 100-node workflow completes; `timeoutMs: 100` on an AI node with a mocked slow LLM → node error "timed out".

### ENG-08 — `$input` expression semantics contradict documentation

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/expression.ts:23-25` (doc: "All items currently entering the node"), `src/lib/engine/executors.ts:895-901` (`contextFor` builds `input: [item]` — exactly one element)
- **Technical explanation:** `{{ $input }}` is documented as all incoming items but always evaluates to an array containing only the current item. Silent wrong data for any user who follows the docs.
- **Proposed solution:** pass the full incoming item list into `contextFor`; compatibility check against seeded templates.
- **Dependencies:** none.
- **Required tests:** expression unit test asserting `$input.length === items.length` in a 3-item run.

### ENG-09 — Wait node silently caps at 8 seconds

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/executors.ts:483-489` (`Math.min(..., 8000)`)
- **Technical explanation:** "Wait 5 minutes" waits 8 s. The cap prevents long in-process sleeps (which would be correct to avoid pre-Phase 4) but is invisible to the user, and waits are not durable (a restart kills them, and the wait time doesn't survive crash recovery).
- **Proposed solution (Phase 4/5):** durable waiting — persist a resume-at timestamp and let the scheduler/queue re-enqueue; until then, validate the configured wait and reject values > 8 s at save time with an explicit message.
- **Dependencies:** Phase 4 scheduler for the durable version.
- **Required tests:** wait > 8 s rejected at save; durable wait resumes after worker restart.

### ENG-10 — Loop node does not loop

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/executors.ts:491-498` (tags items with `batchIndex` and returns them on a single `done` handle — no iteration, no per-batch emission), no second output handle in the catalog
- **Technical explanation:** The node named "Loop" is a batch-tagger. There is no mechanism to iterate batches (and a graph-level cycle is impossible per ENG-02). Users cannot express "for each batch, do X then continue" — the core automation pattern.
- **Proposed solution (Phase 5):** implement explicit loop semantics: `loop` outputs `batch` (current batch) + `done` (after last); engine supports exactly one well-formed back-edge (`loop → body → loop`) validated as a legal cycle; iteration cap + per-iteration telemetry. Alternatively rename the current node "Batch/Tag" to stop implying iteration, and add the real Loop in Phase 5.
- **Dependencies:** ENG-02 (cycle validation must whitelist the loop back-edge).
- **Required tests:** 10 items / batchSize 3 → body executes 4 times (3+3+3+1), `done` once; iteration cap enforced.

### ENG-11 — No workflow versioning or execution snapshots

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** `prisma/schema.prisma` (no version columns/tables), `executions/[id]/route.ts` (replay joins the **current** workflow), engine (runs the in-memory copy loaded at start, discards it)
- **Technical explanation:** Editing a workflow after a run rewrites history: the execution detail/replay renders node names/graph of the *current* version, misaligned with the persisted NodeRun rows (node ids may no longer exist). "Retry" (ENG-05) also uses the current graph, not the one that ran.
- **Proposed solution (Phase 5):** immutable `WorkflowVersion` rows (nodes/edges/name snapshot, created on activation or first run); executions pin `versionId`; replay and retry read the snapshot; diffs between versions surfaced in UI.
- **Dependencies:** Phase 2 migration discipline.
- **Required tests:** run → edit workflow → replay still shows the original graph; retry uses the pinned version.

### ENG-12 — Duplicate node names silently alias `$node` references

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `engine.ts:176-180` (`nodeByName.set(node.name, flat)` — later node overwrites earlier), no uniqueness validation
- **Technical explanation:** Two nodes named "HTTP" make `{{ $node["HTTP"].json }}` resolve to whichever executed last; no warning is produced anywhere.
- **Proposed solution:** enforce unique names at save (UI already generates unique names, but paste/import/AI-builder paths can collide — `build-workflow` dedups ids, not names); engine warns on collision.
- **Dependencies:** none.
- **Required tests:** save with duplicate names → 400; imported collision → warning + auto-rename.

### ENG-13 — Sequential execution of ready nodes; sequential per-item I/O

- **Severity:** Medium (performance)
- **Classification:** `[VERIFIED]`
- **Affected files:** `engine.ts:213-392` (`for (const nodeId of ready)` awaited serially), `executors.ts` (all per-item loops — HTTP and AI — sequential)
- **Technical explanation:** Even independent branches run one node at a time; a 50-item AI node issues 50 sequential LLM calls (45 s timeout each ⇒ worst case ~37 min in-process). No concurrency, no batching, no per-item cap (aiChat silently stops calling the LLM after 5 items — ENG-14).
- **Proposed solution (Phase 4/5):** worker concurrency for ready nodes (bounded), per-item Promise pool with configurable concurrency for HTTP/AI executors, batched LLM calls where the API allows.
- **Dependencies:** Phase 4 (real concurrency requires workers + queue anyway).
- **Required tests:** two independent branches execute concurrently (assert wall-time < sum); item-pool respects concurrency=3 (mocked executor counts parallels).

### ENG-14 — aiChat silently degrades after 5 items

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `executors.ts:723-731` (`if (calls < 5)`), no warning recorded
- **Technical explanation:** The 6th+ item of an aiChat node receives the offline-echo string even when the LLM is healthy. This is an undocumented cost guard that produces fabricated output (violates the "never fabricate" mandate).
- **Proposed solution:** make the cap a visible node setting with default from workspace policy; when exceeded, either batch or mark items `degraded` (never a fake success reply).
- **Dependencies:** Phase 7 AI architecture.
- **Required tests:** 10-item run with cap=5 → 5 real replies + 5 explicit degradation markers (or one batched call), and execution status reflects degradation.

### ENG-15 — `ctx.log` delivery logs are discarded

- **Severity:** Low
- **Classification:** `[VERIFIED]`
- **Affected files:** `executors.ts:907` (`log: opts.log ?? (() => undefined)`), `engine.ts:164-170` (does not pass `log`)
- **Technical explanation:** Simulated-connector log lines (`Slack (simulated) -> #channel`) are written to a no-op. The run console derives lines from NodeRun rows instead; the API surface for richer logging exists but is dead.
- **Proposed solution:** wire `ctx.log` into a persisted execution event stream (Phase 4 event history) or drop the API.
- **Dependencies:** Phase 4.
- **Required tests:** log lines appear in execution event history.

### ENG-16 — HTTP response cap is dead code for JSON

- **Severity:** Low
- **Classification:** `[VERIFIED]`
- **Affected files:** `executors.ts:644-653` (cap applied to `data`, then `data = JSON.parse(rawText)` overwrites with the full object)
- **Technical explanation:** The 8192-char cap only survives for non-JSON bodies; JSON responses flow into items unbounded (NodeRun serialization re-caps at 15 KB, but in-memory items and `$node` references carry everything; large responses also inflate LLM prompts via SEC-11).
- **Proposed solution:** cap the parsed structure (depth+size guard) during SEC-05's response handling rewrite.
- **Dependencies:** SEC-05.
- **Required tests:** 1 MB JSON response → items capped, truncation marker present.

### ENG-17 — Variables snapshot at execution start

- **Severity:** Low
- **Classification:** `[LIMITATION]` (documented behavior once surfaced)
- **Affected files:** `engine.ts:138-140`
- **Technical explanation:** Variables are read once per run; mid-run edits don't apply (correct for consistency) but nothing tells the user. Keep the semantics; document them in the UI.
- **Required tests:** none beyond documentation.

---

## Verified engine strengths (to preserve)

- Deadlock-free wave traversal for DAGs; correct multi-input edge accounting.
- Per-node retry with exponential backoff; `continueOnFail` as an explicit per-node setting.
- Expression warning collection surfaces resolution failures without aborting runs.
- Payload serialization with honest truncation markers (15 KB).
- Pinned-data and disabled-node semantics are implemented and predictable.

## Summary counts

| Severity | Count |
|---|---|
| Critical | 3 (ENG-01, ENG-02, ENG-03) |
| High | 4 (ENG-04, ENG-05, ENG-10, ENG-11) |
| Medium | 7 (ENG-06, 07, 08, 09, 12, 13, 14) |
| Low | 3 (ENG-15, 16, 17) |

All findings `[VERIFIED]` by direct code inspection except where marked `[LIMITATION]`.
