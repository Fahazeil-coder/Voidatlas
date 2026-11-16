# BLISSVOID — Database Audit (Phase 1)

**Scope:** `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/blissvoid/dto.ts`, all Prisma queries in `src/app/api/**` and `src/lib/engine/**` @ `v1.0.0` (commit `a92d3d0`)
**Method:** schema review joined with every query pattern found in code. `[VERIFIED]` / `[RISK]` / `[LIMITATION]`.

---

## Current state (verified)

- **Provider:** SQLite (`db/custom.db`), 8 models: `Workflow`, `Execution`, `NodeRun`, `Credential`, `Template`, `Variable`, `AiUsage`, `ActivityLog`.
- **Schema management:** `prisma db push --accept-data-loss` only. **No `prisma/migrations` directory exists** — no migration history, no reproducible schema lineage.
- **Relations:** `Execution.workflow` (cascade), `NodeRun.execution` (cascade). `ActivityLog.workflowId` and `AiUsage.executionId` are plain strings — **no relation, no FK, orphanable**.
- **JSON-in-TEXT:** `Workflow.tags/nodes/edges`, `Template.nodes/edges`, `NodeRun.inputJson/outputJson` — parsed via `safeParse` which **silently swallows corruption** (`dto.ts:30-37`, `catch { return fallback; }`).

## Findings

### DB-01 — Destructive sync as the only schema workflow

- **Severity:** High / `[VERIFIED]`
- **Affected files:** `package.json` (`"db:push": "prisma db push --accept-data-loss"`), absent `prisma/migrations/`
- **Technical explanation:** `db push --accept-data-loss` reconciles by whatever means necessary — on drift it can drop columns/tables without review. There is no baseline migration to build on, so the upcoming phases (which need schema changes: counters, versions, heartbeats, users, audit) have no safe path.
- **User impact:** Any future schema mistake can silently destroy production data.
- **Proposed solution (Phase 2):** snapshot/backup `db/custom.db` (see DB-09), then `prisma migrate dev --name baseline` to capture the current schema as migration 0; from then on only `migrate deploy` in production; remove `--accept-data-loss` from all scripts.
- **Dependencies:** none.
- **Required tests:** CI: `migrate deploy` on an empty DB reproduces schema; `migrate diff` between schema and migrations is empty.

### DB-02 — JSON columns + whole-column read-modify-write = lost updates and silent corruption

- **Severity:** High / `[VERIFIED]`
- **Affected files:** `src/app/api/workflows/[id]/route.ts:58-82` (find → PATCH whole `nodes`/`edges` strings; no version column, no optimistic lock, no `$transaction`), `dto.ts:30-37` (`safeParse` swallows malformed JSON → `[]`), `dto.ts:216` (edge-id regeneration with `Math.random()` makes server-normalized output diverge from client baseline)
- **Technical explanation:** Two concurrent editors (or editor + AI-builder) last-write-wins on the entire graph. PATCH does not run `normalizeNodes/normalizeEdges` (POST does), so orphan edges can be persisted. Corrupt JSON degrades silently to empty graphs in the UI.
- **User impact:** Silent data loss during concurrent editing; corrupted rows look like "empty workflow".
- **Proposed solution:** optimistic locking (`version Int @default(0)`, increment on update, reject stale with 409); `$transaction` for multi-step writes; surface `safeParse` failures as errors/logs; move to Postgres `Json` columns in Phase 4 for path queries.
- **Dependencies:** Phase 2 migrations.
- **Required tests:** concurrent PATCH test (one succeeds, one 409); malformed nodes column → explicit 500 with log, not silent `[]`.

### DB-03 — Missing indexes for hot query paths

- **Severity:** Medium / `[VERIFIED]`
- **Affected files:** `prisma/schema.prisma` vs. verified query patterns:
  - `Workflow.deletedAt` (every list/detail/hook query filters `deletedAt: null`) — no index
  - `Workflow.updatedAt` (default list ordering) — no index
  - `Workflow.active` (hook preference + stats count) — no index
  - `Execution.startedAt` standalone (global executions list orders by it; only the composite `[workflowId, startedAt]` exists) — no supporting index
  - `ActivityLog.createdAt` (recent-activity ordering) — no index
  - `Credential.createdAt` (list ordering) — no index
  - `NodeRun.startedAt` (per-execution ordering; only `[executionId]` exists) — no index
- **Proposed solution:** add the six indexes in the Phase 2 baseline migration.
- **Dependencies:** DB-01.
- **Required tests:** `EXPLAIN QUERY PLAN` asserts index usage for the list queries (or equivalent timing regression test).

### DB-04 — Orphanable references: `ActivityLog.workflowId`, `AiUsage.executionId`

- **Severity:** Low-Medium / `[VERIFIED]`
- **Affected files:** `prisma/schema.prisma:94,107` (plain strings, no `@relation`)
- **Technical explanation:** Deleting a workflow leaves activity rows pointing at nothing; deleting an execution orphans AI usage rows, corrupting spend analytics.
- **Proposed solution:** add relations with explicit `onDelete` (SetNull for ActivityLog, Cascade for AiUsage) in a Phase 2/4 migration; backfill/cleanup script for existing orphans.
- **Dependencies:** DB-01.
- **Required tests:** cascade semantics test.

### DB-05 — Hook path resolution scans the `nodes` JSON column

- **Severity:** Medium / `[VERIFIED]`
- **Affected files:** `src/app/api/hooks/[path]/route.ts:15-17` (`where: { nodes: { contains: '"path"' } }` — LIKE over a TEXT blob)
- **Technical explanation:** Substring prefilter over every workflow's serialized graph; degrades linearly with workflow count and size; false positives resolved in JS afterwards.
- **Proposed solution:** dedicated `WebhookHook` registration table with a unique path (INT-06).
- **Dependencies:** INT-06.
- **Required tests:** registration lookup correctness + uniqueness.

### DB-06 — Unbounded growth; no retention or pruning

- **Severity:** Medium / `[VERIFIED]`
- **Affected files:** engine (every run writes NodeRun rows with up to ~30 KB payloads; nothing ever deletes them), soft-deleted workflows never purged, seeded history (~450 executions) pre-populates the table
- **Technical explanation:** No retention policy, no pruning job, no archive. `GET /api/stats` already loads **every** Execution row into memory (verified `stats/route.ts:22-29`, no `where`/`take`) — the dashboard degrades linearly with history.
- **Proposed solution:** retention settings (executions older than N days pruned / archived); aggregate tables or SQL-side aggregation for stats; Phase 4 moves history to Postgres with proper partitioning options.
- **Dependencies:** Phase 4 for the full fix; stats SQL aggregation can land earlier.
- **Required tests:** stats response time with 100k seeded executions stays < 300 ms (aggregation test); pruning job removes only eligible rows.

### DB-07 — Type honesty: status strings, Float money, unvalidated casts

- **Severity:** Low / `[VERIFIED]`
- **Affected files:** `schema.prisma` (status as free `String`, `aiCost Float`), `dto.ts:94,112` (`row.status as ExecutionStatus` casts), `dto.ts:244` (partial row cast to full model)
- **Proposed solution:** enums where Prisma+SQLite allow (or checked parsers), integer micro-dollars for cost, typed row mappers.
- **Dependencies:** none.
- **Required tests:** mapper unit tests reject unknown status values.

### DB-08 — SQLite single-writer vs the Phase 4 worker architecture

- **Severity:** Medium (roadmap-critical) / `[LIMITATION]` — correct for v1.0.0 scope, must change for the production mission
- **Affected files:** `prisma/schema.prisma` (provider sqlite)
- **Technical explanation:** SQLite permits one writer; API-triggered executions + UI polling + future workers will contend. The engineering mandate explicitly requires PostgreSQL in Phase 4.
- **Proposed solution (Phase 4):** migrate to Postgres (provider swap + `Json` columns for nodes/edges + enums + the DB-03 indexes + connection pooling); keep a SQLite profile for local single-user mode if desired (dual-provider via Prisma is acceptable; document trade-off).
- **Dependencies:** DB-01 baseline first.
- **Required tests:** migration dry-run on a copy of production-shaped data; parity suite (same API results before/after).

### DB-09 — No backup/restore tooling or documentation

- **Severity:** High (production gap) / `[VERIFIED]`
- **Affected files:** repository (nothing exists)
- **Proposed solution (Phase 2):** `scripts/backup.sh` (sqlite `VACUUM INTO` / `pg_dump` later) + `scripts/restore.sh` + documented restore drill; automated pre-migration backup hook in the deploy script.
- **Dependencies:** none.
- **Required tests:** backup → wipe → restore → app serves identical data (documented drill).

### DB-10 — Demo data is indistinguishable from real runs in queries and metrics

- **Severity:** Medium (product integrity) / `[VERIFIED]`
- **Affected files:** `src/lib/blissvoid/seed-data.ts` (deterministic PRNG fabricates ~450 executions with a 9.5% error rate over 14 days; only marker is the `exe_seed_####` id prefix — no boolean/`mode` marker the API or UI recognizes), `seed/route.ts` (count-guard with a non-transactional check-then-create race; triggered by the client on first page load)
- **Technical explanation:** Success-rate, durations, and AI-spend analytics mix fabricated and real data with no separation. Two concurrent first-loads can double-seed (both pass `count() === 0`).
- **Proposed solution:** add `isSeeded Boolean` (or `mode: "demo"`) marker; exclude demo executions from production analytics or provide a demo/real toggle; make seeding an operator action (CLI/flag) with an upsert-guard transaction.
- **Dependencies:** DB-01.
- **Required tests:** seeding twice produces one dataset (transactional guard); analytics exclude demo rows when configured.

### DB-11 — Prisma query logging always on

- **Severity:** Low / `[VERIFIED]`
- **Affected files:** `src/lib/db.ts:9-11` (`log: ['query']` unconditional)
- **Proposed solution:** gate on `NODE_ENV !== "production"` (or `LOG_LEVEL`).
- **Required tests:** none (config).

---

## Summary counts

| Severity | Count |
|---|---|
| High | 3 (DB-01, DB-02, DB-09) |
| Medium | 5 (DB-03, DB-05, DB-06, DB-08, DB-10) |
| Low | 3 (DB-04, DB-07, DB-11) |
