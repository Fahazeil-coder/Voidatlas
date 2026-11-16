# BLISSVOID — Security Audit (Phase 1)

**Scope:** repository @ `v1.0.0` (commit `a92d3d0`)
**Method:** line-level inspection of every API route, the execution engine, expression engine, credential vault, and client code. Exploit paths described below are derived from code reading; each is marked `[VERIFIED]` (the vulnerable code path is confirmed present) or `[RISK]` (needs a runtime exploit test to confirm severity). **No exploitation was performed against any live system.**

> **Bottom line:** v1.0.0 must not be exposed to the internet. It is a single-user demo with no authentication, untrusted code executing in the main process, and a credential vault whose fallback key is public. Every finding below has a concrete remediation in the roadmap.

---

## SEC-01 — No authentication or authorization on any endpoint

- **Severity:** Critical
- **Classification:** `[VERIFIED]`
- **Affected files:** all 19 route files under `src/app/api/**`; no `middleware.ts` exists anywhere (glob-verified)
- **Technical explanation:** Zero session/token/role checks anywhere. Anyone who can reach the server can: read every workflow and execution payload (`GET /api/executions/[id]` returns full node input/output JSON), create/run/duplicate/delete anything, list and create credentials, read all variables in plaintext, reseed, and trigger unlimited external LLM spend (`POST /api/ai/build-workflow`).
- **User impact:** Total compromise of data and spend; SSRF (SEC-05) and RCE (SEC-03/04) become remotely triggerable via the unauthenticated run path.
- **Proposed solution:** Phase 3 — session auth (NextAuth credentials flow or custom signed sessions), route-level guard (middleware or per-route `requireUser()`), workspace scoping on every query, role separation for destructive ops.
- **Dependencies:** Phase 2 baseline.
- **Required tests:** API contract tests asserting 401 for every route when unauthenticated; 403 cross-workspace; audit-log entries for authenticated mutations.

## SEC-02 — Credential vault falls back to a public master key

- **Severity:** Critical
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/crypto.ts:7-19`
- **Technical explanation:** when `BLISSVOID_MASTER_KEY` is unset (it is undocumented in `.env.example` and unset by default), the key is `scryptSync("blissvoid-dev-master", "blissvoid-salt", 32)` — both strings are in the public repository. AES-256-GCM is correctly implemented (random 12-byte IV, auth tag), but with the public fallback key every stored credential is decryptable by anyone who obtains the DB file or a DB read primitive. Additionally: no key validation, no rotation support, the derived key is cached forever (`cachedKey`), and `maskCredential` (below) weakens the mask.
- **User impact:** Stored secrets (Slack tokens, API keys) are effectively plaintext at rest in the default configuration.
- **Proposed solution:** Phase 3 — refuse to boot without a real master key (min-entropy check), document key generation (`openssl rand -hex 32`), implement re-encryption rotation command, add per-credential DEK wrapped by the master KEK for future rotation without full re-key.
- **Dependencies:** none.
- **Required tests:** boot fails without key; rotation command re-encrypts and old ciphertexts fail closed; known-vector unit tests for encrypt/decrypt.

## SEC-03 — Code node: arbitrary code execution in the main process; timeout is not enforceable

- **Severity:** Critical
- **Classification:** `[VERIFIED]` (blocklist bypass) + `[VERIFIED]` (sync-loop DoS by construction)
- **Affected files:** `src/lib/engine/executors.ts:673-706`
- **Technical explanation:** The Code node compiles user JS with `new Function("items", "$json", '"use strict";\n' + code)` inside the Next.js server process. The only barrier is a regex blocklist `/\b(require|process|import|eval|Function|globalThis|window|document)\b/` applied to the *source text*. Blocklists of this shape are bypassable by string construction; for example the source text
  `items.constructor.constructor("return (function(){return this})().proc"+"ess")()`
  contains no blocked word, yet executes in the new Function scope, retrieves the global object via a non-strict nested function, and returns the real `process` object (env vars, `mainModule.require`, filesystem). The 5-second timeout is `Promise.race` — **it cannot interrupt synchronous code**, so `while(true){}` in a Code node freezes the event loop of the entire API server indefinitely (all endpoints hang; the only remedy is process restart).
- **User impact:** With no auth (SEC-01), anyone can run arbitrary code on the host: read `.env` and the SQLite DB, pivot to internal network, exfiltrate credentials, or hard-stop the service with an infinite loop.
- **Proposed solution:** Phase 3 — remove Code-node execution from the main process entirely. Options with trade-offs (decision required before implementation): (a) subprocess pool (`node:child_process`) with `--disallow-code-generation-from-strings`, no filesystem/network by seccomp/landlock or container, hard SIGKILL timeout — strong isolation, ~50-150 ms spawn cost; (b) dedicated worker service (mini-service pattern) with resource limits — matches the Phase 4 worker architecture; (c) QuickJS/isolate VM library — best latency, new dependency. Regardless of host, replace the blocklist with the AST-based interpreter (SEC-04) for the *expression* language and treat Code nodes as the only place full JS runs, sandboxed.
- **Dependencies:** SEC-01 (auth reduces exposure but is not a fix).
- **Required tests:** security test suite: known escape payloads (constructor chains, `setTimeout("…")` string eval, `import` via dynamic spec, prototype pollution of `items`) must fail closed; sync infinite loop must be killed by the hard timeout and must NOT block the API for >2 s; sandbox cannot read `.env`, `db/`, or reach network unless explicitly allowed.

## SEC-04 — Expression engine: unrestricted `new Function` with a weaker blocklist

- **Severity:** Critical
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/expression.ts:33-45`
- **Technical explanation:** Every `{{ ... }}` template in every node parameter is evaluated via `new Function("$json","$node","$now","$input","$vars", '"use strict"; return (EXPR);')`. The blocklist adds `window`/`document` but omits everything relevant on the server: `constructor`, `fetch`, `setTimeout`, `Buffer`, `Promise`, etc. There is **no timeout at all** on expression evaluation. `{{ fetch("http://169.254.169.254/...") }}` is a direct SSRF; `{{ (function(){while(true){}})() }}` freezes the process (an IIFE is a valid *expression*); `{{ {}.constructor.constructor("…")() }}` is RCE identical to SEC-03. Expressions are also evaluated in more places than users may expect (headers, query params, message bodies of every node).
- **User impact:** Same worst-case as SEC-03, reachable from *any* string parameter in any workflow — including workflows built by the AI builder or imported from templates.
- **Proposed solution:** Phase 3 — replace with a safe AST-based interpreter: parse the expression with a small parser (or `acorn` walking a whitelist of node types: literals, identifiers, member access, calls on whitelisted builtins, arithmetic/comparison/logic, ternary, array/object literals), evaluate by tree-walking with a step budget, no property access to `constructor`/`__proto__`/`prototype`, no function construction. Keep the `$json`/`$node`/`$now`/`$input`/`$vars` surface so existing templates keep working (see compatibility tests below).
- **Dependencies:** none (this is self-contained in `expression.ts` + its call sites).
- **Required tests:** golden corpus of existing seeded/template expressions must produce identical outputs before/after (compatibility); escape-payload corpus must throw a structured error; step-budget exhaustion test (deep recursion / long loops) returns an error, not a hang.

## SEC-05 — SSRF via HTTP Request node (no private-address or protocol restrictions)

- **Severity:** Critical
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/executors.ts:589-669`
- **Technical explanation:** `executeHttpRequest` fetches any `http(s)` URL reachable from the server: `http://localhost:3000/api/...` (self-calls, incl. mutating routes — a CSRF-from-inside primitive), RFC1918 ranges, link-local `169.254.169.254` cloud metadata, and follows redirects by default (redirect can bounce to an internal target even if the first hop is public). No allowlist, no DNS-rebinding protection, no response-size cap for JSON (the 8192-char cap at `executors.ts:646-650` is applied to the *text* variable but then overwritten by `JSON.parse(rawText)` of the **uncapped** body — the cap is dead code for JSON responses).
- **User impact:** An unauthenticated attacker combines SEC-01 + a webhook trigger (SEC-07) + an HTTP node to probe and exfiltrate from the internal network, or to hammer internal admin endpoints.
- **Proposed solution:** Phase 3 — URL policy: protocol allowlist (http/https), resolve DNS and reject private/loopback/link-local/unique-local ranges (both on first hop and after redirect — `redirect: "manual"` + re-validate each hop), optional per-instance outbound allowlist, cap the parsed body honestly, and log outbound targets to the audit trail.
- **Dependencies:** none.
- **Required tests:** unit tests of the URL policy (localhost, 127.0.0.1, 10/8, 192.168/16, 172.16/12, 169.254/16, [::1], 0.0.0.0, decimal/hex IP encodings, redirect-to-private) — all rejected; public URL passes; redirect chain re-validation test.

## SEC-06 — Secrets stored in plaintext inside workflow JSON

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/executors.ts:615-617` (HTTP bearer token taken from raw node parameter `p.token`), `src/lib/blissvoid/node-catalog.ts` (token param), `prisma/schema.prisma` (nodes stored as TEXT)
- **Technical explanation:** The credentials vault is **never consulted by any executor** (verified: no `db.credential` reads in `executors.ts`). The HTTP node's bearer token is typed into the node parameter, stored unencrypted in `Workflow.nodes`, returned verbatim by `GET /api/workflows`, and (absent auth) readable by anyone. The same pattern awaits every future connector.
- **User impact:** Any secret used by a workflow is effectively public to anyone with API access, and is *not* protected by the vault's AES-256-GCM at all.
- **Proposed solution:** Phase 6 — connectors must reference credentials by id; the engine resolves them at execution time from the vault; node parameters never persist secret material (migrate existing params to vault references with a one-time importer).
- **Dependencies:** SEC-02 (real master key), Phase 6 connector SDK.
- **Required tests:** API test asserting workflow GET/execution payloads never contain a resolved secret; connector unit tests fetch secret from vault only.

## SEC-07 — Webhook endpoint: unauthenticated, unsigned, replayable, no rate limit

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/api/hooks/[path]/route.ts` (whole file), `node-catalog.ts:74-82` (advertises `auth` options "HMAC signature"/"Bearer token" that the route never reads)
- **Technical explanation:** The hook resolves a workflow by substring-matching the path inside the raw `nodes` JSON column, then fires a full execution. Verified gaps: no signature/HMAC, no token check, no timestamp/nonce (replay), no rate limit, the node's configured HTTP `method` is ignored, **inactive workflows still fire** (`matching.find(m => m.workflow.active) ?? matching[0]`), duplicate paths across workflows are ambiguous, and a `GET` (trivially triggerable via `<img src>`) causes DB writes and side-effectful node execution. The request body (up to 4 KB raw) flows into node contexts and is persisted to `NodeRun.inputJson`.
- **User impact:** Anyone can trigger any webhook-named workflow repeatedly, including costly AI/HTTP paths; headers (including forwarded `authorization`) are persisted to the DB.
- **Proposed solution:** Phase 3 — enforce the node's `auth` param (HMAC-SHA256 over body + timestamp window ±5 min + nonce cache, or bearer compare in constant time); honor `method`; only `active` workflows fire; per-path token-bucket rate limit; return 202 with execution id; redact `authorization` before persisting.
- **Dependencies:** SEC-01 (identity), Phase 4 (queue absorbs bursts).
- **Required tests:** HMAC verification (valid/invalid/stale/replayed nonce); method mismatch → 405; inactive workflow → 404; rate-limit → 429; CSRF-style GET does not execute side-effectful nodes (require explicit POST or a confirmation token).

## SEC-08 — No rate limiting or request-size governance anywhere

- **Severity:** High
- **Classification:** `[VERIFIED]`
- **Affected files:** all routes; `src/app/api/ai/build-workflow/route.ts:11-13` (prompt has `min(1)` but **no max length**)
- **Technical explanation:** Beyond webhooks, every route is unthrottled: unbounded LLM-spend (`ai/build-workflow`, `ai/node-assistant` with 4 KB context), unthrottled workflow runs (each spawning background executions), and unbounded list queries (see DATABASE_AUDIT).
- **User impact:** Cost abuse and trivial DoS.
- **Proposed solution:** Phase 3 — in-process token buckets now (fine for single-node), Redis-backed limiter in Phase 4; prompt/context max lengths (e.g., 4 KB) with 413/429 responses.
- **Dependencies:** none.
- **Required tests:** limiter unit tests (burst/decay); API tests asserting 429 after threshold.

## SEC-09 — Masked credential preview leaks secret fragments

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/lib/engine/crypto.ts:84-87` (`maskCredential` returns a plaintext prefix up to 8 chars + last 4 chars)
- **Technical explanation:** The preview ships `prefix••••last4` of the real secret to any client on every credentials list call. For many token formats (e.g., `sk-…`, `xoxb-…`, GitHub `ghp_…`) the prefix is a format tell and the last 4 reduce entropy of guessing/verification attacks; combined with SEC-01 this is world-readable.
- **User impact:** Partial secret disclosure; enough for support-tool verification attacks in some providers.
- **Proposed solution:** Phase 3 — mask to type + fixed dots + last 2, or better, return only a hash-suffix identifier; gate behind auth.
- **Dependencies:** none.
- **Required tests:** snapshot test of mask output containing ≤2 trailing chars and zero prefix.

## SEC-10 — Variables are plaintext and world-readable

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/api/variables/route.ts:14-17` (returns raw `value`), `prisma/schema.prisma` (`Variable.value String` unencrypted)
- **Technical explanation:** Variables are the natural place users store API keys for expressions; they are stored and served in plaintext with no auth.
- **Proposed solution:** Phase 3 — auth + mark variables as secret-capable: encrypt secret-typed values with the vault, redact in list responses, only the engine decrypts at run time.
- **Dependencies:** SEC-02.
- **Required tests:** list response redaction test; engine resolution still works.

## SEC-11 — Node payloads (potentially containing secrets) sent to external LLM without redaction

- **Severity:** Medium-High
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/api/ai/execution-doctor/route.ts:70-76` (sends first 800 chars of failing node's raw input/output JSON), `ai/node-assistant` (client-supplied context up to 4 KB), AI node executors (whole resolved items)
- **Technical explanation:** Anything that flowed through a workflow — webhook bodies, HTTP responses, bearer tokens in headers captured by the hook route — can be serialized into prompts sent to the external LLM provider. No field-level redaction exists anywhere.
- **User impact:** Silent exfiltration channel for secrets and personal data to a third-party service.
- **Proposed solution:** Phase 3/7 — redaction layer (regex + key-name heuristics on `token|secret|password|authorization|key` fields) applied to every prompt; configurable allowlist; audit entry when redaction fires.
- **Dependencies:** none.
- **Required tests:** redaction unit corpus (tokens, emails, headers) all masked before the SDK call (assert via mocked SDK).

## SEC-12 — Systemic error-message leakage on 500s

- **Severity:** Low-Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** all 19 routes (pattern `err instanceof Error ? err.message : "Internal error"`), e.g. `stats/route.ts:134-139`
- **Technical explanation:** Raw Prisma/driver messages (table names, constraint names, file paths) are returned to clients.
- **Proposed solution:** Phase 3 — central error mapper: log full server-side, return `{ error: "Internal error", requestId }`; correlate via request id in logs.
- **Dependencies:** none.
- **Required tests:** API tests assert generic message + requestId present; logs contain detail.

## SEC-13 — No security headers / CSP; deployment posture undefined

- **Severity:** Medium (deployment-dependent)
- **Classification:** `[RISK]` (depends on final reverse proxy)
- **Affected files:** `next.config.ts` (no headers), no CORS policy anywhere
- **Proposed solution:** Phase 3 — security headers (CSP with nonces or strict-dynamic, HSTS at proxy, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none'); explicit same-origin CORS for the API.
- **Required tests:** header assertions in E2E.

## SEC-14 — No security audit trail

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `ActivityLog` usage across routes (app-level events only)
- **Technical explanation:** No record of who did what: logins, credential creation/deletion, workflow activation, runs, AI calls. `ActivityLog.workflowId` also lacks a FK (see DATABASE_AUDIT).
- **Proposed solution:** Phase 3 — security audit log (actor, action, target, ip, ua, timestamp) with append-only semantics; include in backups.
- **Dependencies:** SEC-01 (identity).
- **Required tests:** audit rows written for every mutation route.

## SEC-15 — Captured payloads persist secrets unencrypted at rest

- **Severity:** Medium
- **Classification:** `[VERIFIED]`
- **Affected files:** `src/app/api/hooks/[path]/route.ts:56-59` (persists forwarded `authorization` header into trigger data → NodeRun.inputJson), engine `serializePayload` (stores full items)
- **Technical explanation:** Even with the vault fixed, execution telemetry stores raw payloads containing secrets in SQLite, readable via the unauthenticated executions API.
- **Proposed solution:** Phase 3 — redact sensitive header names before persistence; encrypt NodeRun payloads at rest or enforce retention + access control (Phase 4).
- **Dependencies:** SEC-01.
- **Required tests:** persisted NodeRun JSON contains no `authorization`/`cookie` values.

---

## Security acceptance gate (Phase 3 exit criteria)

1. Unauthenticated request to **every** API route → 401 (contract-tested).
2. Master key required at boot; no public fallback; rotation command works.
3. Expression interpreter passes the escape corpus; Code node runs only in the isolated runner; sync-loop payload cannot block the API >2 s.
4. HTTP node rejects the private-address corpus; redirects re-validated.
5. Webhooks enforce HMAC/bearer + method + active-only + rate limit; replay rejected.
6. Redaction verified on all LLM prompts and persisted payloads (mocked SDK assertions).
7. Rate limits + request-size caps return 429/413.
8. Security audit log records all mutations.
9. `npm audit` / `bun audit` clean or risk-accepted with justification.

**Explicitly out of scope for v1.0.0 and inherited as known limitations:** multi-tenancy (workspace isolation beyond a single workspace), 2FA, secret scanning of git history.
