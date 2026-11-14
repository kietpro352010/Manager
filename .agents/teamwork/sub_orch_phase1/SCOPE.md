# Scope: Phase 1 — Security, Authentication, & Worker Registry Foundation

## Overview
Remediate all 20 security, authentication, and worker registry findings across Parts 1, 8, 2, and 9 from the master remediation plan in `D:\manager` and `D:\worker`.

## Status: DONE (Gate 1 Passed)

## Target Repositories & Working Directories
- Primary: `D:\manager`
- Secondary: `D:\worker`

## Feature Inventory (20 findings)
| # | Bug ID | Severity | File | Description & Surgical Fix | Status |
|---|--------|----------|------|-----------------------------|--------|
| 1 | AUTH-01 / SEC-01 | P1 | D:\manager\src\utils\secrets.js#L108 | Replace AES-256 password encryption with Scrypt hashing (`hashPassword(password, salt)`). Auto-migrate legacy password to Scrypt on successful login. | DONE |
| 2 | AUTH-02 / SEC-02 | P1 | D:\manager\src\http\routes\auth-api.js#L211, L367 | Fail-closed DB session persistence: If Supabase session insert fails, abort RAM session and return HTTP 503 (`database_unavailable`). | DONE |
| 3 | AUTH-03 | P1 | D:\manager\src\http\routes\auth-api.js#L443 | Revoke old sessions on password change: call `store.adapter.revokeUserSessions(userId)`, clear all RAM `activeSessions`, clear cookie, require re-login. | DONE |
| 4 | AUTH-04 | P1 | D:\manager\src\http\routes\auth-api.js#L407 | Synchronized DB logout revocation: call DB RPC `revoke_manager_session`, log warning with correlation ID if DB call fails. | DONE |
| 5 | AUTH-05 / SEC-05 | P2 | D:\manager\src\http\routes\auth-api.js#L248, D:\manager\src\http\app.js | Enable Express `trust proxy` in `src/http/app.js`. Use real client IP (`req.ip`) in rate limiter. | DONE |
| 6 | AUTH-06 / SEC-03 | P2 | D:\manager\src\http\routes\auth-api.js#L65 | Bounded `loginAttempts` Map with `MAX_ENTRIES = 5000` and periodic expiration cleanup to prevent DoS/OOM. Pass `config.maxLoginAttempts` & `config.loginWindowMs`. | DONE |
| 7 | SEC-04 | P2 | D:\manager\src\http\routes\auth-api.js#L61 | Harmonize session TTL in milliseconds (`config.webSessionTtlHours * 3600 * 1000`) across cookie Max-Age and DB session expiry. | DONE |
| 8 | SEC-OBS-01 | P2 | D:\manager\src\storage\supabase-client.js#L1233 | Preserve `role` in DB session storage: change hardcoded `role: 'user'` to `role: String(session.role || 'user')`. | DONE |
| 9 | AUTH-07 | P2 | D:\manager\src\http\routes\auth-api.js#L176 | Explicit key redemption reporting: when registration key redemption fails, return `{ keyRedeemed: false, keyError }` to client. | DONE |
| 10 | AUTH-08 | P2 | D:\manager\src\http\app.js#L208 | DB auth as Single Source of Truth: invalidate RAM cache on login and logout, ensure cache bypass when querying user for auth. | DONE |
| 11 | WORKER-01 | P1 | D:\manager\src\http\routes\auth-api.js#L490 | Promise truthiness bypass: add `await` to `registry.verifyBotSecret(botId, secret)` at `auth-api.js#L490` and verify boolean strictly. | DONE |
| 12 | WORKER-02 / WKR-01 | P1 | D:\manager\src\services\worker-registry.js#L168 | Assign 60s TTL to `secretCache` in `worker-registry.js` and add programmatic `invalidateWorkerSecret(workerId)` method. | DONE |
| 13 | WORKER-03 | P2 | D:\manager\src\http\routes\worker-api.js#L90, src/http/app.js | Restrict global bot secret usage to worker routes with dedicated warning audit log (`GLOBAL_BOT_SECRET_USED`). | DONE |
| 14 | WORKER-04 | P2 | D:\manager\src\storage\supabase-worker-store.js#L73 | Atomic bot sequence number generation: prevent race conditions in `nextBotNumber()` fallback using `AsyncKeyLock` or atomic sequence RPC. | DONE |
| 15 | WORKER-05 | P2 | D:\manager\src\services\worker-registry.js#L328 | Prevent calling `addEvent` when worker is non-existent or disabled (`worker.enabled !== false`). | DONE |
| 16 | WORKER-06 | P2 | D:\manager\src\services\worker-registry.js#L186 | Prevent calling `rotateSecret` when worker is disabled: throw Error if worker is not registered or is disabled. | DONE |
| 17 | WORKER-07 | P2 | D:\manager\src\storage\supabase-worker-store.js#L116 | Non-silent RPC error handling in `resetData` & `addEvent`: classify RPC errors, do not silent fallback. | DONE |
| 18 | WORKER-08 | P2 | D:\manager\src\services\worker-registry.js#L230 | Strict schema validation for Worker status payload: validate state enum, booleans, integer coordinates. | DONE |
| 19 | WKR-02 | P2 | D:\worker\src\config.js | BotWorker secret rotation grace period / status handling to avoid unexpected disconnects. | DONE |
| 20 | WKR-03 | P2 | D:\worker\src\http\routes.js#L45 | Trim public `/health` endpoint in BotWorker to return only service status, concealing internal diagnostics/heap. | DONE |

## Gate 1 Acceptance Criteria
- [x] `tests/auth-regression.test.js` passes 100% (covering AUTH-01..08, SEC-01..05, SEC-OBS-01).
- [x] `tests/worker-registry-audit.test.js` passes 100% (covering WORKER-01..08, WKR-01..03).
- [x] All 37 baseline tests in `D:\manager` continue to pass 100% (All 5 suites, 55 tests pass in `npm test`).
- [x] Reviewer verdict: APPROVE from 2 reviewers (`reviewer_1`: APPROVE, `reviewer_2`: APPROVE).
- [x] Challenger verdict: PASS from 2 challengers (`challenger_1`: PASS, `challenger_2`: PASS).
- [x] Forensic Auditor verdict: CLEAN from teamwork_auditor (`auditor_1`: AUDIT_CLEAN).
