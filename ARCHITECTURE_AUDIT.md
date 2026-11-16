# BLISSVOID — Architecture Audit (Phase 1)

**Scope:** repository `Fahazeil-coder/Voidatlas` @ `v1.0.0` (commit `a92d3d0`)
**Method:** full read of every file under `src/`, `prisma/`, root configs; verified line-level evidence for every claim. No code was modified.
**Classification legend:** `[VERIFIED]` = confirmed by direct code inspection · `[RISK]` = plausible failure mode requiring tests to confirm · `[LIMITATION]` = accepted design boundary of v1.0.0.

---

## 1. System overview (as built)

```
┌──────────────────────────── Single Next.js 16 process ────────────────────────────┐
│                                                                                    │
│  Browser SPA (src/app/page.tsx, all 'use client')                                  │
│    └─ React Query (polling) ──► 19 REST route files (src/app/api/**)               │
│                                   ├─ Prisma (SQLite, db/custom.db)                 │
│                                   └─ startExecution() ──► runExecution()           │
│                                        (fire-and-forget, same process)             │
│                                             ├─ executors.ts (fetch / new Function  │
│                                             │   / z-ai-web-dev-sdk LLM calls)      │
│                                             └─ NodeRun/Execution rows (progress)   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Key architectural facts (all verified):

- **One process, one port.** API server, execution engine, untrusted-code sandbox, and LLM client all share the Next.js server process.
- **Single-page client.** The entire UI is one route (`/`); views switch via a zustand nav store (`src/app/page.tsx:95-112`). No route-level code splitting.
- **Execution is fire-and-forget in-process.** `startExecution()` creates a row and returns; `runExecution()` continues in the background of the same process (`src/lib/engine/engine.ts:36-71`).
- **No scheduler exists.** `schedule` trigger nodes are data only; nothing ever fires them (see ARCH-03).
- **No auth, no workers, no queue, no cache** — SQLite is the only infrastructure dependency.
- **Deployment story is absent from the repo.** No Dockerfile, no CI, no migrations directory. (The `.zscripts/`, `Caddyfile`, `tests/*.sh`, `examples/` referenced during development are sandbox-local and **not part of the published repository**.)

Module boundaries that are genuinely good (keep them):

- `src/lib/engine/*` (engine, executors, expression, crypto) is cleanly separated from both API routes and UI.
- `z-ai-web-dev-sdk` is imported in exactly one server file (`executors.ts:1`) — the "backend-only AI" claim holds.
- Zod is used on all mutating API bodies; node `type` is validated against the catalog registry (`dto.ts:174-191`).
- Prisma client uses the `globalThis` singleton pattern (`db.ts`).

---

## 2. Findings

### ARCH-01 — Production TypeScript build suppresses errors

- **Severity:** High (currently latent — see evidence)
- **Classification:** `[VERIFIED]`
- **Affected files:** `next.config.ts:6-8` (`typescript: { ignoreBuildErrors: true }`, `reactStrictMode: false`), `tsconfig.json:13` (`noImplicitAny: false`)
- **Technical explanation:** `ignoreBuildErrors: true` means the production `next build` never fails on type errors. Measured today: `bunx tsc --noEmit` reports **0 errors in `src/`** (the single reported error is in the gitignored sandbox `skills/` directory). So the suppression currently hides nothing — but it guarantees that *any future* type regression ships silently. `noImplicitAny: false` further weakens `strict: true`.
- **User impact:** None today; a silent class of future regressions (broken contracts between engine/UI/DTO) would reach production undetected.
- **Proposed solution (Phase 2):** set `ignoreBuildErrors: false`, set `noImplicitAny: true`, run `tsc --noEmit` in CI. Do **not** do this mid-audit — it is a build-policy change belonging to the baseline-protection phase.
- **Dependencies:** none.
- **Required tests:** CI job `tsc --noEmit` green on `src/` (exclude sandbox dirs).

### ARCH-02 — Monolithic in-process execution

- **Severity:** Critical (blocks Phase 4 goals: durability, recovery, cancellation, isolation)
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/engine.ts:60-68` (`void runExecution(...)` fire-and-forget inside the API process), all `src/app/api/**` run-triggering routes
- **Technical explanation:** Workflow execution shares the HTTP server's process, event loop, and memory. Consequences verified in code: no heartbeats, no recovery after restart (orphans stay `running` forever), no cancellation path, a synchronous infinite loop in the Code node **freezes the entire API** (see SEC-03), and LLM calls (up to 45 s each, sequential per item) occupy the same process.
- **User impact:** A process crash or deploy kills all in-flight executions with no trace except a permanently "running" row; heavy workflows degrade API latency for all users.
- **Proposed solution:** Phase 4 — separate worker process, durable job queue (BullMQ + Redis, justified below), heartbeat + recovery sweep, cancel flag checked between nodes.
- **Dependencies:** Phase 2 (branch/backup), Phase 3 (auth so workers can be authorized), Postgres migration (Phase 4) since SQLite single-writer serializes worker writes.
- **Required tests:** kill -9 worker at start/mid-node/after-final-node; assert executions recover or are marked failed, never stuck `running`; cancellation API test.

### ARCH-03 — Advertised scheduler does not exist

- **Severity:** Critical (feature integrity)
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/blissvoid/node-catalog.ts:96-113` (schedule trigger with cron params), `src/lib/engine/executors.ts:217-228` (schedule executor only emits an item when a run is *manually* started), repo-wide grep: zero `setInterval`/cron libraries on the server
- **Technical explanation:** No runtime component consumes `active: true` workflows or evaluates cron expressions. The `active` flag's only runtime consumer is webhook disambiguation (`hooks/[path]/route.ts:37`) and a stats counter. Seeded "Daily Standup Digest" and "Repo Watchdog" workflows are `active: true` with cron parameters and will **never fire**.
- **User impact:** Users who activate scheduled workflows believe automations run daily; nothing happens. This is the single largest expectation gap in the product.
- **Proposed solution:** Phase 4 scheduler (cron parser + queue) in the worker process; until then, the UI must label schedule triggers "manual-run only (scheduler coming)".
- **Dependencies:** Phase 4 worker/queue infrastructure.
- **Required tests:** integration test asserting a `*/1 * * * *` workflow with `active: true` produces ≥1 execution within ~70 s; deactivate stops firing.

### ARCH-04 — No environment validation; silent degradation paths

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/crypto.ts:9-19` (falls back to a hardcoded dev master key when `BLISSVOID_MASTER_KEY` is unset), `src/lib/engine/executors.ts:113-141` (LLM unreachable → silent heuristic fallbacks), `.env.example` (documents only `DATABASE_URL`)
- **Technical explanation:** Only two `process.env` reads exist in `src/`. Nothing validates at startup. A missing master key silently weakens all credential encryption (SEC-02); a missing SDK config silently converts every AI node to fabricated heuristic output while executions still report `success`.
- **User impact:** Security posture and AI behavior degrade invisibly; operators get no signal.
- **Proposed solution:** zod env schema validated at boot; refuse to start without `BLISSVOID_MASTER_KEY` in production; surface LLM-unreachable as a node warning, not silent success.
- **Dependencies:** none.
- **Required tests:** unit tests booting with missing env → explicit error; LLM-down test → node marked degraded, execution not "clean success".

### ARCH-05 — Dependency bloat: 12 unused + ~30 effectively-unused packages

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `package.json`
- **Technical explanation:** Verified by import grep: truly unused — `@dnd-kit/*` (3), `@hookform/resolvers`, `@mdxeditor/editor`, `@reactuses/core`, `@tanstack/react-table`, `next-auth` (also v4-vs-Next-16 mismatch), `next-intl`, `react-markdown`, `react-syntax-highlighter`, `sharp`, `uuid`, and `prisma` (belongs in devDependencies). Effectively unused (imported only by dead shadcn scaffold files no app code reaches): 16 Radix packages, `embla-carousel-react`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `input-otp`, `vaul`, `next-themes`.
- **User impact:** Larger install surface (supply-chain exposure), slower CI, misleading stack signals.
- **Proposed solution:** Phase 2 cleanup with the baseline protected: remove unused deps and dead `ui/` scaffold files in one reviewed commit; keep the design system intact.
- **Dependencies:** Phase 2 (rollback safety).
- **Required tests:** `bun install && bun run lint && bun run dev` + smoke of all views after removal.

### ARCH-06 — Monolithic client bundle; zero code splitting

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/page.tsx:16-28` (static imports of every view + editor), no `dynamic()`/`lazy` anywhere in repo
- **Technical explanation:** The initial bundle ships the React Flow editor, recharts (dashboard + insights), and framer-motion for all views regardless of which is displayed.
- **User impact:** Slower first paint on mobile; the marketing landing page pays the editor's weight.
- **Proposed solution:** lazy-load editor and chart views via `next/dynamic` in a Phase 5/8 pass (not before — do not destabilize the working UI early).
- **Dependencies:** none technically; scheduled late to minimize regression risk.
- **Required tests:** bundle-size budget test in CI; view smoke tests.

### ARCH-07 — README overstates capabilities

- **Severity:** Medium (product integrity)
- **Classification:** `[VERIFIED]`
- **Affected files:** `README.md` (binary items claim — `types.ts`/`expression.ts` have no binary support, 0 grep matches; "21 REST routes" — actual 19 route files; "test-connection" feature — the endpoint `/api/credentials/[id]/test` does not exist, so the UI button 404s; "`{ json, binary? }[]` like n8n" — unimplemented)
- **User impact:** Evaluators trust claims the code cannot honor; the broken "Test connection" button is user-visible.
- **Proposed solution:** Phase 2 documentation correction; implement or remove the test-connection endpoint (roadmap Stage 5).
- **Dependencies:** none.
- **Required tests:** docs review; if endpoint kept, API contract test.

### ARCH-08 — Settings screen contains non-functional controls (client-side theater)

- **Severity:** Medium (product integrity)
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/components/blissvoid/views/settings.tsx:379` (workspace-name "Save" toasts only), `:438-442` (AI provider key "Save" — no API call exists), `:477-479` (hardcoded `uptime 99.99%` / `database ok` / `queue ok` health chips)
- **Technical explanation:** These controls produce success feedback without persisting anything. This violates the project's own "no fake features" directive.
- **Proposed solution:** wire to real endpoints (workspace name → Variable/Settings table; provider keys → credential vault; health → real liveness checks) or remove the controls. Scheduled with Phase 6/7.
- **Dependencies:** Phase 7 for provider keys (AI architecture).
- **Required tests:** E2E: save → reload → value persists; health chips reflect actual probe results.

### ARCH-09 — Toast feedback system is broken (all notifications invisible)

- **Severity:** High (UX correctness)
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/layout.tsx:4,44` (mounts the Radix `Toaster` bound to `hooks/use-toast.ts`, which no app code calls), 14 app components call `toast` from `"sonner"` while `ui/sonner.tsx` (sonner's Toaster) is never mounted
- **Technical explanation:** Sonner requires its own mounted `<Toaster/>`. It is never rendered, so **every** success/error notification in the app — including "Save failed", run failures, validation errors — silently never appears.
- **User impact:** Users get zero feedback for failures; silent data-loss perception (e.g., rejected saves look successful).
- **Proposed solution:** one-line fix (mount sonner Toaster) — but executed in Phase 2 with regression check, since it changes global layout behavior.
- **Dependencies:** none.
- **Required tests:** E2E assertion that a failed save produces a visible toast.

### ARCH-10 — No error boundary in the SPA

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** no `app/error.tsx`, no `global-error.tsx`, no `ErrorBoundary` components anywhere
- **User impact:** Any render-time exception white-screens the whole application.
- **Proposed solution:** add `app/error.tsx` + a view-level boundary; Phase 2/8.
- **Dependencies:** none.
- **Required tests:** E2E fault-injection rendering test.

---

## 3. Cross-cutting observations (informational)

- Prisma query logging (`log: ['query']`) is unconditionally enabled (`src/lib/db.ts`) — noisy and slow in production; gate on `NODE_ENV`.
- `serializePayload` caps NodeRun payloads at 15 KB with honest truncation markers — good pattern, keep.
- The seeder is client-triggered on first page load (`page.tsx` `seedIfNeeded()` calling unauthenticated `POST /api/seed`) — acceptable for a demo, must become an operator CLI in production (see DATABASE_AUDIT).
- The engine's wave traversal is deadlock-free for DAGs and its expression-warning collection is a solid foundation for the Phase 5 interpreter.

## 4. Architecture summary counts

| Severity | Count |
|---|---|
| Critical | 2 (ARCH-02, ARCH-03) |
| High | 3 (ARCH-01, ARCH-04, ARCH-09) |
| Medium | 5 (ARCH-05, ARCH-06, ARCH-07, ARCH-08, ARCH-10) |

All findings above are `[VERIFIED]` by direct inspection; no speculative findings are included in this document. See `SECURITY_AUDIT.md`, `EXECUTION_ENGINE_AUDIT.md`, `INTEGRATIONS_AUDIT.md`, `DATABASE_AUDIT.md`, `TESTING_AUDIT.md` for domain depth, and `IMPROVEMENT_ROADMAP.md` for the proposed sequence.
