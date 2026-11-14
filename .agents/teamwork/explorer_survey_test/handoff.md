# Survey Report: Requirement R3 — Test Suite, Test Runner, and Baseline Verification

**Working Directory**: `D:\manager`  
**State Folder**: `D:\manager\.agents\teamwork\explorer_survey_test\`  
**Target Requirement**: R3 (Kiểm thử hồi quy tự động và đảm bảo tính toàn vẹn hệ thống)  

---

## 1. Observation

### 1.1 `package.json` Test Scripts & Dependencies
- File: `D:\manager\package.json`, lines 7–11 and 22–24:
```json
  "scripts": {
    "start": "node src/index.js",
    "test": "node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js",
    "commands:register": "node scripts/register-commands.js"
  },
  "devDependencies": {
    "pg": "^8.23.1"
  }
```
- No test runners (e.g. Jest, Mocha, Vitest, Ava, Tap) or assertion/mocking frameworks (e.g. Chai, Supertest, Sinon) are installed in `dependencies` or `devDependencies`.
- The test command chains three scripts synchronously with `&&` using standard `node`:
  `node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js`

### 1.2 Test Files Inventory & Execution
Directory `D:\manager\tests`:
1. `D:\manager\tests\integration.test.js` (30,145 bytes, 694 lines)
2. `D:\manager\tests\services-wiring.test.js` (127,873 bytes, 2,911 lines)
3. `D:\manager\tests\storage-sql.test.js` (82,613 bytes, 1,681 lines)
4. `D:\manager\tests\postgres-real.test.js` (75,038 bytes, 1,607 lines) — Requires embedded or live PostgreSQL; excluded from `npm test`.

Baseline test execution via `cmd.exe /c "cd /d D:\manager && npm test"`:
- Result: **Exit Code 0, 100% PASS**
- Output:
  ```
  --- [MANAGER INTEGRATION TESTS] ---
  1. Checking Unified Actions Set...
  ✅ 1. Unified Actions Set: 15 actions verified.
  2. Checking Secret Encryption Roundtrip...
  ✅ 2. Secret Encryption: AES-256-GCM roundtrip verified.
  3. Checking AsyncKeyLock Critical Section...
  ✅ 3. AsyncKeyLock: Sequential serialization verified.
  4. Checking Schema SQL, Atomic Numbering & Advisory Locks...
  ✅ 4. Schema SQL: Atomic sequence, unique constraint & single definition verified.
  5. Checking Command Coalescing Atomic RPC & Fallback Concurrency...
  ✅ 5. Command Coalescing: Atomic RPC parameter & concurrent fallback serialization verified.
  6. Checking Readiness Probe (Discord + Database dependencies)...
  ✅ 6. Readiness Probe: Strict 503/200 gating validated.
  7. Checking Discord Simplified Commands...
  ✅ 7. Discord Commands: Strictly 6 allowed commands, all legacy individual commands removed.
  8. Checking Discord Panel Rendering & Full Bot ID...
  ✅ 8. Discord Panels: Full Bot ID, performance metrics & button state gating verified.
  9. Checking Discord Data Isolation & Ownership Authorization Guard...
  ✅ 9. Discord Data Isolation: Strict multi-tenant authorization confirmed.
  10. Checking Discord Account Linking Store...
  ✅ 10. Discord Account Linking: Link and unlink roundtrip verified.
  11. Checking Free Trial 1 Bot Registration & Atomic Allocation...
  ✅ 11. Free Trial: Atomic allocation, 1 bot limit, out-of-bots & duplicate guards verified.
  12. Checking Link4M Complete Repair & Renewal Contract...
  ✅ 12. Link4M: Contract methods, active/expired extensions & bot preservation verified.
  13. Checking Giftcode Hash Lookup & Atomic Redemption...
  ✅ 13. Giftcode: SHA-256 hash lookup & usage exhaustion verified.
  14. Checking Expiration State Machine (active -> expiring -> expired)...
  ✅ 14. Expiration State Machine: active -> expiring -> expired retry lifecycle verified.
  15. Checking Reset Parity across HTTP & Polling Transports...
  ✅ 15. Reset Parity: registry.resetData & commandStore.clearWorker triggered on reportResult.
  🎉 ALL MANAGER INTEGRATION TESTS PASSED 100%!

  --- [MANAGER SERVICES WIRING & RELIABILITY TESTS] ---
  ✅ 1. src/index.js Link4M & Service DI Wiring verified.
  ✅ 2. Real AccessControl + AsyncKeyLock + Link4mService Wiring & Concurrency verified.
  ✅ 3. isWorkerStopConfirmed Contract verified.
  ✅ 4. EntitlementService STOP Confirmation Edge Cases verified.
  ✅ 5. Real CommandBroker + FleetOperations + EntitlementService Wiring verified.
  ✅ 6. Cross-Cutting Parity Contracts verified.
  ✅ 7. Link4M Degraded Initialization Visibility verified.
  ✅ 8. CommandBroker Reset Error Visibility verified.
  ✅ 9. Two-Phase Polling RESET & Independent Retry verified.
  ✅ 10. Long-Running RESET Lease Renewal & Multi-Instance Exclusion verified.
  ✅ 11. Stalled Lease Expiry Takeover, Fencing & Concurrent Race verified.
  ✅ 12. Manager Restart Mid-Flight Recovery verified.
  ✅ 13. Fail-Closed Atomic RPC Enforcement & Health/Readiness verified.
  ✅ 14. Session Revocation, Cache Eviction & Multi-Process Fail-Closed Middleware verified.
  ✅ 15. Public Login Security, Telemetry, Reduced-Motion, ARIA Tabs & API Contract verified.
  🎉 ALL MANAGER SERVICES WIRING TESTS PASSED 100%!

  --- [STORAGE & SQL STRUCTURAL TESTS] ---
  ✅ 1. SQL DDL & RPC structural validation passed.
  ✅ 2. Trial fallback concurrency, RPC fail-closed & 23505 rollback passed.
  ✅ 3. Discord link/unlink fail-closed & conflict checks passed.
  ✅ 4. Link4M dual-column parity & settings array preservation passed.
  ✅ 5. SupabaseCommandStore two-phase RESET states, fencing & fail-closed RPC enforcement verified.
  ✅ 6. cmd_<UUID> end-to-end RPC contract across SQL signatures verified.
  ✅ 7. Reconciled SQL parity, hardening & Phase 6 runtime contracts verified.
  🎉 ALL STORAGE & SQL TESTS PASSED 100%!
  ```
- Current test count: 15 (integration) + 15 (services-wiring) + 7 (storage-sql) = 37 tests.
- Note on the prompt's reference to "34 existing tests": Earlier iterations had 15 + 15 + 4 = 34 tests before tests 5, 6, and 7 were added to `storage-sql.test.js`. All 37 existing tests currently pass.

### 1.3 Test Construction & Mocks Pattern
Across all 3 active test files:
1. **Assertion Library**: Built-in `const assert = require('node:assert');` (`assert.strictEqual`, `assert.deepStrictEqual`, `assert.ok`, `assert.match`, `assert.rejects`).
2. **HTTP Server and Client Testing**:
   - In `tests/services-wiring.test.js` (lines 2259–2263):
     ```javascript
     const serverLocal = http.createServer(appLocal);
     await new Promise((resolve) => serverLocal.listen(0, resolve));
     const port = serverLocal.address().port;
     const base = `http://127.0.0.1:${port}`;
     ```
   - HTTP requests are sent using Node's native `fetch(`${base}/api/...`, { method, headers, body })`.
   - Tear-down via `finally { await new Promise((resolve) => serverLocal.close(resolve)); }`.
3. **Database and Storage Mocks**:
   - In-memory table stores using JavaScript `Map`s (`tables.users`, `tables.settings`, `tables.linkAttempts`, `tables.audit`).
   - Mock DB adapters (`store.adapter`) providing `createManagerUserSession`, `fetchManagerAuthorization`, `revokeUserSessions`, `deleteSession`, `testConnection`.
   - Mock Supabase PostgREST clients providing `rpc: async (fn, params) => ...` and `from: (tbl) => ({ select, insert, update, delete, eq, maybeSingle })`.
4. **Logger Mocks**: `createSilentLogger()` stubbing `info`, `warn`, `error`, `debug` methods.
5. **No live DB or external API requirements**: All active tests execute in-process using memory mocks without touching external databases or network endpoints.

### 1.4 Audit Vulnerability Observations in Code
- **AUTH-01 / AUTH-03**: `src/http/routes/auth-api.js` lines 472–476 calls `encryptUserPassword(newPassword)` (AES-256-GCM) instead of Scrypt `hashPassword`. Line 474 does not call `store.adapter.revokeUserSessions(userId)` and does not clear `activeSessions` or cookies.
- **AUTH-02**: `src/http/routes/auth-api.js` line 211:
  `await store.adapter.createManagerUserSession(session, 1).catch(() => false);`
  It swallows session persistence failure, leaving user with a RAM-only session instead of failing closed with HTTP 503.
- **AUTH-04**: `src/http/routes/auth-api.js` logout flow swallows DB session revocation.
- **AUTH-05**: `src/http/routes/auth-api.js` line 248:
  `const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();`
  Raw `X-Forwarded-For` is read without Express trust proxy validation (`req.ip`).
- **AUTH-06**: `src/http/routes/auth-api.js` line 65: `const loginAttempts = new Map();` has no max capacity limit (`MAX_ENTRIES`).
- **WORKER-01**: `src/http/routes/auth-api.js` lines 489–494:
  ```javascript
  const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
                   registry.verifyBotSecret(botId, incomingSecret);
  ```
  `registry.verifyBotSecret()` is async and returns a `Promise`. In JavaScript, all Promises are truthy (`Boolean(Promise) === true`). As a result, `isAuthed` evaluates to `true` even when the Promise resolves to `false`!
- **WORKER-02**: `src/services/worker-registry.js` line 51: `this.secretCache = new Map();` stores credentials without TTL or cross-instance invalidation mechanism.
- **WORKER-05 / WORKER-06**: `src/services/worker-registry.js`:
  - `addEvent()` (line 328) does not check if worker exists and is enabled before pushing to `botLogsCache` or calling `store.addEvent()`.
  - `rotateSecret()` (line 186) checks `if (!record)`, but fails to check `if (!record.enabled)` before generating and persisting a new secret.
- **WORKER-04 / WORKER-07**: `src/storage/supabase-worker-store.js`:
  - `nextBotNumber()` (lines 68–77) falls back to non-atomic `Math.max(...numbers) + 1` from `list()`.
  - RPC calls across `supabase-worker-store.js` use `catch (_) {}`, silently swallowing errors.

---

## 2. Logic Chain

1. **Test Runner Architecture**:
   - `package.json` specifies `"test": "node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js"`.
   - Node v24 is installed (`v24.21.0`), supporting ES modules, native `fetch()`, `crypto.scryptSync`, `crypto.timingSafeEqual`, and `node:assert`.
   - The test runner operates without any external harness (no Jest/Mocha runner needed). Adding regression tests must therefore follow the identical runner mechanism: pure Node.js scripts returning exit code 0 on success and throwing an error on failure.

2. **Preservation of Existing Tests**:
   - Existing 37 tests currently pass 100%.
   - In `tests/services-wiring.test.js`, mock stores and `createApp` are heavily utilized, but `WorkerRegistry` itself is never instantiated (only mocked).
   - In `src/utils/secrets.js`, `verifyPassword` already supports both `scrypt$` hashes and legacy AES-256-GCM ciphertexts. Therefore, migrating user passwords to Scrypt will not break existing tests (such as line 2345 in `services-wiring.test.js` where `encryptUserPassword('bob-pass-123')` is used).

3. **Layout and Structure for Regression Tests**:
   - `services-wiring.test.js` is already 2,911 lines long. Inserting 16 new vulnerability tests into it would increase cognitive load, introduce merge risks, and make verification cumbersome.
   - Creating two dedicated regression test files:
     - `tests/auth-regression.test.js` (for AUTH-01 through AUTH-08)
     - `tests/worker-regression.test.js` (for WORKER-01 through WORKER-08)
   - Updating `package.json`'s `"test"` script to:
     `"test": "node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js && node tests/auth-regression.test.js && node tests/worker-regression.test.js"`
   - This keeps the existing 37 tests completely isolated and unchanged while guaranteeing that `npm test` runs all existing tests plus the 16 regression tests in a single command.

4. **Environment Isolation**:
   - Tests must not require `.env` or live database connections.
   - All tests must use dependency injection (`createApp({ store, registry, config, logger })`, `new WorkerRegistry({ store, ... })`) and ephemeral `http.createServer` on port 0.

---

## 3. Caveats

1. **PowerShell ExecutionPolicy on Windows**:
   - Running `npm test` directly from PowerShell may trigger `PSSecurityException` due to Windows ExecutionPolicy blocking `npm.ps1`.
   - The verified reliable execution command on this machine is:
     `cmd.exe /c "cd /d D:\manager && npm test"`
     or PowerShell:
     `Set-Location "D:\manager"; node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js`
2. **`postgres-real.test.js`**:
   - `tests/postgres-real.test.js` exists in `tests/` but is not executed by `npm test` because it requires a live PostgreSQL instance or `embedded-postgres`. It should remain excluded from the standard offline test suite.
3. **Database Adapter Compatibility**:
   - Several AUTH requirements (AUTH-02, AUTH-03, AUTH-04) explicitly require behavior to differentiate between "DB adapter enabled" (`store.adapter?.isEnabled() === true`) and "in-memory only" fallback. Tests must assert both paths.

---

## 4. Conclusion

1. **Test Infrastructure**:
   - The test runner is vanilla Node.js executing standalone script files with `node:assert`.
   - Baseline status: 37 test sections across `integration.test.js`, `services-wiring.test.js`, and `storage-sql.test.js` pass 100% (exit code 0).
2. **Recommended Test Suite Architecture for R3**:
   - Implement two new test files in `tests/`:
     1. `tests/auth-regression.test.js`: Contains tests for AUTH-01 through AUTH-08.
     2. `tests/worker-regression.test.js`: Contains tests for WORKER-01 through WORKER-08.
   - Update `package.json` `"scripts"`:
     ```json
     "test": "node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js && node tests/auth-regression.test.js && node tests/worker-regression.test.js"
     ```
   - Each regression test file will:
     - Use `node:assert` and `http.createServer(app).listen(0)`.
     - Use mock in-memory stores and adapters.
     - Structure test functions with descriptive names (`testAuth01ScryptPasswordHashing()`, `testWorker01PromiseTruthiness()`, etc.).
     - Output `✅ <Requirement>: <Description> verified.` on success.
     - Exit code 0 if all pass, exit code 1 on any assertion failure.
3. **Zero Regressions**:
   - Existing tests remain untouched and pass 100%.

---

## 5. Verification Method

### 5.1 Command to verify baseline tests
Run in terminal:
```powershell
cmd.exe /c "cd /d D:\manager && npm test"
```
Or directly with Node:
```powershell
Set-Location "D:\manager"
node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js
```

### 5.2 Verification of Individual Files
```powershell
Set-Location "D:\manager"
node tests/integration.test.js
node tests/services-wiring.test.js
node tests/storage-sql.test.js
```

### 5.3 Invalidation Conditions
- Any test exiting with code != 0.
- Any unhandled promise rejection or uncaught exception during test run.
- Any network request escaping to the public internet during test execution.
