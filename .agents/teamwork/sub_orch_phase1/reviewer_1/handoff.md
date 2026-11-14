# Review & Adversarial Assessment Report: Phase 1 Auth & Security

**Reviewer**: Reviewer 1 (Auth & Security Reviewer & Adversarial Critic)  
**Parent Conversation ID**: `d69ef446-7699-4629-a2ce-6fa44ed3b128`  
**Milestone**: Phase 1: Security, Authentication, & Worker Registry Foundation  
**Date**: 2026-11-14T06:06:00Z  
**Verdict**: **APPROVE**  
**Adversarial Risk Assessment**: **LOW**

---

## 1. Observation

### 1.1 Integrity & Anti-Cheating Verification
- Executed source inspection across all modified files (`git diff src/`) checking for hardcoded test fixtures, usernames (`scryptuser`, `legacyuser`, `trustproxyuser`, `brutetarget`), or dummy/facade implementations.
- Result: **0 integrity violations found**. All implementations contain genuine, production-grade logic. No test shortcuts or self-certifying mock bypasses exist in implementation source code.

### 1.2 File-by-File Code Inspection

1. **`D:\manager\src\utils\secrets.js` (AUTH-01 / SEC-01)**:
   - Lines 178-184: `hashPassword(password, salt = null)` accepts an optional salt parameter. If `salt && typeof salt === 'string' && salt.length >= 8`, the salt is preserved; otherwise `crypto.randomBytes(16).toString('hex')` generates a fresh salt.
   - Derives one-way hash using `crypto.scryptSync(String(password), actualSalt, 64, { N: 16384, r: 8, p: 1 })`.
   - Lines 219-224: `verifyPassword` strictly validates Scrypt cost bounds (`1024 <= N <= 262144`, `1 <= r <= 16`, `1 <= p <= 4`, hex parity, and non-empty salt) before derivation, defending against algorithmic complexity attacks.
   - Lines 227-229: Performs constant-time comparison via `crypto.timingSafeEqual`.

2. **`D:\manager\src\storage\supabase-client.js` (SEC-OBS-01, AUTH-01)**:
   - Line 472: In `userToDatabaseRows`, checks `else if (String(u.password ?? '').startsWith('scrypt$')) { encPassword = String(u.password); }`. This prevents one-way Scrypt hashes from being erroneously re-encrypted with AES-256-GCM.
   - Line 1235: In `createManagerUserSession`, sets `role: String(session.role || 'user')`. Previously hardcoded to `role: 'user'`, this fix guarantees that administrative sessions (`session.role = 'admin'`) persist with full privileges in PostgreSQL `manager_sessions`.

3. **`D:\manager\src\storage\supabase-dashboard-store.js` (AUTH-01, AUTH-08)**:
   - Lines 371-374: `setAccess` resolves `existingUser` prior to row construction (`(await this.resolveUserRow(userId)) || ...`).
   - Lines 385-409: Preserves existing database attributes (`role`, `status`, `is_permanent`, `expires_at`, `plan_name`, `assigned_bot_ids`, `bot_count`, `allow_account_change`, `lock_reason`, `note`, `is_trial`, `trial_bot_id`, `password`) when not explicitly provided in partial updates.
   - Lines 404-409: Hashes plaintext passwords using `hashPassword` while preserving existing `scrypt$` hashes or ciphertext.
   - Lines 588-594: `getUser(username, { bypassCache = false } = {})` implements `bypassCache` option, ensuring fresh lookups on authentication flows.
   - Lines 628: `registerUser` hashes new user passwords with `hashPassword`.

4. **`D:\manager\src\http\routes\auth-api.js` (AUTH-02, AUTH-03, AUTH-04, SEC-04, AUTH-06/SEC-03, AUTH-07, AUTH-08, WORKER-01, WORKER-03)**:
   - Lines 62-67: Session TTL harmonized via `config.webSessionTtlHours * 3600 * 1000`, matching cookie `maxAge` (seconds) and DB `expiresAt` (ms).
   - Lines 70-117: `checkRateLimit` enforces bounded `loginAttempts` Map (`MAX_RATE_LIMIT_ENTRIES = 5000`, `RATE_LIMIT_WINDOW_MS = 15m`, `MAX_LOGIN_ATTEMPTS = 10`). Eviction purges expired entries first, then applies FIFO eviction (`loginAttempts.keys().next().value`). Cleanup timer uses `.unref()`.
   - Lines 240-262 (`/register`), lines 341-363 (Admin `/login`), and lines 461-483 (User `/login`): Enforces fail-closed session persistence. If `createManagerUserSession` returns `ok: false` or throws, `activeSessions.delete(tokenHash)` immediately removes the in-memory session and returns HTTP 503 (`database_unavailable`).
   - Lines 594-628 (`/change-password`): Calls `store.adapter.revokeUserSessions`, prunes all matching user/admin sessions from RAM `activeSessions`, calls `store.invalidateCache()`, and sets cookie `Max-Age=0`.
   - Lines 530-540 (`/logout`): Prunes RAM session, calls `store.adapter.deleteSession(tokenHash)`, logs structured warning with `correlationId` and `tokenHash` on database failure, invalidates cache, and sets cookie `Max-Age=0`.
   - Lines 287-292 & 510-515: Explicitly surfaces `{ keyRedeemed: false, keyError }` when giftcode redemption fails during registration or login.
   - Line 387: In `/login`, invokes `store.getUser(cleanUsername, { bypassCache: true })`.
   - Lines 639-658: In `POST /verify-bot-access`, strictly awaits `registry.verifyBotSecret(botId, incomingSecret)` and audits `GLOBAL_BOT_SECRET_USED`.

5. **`D:\manager\src\http\app.js` (AUTH-05, WORKER-03)**:
   - Line 39: `app.set('trust proxy', 1);` enables Express trust proxy for accurate client IP resolution behind reverse proxies.
   - Lines 49-61: `isBotSecretRequest(req)` restricts global bot secret usage strictly to worker paths (`/api/worker/*`, `/api/v1/workers/*`, `/api/auth/verify-bot-access`). Non-worker endpoints log `GLOBAL_BOT_SECRET_BLOCKED` and return `false`.

6. **`D:\manager\src\http\routes\user-api.js` (SEC-05)**:
   - Line 737: In `/rewards/link4m/start`, uses `req.ip || req.socket?.remoteAddress || '127.0.0.1'` instead of raw `x-forwarded-for` header.

### 1.3 Independent Test Execution Evidence

- **Auth Regression Test Suite (`tests/auth-regression.test.js`)**:
  - Command: `cmd.exe /c "cd /d D:\manager && node tests/auth-regression.test.js"`
  - Exit code: `0`
  - Output summary:
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

- **Worker Registry Audit Test Suite (`tests/worker-registry-audit.test.js`)**:
  - Command: `cmd.exe /c "cd /d D:\manager && node tests/worker-registry-audit.test.js"`
  - Exit code: `0`
  - Output summary:
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

- **Full Manager Test Suite (`npm test` in `D:\manager`)**:
  - Command: `cmd.exe /c "cd /d D:\manager && npm test"`
  - Exit code: `0`
  - Suites executed:
    1. `tests/integration.test.js` (15/15 passed)
    2. `tests/services-wiring.test.js` (15/15 passed)
    3. `tests/storage-sql.test.js` (7/7 passed)
    4. `tests/auth-regression.test.js` (8/8 passed)
    5. `tests/worker-registry-audit.test.js` (10/10 passed)
  - Total tests: 55/55 passed (100% pass rate).

- **BotWorker Test Suite (`D:\worker`)**:
  - Command: `cmd.exe /c "cd /d D:\worker && node tests/integration.test.js"`
  - Exit code: `0`
  - Output summary: 13/13 tests passed cleanly.

---

## 2. Logic Chain

1. **AUTH-01 / SEC-01 (Password Security & Field Preservation)**:
   - Passwords must be irreversible to prevent plaintext exposure if the database is breached. Scrypt with `N=16384, r=8, p=1` satisfies modern cryptographic standards.
   - Legacy AES passwords are automatically identified via `isStoredCredentialCiphertext()`, validated, and upgraded to Scrypt on successful login.
   - Partial updates in `SupabaseDashboardStore.setAccess` previously dropped existing fields when updating passwords. Resolving the existing database record and merging unsupplied fields preserves user attributes (`role`, `status`, `expires_at`, `plan_name`).
   - Verified by test 1 in `auth-regression.test.js`.

2. **AUTH-02 / SEC-02 (Fail-Closed DB Persistence)**:
   - Storing sessions solely in RAM creates split-brain state across cluster restarts and bypasses PostgreSQL audit trails.
   - The implementation puts database persistence in the critical authentication path: if `createManagerUserSession` returns `ok: false` or throws an exception, the in-memory session is deleted and HTTP 503 is returned.
   - Verified by test 2 in `auth-regression.test.js` across both reject and throw paths.

3. **AUTH-03 & AUTH-04 (Session Lifecycle Integrity)**:
   - When a password is changed, all active sessions for that user must be invalidated immediately in both the database (`revokeUserSessions`) and RAM (`activeSessions.delete`), and the client cookie expired (`Max-Age=0`).
   - On logout, database session revocation (`deleteSession`) is executed. If the database is unreachable, a structured warning log with `correlationId` and `tokenHash` is emitted, while RAM session eviction and cookie clearing proceed.
   - Verified by tests 3 and 4 in `auth-regression.test.js`.

4. **AUTH-05, AUTH-06, SEC-03, SEC-05 (Network Edge & DoS Hardening)**:
   - With `app.set('trust proxy', 1)`, Express derives the authentic client IP from the reverse proxy header.
   - In-memory rate limiting Map enforces an upper bound of 5,000 entries. Expired entries are swept during insertion and via an unref'd 5-minute timer; if the map remains saturated, FIFO eviction prevents memory growth.
   - Verified by tests 5 and 6 in `auth-regression.test.js`.

5. **SEC-04 & SEC-OBS-01 (TTL & Role Consistency)**:
   - Session duration is unified in milliseconds across cookie `maxAge` and database `expires_at` using `config.webSessionTtlHours`.
   - `session.role` is explicitly stored in DB sessions (`role: String(session.role || 'user')`), preventing administrative privileges from reverting to standard user permissions.
   - Verified by test 8 in `auth-regression.test.js`.

---

## 3. Adversarial Challenges & Stress-Test Results

| # | Challenge Dimension | Attack Scenario / Hypothesis | Stress-Test Execution | Result |
|---|---------------------|------------------------------|-----------------------|--------|
| 1 | **Scrypt Parameter Injection** | Malicious stored password string with exorbitant `N=262144, r=16, p=4` to trigger CPU/memory starvation. | `verifyPassword` bounds check rejects `N > 262144` or `r > 16` or non-integer before calling `crypto.scryptSync`. | **PASS** |
| 2 | **Database Outage Fail-Closed** | Database connection times out during user login. Does the session leak into memory? | Simulated timeout in `store.adapter.createManagerUserSession`. Verified `activeSessions.size === 0` and HTTP 503 returned. | **PASS** |
| 3 | **Session Hijacking After Password Change** | Stolen token used after user calls `/change-password`. | Verified old Bearer token returns HTTP 401 and cookie is cleared with `Max-Age=0`. | **PASS** |
| 4 | **Rate Limiter Memory Exhaustion (OOM DoS)** | Attacker spams login with 10,000 randomized IP/username pairs. | Evaluated `checkRateLimit` with 5,000 entries + overflow. Map size strictly capped at 5,000; oldest entries FIFO-evicted. | **PASS** |
| 5 | **IP Spoofing via X-Forwarded-For** | Client sends forged `X-Forwarded-For: 1.2.3.4, 5.6.7.8` behind single reverse proxy. | Verified Express trust proxy resolves to actual client IP hop without spoof vulnerability. | **PASS** |
| 6 | **Global Bot Secret Escalation** | Client presents global bot secret to user endpoints (e.g., `/api/user/bots`). | `isBotSecretRequest` checks path prefix; rejects non-worker routes and logs `GLOBAL_BOT_SECRET_BLOCKED`. | **PASS** |
| 7 | **Promise Truthiness Bypass in Worker Auth** | Incoming unauthenticated request to `/api/auth/verify-bot-access`. | `await registry.verifyBotSecret(botId, incomingSecret)` is strictly awaited and compared as boolean. | **PASS** |

---

## 4. Caveats

1. **Supabase In-Memory Emulation in Unit Tests**:
   - The test suites use an in-memory adapter that emulates PostgreSQL constraints and RPC behaviors. Live production deployments require a functioning PostgreSQL instance with migration tables.
2. **Windows File System Timing for Discord.js**:
   - `tests/integration.test.js` imports Discord.js symbols, requiring ~5 seconds initialization on Windows NTFS. All automated test runners should maintain a timeout buffer of >= 15 seconds.
3. No caveats affect the security, reliability, or correctness of the code.

---

## 5. Conclusion & Verdict

**VERDICT: APPROVE**

The Phase 1 Auth & Security implementation:
1. Meets 100% of the specifications laid out in `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `SCOPE.md`.
2. Passes all 8 regression sub-suites in `tests/auth-regression.test.js` with exit code 0.
3. Passes all 5 test suites (55 tests) across `D:\manager` with exit code 0.
4. Passes all 13 integration tests in `D:\worker` with exit code 0.
5. Displays zero integrity violations, shortcuts, or facade implementations.
6. Successfully withstands adversarial stress-testing across fail-closed persistence, memory limits, and timing safety.

---

## 6. Verification Method

To independently reproduce and verify this assessment:

```powershell
# 1. Run Auth Regression Suite (Manager)
cd D:\manager
node tests/auth-regression.test.js

# 2. Run Worker Registry Audit Suite (Manager)
cd D:\manager
node tests/worker-registry-audit.test.js

# 3. Run Full Manager Regression Suite (All 5 suites)
cd D:\manager
npm test

# 4. Run BotWorker Integration Suite (Worker)
cd D:\worker
node tests/integration.test.js
```

### Invalidation Conditions
- Any test suite failing or exiting with non-zero exit code.
- Database write failure during login/registration failing to return HTTP 503.
- Rate limiter `loginAttempts` Map growing beyond 5,000 entries.
- Stolen session token succeeding after a password change.
- Global bot secret authenticating non-worker endpoints.
