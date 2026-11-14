# Forensic Integrity Audit Report: Phase 1 (Security, Authentication, & Worker Registry Foundation)

## Verdict: `AUDIT_CLEAN`

All 20 audit remediation items across `D:\manager` and `D:\worker` for Phase 1 have been forensically inspected and empirically verified. Zero integrity violations, facades, hardcoded test shortcuts, or mock evasions were detected.

---

## 1. Observation

### 1.1 Direct Inspection of Production Source Code

1. **`D:\manager\src\utils\secrets.js`**:
   - Lines 178–184: `hashPassword(password, salt = null)` uses `crypto.randomBytes(16).toString('hex')` when salt is omitted, and computes `crypto.scryptSync(String(password), actualSalt, 64, { N: 16384, r: 8, p: 1 })`.
   - Lines 186–233: `verifyPassword(password, storedValue)` strictly parses Scrypt parameters (`N`, `r`, `p`), validates bounds (`1024 <= N <= 262144`, `1 <= r <= 16`, `1 <= p <= 4`), recomputes `crypto.scryptSync`, and checks equality via `crypto.timingSafeEqual(expected, actual)`. Handles legacy ciphertext fallback cleanly.
   - Empirical verification:
     ```
     h1!=h2: true
     verify h1: true
     verify wrong: false
     tampered: false
     ```

2. **`D:\manager\src\storage\supabase-client.js`**:
   - Line 1235: `createManagerUserSession(session, expectedUserRevision)` dynamically persists `role: String(session.role || 'user')` (SEC-OBS-01).

3. **`D:\manager\src\storage\supabase-dashboard-store.js`**:
   - Lines 371–411: `setAccess(userId, values, actorId)` merges `role`, `status`, `is_permanent`, `expires_at`, `assigned_bot_ids`, and `plan_name` with `existingUser` before upserting into `manager_users`. Line 407 hashes plain-text incoming passwords using `hashPassword(p)`.

4. **`D:\manager\src\http\routes\auth-api.js`**:
   - Lines 62–67: Harmonized session TTL: `sessionDurationMs = Number(config.webSessionTtlHours) * 3600 * 1000`.
   - Lines 70–98: Bounded `loginAttempts` Map with `MAX_ENTRIES = 5000`, pruning expired entries and evicting FIFO if at capacity.
   - Lines 244–261 (`/register`), lines 350–362 (Admin `/login`), and lines 465–482 (User `/login`): Fail-closed session persistence. If `createManagerUserSession` returns `{ ok: false }` or throws, `activeSessions.delete(tokenHash)` is executed immediately and HTTP 503 (`database_unavailable`) is returned.
   - Lines 387: Single Source of Truth DB auth with `store.getUser(cleanUsername, { bypassCache: true })`.
   - Lines 405–416: Auto-migration of legacy AES passwords to Scrypt upon successful login, calling `store.invalidateCache()`.
   - Lines 524–544 (`/logout`): Deletes RAM session, calls `store.adapter.deleteSession(tokenHash)`, logs warning with `correlationId` if revocation fails, and sets `Max-Age=0` cookie.
   - Lines 573–630 (`/change-password`): Calls `store.adapter.revokeUserSessions`, purges matching RAM sessions, and sets `Max-Age=0` cookie.
   - Line 657 (`/verify-bot-access`): Strictly awaits `registry.verifyBotSecret(botId, incomingSecret)` and casts to boolean (`WORKER-01`).
   - Lines 642–655: Global bot secret usage logs `GLOBAL_BOT_SECRET_USED` and records an audit entry with client IP.

5. **`D:\manager\src\http\app.js`**:
   - Line 39: `app.set('trust proxy', 1)` enables Express trusted proxy IP resolution.
   - Lines 45–69: `isBotSecretRequest(req)` scopes the global bot secret strictly to worker routes (`/api/worker/*`, `/api/v1/workers/*`, `/api/auth/verify-bot-access`). Non-worker endpoints are blocked with `GLOBAL_BOT_SECRET_BLOCKED`.

6. **`D:\manager\src\http\routes\user-api.js`**:
   - Line 737: `const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';` uses trusted proxy `req.ip` rather than unvalidated spoofable headers.

7. **`D:\manager\src\http\routes\worker-api.js`**:
   - Lines 28–34 (`/events`): Calls `registry.addEvent(req.workerId, event)`. Returns 404 (`worker_not_found_or_disabled`) if missing or disabled.
   - Lines 95–108 (`/report`): Emits `GLOBAL_BOT_SECRET_USED` and creates audit records when global secret is presented.
   - Lines 117–120 (`/report`): Validates worker exists and `worker.enabled !== false`, returning 404 if disabled.

8. **`D:\manager\src\services\worker-registry.js`**:
   - Lines 37–38: `SECRET_CACHE_TTL_MS = 60000` (60s TTL), `ROTATION_GRACE_PERIOD_MS = 300000` (5m grace).
   - Lines 48–110: Canonical `validateWorkerStatus(rawStatus, source)` validates against `VALID_WORKER_STATES`, clamps coordinates to `[-30000000, 30000000]`, and clamps metrics (`health: [0, 20]`, `food: [0, 20]`, `tps: [0, 20]`, `cpuPercent: [0, 100]`).
   - Lines 276–292 (`rotateSecret`): Rejects disabled/unregistered workers with error and populates previous secret with 5m grace window.
   - Lines 294–305: Programmatic `invalidateWorkerSecret(workerId)` and `invalidate(workerId)`.
   - Lines 317–355 (`authenticate`): Verifies TTL freshness and allows dual-secret authentication during grace window.
   - Lines 452–458 (`addEvent`): Rejects non-existent or disabled workers returning `null`.
   - Lines 675–684: Backward-compatible dual-export (`module.exports = WorkerRegistry; module.exports.validateWorkerStatus = ...`).

9. **`D:\manager\src\storage\supabase-worker-store.js`**:
   - Lines 9–23: `isRpcUnavailableError(error)` detects missing RPCs (`PGRST202`, `42883`) while rethrowing genuine errors (e.g. Postgres `42501`).
   - Lines 88–115 (`nextBotNumber`): Concurrency serialized via `this.sequenceLock.run('next_bot_number', ...)`. Monotonically allocates `Math.max(dbMax, this.lastAllocatedBotNumber) + 1`.
   - Lines 157–184 (`resetData`): Re-throws non-unavailable RPC errors, checks `data === true`, and falls back safely only on RPC absence.

10. **`D:\worker\src\http\auth.js`**:
    - Lines 16–25: `requireWorkerSecret(secret, { previousSecret = null, graceUntil = 0 } = {})` validates current secret or previous secret if within `graceUntil` window using `timingSafeEqual`.

11. **`D:\worker\src\http\routes.js`**:
    - Lines 45–49: Public `GET /` and `GET /health` trimmed to `{ ok: true, service: 'kingmc-afk-worker', botCount: config.botCount }`.
    - Lines 51–61: Detailed diagnostics relocated to `GET /api/v1/diagnostics`, gated by `x-worker-secret`.

---

### 1.2 Automated Tool Commands & Raw Execution Results

#### Check A: Zero Facade / Test Bypass Scan
- Command: `Select-String -Path "D:\manager\src\*.js", "D:\manager\src\**\*.js", "D:\worker\src\*.js", "D:\worker\src\**\*.js" -Pattern "NODE_ENV === 'test'|NODE_ENV === `"test`"|__test__|bypass.*test"`
- Exit code: `0`
- Result: `No output` (Zero test-bypass conditionals in production code).

#### Check B: Zero Pre-populated Logs / Results Scan
- Command: `Get-ChildItem -Path "D:\manager", "D:\worker" -Exclude "node_modules", ".git" ...`
- Exit code: `0`
- Result: `No pre-populated test artifacts detected`.

#### Check C: Auth Regression Suite (`D:\manager`)
- Command: `cmd.exe /c "cd /d D:\manager && node tests/auth-regression.test.js"`
- Exit code: `0`
- Output:
  ```
  --- [AUTH & SESSION HARDENING REGRESSION TESTS (AUTH-01..08)] ---
  1. Testing AUTH-01: Scrypt Hashing, Auto-Migration, and Store Preservation...
  ✅ AUTH-01: Scrypt hashing, auto-migration & store preservation verified.
  2. Testing AUTH-02: Fail-Closed DB Session Persistence...
  ✅ AUTH-02: Fail-closed DB session persistence verified.
  3. Testing AUTH-03: /change-password Session Revocation...
  ✅ AUTH-03: /change-password session revocation verified.
  4. Testing AUTH-04: /logout Warning Log on DB Revoke Failure...
  ✅ AUTH-04: /logout DB revoke failure warning log verified.
  5. Testing AUTH-05: Rate Limiter IP Resolution via Express Trust Proxy...
  ✅ AUTH-05: Express trust proxy & clientIp resolution verified.
  6. Testing AUTH-06: Bounded Map Rate Limiter...
  ✅ AUTH-06: Bounded Map rate limiter verified.
  7. Testing AUTH-07: Explicit keyRedeemed and keyError in /register...
  ✅ AUTH-07: Explicit keyRedeemed and keyError response verified.
  8. Testing AUTH-08: DB Auth and RAM Cache Consistency (bypassCache)...
  ✅ AUTH-08: DB auth & RAM cache consistency verified.
  🎉 ALL AUTH-01 THROUGH AUTH-08 REGRESSION TESTS PASSED 100%!
  ```

#### Check D: Worker Registry Audit Suite (`D:\manager`)
- Command: `cmd.exe /c "cd /d D:\manager && node tests/worker-registry-audit.test.js"`
- Exit code: `0`
- Output:
  ```
  --- [WORKER REGISTRY & STORAGE HARDENING AUDIT TESTS (WORKER-01..08, WKR-01..03)] ---
  1. Testing WORKER-01: Promise Truthiness Fix in POST /api/auth/verify-bot-access...
  ✅ WORKER-01: Promise truthiness fix verified.
  2. Testing WORKER-02 / WKR-01: Secret Cache TTL (60s) & Programmatic Invalidation...
  ✅ WORKER-02 / WKR-01: Secret cache TTL & programmatic invalidation verified.
  3. Testing WORKER-03: Scoped Global Bot Secret & Audit Logging...
  ✅ WORKER-03: Scoped global bot secret & audit logging verified.
  4. Testing WORKER-04: Atomic nextBotNumber() Fallback with Concurrency Lock...
  ✅ WORKER-04: Atomic nextBotNumber() fallback verified.
  5. Testing WORKER-05: addEvent() Rejection on Non-Existent or Disabled Workers...
  ✅ WORKER-05: addEvent() worker existence & enabled verification verified.
  6. Testing WORKER-06: rotateSecret() Rejection on Disabled Workers...
  ✅ WORKER-06: rotateSecret() disabled worker rejection verified.
  7. Testing WORKER-07: Non-Silent RPC Error Handling in SupabaseWorkerStore...
  ✅ WORKER-07: Non-silent RPC error handling verified.
  8. Testing WORKER-08: validateWorkerStatus Schema Sanitization & Boundary Clamps...
  ✅ WORKER-08: validateWorkerStatus schema sanitization verified.
  9. Testing WKR-02: Secret Rotation Grace Period Dual-Secret Authentication...
  ✅ WKR-02: Secret rotation grace period verified.
  10. Testing WKR-03: BotWorker /health Trimming & Protected Diagnostics...
  ✅ WKR-03: BotWorker /health trimming & protected diagnostics verified.
  🎉 ALL WORKER-01 THROUGH WORKER-08 & WKR-01..03 AUDIT TESTS PASSED 100%!
  ```

#### Check E: Manager Full Test Suite (`D:\manager`)
- Command: `cmd.exe /c "cd /d D:\manager && npm test"`
- Exit code: `0`
- Suites run:
  1. `tests/integration.test.js` (15/15 passed)
  2. `tests/services-wiring.test.js` (15/15 passed)
  3. `tests/storage-sql.test.js` (7/7 passed)
  4. `tests/auth-regression.test.js` (8/8 passed)
  5. `tests/worker-registry-audit.test.js` (10/10 passed)
- Total tests: 55/55 passed, 0 failures.

#### Check F: Worker Full Test Suite (`D:\worker`)
- Command: `cmd.exe /c "cd /d D:\worker && npm test"`
- Exit code: `0`
- Total tests: 13/13 passed, 0 failures.

#### Check G: Empirical Concurrency Stress Test on `nextBotNumber`
- Tested 50 concurrent fallback invocations under simulated async delay.
- Result: `50 concurrent calls unique count: 50 min: 1 max: 50`. Zero duplicate collisions.

---

## 2. Logic Chain

1. **Absence of Facades and Pre-computation**:
   Inspection of `D:\manager\src` and `D:\worker\src` confirms no mock branches, hardcoded test responses, or environment-triggered bypasses exist in production code paths.
2. **Cryptographic Integrity (AUTH-01/SEC-01)**:
   Scrypt password hashing directly leverages Node.js standard library `crypto.scryptSync` with high memory/CPU difficulty parameters (`N=16384, r=8, p=1`) and individual random 16-byte salts. Reversible AES passwords for users are strictly auto-migrated upon login without deleting account metadata.
3. **Session Fail-Closed Invariant (AUTH-02/SEC-02)**:
   Whenever database session persistence encounters network failure, constraint errors, or returns `{ ok: false }`, the in-memory session is pruned from `activeSessions` and HTTP 503 is returned. No ghost session exists in RAM.
4. **Session Invalidation & Synchronization (AUTH-03, AUTH-04, AUTH-08)**:
   Password changes trigger database session deletion via `revokeUserSessions`, wipe RAM sessions, and issue `Max-Age=0` cookie clearing headers. Logouts similarly delete database records and emit diagnostic warning logs if database revocation fails.
5. **Worker Secret Verification & Promise Truthiness (WORKER-01)**:
   `await registry.verifyBotSecret(botId, incomingSecret)` is strictly awaited and compared as a boolean, eliminating the Promise truthiness bypass.
6. **Worker Registry Hardening (WORKER-02..08, WKR-01..03)**:
   - Secret cache employs a 60-second TTL with explicit programmatic invalidation (`invalidateWorkerSecret`).
   - `rotateSecret` issues a 5-minute grace period enabling dual-secret authentication without connection interruption.
   - Disabled workers are blocked from receiving events or rotating secrets.
   - Monotonic sequence generation in `nextBotNumber` is serialized with `AsyncKeyLock`.
   - Status payloads are clamped to legitimate ranges and valid Minecraft coordinate boundaries.
   - Sensitive diagnostics are concealed from public `/health` and protected by authentication.

---

## 3. Caveats

1. **Postgres Cluster Environment**:
   Verification tests utilize high-fidelity in-memory adapter mocks replicating Postgres error codes (`42501`, `PGRST202`, `23505`). Live Supabase cluster deployment requires matching network accessibility and database privileges.
2. **Third-Party Module Cold Start**:
   `discord.js` startup during `tests/integration.test.js` takes 4–6 seconds on Windows filesystems; test timeout budgets should accommodate this latency.
3. No integrity caveats exist.

---

## 4. Conclusion

The Phase 1 implementation across `D:\manager` and `D:\worker` conforms fully to all security and integrity specifications outlined in `ORIGINAL_REQUEST.md` and `PROJECT.md`.
- **Verdict**: `AUDIT_CLEAN`
- **Gate 1 Status**: Fully verified and recommended to advance to Phase 2.

---

## 5. Verification Method

To independently reproduce the audit results, execute:

```powershell
# 1. Verify Manager Auth Regression Suite
cd /d D:\manager
node tests/auth-regression.test.js

# 2. Verify Worker Registry Audit Suite
cd /d D:\manager
node tests/worker-registry-audit.test.js

# 3. Verify All Manager Suites (55 tests)
cd /d D:\manager
npm test

# 4. Verify BotWorker Integration Suite (13 tests)
cd /d D:\worker
npm test
```

### Invalidation Conditions
- Any suite exiting with a non-zero exit code.
- Presence of diagnostic or heap data in unauthenticated `GET /health` on BotWorker.
- Concurrent calls to `nextBotNumber` yielding identical integers.
- Session persistence failure in `/register` or `/login` returning HTTP 200/201 instead of 503.
- Un-awaited truthy Promise allowing unauthorized worker secrets in `POST /api/auth/verify-bot-access`.
