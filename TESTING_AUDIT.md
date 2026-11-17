# BLISSVOID — Testing Audit (Phase 1)

**Scope:** repository @ `v1.0.0` (commit `a92d3d0`)
**Method:** exhaustive search for any test artifact, runner, or CI configuration; verification of the "green" signals that do exist.

---

## Current state (verified)

| Signal | Status | Evidence |
|---|---|---|
| Automated tests | **None.** | No test files, no test runner in `package.json` (no `vitest`/`jest`/`playwright` deps), no `*.test.*`/`*.spec.*` anywhere. The `tests/` folder referenced during development contained sandbox build scripts and is **not part of the published repo**. |
| CI pipeline | **None.** | No `.github/workflows/`, no other CI config. |
| TypeScript check | **Suppressed.** | `next.config.ts` `ignoreBuildErrors: true`; measured: `tsc --noEmit` → **0 errors in `src/`** (only error is in the gitignored sandbox `skills/` dir). Latent, not active. `noImplicitAny: false` weakens strictness. |
| ESLint | **Passes by construction.** | `eslint .` exits clean, but `eslint.config.mjs` disables **24 rules** (incl. `no-explicit-any`, `no-unused-vars`, `react-hooks/exhaustive-deps`, `no-console`, `no-unreachable`). The "zero warnings" claim in the README is true but low-signal. |
| Manual verification | **Exists (one-time).** | Golden-path browser session against the dev server during v1.0.0: landing → app → dashboard → editor → run → execution detail; screenshots in `docs/screenshots/`. Not repeatable, not regression-proof. |

## Findings

### TEST-01 — Zero automated tests for a system with three RCE-class findings

- **Severity:** Critical / `[VERIFIED]`
- **Affected files:** entire repository
- **Technical explanation:** The expression engine (15 operators, proxy semantics, typed resolution), condition evaluator, executors (32 node types), wave traversal, retry/backoff, payload serialization, credential vault, and 19 API routes are all untested. Every finding in the sibling audits — including the false-success paths (ENG-01/02) — would have been caught by a day of unit tests.
- **User impact:** Every subsequent phase of the mandate would land blind; regressions in the engine would ship silently behind the suppressed build.
- **Proposed solution:** the test ladder below, introduced with Phase 2 and grown in lockstep with each phase ("no implementation without test evidence" per the mandate).
- **Dependencies:** none.
- **Required tests:** self-evident.

### TEST-02 — No CI pipeline

- **Severity:** High / `[VERIFIED]`
- **Proposed solution (Phase 2):** GitHub Actions: `install → typecheck (tsc --noEmit, unsuppressed) → lint (rules re-enabled progressively) → unit tests → build`. Later stages add contract/E2E/security jobs. Required status checks on `develop`/`main`.
- **Dependencies:** TEST-01 runner choice.

### TEST-03 — Lint configuration disables the rules that matter most

- **Severity:** Medium / `[VERIFIED]`
- **Affected files:** `eslint.config.mjs:10-45` (24 rules off), `tsconfig.json:13`
- **Proposed solution:** re-enable rules in batches (start: `no-unused-vars`, `no-unreachable`, `react-hooks/exhaustive-deps`), fix findings, keep the rest on as warnings. Type-check strictness: `noImplicitAny: true` once the codebase proves clean.
- **Dependencies:** TEST-02 (CI enforces it).
- **Required tests:** CI green with the enabled rule set.

---

## Proposed test ladder (per the Phase 8 mandate)

| Level | Tool (proposal) | Scope | Entry criteria |
|---|---|---|---|
| **Unit** | `vitest` | `expression.ts` (golden corpus + escape corpus), `evaluateCondition(s)`, `serializePayload`, `crypto.ts` (round-trip, wrong-key fails closed, mask), executors with mocked `fetch`/SDK (per node type: happy/error/retry/timeout), engine traversal on fixture graphs (diamonds, skips, continueOnFail, cycles) | Phase 2 |
| **Integration / API contract** | `vitest` + route handlers against a scratch SQLite DB | Every route × {valid, invalid, unauthenticated(→401 after Phase 3), cross-workspace(→403), conflict(→409)}; response-shape snapshots (DTO contracts incl. "no secret fields" invariant) | Phase 2/3 |
| **E2E** | Playwright against `next dev` | Golden paths: build-with-AI, edit, save, run, watch live progress, execution replay, credentials CRUD (masked), templates use | Phase 2 (smoke) → grows |
| **Security** | vitest suites from SECURITY_AUDIT | Blocklist/interpreter escape corpus, SSRF URL corpus, HMAC webhooks (replay/stale/invalid), rate-limit thresholds, redaction invariants, authn/authz matrix | Phase 3 |
| **Recovery / chaos** | worker harness | kill -9 at staged points (ENG-03), cancel semantics, retry idempotency, heartbeat expiry sweep, queue redelivery | Phase 4 |
| **Performance** | k6 or Playwright traces | Dashboard/stats with 100k executions < 300 ms (DB-06); 40-node workflow wall-time; LLM-mock concurrency caps | Phase 4+ |
| **Connector** | mocked transport per connector + recorded fixtures | auth signing, error taxonomy, pagination, retry classification; live verification runs marked explicitly *outstanding* when credentials are unavailable | Phase 6 |

**Reporting discipline (mandated):** every phase report distinguishes **passed / failed / skipped / untested**; skipped tests must carry a reason; "untested" is an honest label, never silently omitted.

## Effort note

The expression engine and executors are pure functions over `(params, items, ctx)` — highly testable as-is. The engine's traversal is deterministic given fixture graphs and a mocked executor map. Introducing the ladder is cheap; deferring it multiplies cost across every later phase.
