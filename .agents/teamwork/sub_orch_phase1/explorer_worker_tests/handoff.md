# Investigation and Architecture Report: Worker Findings & Phase 1 Test Harness

**Explorer**: Explorer 3 (Worker & Tests)  
**Parent Agent ID**: `d69ef446-7699-4629-a2ce-6fa44ed3b128`  
**State Folder**: `D:\manager\.agents\teamwork\sub_orch_phase1\explorer_worker_tests\`  
**Target Scope**: WKR-02, WKR-03, Test Suite Assessment & Test Harness Architecture (AUTH-01..08, WORKER-01..08, WKR-01..03, Baseline 37 Tests).

---

## 1. Observation

### 1.1 WKR-03: Internal Diagnostics Leakage in `/health` Endpoint
- **File**: `D:\worker\src\http\routes.js`, lines 45–50
- **Verbatim Code**:
  ```javascript
  // D:\worker\src\http\routes.js:45-50
  router.get(['/', '/health'], (_req, res) => res.json({
    ok: true,
    service: 'kingmc-afk-worker',
    botCount: config.botCount,
    resource: fleet.health()
  }));
  ```
- **File**: `D:\worker\src\services\worker-fleet.js`, lines 66–74
- **Verbatim Code**:
  ```javascript
  // D:\worker\src\services\worker-fleet.js:66-74
  health() {
    const memory = process.memoryUsage();
    return {
      botCount: this.instances.size,
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      wispbyteKeepAlive: this.wispbyteKeepAlive.getStatus()
    };
  }
  ```
- **Observed Problem**:
  - The public unauthenticated endpoint `GET /` and `GET /health` leaks process memory internals (`rssMb`, `heapUsedMb`) and private infrastructure state (`wispbyteKeepAlive`).
  - Anyone on the public network or cloud environment can probe worker memory pressure, heap fragmentation, and third-party panel credentials/cookies status without authentication.

---

### 1.2 WKR-02: Secret Rotation Grace Period & Status Handling in BotWorker
- **File**: `D:\worker\src\config\env.js`, lines 23–50 & lines 118–122
  ```javascript
  // D:\worker\src\config\env.js:27
  const secret = required(slotValue('WORKER_SECRET'), `WORKER_SECRET${suffix}`);
  ```
- **File**: `D:\worker\src\http\auth.js`, lines 16–22
  ```javascript
  // D:\worker\src\http\auth.js:16-22
  function requireWorkerSecret(secret) {
    return (req, res, next) => {
      const supplied = req.get('x-worker-secret') || '';
      if (!safeEqual(supplied, secret)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      next();
    };
  }
  ```
- **File**: `D:\worker\src\transports\manager-reporter.js`, lines 41–53
  ```javascript
  // D:\worker\src\transports\manager-reporter.js:45
  headers: {
    'content-type': 'application/json',
    'x-worker-secret': this.secret,
    'x-manager-bot-id': String(this.workerId)
  }
  ```
- **File**: `D:\worker\src\transports\wispbyte-poller.js`, lines 32–35
  ```javascript
  // D:\worker\src\transports\wispbyte-poller.js:33
  headers: { 'content-type': 'application/json', 'x-worker-secret': this.config.secret }
  ```
- **Observed Problem**:
  - Worker configurations currently bind to a single immutable `secret` string per slot loaded from `process.env`.
  - When Manager rotates a bot's secret via `WorkerRegistry.prototype.rotateSecret(workerId)`:
    1. Manager's DB and RAM `secretCache` immediately transition to the new secret.
    2. Any subsequent poll request from `WispbytePoller` or heartbeat from `ManagerReporter` using the old secret receives HTTP 401 (`unauthorized_worker_secret`).
    3. Any command sent by Manager to a Render HTTP worker using the new secret is rejected with HTTP 401 by `requireWorkerSecret(instance.config.secret)`.
    4. Without dual-secret validation or a defined grace period window, a secret rotation immediately severs communication between Manager and BotWorker.

---

### 1.3 Test Suite Baseline & Existing Test Harness Status
- **`D:\manager\package.json`**:
  ```json
  "scripts": {
    "start": "node src/index.js",
    "test": "node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js",
    "commands:register": "node scripts/register-commands.js"
  }
  ```
- **Baseline Test Execution**:
  1. `node D:\manager\tests\integration.test.js`: **15/15 tests PASS (100%)** in 3.1s.
  2. `node D:\manager\tests\services-wiring.test.js`: **15/15 tests PASS (100%)** in 6.8s.
  3. `node D:\manager\tests\storage-sql.test.js`: **7/7 tests PASS (100%)** in 5.2s.
  - **Total Baseline**: **37/37 tests PASS 100%**.
- **Worker Baseline Execution**:
  - `node D:\worker\tests\integration.test.js`: **13/13 tests PASS (100%)**.

---

### 1.4 Assessment of `tests/auth-regression.test.js`
- **File**: `D:\manager\tests\auth-regression.test.js` (1,002 lines)
- **Status**: **Already present, fully implemented, and passes 100%**!
- **Verified Execution**: `node D:\manager\tests\auth-regression.test.js` completed with exit code 0:
  - `✅ AUTH-01`: Scrypt hashing, auto-migration & store preservation verified.
  - `✅ AUTH-02`: Fail-closed DB session persistence verified.
  - `✅ AUTH-03`: `/change-password` session revocation verified.
  - `✅ AUTH-04`: `/logout` DB revoke failure warning log verified.
  - `✅ AUTH-05`: Express trust proxy & clientIp resolution verified.
  - `✅ AUTH-06`: Bounded Map rate limiter verified (`MAX_ENTRIES = 5000`).
  - `✅ AUTH-07`: Explicit `keyRedeemed` and `keyError` response verified.
  - `✅ AUTH-08`: DB auth & RAM cache consistency verified.
  - `🎉 ALL AUTH-01 THROUGH AUTH-08 REGRESSION TESTS PASSED 100%!`

---

### 1.5 Assessment of `tests/worker-registry-audit.test.js`
- **Status**: **Does NOT exist yet**.
- **Scope required**: Must cover WORKER-01..08, WKR-01..03 as an independent gate test suite.
- **Requirements to Cover**:
  - WORKER-01: `await registry.verifyBotSecret` in `auth-api.js#L490` (fix Promise truthiness).
  - WORKER-02 / WKR-01: 60s TTL for `secretCache` and `invalidateWorkerSecret(workerId)` method.
  - WORKER-03: Restrict global secret to worker routes, with audit log `GLOBAL_BOT_SECRET_USED`.
  - WORKER-04: Atomic `nextBotNumber` fallback using `AsyncKeyLock` to prevent sequence duplicate collisions.
  - WORKER-05: Prevent calling `addEvent` when worker does not exist or is disabled.
  - WORKER-06: Prevent calling `rotateSecret` when worker is disabled.
  - WORKER-07: Non-silent RPC error handling in `SupabaseWorkerStore` (resetData, addEvent).
  - WORKER-08: Strict schema validation for Worker status payload (`validateWorkerStatus`).
  - WKR-02: Secret rotation grace period and status signaling for BotWorker.
  - WKR-03: Trim public `/health` endpoint to conceal internal heap diagnostics.

---

## 2. Logic Chain

### 2.1 WKR-03: Remediation Strategy for Public `/health` Trimming
1. **Exposure Mechanism**:
   - `router.get(['/', '/health'], ...)` directly returns `{ ok: true, service: 'kingmc-afk-worker', botCount: config.botCount, resource: fleet.health() }`.
   - `fleet.health()` evaluates `process.memoryUsage()` and exposes `rssMb`, `heapUsedMb`, and `wispbyteKeepAlive`.
2. **Surgical Solution**:
   - Modify `routes.js`: Public `GET /` and `GET /health` must return only:
     ```javascript
     router.get(['/', '/health'], (_req, res) => res.json({
       ok: true,
       service: 'kingmc-afk-worker',
       botCount: config.botCount
     }));
     ```
   - Provide a protected internal endpoint `GET /api/v1/diagnostics` (or `GET /api/v1/health`) protected by `x-worker-secret`:
     ```javascript
     router.get('/api/v1/diagnostics', (req, res) => {
       const secret = req.get('x-worker-secret') || '';
       const authed = config.bots.some((b) => safeEqual(secret, b.secret));
       if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });
       return res.json({
         ok: true,
         service: 'kingmc-afk-worker',
         botCount: config.botCount,
         resource: fleet.health()
       });
     });
     ```
   - This conceals internal metrics from unauthenticated probes while allowing monitoring tools with the worker secret to inspect resource consumption.

### 2.2 WKR-02: Remediation Strategy for Secret Rotation Grace Period
1. **Disconnection Cause**:
   - Secret rotation is a distributed operation across two independent processes (Manager and BotWorker).
   - In Manager, rotating a secret creates a new random string in the database and invalidates old cache entries.
   - If BotWorker is not restarted simultaneously or does not support dual-secret acceptance during the rotation window, requests in-flight or next poll requests instantly fail authentication.
2. **Dual-Sided Grace Mechanism**:
   - **BotWorker Side (`D:\worker\src\config\env.js` & `D:\worker\src\http\auth.js`)**:
     - Allow BotWorker slot configuration to accept optional `previousSecret` and `rotationGraceUntil`:
       ```javascript
       // In auth.js:
       function requireWorkerSecret(currentSecret, { previousSecret = null, graceUntil = 0 } = {}) {
         return (req, res, next) => {
           const supplied = req.get('x-worker-secret') || '';
           if (safeEqual(supplied, currentSecret)) return next();
           if (previousSecret && Date.now() < graceUntil && safeEqual(supplied, previousSecret)) {
             return next();
           }
           return res.status(401).json({ ok: false, error: 'unauthorized' });
         };
       }
       ```
     - In BotWorker slot config: support optional `WORKER_PREVIOUS_SECRET` or allow dynamic in-memory rotation via a lifecycle command `update_secret`.
   - **Manager Side (`D:\manager\src\services\worker-registry.js`)**:
     - In `WorkerRegistry`, when `rotateSecret(workerId)` is called:
       - Cache `{ secret: newSecret, previousSecret: oldSecret, graceUntil: Date.now() + GRACE_PERIOD_MS (e.g. 5 minutes), enabled: true }`.
       - In `authenticate(workerId, presentedSecret)`:
         - Accept `presentedSecret` if it matches `secret`.
         - If it matches `previousSecret` and `Date.now() < graceUntil`, log a warning `'WORKER_USING_PREVIOUS_SECRET'` and permit authentication during the grace period!
       - This guarantees zero-downtime secret rotations: BotWorker can gracefully update its credentials without being rejected immediately.

### 2.3 Phase 1 Gate Testing Architecture
1. **Existing Test Framework**:
   - Built on pure Node.js runtime (`node:assert`, `node:crypto`, `node:http`, `node:net`).
   - No external runner (Jest, Mocha, Vitest) is used or required.
   - All tests use dependency injection, in-memory mocks, and ephemeral HTTP servers listening on port 0.
2. **Two Complementary Audit Test Suites**:
   - `tests/auth-regression.test.js`: Confirmed 100% functional, covers AUTH-01..08, SEC-01..05, SEC-OBS-01.
   - `tests/worker-registry-audit.test.js`: To be created, covering WORKER-01..08, WKR-01..03.
3. **`package.json` Test Command Update**:
   ```json
   "test": "node tests/integration.test.js && node tests/services-wiring.test.js && node tests/storage-sql.test.js && node tests/auth-regression.test.js && node tests/worker-registry-audit.test.js"
   ```

---

## 3. Caveats

1. **Windows PowerShell Execution Policy**:
   - `npm test` via PowerShell can be blocked by `PSSecurityException`.
   - Recommended command: `cmd.exe /c "cd /d D:\manager && npm test"` or `node tests/<test>.js`.
2. **In-Memory Mocks vs. Live PostgreSQL**:
   - The test suite operates without a live Supabase or external database instance.
   - Database operations are verified through structural SQL schema tests (`tests/storage-sql.test.js`) and comprehensive mock adapters with realistic error simulations (PostgreSQL code `42501`, `23505`, `PGRST202`).
3. **Backward Compatibility for Worker Routes**:
   - WKR-03 removes `resource` from public `GET /health`. Any external uptime check (like Uptime Kuma or Render health checks) that asserts `ok: true` will continue to pass without disruption.

---

## 4. Conclusion & Concrete Fix Specifications

### 4.1 BotWorker Code Changes

#### Change 1: `D:\worker\src\http\routes.js` (WKR-03)
**Target**: Lines 45–50
**Replacement**:
```javascript
  router.get(['/', '/health'], (_req, res) => res.json({
    ok: true,
    service: 'kingmc-afk-worker',
    botCount: config.botCount
  }));

  router.get('/api/v1/diagnostics', (req, res) => {
    const secret = req.get('x-worker-secret') || '';
    const authed = config.bots.some((b) => safeEqual(secret, b.secret));
    if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });
    return res.json({
      ok: true,
      service: 'kingmc-afk-worker',
      botCount: config.botCount,
      resource: fleet.health()
    });
  });
```

#### Change 2: `D:\worker\src\http\auth.js` (WKR-02)
**Target**: Lines 16–22
**Replacement**:
```javascript
function requireWorkerSecret(secret, { previousSecret = null, graceUntil = 0 } = {}) {
  return (req, res, next) => {
    const supplied = req.get('x-worker-secret') || '';
    if (safeEqual(supplied, secret)) return next();
    if (previousSecret && Date.now() < graceUntil && safeEqual(supplied, previousSecret)) {
      return next();
    }
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  };
}
```

---

### 4.2 Complete Architecture Specification for `tests/worker-registry-audit.test.js`

The file `D:\manager\tests\worker-registry-audit.test.js` will be constructed as follows:

```javascript
'use strict';

const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const crypto = require('node:crypto');

const { createApp } = require('../src/http/app');
const { createAuthApi } = require('../src/http/routes/auth-api');
const { createWorkerApi } = require('../src/http/routes/worker-api');
const WorkerRegistry = require('../src/services/worker-registry');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const { encryptSecret, decryptSecret, safeDecryptText } = require('../src/utils/secrets');

// Test Suite Structure:
// 1. WORKER-01: Promise truthiness fix in POST /api/auth/verify-bot-access
// 2. WORKER-02 & WKR-01: 60s TTL for secretCache & invalidateWorkerSecret()
// 3. WORKER-03: Scoped global bot secret & audit logging
// 4. WORKER-04: Atomic nextBotNumber fallback with AsyncKeyLock
// 5. WORKER-05: addEvent existence and enabled validation
// 6. WORKER-06: rotateSecret disabled worker rejection
// 7. WORKER-07: Non-silent RPC error handling in SupabaseWorkerStore
// 8. WORKER-08: Worker status payload validation (validateWorkerStatus)
// 9. WKR-02: Secret rotation grace period verification
// 10. WKR-03: Worker /health trimming verification
```

#### Detailed Test Case Mapping:
| Test Case # | Target Finding | Mock Setup & Assertions |
|---|---|---|
| **Case 1** | **WORKER-01** | Mount `createAuthApi`. Make `POST /api/auth/verify-bot-access` with `x-bot-secret: wrong-secret`. Assert response status is 401 (`unauthorized_worker_secret`). Then call with valid secret; assert response status is 200. Confirms Promise is awaited. |
| **Case 2** | **WORKER-02 / WKR-01** | Create `WorkerRegistry`. Call `credential(workerId)` to populate cache. Advance `cachedAt` by 61,000ms. Assert cache has expired. Call `invalidateWorkerSecret(workerId)`; assert immediate cache eviction. Call `pruneStaleMemory()`; assert expired secret cache entries are pruned. |
| **Case 3** | **WORKER-03** | Send `x-bot-secret: global-secret` to `/api/manager/users` and `/api/user/profile`. Assert auth is NOT bypassed (returns 401). Send to `/api/worker/report`; assert access granted and `store.audit` contains `GLOBAL_BOT_SECRET_USED`. |
| **Case 4** | **WORKER-04** | Mock `SupabaseWorkerStore.client.rpc('manager_next_bot_number')` to fail. Execute 10 concurrent calls to `store.nextBotNumber()`. Assert all 10 return unique, consecutive integers without duplicates. |
| **Case 5** | **WORKER-05** | Call `registry.addEvent('non_existent', { type: 'crash' })` -> returns `null`, cache empty. Call on disabled worker (`enabled: false`) -> returns `null`, cache empty, no alert sent. |
| **Case 6** | **WORKER-06** | Call `registry.rotateSecret('disabled_bot')` -> rejects with error `/Worker .* is not registered or is disabled/`. Cache must not store new secret. |
| **Case 7** | **WORKER-07** | Mock RPC to return `{ error: { code: '42501', message: 'permission denied' } }`. Call `nextBotNumber`, `patchSettings`, `resetData`, `addEvent`. Assert error is thrown, NOT swallowed. |
| **Case 8** | **WORKER-08** | Call `validateWorkerStatus` with invalid coordinate (`x: 99999999`), non-object payload, and invalid state. Assert coordinates are clamped/rejected and sanitized. |
| **Case 9** | **WKR-02** | Test grace period: when secret rotated, old secret remains valid until `graceUntil` timestamp. Expired old secret returns 401. |
| **Case 10** | **WKR-03** | Query BotWorker `GET /health` -> assert `res.resource` is undefined. Query `GET /api/v1/diagnostics` with secret -> assert `res.resource` is present. |

---

## 5. Verification Method

### 5.1 Verification Commands
```powershell
# 1. Run full manager test suite (once worker-registry-audit is created)
cmd.exe /c "cd /d D:\manager && npm test"

# 2. Run auth regression test suite independently
node D:\manager\tests\auth-regression.test.js

# 3. Run worker registry audit test suite independently
node D:\manager\tests\worker-registry-audit.test.js

# 4. Run baseline suites independently
node D:\manager\tests\integration.test.js
node D:\manager\tests\services-wiring.test.js
node D:\manager\tests\storage-sql.test.js

# 5. Run worker integration suite
node D:\worker\tests\integration.test.js
```

### 5.2 Pass/Fail Invalidation Conditions
- **WORKER-01**: Must fail if `POST /api/auth/verify-bot-access` with an incorrect secret returns HTTP 200.
- **WORKER-02**: Must fail if `secretCache` entry persists beyond 60s or remains cached after `invalidateWorkerSecret(workerId)`.
- **WORKER-03**: Must fail if global secret allows bypassing session authentication on non-worker endpoints (`/api/manager/*`).
- **WORKER-04**: Must fail if 10 concurrent fallback allocations generate duplicate sequence IDs.
- **WORKER-05**: Must fail if `addEvent` logs events for disabled bots.
- **WORKER-06**: Must fail if `rotateSecret` succeeds for disabled bots.
- **WORKER-07**: Must fail if DB permission errors (`42501`) are silently swallowed.
- **WORKER-08**: Must fail if out-of-range coordinates or malformed status schemas pass validation without sanitization.
- **WKR-03**: Must fail if `GET /health` on BotWorker returns heap memory or KeepAlive status.
