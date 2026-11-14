# Handoff Report: Requirement R2 (Worker Registry, Authentication & Lifecycle) Survey

## 1. Observation

Direct code inspections of `D:\manager` revealed the exact locations, contracts, and failure mechanisms for all 8 items (WORKER-01 through WORKER-08):

### WORKER-01: Promise Truthiness in POST /api/auth/verify-bot-access
- **Location**: `src/http/routes/auth-api.js:483-505` and `src/services/worker-registry.js:529-531`
- **Code**:
  ```javascript
  // src/http/routes/auth-api.js:489-494
  const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
                   registry.verifyBotSecret(botId, incomingSecret);

  if (!isAuthed) {
    return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
  }
  ```
  ```javascript
  // src/services/worker-registry.js:529-531
  verifyBotSecret(workerId, secret) {
    return this.isBotSecretRequestForBot(secret, workerId);
  }
  // src/services/worker-registry.js:226-228
  async isBotSecretRequestForBot(presentedSecret, expectedBotId) {
    return this.authenticate(expectedBotId, presentedSecret);
  }
  ```
- **Findings**:
  - `registry.verifyBotSecret()` calls `isBotSecretRequestForBot()`, which is an `async` function returning a `Promise<boolean>`.
  - In `src/http/routes/auth-api.js:490`, `registry.verifyBotSecret(botId, incomingSecret)` is invoked without `await`.
  - In JavaScript, any object—including an unresolved Promise instance—is strictly truthy (`Boolean(Promise) === true`).
  - Consequently, `isAuthed` evaluates to a Promise object whenever `incomingSecret` does not match `globalSecret`.
  - `if (!isAuthed)` evaluates to `false`, allowing unauthenticated callers providing ANY invalid secret (or blank secret) to bypass authentication and receive `assignedUser` information for any `botId`.

### WORKER-02: Secret Cache Missing TTL and Invalidation Method
- **Location**: `src/services/worker-registry.js:51, 55-67, 166-184, 186-193, 213-224`
- **Code**:
  ```javascript
  // Line 51
  this.secretCache = new Map(); // botId -> decrypted secret
  
  // Lines 166-184
  async credential(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    const cached = this.secretCache.get(id);
    if (cached) {
      if (typeof cached === 'object') {
        if (cached.enabled === false) return null;
        return cached.secret;
      }
      return cached;
    }
    const record = await this.find(id);
    if (!record || record.enabled === false) {
      this.secretCache.delete(id);
      return null;
    }
    const secret = safeDecryptText(record.secretCiphertext, this.encryptionKey);
    if (secret) this.secretCache.set(id, { secret, enabled: Boolean(record.enabled) });
    return secret || null;
  }

  // Lines 213-224
  verifyBotSecretSync(workerId, secret) {
    if (!workerId || typeof secret !== 'string') return false;
    const id = String(workerId).trim().toLowerCase();
    const cached = this.secretCache.get(id);
    if (!cached) return false;
    const expected = typeof cached === 'object' ? cached.secret : cached;
    if (typeof cached === 'object' && cached.enabled === false) return false;
    if (!expected) return false;
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(secret, 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
  ```
- **Findings**:
  - `this.secretCache` stores `{ secret, enabled }` indefinitely with no timestamp or expiration.
  - `pruneStaleMemory()` (lines 55-67) prunes `summaryCache` (> 60s) and `botLogsCache` (> 100 entries), but ignores `secretCache`.
  - If another Manager instance rotates a secret (`rotateSecret`) or disables a worker (`setEnabled(id, false)`), or if the database is modified directly, this instance never purges or updates the secret, causing cross-instance inconsistency and stale authentication.
  - There is no public `invalidate(workerId)` method on `WorkerRegistry` to programmatically evict cached secrets.

### WORKER-03: Scope Limitation and Audit Logging for Global Bot Secret
- **Location**:
  - `src/http/routes/auth-api.js:487-494`
  - `src/http/routes/worker-api.js:89-95`
  - `src/http/app.js:44-54, 119, 201`
- **Code**:
  ```javascript
  // src/http/app.js:44-54
  function isBotSecretRequest(req) {
    const incoming = String(req?.headers?.['x-bot-secret'] || req?.headers?.['x-worker-secret'] || '').trim();
    if (!incoming) return false;
    const globalSecret = String(config.botSecretKey || '').trim();
    if (globalSecret && timingSafeStringEquals(incoming, globalSecret)) return true;
    const botId = String(req?.headers?.['x-manager-bot-id'] || req?.body?.workerId || req?.body?.botId || req?.query?.botId || req?.params?.workerId || '').trim();
    if (botId && typeof registry.verifyBotSecretSync === 'function') {
      return registry.verifyBotSecretSync(botId, incoming);
    }
    return false;
  }

  // Lines 119 & 201 in src/http/app.js
  if (isBotSecretRequest(req)) return next(); // Bypasses CSRF & bypasses session authentication
  ```
- **Findings**:
  - `isBotSecretRequest(req)` treats any request with `x-bot-secret: <globalSecret>` as a valid bot request across ALL HTTP methods and paths.
  - This allows the global bot secret to bypass CSRF middleware (line 119) and skip session authentication (line 201) even on non-worker endpoints.
  - In `auth-api.js:verify-bot-access` and `worker-api.js:report`, whenever `globalSecret` matches, access is granted silently with NO audit log, NO warning log, and NO tracking of client IP or target bot.

### WORKER-04: Non-Atomic nextBotNumber() Fallback
- **Location**: `src/storage/supabase-worker-store.js:67-77`
- **Code**:
  ```javascript
  async nextBotNumber() {
    try {
      const { data, error } = await this.client.rpc('manager_next_bot_number');
      if (!error && data !== null && data !== undefined) return Number(data);
    } catch (_) {}

    // Fallback: tính max bot_number + 1
    const workers = await this.list();
    const numbers = workers.map((w) => Number(w.botNumber || 0)).filter((n) => Number.isInteger(n) && n > 0);
    return (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  }
  ```
- **Findings**:
  - When the RPC fails or is unavailable, the fallback reads all workers from the database, computes `Math.max(...numbers) + 1`, and returns it.
  - If two or more concurrent bot creations run in fallback mode:
    - Both read `this.list()` before either has written the new worker.
    - Both calculate the exact same number `N + 1`.
    - Both attempt to insert `bot_number = N + 1`, resulting in duplicate key constraint failure (`23505`) or conflicting bot assignments.
  - There is no mutual exclusion (`AsyncKeyLock`) or monotonic in-flight sequence tracker.

### WORKER-05: addEvent() Missing Existence and Enabled Check
- **Location**: `src/services/worker-registry.js:328-358` and `src/http/routes/worker-api.js:28-44`
- **Code**:
  ```javascript
  // src/services/worker-registry.js:328-358
  async addEvent(workerId, event) {
    const id = String(workerId || '').trim().toLowerCase();
    const rawMsg = event?.message || event?.reason || '';
    const cleanMsg = extractChatMessage(rawMsg);
    const safeEvent = {
      type: String(event?.type || 'worker_event').slice(0, 48),
      message: cleanMsg.replace(/[\r\n\t]+/g, ' ').slice(0, 300),
      occurredAt: event?.occurredAt ? new Date(event.occurredAt) : new Date()
    };
    if (Number.isNaN(safeEvent.occurredAt.getTime())) safeEvent.occurredAt = new Date();

    // Lưu vào RAM buffer (tối đa 100 entries)
    const logs = this.botLogsCache.get(id) || [];
    logs.push(safeEvent);
    if (logs.length > MAX_LOGS_PER_BOT) logs.shift();
    this.botLogsCache.set(id, logs);

    await this.store.addEvent(id, safeEvent);

    if (this.adminNotifier && ['crash', 'process_error', 'system_error'].includes(safeEvent.type)) {
      void this.adminNotifier.sendAlert({ ... });
    }

    return safeEvent;
  }
  ```
- **Findings**:
  - `addEvent()` has NO check for whether `workerId` exists in the registry or whether `record.enabled !== false`.
  - In contrast, `updateStatus(id)` checks:
    `const existing = await this.find(id); if (!existing || existing.enabled === false) return null;`
  - In `addEvent()`, any deleted or disabled worker (or arbitrary string) can append logs to RAM (`this.botLogsCache`), write to database `manager_workers.events`, and trigger Admin Discord error alerts.

### WORKER-06: rotateSecret() Missing Enabled Check
- **Location**: `src/services/worker-registry.js:186-193`
- **Code**:
  ```javascript
  async rotateSecret(workerId) {
    const record = await this.find(workerId);
    if (!record) throw new Error(`Worker ${workerId} is not registered.`);
    const secret = generateWorkerSecret();
    await this.store.update(record.workerId, { secretCiphertext: encryptSecret(secret, this.encryptionKey) });
    this.secretCache.set(record.workerId, { secret, enabled: Boolean(record.enabled) });
    return secret;
  }
  ```
- **Findings**:
  - `rotateSecret()` only validates `if (!record) throw new Error(...)`. It completely ignores `record.enabled`.
  - All other mutating operations (`resetData:197`, `updateCredentials:406`, `updateSettings:428`, `bootstrap:374`) enforce:
    `if (!record || !record.enabled) throw new Error('Worker is not registered or is disabled.');`
  - Calling `rotateSecret` on a disabled bot updates its secret in the database and caches `{ secret, enabled: false }` instead of failing with a disabled error.

### WORKER-07: Silent RPC Fallbacks in supabase-worker-store.js
- **Location**: `src/storage/supabase-worker-store.js:67-77, 93-108, 110-123, 131-139`
- **Code**:
  ```javascript
  // 1. nextBotNumber (lines 67-71)
  try {
    const { data, error } = await this.client.rpc('manager_next_bot_number');
    if (!error && data !== null && data !== undefined) return Number(data);
  } catch (_) {}

  // 2. patchSettings (lines 93-100)
  try {
    const { data, error } = await this.client.rpc('manager_patch_worker_settings', { ... });
    if (!error) return data;
  } catch (_) {}

  // 3. resetData (lines 110-115)
  try {
    const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
    if (!error && data === true) return;
  } catch (_) {}

  // 4. addEvent (lines 131-135)
  try {
    const { error } = await this.client.rpc('manager_append_worker_event', { ... });
    if (!error) return;
  } catch (_) {}
  ```
- **Findings**:
  - All four RPC calls catch and swallow any error with empty `catch (_) {}` or `if (!error) ... else fallback`.
  - Genuine database errors (PostgreSQL permission denied `42501`, connection drop, syntax errors, deadlock) are silently swallowed, causing unlogged degradations to non-atomic fallbacks.
  - Unlike `src/storage/supabase-command-store.js` which defines `isRpcUnavailableError(error)` and throws on real errors, `SupabaseWorkerStore` completely hides failures.

### WORKER-08: Standardized Worker Status Payload Validation
- **Location**: `src/services/worker-registry.js:230-288` and `src/http/routes/worker-api.js:20-25, 46-52, 60-65, 83-104`
- **Findings**:
  - In `worker-api.js`:
    - `POST /heartbeat`: `req.body?.status || {}` passed directly.
    - `POST /poll`: `req.body?.status || {}` passed directly.
    - `POST /result`: `status` passed directly without validation.
    - `POST /report`: `const status = req.body?.status || req.body || {};` accepts raw payload even if not an object.
  - In `WorkerRegistry.prototype.updateStatus`:
    - Ad-hoc sanitation is embedded directly inside the method rather than in an isolated, reusable validator.
    - Missing checks for non-object payloads (e.g. `typeof status !== 'object' || Array.isArray(status)`).
    - Coordinate validation checks `Number.isFinite(Number(status.position[axis]))` but does not bound check within Minecraft coordinate limits (-30,000,000 to +30,000,000).
    - Status `state` is truncated to 40 characters without normalization against recognized worker state tokens (`active`, `idle`, `connecting`, `reconnecting`, `error`, `stopped`, `offline`, `unknown`, etc.).

---

## 2. Logic Chain

1. **WORKER-01 Chain**:
   - `registry.verifyBotSecret(botId, secret)` is an asynchronous method (`isBotSecretRequestForBot` -> `authenticate`).
   - In `auth-api.js:490`, calling it without `await` yields a Promise.
   - JavaScript truthiness rules evaluate `Boolean(Promise)` to `true`.
   - `if (!isAuthed)` evaluates to `false`.
   - Any secret matches, completely breaking bot access authorization and allowing unauthorized callers to enumerate bot owner assignments.
   - Therefore, `await` is required, and boolean coerciveness must be enforced (`Boolean(await registry.verifyBotSecret(botId, incomingSecret))`).

2. **WORKER-02 Chain**:
   - `WorkerRegistry.prototype.secretCache` is a simple `Map`.
   - In `credential(id)`, secrets are cached indefinitely without TTL.
   - In multi-instance deployments (or if an admin rotates secrets), instances holding stale cache entries will continue validating old secrets or failing new secrets for up to infinite time.
   - A 60-second TTL (`60000ms`) and explicit `invalidate(workerId)` method provides cross-instance eventual consistency within 60s and immediate on-demand invalidation.

3. **WORKER-03 Chain**:
   - `config.botSecretKey` is a shared global secret intended for internal service-to-service communication.
   - Because `isBotSecretRequest(req)` in `app.js` checks `timingSafeStringEquals(incoming, globalSecret)` without validating `req.path`, sending `x-bot-secret` allows an attacker possessing the global secret to bypass CSRF and session auth on any arbitrary API route.
   - Restricting global secret usage strictly to worker routes (`/api/worker/*`, `/api/v1/workers/*`, `/api/auth/verify-bot-access`) limits blast radius.
   - Adding structured `logger.warn` and persistent `store.addAudit` creates an immutable audit trail of whenever the master key is invoked.

4. **WORKER-04 Chain**:
   - `manager_next_bot_number` plpgsql function uses a sequence `manager_bot_number_seq` with `EXIT WHEN NOT EXISTS`.
   - When the RPC is absent or fails, fallback calculates `Math.max(...numbers) + 1` from `this.list()`.
   - Concurrent registrations executing this fallback simultaneously read the same database snapshot and compute the same next number.
   - Wrapping the fallback with `AsyncKeyLock` and tracking `lastAllocatedBotNumber` ensures atomic monotonic sequence generation even under high concurrent load.

5. **WORKER-05 & WORKER-06 Chain**:
   - A worker lifecycle requires strict existence and enabled checks before state/event mutation.
   - `WorkerRegistry` already enforces `if (!record || !record.enabled)` in `resetData`, `updateCredentials`, `updateSettings`, and `updateStatus`.
   - `addEvent` omitted both checks, allowing disabled or phantom bots to write logs and fire Discord alerts.
   - `rotateSecret` checked `if (!record)` but omitted `if (record.enabled === false)`, permitting secret rotations on disabled bots.
   - Adding consistent checks `if (!record || record.enabled === false)` restores domain model integrity.

6. **WORKER-07 Chain**:
   - `try { ... } catch (_) {}` masks all database errors.
   - If Postgres rejects an RPC due to permissions (`42501`) or data corruption, falling back to direct table update silently bypasses the RPC's transactional guarantees.
   - Discriminating between unavailable RPCs (`PGRST202`, `42883`) versus operational DB errors (which must be thrown) ensures system observability and fail-closed security.

7. **WORKER-08 Chain**:
   - Workers report health and status telemetry via multiple endpoints (`/heartbeat`, `/poll`, `/result`, `/report`).
   - Extracting a centralized `sanitizeWorkerStatus(rawStatus)` / `validateWorkerStatus(rawStatus)` function ensures identical schema validation across all ingestion points, clamps out-of-range metrics, validates coordinates, and prevents malformed JSON from reaching database storage.

---

## 3. Caveats

1. **Live Supabase Environment**: As documented in `agent-notes/04-test-verification-and-gaps.md`, tests run against in-memory mock adapters. Staging/production Supabase instances may or may not have all RPCs installed. RPC fallback logic must remain functional when RPCs are genuinely unavailable (`isRpcUnavailableError`), while failing fast on real DB errors.
2. **Backward Compatibility with Existing Workers**: Existing worker instances currently poll `/api/v1/workers/:workerId/poll` and report to `/api/worker/report`. Validation in WORKER-08 must be lenient enough to accept valid existing worker payloads while rejecting malicious or invalid schemas.
3. **Execution Policy on Windows**: PowerShell execution policy disables running `npm.ps1`. All verification commands must be invoked via `cmd /c "npm test"` or `node tests/<test>.js`.

---

## 4. Conclusion & Implementation Blueprint

### Summary Matrix

| Finding | Target File | Line(s) | Fix Summary |
|---|---|---|---|
| **WORKER-01** | `src/http/routes/auth-api.js`<br>`src/services/worker-registry.js` | `489-494`<br>`529-531` | Add `await` to `registry.verifyBotSecret(botId, incomingSecret)`, coerce to boolean. Ensure `verifyBotSecret` in `WorkerRegistry` is async and returns boolean. |
| **WORKER-02** | `src/services/worker-registry.js` | `51, 166-184, 213-224` | Add 60s TTL (`SECRET_CACHE_TTL_MS = 60000`) to `this.secretCache`. Store `{ secret, enabled, cachedAt }`. Check TTL in `credential()` and `verifyBotSecretSync()`. Add `invalidate(workerId)` method. Prune in `pruneStaleMemory()`. |
| **WORKER-03** | `src/http/routes/auth-api.js`<br>`src/http/routes/worker-api.js`<br>`src/http/app.js` | `487-494`<br>`89-95`<br>`44-54, 119, 201` | Scope global secret in `isBotSecretRequest` only to worker routes (`/api/worker/*`, `/api/v1/workers/*`, `/api/auth/verify-bot-access`). Add `logger.warn` and `store.addAudit` when global secret authenticates. |
| **WORKER-04** | `src/storage/supabase-worker-store.js` | `67-77` | Wrap `nextBotNumber` fallback in `AsyncKeyLock` (`botNumberLock`). Maintain `this.lastAllocatedBotNumber` to guarantee sequential uniqueness under concurrent execution. |
| **WORKER-05** | `src/services/worker-registry.js`<br>`src/http/routes/worker-api.js` | `328-358`<br>`28-44` | In `addEvent()`: check `const existing = await this.find(id); if (!existing || existing.enabled === false) return null;`. In `worker-api.js`, return 404 `worker_not_found_or_disabled` if `addEvent` returns null. |
| **WORKER-06** | `src/services/worker-registry.js` | `186-193` | In `rotateSecret(workerId)`: check `if (!record || record.enabled === false) throw new Error('Worker is not registered or is disabled.');`. Delete secret cache if disabled. |
| **WORKER-07** | `src/storage/supabase-worker-store.js` | `67-77, 93-108, 110-123, 131-139` | Implement `isRpcUnavailableError(error)`. In `nextBotNumber`, `patchSettings`, `resetData`, `addEvent`: re-throw unexpected errors (`if (error && !isRpcUnavailableError(error)) throw error;`). Log `console.warn` when falling back. |
| **WORKER-08** | `src/services/worker-registry.js`<br>`src/http/routes/worker-api.js` | `230-288`<br>`20-25, 46-52, 60-65, 83-104` | Export canonical `validateWorkerStatus(status)` function with type checks, coordinate bounds (-30M to +30M), safe metrics clamping, and string length limits. Integrate into `updateStatus()` and `worker-api.js`. |

---

## 5. Verification Method

### 1. Verification Commands
Run in `D:\manager`:
```powershell
# Run baseline tests
cd D:\manager
cmd /c "npm test"

# Run individual test suites
node tests/integration.test.js
node tests/services-wiring.test.js
node tests/storage-sql.test.js
```

### 2. Specific Test Invalidation Conditions
- **WORKER-01**: A test calling `POST /api/auth/verify-bot-access` with an invalid `x-bot-secret` header MUST return HTTP 401 `{ ok: false, error: 'unauthorized_worker_secret' }`. If it returns 200 OK, the vulnerability persists.
- **WORKER-02**: A test caching a secret, advancing time by 61 seconds (or invoking `registry.invalidate(botId)`), and checking `verifyBotSecretSync` MUST return `false` until refreshed.
- **WORKER-03**: A test making a request to `/api/manager/users` or `/api/user/profile` with `x-bot-secret: <globalSecret>` MUST NOT bypass authentication. An audit entry with action `'GLOBAL_BOT_SECRET_USED'` MUST be recorded when used on valid worker endpoints.
- **WORKER-04**: Running 10 concurrent `nextBotNumber()` calls in fallback mode (with RPC mocked to unavailable) MUST return 10 distinct, consecutive integers with zero collisions.
- **WORKER-05**: Calling `registry.addEvent('disabled_bot', { type: 'crash' })` on a disabled worker MUST return `null`, must not append to `botLogsCache`, and must not dispatch alerts.
- **WORKER-06**: Calling `registry.rotateSecret('disabled_bot')` on a disabled worker MUST reject with `Worker disabled_bot is not registered or is disabled.`
- **WORKER-07**: Mocking an RPC call to return `{ error: { code: '42501', message: 'permission denied' } }` MUST throw the error and NOT silently fall back to table update.
- **WORKER-08**: Passing non-object, NaN, or out-of-range coordinates to `validateWorkerStatus` must sanitize or reject according to schema.
