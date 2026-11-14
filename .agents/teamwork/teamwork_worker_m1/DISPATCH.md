## 2026-11-14T08:42:56Z
You are dispatched by the orchestrator (conversation ID: 0d86e0d0-41d7-4997-80d0-d77fba035dfc).

MANDATORY FIRST STEP:
Read ORIGINAL_REQUEST.md at:
C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\ORIGINAL_REQUEST.md

Read Survey Findings and Blueprint at:
C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_explorer_survey_1\handoff.md

Read PROJECT.md at:
C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\PROJECT.md

Working directory: D:\manager
Your state folder: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_worker_m1\

ROLE & OBJECTIVE:
You are an implementation worker (`teamwork_worker`) for Milestone 1: Gate 3 - Concurrency & Network Security (P6-01 to P6-08).
Your exclusive file ownership:
- `D:\manager\src\services\async-key-lock.js`
- `D:\manager\src\services\entitlement-service.js`
- `D:\manager\src\services\proxy-validation.js`
- `D:\manager\src\services\link4m-service.js`
- `D:\manager\src\http\routes\user-api.js` (proxy test/save & /bot/:id/settings sanitization)
- New or targeted test files: `D:\manager\tests\gate3-m1-concurrency.test.js`

REQUIREMENTS TO IMPLEMENT:
1. P6-01: In `D:\manager\src\services\async-key-lock.js`, do not release the lock on timeout while the underlying task is still executing; the lock must remain held until the running task settles to prevent concurrent mutation of the critical section. Caller must be rejected immediately on timeout, but lock release (`release()` and `decrementCount`) must be deferred until `task()` settles.
2. P6-02: In `D:\manager\src\services\entitlement-service.js`, catch and handle `savePendingAllocation` errors durably without losing compensation state. When `savePendingAllocation` fails or returns false, persist compensation record/fallback so pending bot allocations are never silently dropped.
3. P6-03: In `D:\manager\src\services\proxy-validation.js`, resolve hostnames via `dns.promises.lookup(url.hostname, { all: true })` and validate resolved IPs against forbidden private/loopback ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`) before allowing proxy connections. Update callers in `D:\manager\src\http\routes\user-api.js` (lines 579, 602) to `await validateProxyUrl(proxyUrl)`.
4. P6-04, P6-06: In `D:\manager\src\services\link4m-service.js`, verify tokens with backend API and enforce daily link limit checks prior to returning provider attempt URLs (move `countLinkRewards` check before checking active attempt reuse in `startAttemptLocked`).
5. P6-05: In `D:\manager\src\services\entitlement-service.js`, cap fixed bot IDs allocation strictly at package quota `targetCount` (break the `fixedIds` iteration when `desired.length >= targetCount`).
6. P6-07: In `D:\manager\src\http\routes\user-api.js`, pass `/bot/:id/settings` updates through `sanitizeBotForSession(updatedConfig, req.managerAuthSession)`.
7. P6-08: Ensure license key activation transactions cannot double-consume or race under parallel requests (serialize on `key:${codeHash}` in `EntitlementService.redeem`).

VERIFICATION REQUIREMENTS:
- Create comprehensive tests in `D:\manager\tests\gate3-m1-concurrency.test.js` testing all 7 requirements.
- Run canonical tests:
  `cmd /c "cd /d D:\manager && node tests/gate3-m1-concurrency.test.js"`
  `cmd /c "cd /d D:\manager && npm test"`
- Record exact commands and output summaries in your `handoff.md`.
