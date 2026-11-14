## 2026-11-14T05:17:20Z

You are the Implementation Worker for Phase 1: Security, Authentication, & Worker Registry Foundation.

Working directory: D:\manager (secondary repository: D:\worker)
State folder: D:\manager\.agents\teamwork\sub_orch_phase1\worker_phase1\
Parent ID: d69ef446-7699-4629-a2ce-6fa44ed3b128

MANDATORY FIRST STEP:
Read `D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md` verbatim before doing any work.
Also read:
- `D:\manager\.agents\teamwork\orchestrator\PROJECT.md`
- `D:\manager\.agents\teamwork\sub_orch_phase1\SCOPE.md`
- Explorer 1 Report: `D:\manager\.agents\teamwork\sub_orch_phase1\explorer_auth\handoff.md`
- Explorer 2 Report: `D:\manager\.agents\teamwork\sub_orch_phase1\explorer_registry\handoff.md`
- Explorer 3 Report: `D:\manager\.agents\teamwork\sub_orch_phase1\explorer_worker_tests\handoff.md`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

YOUR ASSIGNMENT:
Implement all 20 surgical fixes across `D:\manager` and `D:\worker` using the concrete diffs and specifications provided by the 3 Explorers:

1. Auth & Secrets (`D:\manager`):
   - AUTH-01 / SEC-01 (`src/utils/secrets.js`): Ensure `hashPassword(password, salt = null)` supports optional salt; verify legacy passwords auto-migrate to Scrypt on login. In `src/storage/supabase-dashboard-store.js#setAccess`, ensure partial updates merge existing fields so password updates don't wipe out roles or expiry!
   - AUTH-02 / SEC-02 (`src/http/routes/auth-api.js`): Fail-closed session persistence in `/login` (both admin and user) and `/register`. Return HTTP 503 (`database_unavailable`) if DB session persistence fails.
   - AUTH-03 (`src/http/routes/auth-api.js`): Revoke sessions on password change: call `store.adapter.revokeUserSessions`, clear all matching RAM sessions, set cookie `Max-Age=0`.
   - AUTH-04 (`src/http/routes/auth-api.js`): Synchronized DB logout revocation: call `deleteSession(tokenHash)` (RPC `revoke_manager_session`), log warning with `correlationId` and `tokenHash` on failure.
   - AUTH-05 / SEC-05 (`src/http/app.js` & `src/http/routes/auth-api.js`): Express trust proxy enabled (`app.set('trust proxy', 1)`) and rate limiter uses real `req.ip`.
   - AUTH-06 / SEC-03 (`src/http/routes/auth-api.js`): Bounded `loginAttempts` Map with `MAX_ENTRIES = 5000` and periodic / FIFO cleanup, reading `config.maxLoginAttempts` and `config.loginWindowMs`.
   - SEC-04 (`src/http/routes/auth-api.js`): Harmonize session TTL in milliseconds (`config.webSessionTtlHours * 3600 * 1000`) across cookie Max-Age and DB session expiry.
   - SEC-OBS-01 (`src/storage/supabase-client.js#L1233-1235`): Preserve session role in DB session storage: `role: String(session.role || 'user')`.
   - AUTH-07 (`src/http/routes/auth-api.js`): Explicit key redemption status reporting in `/register` and `/login` (`keyRedeemed: false`, `keyError`).
   - AUTH-08 (`src/http/app.js` & `src/http/routes/auth-api.js`): Single Source of Truth DB auth, bypass cache on login (`bypassCache: true`), invalidate RAM cache on login/logout/password change.

2. Worker Registry & Stores (`D:\manager`):
   - WORKER-01 (`src/http/routes/auth-api.js#L582-604` & `src/services/worker-registry.js`): Add `await` to `registry.verifyBotSecret(botId, incomingSecret)` and strict boolean check.
   - WORKER-02 / WKR-01 (`src/services/worker-registry.js`): 60s TTL (`SECRET_CACHE_TTL_MS = 60000`) for `secretCache`, prune stale entries in `pruneStaleMemory`, check TTL in `credential()` and `verifyBotSecretSync()`, add programmatic `invalidateWorkerSecret(workerId)` and `invalidate(workerId)`.
   - WORKER-03 (`src/http/app.js` & `src/http/routes/worker-api.js`): Scope global bot secret in `isBotSecretRequest(req)` strictly to worker routes (`/api/worker/*`, `/api/v1/workers/*`, `/api/auth/verify-bot-access`), block and log `GLOBAL_BOT_SECRET_BLOCKED` on other routes, emit `logger.warn('GLOBAL_BOT_SECRET_USED')` and audit record when used.
   - WORKER-04 (`src/storage/supabase-worker-store.js`): Atomic `nextBotNumber()` fallback using `AsyncKeyLock` (`this.sequenceLock`) and `this.lastAllocatedBotNumber` to prevent sequence duplicate collisions.
   - WORKER-05 (`src/services/worker-registry.js#L328` & `src/http/routes/worker-api.js`): Check worker exists and `worker.enabled !== false` before calling `addEvent`. Return 404 in worker-api if worker not found or disabled.
   - WORKER-06 (`src/services/worker-registry.js#L186`): Check worker is registered and `record.enabled !== false` before `rotateSecret`, throwing Error if disabled.
   - WORKER-07 (`src/storage/supabase-worker-store.js`): Non-silent RPC error handling with `isRpcUnavailableError(error)`. Re-throw genuine database errors (e.g. Postgres `42501`), check `data === true` on `resetData`.
   - WORKER-08 (`src/services/worker-registry.js`): Export canonical `validateWorkerStatus(rawStatus, source)` with strict `VALID_WORKER_STATES` enum, coordinate bounds (`[-30000000, 30000000]`), boolean coercion, and metric clamps. Use it in `updateStatus`.

3. BotWorker Fixes (`D:\worker`):
   - WKR-02 (`src/services/worker-registry.js` & `D:\worker`): Support secret rotation grace period (cache `{ secret: newSecret, previousSecret: oldSecret, graceUntil }` on rotation; accept previousSecret during grace window with warning).
   - WKR-03 (`D:\worker\src\http\routes.js#L45`): Trim public `GET /` and `GET /health` to return only `{ ok: true, service: 'kingmc-afk-worker', botCount: config.botCount }`. Move detailed memory/wispbyte metrics to protected `GET /api/v1/diagnostics` requiring worker secret.

4. Test Suite Implementation & Verification:
   - Create `D:\manager\tests\worker-registry-audit.test.js` covering WORKER-01..08 and WKR-01..03 (refer to Explorer 2 §5 and Explorer 3 §2.3/§4).
   - Update `D:\manager\package.json` test script to:
     `"test": "node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js && node tests/auth-regression.test.js && node tests/worker-registry-audit.test.js"`
   - Execute and verify all test suites:
     1. `node tests/auth-regression.test.js`
     2. `node tests/worker-registry-audit.test.js`
     3. `node tests/integration.test.js`
     4. `node tests/services-wiring.test.js`
     5. `node tests/storage-sql.test.js`
     6. `cmd.exe /c "cd /d D:\manager && npm test"`
     7. `node D:\worker\tests\integration.test.js`

OUTPUT:
Write your implementation report to `D:\manager\.agents\teamwork\sub_orch_phase1\worker_phase1\handoff.md`.
Document all modified files, test execution commands, outputs, exit codes, and verification evidence.
Send a completion message back to parent when done.


## 2026-11-14T05:48:34Z

**Context**: Server Connection Re-established Resume
**Content**: Server connection was restored after TLS timeout. Please resume immediately:
1. Finish implementing and running `tests/worker-registry-audit.test.js`.
2. Ensure all Gate 1 tests pass:
   - `node tests/auth-regression.test.js`
   - `node tests/worker-registry-audit.test.js`
   - `node tests/integration.test.js`
   - `node tests/services-wiring.test.js`
   - `node tests/storage-sql.test.js`
   - `cmd.exe /c "cd /d D:\manager && npm test"`
   - `node D:\worker\tests\integration.test.js`
3. Write your completion handoff report to `D:\manager\.agents\teamwork\sub_orch_phase1\worker_phase1\handoff.md` and report completion back.
**Action**: Resume execution, verify all tests, and publish handoff report.
