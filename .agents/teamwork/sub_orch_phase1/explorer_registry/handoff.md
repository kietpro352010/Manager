# Handoff Report: Worker Registry & Storage Foundation (WORKER-01 through WORKER-08)

**Agent**: Explorer 2 (Worker Registry & Storage Foundation)  
**State Folder**: `D:\manager\.agents\teamwork\sub_orch_phase1\explorer_registry\`  
**Milestone**: Phase 1 — Security, Authentication, & Worker Registry Foundation  
**Target Repositories**: `D:\manager`  
**Date**: 2026-11-14  

---

## 1. Observation

Direct code inspections of `D:\manager` identified the exact source locations, call hierarchies, verbatim code blocks, and failure mechanisms for all 8 audit findings (WORKER-01 through WORKER-08):

### WORKER-01: Promise Truthiness Bypass in POST /api/auth/verify-bot-access
- **Primary Location**: `D:\manager\src\http\routes\auth-api.js`, lines 582–604
- **Secondary Location**: `D:\manager\src\services\worker-registry.js`, lines 226–228, 529–531
- **Verbatim Code (`src/http/routes/auth-api.js:582-604`)**:
  ```javascript
  // 6. VERIFY BOT ACCESS (Internal/Worker query)
  router.post('/verify-bot-access', async (req, res) => {
    try {
      const { botId } = req.body || {};
      const incomingSecret = req.headers['x-bot-secret'] || '';
      const globalSecret = config.botSecretKey || '';

      const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
                       registry.verifyBotSecret(botId, incomingSecret);

      if (!isAuthed) {
        return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
      }

      const assigned = await store.assignedUser(String(botId));
      return res.json({
        ok: true,
        botId,
        assignedUser: assigned || null
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
  ```
- **Verbatim Code (`src/services/worker-registry.js:529-531, 226-228`)**:
  ```javascript
  verifyBotSecret(workerId, secret) {
    return this.isBotSecretRequestForBot(secret, workerId);
  }

  async isBotSecretRequestForBot(presentedSecret, expectedBotId) {
    return this.authenticate(expectedBotId, presentedSecret);
  }
  ```
- **Direct Finding**:
  - `registry.verifyBotSecret` invokes `isBotSecretRequestForBot`, which delegates to `async authenticate(...)`. It returns a `Promise<boolean>`.
  - In `auth-api.js:589`, `registry.verifyBotSecret(botId, incomingSecret)` is invoked without `await`.
  - In JavaScript, any object—including an unfulfilled or rejected Promise instance—is strictly truthy (`Boolean(new Promise(...)) === true`).
  - When `incomingSecret` is invalid, `isAuthed` evaluates to the unresolved Promise object.
  - The guard `if (!isAuthed)` evaluates to `false`.
  - Result: Any caller sending `POST /api/auth/verify-bot-access` with an arbitrary or blank secret receives `HTTP 200 OK` and can enumerate bot owner assignments (`assignedUser`).

---

### WORKER-02 / WKR-01: Secret Cache Missing TTL and Invalidation Method
- **Primary Location**: `D:\manager\src\services\worker-registry.js`, lines 51, 55–67, 166–184, 186–193, 213–224
- **Verbatim Code (`src/services/worker-registry.js`)**:
  ```javascript
  // Line 51: Constructor
  this.secretCache = new Map(); // botId -> decrypted secret

  // Lines 166-184: credential()
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

  // Lines 213-224: verifyBotSecretSync()
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
- **Direct Finding**:
  - `this.secretCache` stores `{ secret, enabled }` with zero timestamp tracking and infinite TTL.
  - `pruneStaleMemory()` (lines 55–67) evicts entries from `summaryCache` (> 60s) and caps `botLogsCache` (100 entries), but leaves `secretCache` completely untouched.
  - If a worker secret is updated in the database or by another cluster node, the local process retains the stale secret permanently.
  - There is no programmatic invalidation method (e.g. `invalidateWorkerSecret(workerId)` or `invalidate(workerId)`).

---

### WORKER-03: Scope Limitation and Audit Logging for Global Bot Secret
- **Primary Locations**:
  - `D:\manager\src\http\app.js`, lines 45–54, 120, 202
  - `D:\manager\src\http\routes\worker-api.js`, lines 83–100
  - `D:\manager\src\http\routes\auth-api.js`, lines 582–604
- **Verbatim Code (`src/http/app.js:45-54, 120, 202`)**:
  ```javascript
  // Helper to check worker bot secret
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

  // Line 120: CSRF Middleware
  if (isBotSecretRequest(req)) return next();

  // Line 202: Session Auth Middleware
  if (isBotSecretRequest(req)) return next();
  ```
- **Verbatim Code (`src/http/routes/worker-api.js:89-95`)**:
  ```javascript
  const globalSecret = config.botSecretKey || '';
  const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
                   (await registry.authenticate(workerId, incomingSecret));

  if (!isAuthed) {
    return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
  }
  ```
- **Direct Finding**:
  - `isBotSecretRequest(req)` does not restrict path. Any request sent with `x-bot-secret: <globalSecret>` to arbitrary user or admin endpoints (e.g. `/api/manager/users`, `/api/user/profile`) bypasses CSRF checks and session authentication.
  - In `worker-api.js:report` and `auth-api.js:verify-bot-access`, authenticating with `globalSecret` occurs completely silently with no `GLOBAL_BOT_SECRET_USED` warning log or audit trail.

---

### WORKER-04: Non-Atomic `nextBotNumber()` Fallback
- **Primary Location**: `D:\manager\src\storage\supabase-worker-store.js`, lines 67–77
- **Verbatim Code**:
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
- **Direct Finding**:
  - When the RPC fails or is unavailable, the fallback calls `await this.list()` and calculates `Math.max(...numbers) + 1`.
  - Under concurrent worker creation calls in fallback mode, two simultaneous calls read the same list, calculate the same number `N + 1`, and attempt to insert identical `bot_number`, resulting in unique constraint violation (`23505`) or collision.
  - In test suites like `tests/postgres-real.test.js:904-905`, consecutive calls without intermediate inserts are expected to produce incremented numbers (`1`, then `2`).

---

### WORKER-05: `addEvent()` Missing Worker Existence and Enabled Verification
- **Primary Location**: `D:\manager\src\services\worker-registry.js`, lines 328–358
- **Secondary Location**: `D:\manager\src\http\routes\worker-api.js`, lines 28–44
- **Verbatim Code (`src/services/worker-registry.js:328-358`)**:
  ```javascript
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
- **Direct Finding**:
  - `addEvent()` has zero validation for whether `workerId` exists in the store or whether `record.enabled !== false`.
  - By contrast, `updateStatus(id)` enforces:
    `const existing = await this.find(id); if (!existing || existing.enabled === false) return null;`
  - A disabled or non-existent worker can append events to RAM, mutate database records, and spam Discord administrator alerts.

---

### WORKER-06: `rotateSecret()` Missing Worker Enabled Verification
- **Primary Location**: `D:\manager\src\services\worker-registry.js`, lines 186–193
- **Verbatim Code**:
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
- **Direct Finding**:
  - `rotateSecret()` only validates `if (!record)`. It completely omits `if (!record.enabled)`.
  - All other mutation methods in `WorkerRegistry` (`resetData:197`, `updateCredentials:406`, `updateSettings:428`, `bootstrap:374`) strictly enforce:
    `if (!record || !record.enabled) throw new Error(\`Worker \${workerId} is not registered or is disabled.\`);`
  - A disabled worker can have its secret rotated and cached in RAM as `{ secret, enabled: false }`.

---

### WORKER-07: Silent RPC Fallbacks in `supabase-worker-store.js`
- **Primary Location**: `D:\manager\src\storage\supabase-worker-store.js`, lines 67–77, 93–108, 110–123, 131–139
- **Verbatim Code**:
  ```javascript
  // resetData: lines 110-123
  async resetData(workerId) {
    try {
      const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
      if (!error && data === true) return;
    } catch (_) {}

    // Fallback: reset settings về rỗng
    await this.update(workerId, {
      settings: {},
      status: { state: 'offline', online: false },
      events: [],
      lastEvent: null
    });
  }

  // addEvent: lines 131-139
  async addEvent(workerId, event) {
    try {
      const { error } = await this.client.rpc('manager_append_worker_event', { p_worker_id: workerId, p_event: event });
      if (!error) return;
    } catch (_) {}

    // Fallback: cập nhật last_event trên worker row
    await this.update(workerId, { lastEvent: event });
  }
  ```
- **Direct Finding**:
  - All RPC invocations swallow errors using empty `catch (_) {}`.
  - Legitimate database errors (e.g. Postgres permission denied `42501`, connection drops, deadlocks, RLS denials) are hidden.
  - In `resetData`, if the RPC returns `data === false` (worker does not exist or was not modified), it silently falls back to `this.update()`.
  - Unlike `src/storage/supabase-command-store.js` which classifies errors using `isRpcUnavailableError(error)` and throws on real database errors, `SupabaseWorkerStore` silently masks failures.

---

### WORKER-08: Ad-hoc Status Validation in `WorkerRegistry.prototype.updateStatus`
- **Primary Location**: `D:\manager\src\services\worker-registry.js`, lines 230–288
- **Secondary Location**: `D:\manager\src\http\routes\worker-api.js`, lines 20–25, 46–52, 60–65, 83–104
- **Verbatim Code (`src/services/worker-registry.js:254-288`)**:
  ```javascript
  const safeStatus = {
    state: String(status?.state || 'unknown').slice(0, 40),
    online: Boolean(status?.online ?? status?.connected),
    username: String(status?.username || '').slice(0, 64),
    uptimeSeconds: Number.isFinite(Number(status?.uptimeSeconds)) ? Math.max(0, Number(status.uptimeSeconds)) : null,
    pingMs: asNumber(status?.pingMs, 600000),
    managerLatencyMs: asNumber(status?.managerLatencyMs, 600000),
    transport: String(status?.transport || '').slice(0, 24),
    reconnectAttempts: Number.isFinite(Number(status?.reconnectAttempts)) ? Math.max(0, Number(status.reconnectAttempts)) : 0,
    reconnectCount: Number.isFinite(Number(status?.reconnectCount)) ? Math.max(0, Number(status.reconnectCount)) : 0,
    afkMode: 'still',
    proxyEnabled: Boolean(status?.proxyEnabled),
    lastError: String(status?.lastError || '').slice(0, 240),
    lastKickReason: String(status?.lastKickReason || '').slice(0, 240),
    restriction: String(status?.restriction || '').slice(0, 40) || null,
    maintenanceWindow: Boolean(status?.maintenanceWindow),
    maintenanceTimeZone: String(status?.maintenanceTimeZone || '').slice(0, 40),
    maintenanceStart: String(status?.maintenanceStart || '').slice(0, 5),
    maintenanceEnd: String(status?.maintenanceEnd || '').slice(0, 5),
    tps: typeof status?.tps === 'number' && Number.isFinite(status.tps) ? Math.max(0, Math.min(20, status.tps)) : null,
    cpuPercent: asNumber(status?.cpuPercent, 100),
    rssMb: asNumber(status?.rssMb, 65536),
    heapUsedMb: asNumber(status?.heapUsedMb, 65536),
    health: asNumber(status?.health, 20),
    food: asNumber(status?.food, 20),
    totemCount: asNumber(status?.totemCount, 1000),
    goldenAppleCount: asNumber(status?.goldenAppleCount, 1000),
    position: status?.position && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(status.position[axis])))
      ? { x: Number(status.position.x), y: Number(status.position.y), z: Number(status.position.z) }
      : null,
    dimension: String(status?.dimension || '').slice(0, 40),
    lastStateAt: status?.lastStateAt ? new Date(status.lastStateAt) : null,
    updatedAt: new Date(),
    source
  };
  ```
- **Direct Finding**:
  - `status.state` accepts any arbitrary string up to 40 characters without enum validation.
  - Coordinates in `position` are checked only for `Number.isFinite`, without bounding checks against Minecraft world dimensions (`[-30000000, 30000000]` for X/Z, `[-2048, 2048]` for Y).
  - Validation is embedded directly inside `updateStatus`, so other endpoints receiving worker payloads (`/report`, `/poll`, `/result`) cannot reuse the validation logic uniformly.

---

## 2. Logic Chain

1. **WORKER-01 Reasoning**:
   - `WorkerRegistry.prototype.verifyBotSecret` delegates to `isBotSecretRequestForBot` -> `authenticate`, returning a `Promise<boolean>`.
   - In `src/http/routes/auth-api.js:589`, the call is unawaited: `const isAuthed = ... || registry.verifyBotSecret(botId, incomingSecret);`.
   - JavaScript evaluates `Boolean(Promise)` to `true`. Thus `!isAuthed` is always `false`.
   - An unauthenticated client sending an arbitrary string receives `200 OK` and can inspect `assignedUser`.
   - Therefore, adding `await` and explicitly coercing to boolean (`Boolean(await registry.verifyBotSecret(botId, incomingSecret))`) is mandatory.

2. **WORKER-02 Reasoning**:
   - `this.secretCache` maintains secrets indefinitely.
   - If secrets are rotated by an external process or updated in Supabase, the in-memory entry never expires.
   - Adding a 60-second TTL (`SECRET_CACHE_TTL_MS = 60000`) guarantees eventual consistency across cluster nodes.
   - Adding `invalidateWorkerSecret(workerId)` and alias `invalidate(workerId)` allows immediate explicit eviction when secrets are modified.

3. **WORKER-03 Reasoning**:
   - `config.botSecretKey` is intended as a service-to-service key for worker reporting and bootstrap.
   - In `src/http/app.js:120, 202`, `isBotSecretRequest(req)` allowed any HTTP request carrying `x-bot-secret: <globalSecret>` to bypass CSRF protection and session authentication for all endpoints (including admin APIs).
   - Scoping `globalSecret` strictly to worker endpoints (`/api/worker/*`, `/api/v1/workers/*`, `/api/auth/verify-bot-access`) confines its reach to its intended purpose.
   - Emitting `logger.warn('GLOBAL_BOT_SECRET_USED')` and recording an audit record via `store.addAudit` provides forensic accountability.

4. **WORKER-04 Reasoning**:
   - When the `manager_next_bot_number` sequence RPC is unavailable, the fallback reads all rows from `manager_workers` and calculates `Math.max(...numbers) + 1`.
   - Concurrent calls in fallback mode read the identical list before either has written a new row, producing duplicate numbers.
   - Using an in-memory `AsyncKeyLock` (`this.sequenceLock`) and maintaining `this.lastAllocatedBotNumber` guarantees monotonic, conflict-free sequence allocation.

5. **WORKER-05 Reasoning**:
   - `WorkerRegistry.prototype.addEvent` records events into `this.botLogsCache` (RAM), `this.store.addEvent` (DB), and dispatches Discord alerts.
   - Because it omitted checking whether the worker exists or is enabled, invalid or disabled bots could write logs and trigger alerts.
   - Checking `const existing = await this.find(id); if (!existing || existing.enabled === false) return null;` guarantees domain integrity.
   - Returning HTTP 404 in `worker-api.js` on null result signals client failure appropriately.

6. **WORKER-06 Reasoning**:
   - `rotateSecret` is a state-mutating operation.
   - All other mutating methods (`resetData`, `updateCredentials`, `updateSettings`) enforce `if (!record || !record.enabled)`.
   - Allowing `rotateSecret` on a disabled bot updates database credentials and sets `secretCache`, violating the invariant that disabled bots are inactive.
   - Adding `if (!record || !record.enabled) throw new Error(\`Worker \${workerId} is not registered or is disabled.\`);` enforces domain consistency.

7. **WORKER-07 Reasoning**:
   - Empty `catch (_) {}` blocks in `SupabaseWorkerStore` swallow critical database errors, including permission denials (`42501`) and syntax errors.
   - When an RPC exists but fails due to constraints or authorization, silently falling back to direct table updates circumvents database triggers and transactional consistency.
   - Implementing `isRpcUnavailableError(error)` (checking for PostgREST codes `PGRST202` and `42883`) allows fallback ONLY when the RPC function is genuinely missing from the database schema, while re-throwing genuine operational errors.
   - In `resetData`, checking `data === true` ensures the RPC actually modified a row.

8. **WORKER-08 Reasoning**:
   - Ingested worker status payloads must be sanitized to prevent invalid states, out-of-bounds coordinates, and non-numeric metrics from corrupting the database.
   - Centralizing validation in an exported `validateWorkerStatus(rawStatus, source)` function provides a single source of truth across `/heartbeat`, `/poll`, `/result`, and `/report`.
   - Validating state against the allowed enum (`VALID_WORKER_STATES`) and bounding coordinates within Minecraft world boundaries (`[-30000000, 30000000]`) guarantees database safety.

---

## 3. Caveats

1. **PowerShell Execution Policy on Windows**:
   - Windows PowerShell ExecutionPolicy may block `npm.ps1`. All verification and testing commands must be executed via `cmd.exe /c "cd /d D:\manager && npm test"` or directly via Node.js: `node tests/<test-file>.js`.
2. **Offline vs Real Database**:
   - Standard unit and regression tests run in offline mock mode using in-memory stores and adapters. Tests must verify that `isRpcUnavailableError` correctly allows fallback when RPCs are missing (offline mode) while re-throwing genuine Postgres errors (e.g. `42501`).
3. **Existing Worker Backward Compatibility**:
   - Existing bots send status payloads with coordinates such as `{ x: 120.5, y: 64, z: -30.2 }`. Validation must accept finite floating point coordinates within bounds while supporting integer coordinates for telemetry formatting.
4. **Coordination with Auth Phase 1 Team**:
   - `auth-api.js` and `app.js` are touched by both Auth (AUTH-01..08) and Worker Registry (WORKER-01, WORKER-03). Merging must ensure that both sets of changes are preserved cleanly without overwriting.

---

## 4. Conclusion & Surgical Fix Specifications

The following concrete code diff proposals specify the exact changes to implement across all target files:

### Specification 1: WORKER-01 & WORKER-03 in `src/http/routes/auth-api.js`
**Target File**: `D:\manager\src\http\routes\auth-api.js` (lines 582–604)

```diff
   // 6. VERIFY BOT ACCESS (Internal/Worker query)
   router.post('/verify-bot-access', async (req, res) => {
     try {
       const { botId } = req.body || {};
       const incomingSecret = req.headers['x-bot-secret'] || '';
       const globalSecret = config.botSecretKey || '';
 
-      const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
-                       registry.verifyBotSecret(botId, incomingSecret);
+      const isGlobalAuthed = Boolean(globalSecret && timingSafeStringEquals(incomingSecret, globalSecret));
+      let isAuthed = isGlobalAuthed;
+
+      if (isGlobalAuthed) {
+        logger?.warn('GLOBAL_BOT_SECRET_USED', {
+          action: 'verify-bot-access',
+          botId,
+          ip: req.ip
+        });
+        if (typeof store.addAudit === 'function') {
+          await store.addAudit({
+            action: 'GLOBAL_BOT_SECRET_USED',
+            targetId: String(botId || 'unknown'),
+            actorId: 'system:global_secret',
+            details: { ip: req.ip, endpoint: '/verify-bot-access' }
+          }).catch(() => null);
+        }
+      } else {
+        isAuthed = Boolean(await registry.verifyBotSecret(botId, incomingSecret));
+      }
 
       if (!isAuthed) {
         return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
       }
 
       const assigned = await store.assignedUser(String(botId));
```

---

### Specification 2: WORKER-01, WORKER-02, WORKER-05, WORKER-06, WORKER-08 in `src/services/worker-registry.js`
**Target File**: `D:\manager\src\services\worker-registry.js`

```javascript
// Add Constants at top of file
const SECRET_CACHE_TTL_MS = 60000; // 60s TTL for secret cache (WORKER-02)

const VALID_WORKER_STATES = new Set([
  'online', 'offline', 'error', 'maintenance', 'stopped',
  'connecting', 'authenticating', 'entering', 'kicked', 'afk',
  'waking', 'registered', 'idle', 'running', 'banned',
  'ip_limited', 'disconnected', 'unknown'
]);

// Canonical Worker Status Validator (WORKER-08)
function validateWorkerStatus(rawStatus, source = 'worker') {
  const status = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus) ? rawStatus : {};

  const asNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : null;
  };

  const asInteger = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const num = asNumber(value, min, max);
    return num !== null ? Math.round(num) : null;
  };

  const rawState = String(status.state || '').trim().toLowerCase();
  const state = VALID_WORKER_STATES.has(rawState) ? rawState : 'unknown';

  let position = null;
  if (status.position && typeof status.position === 'object' && !Array.isArray(status.position)) {
    const x = asNumber(status.position.x, -30000000, 30000000);
    const y = asNumber(status.position.y, -2048, 2048);
    const z = asNumber(status.position.z, -30000000, 30000000);
    if (x !== null && y !== null && z !== null) {
      position = { x, y, z };
    }
  }

  return {
    state,
    online: Boolean(status.online ?? status.connected),
    username: String(status.username || '').slice(0, 64),
    uptimeSeconds: asInteger(status.uptimeSeconds, 0),
    pingMs: asNumber(status.pingMs, 0, 600000),
    managerLatencyMs: asNumber(status.managerLatencyMs, 0, 600000),
    transport: String(status.transport || '').slice(0, 24),
    reconnectAttempts: asInteger(status.reconnectAttempts, 0, 1000) || 0,
    reconnectCount: asInteger(status.reconnectCount, 0, 10000) || 0,
    afkMode: 'still',
    proxyEnabled: Boolean(status.proxyEnabled),
    lastError: String(status.lastError || '').slice(0, 240),
    lastKickReason: String(status.lastKickReason || '').slice(0, 240),
    restriction: String(status.restriction || '').slice(0, 40) || null,
    maintenanceWindow: Boolean(status.maintenanceWindow),
    maintenanceTimeZone: String(status.maintenanceTimeZone || '').slice(0, 40),
    maintenanceStart: String(status.maintenanceStart || '').slice(0, 5),
    maintenanceEnd: String(status.maintenanceEnd || '').slice(0, 5),
    tps: typeof status.tps === 'number' && Number.isFinite(status.tps) ? Math.max(0, Math.min(20, status.tps)) : null,
    cpuPercent: asNumber(status.cpuPercent, 0, 100),
    rssMb: asNumber(status.rssMb, 0, 65536),
    heapUsedMb: asNumber(status.heapUsedMb, 0, 65536),
    health: asNumber(status.health, 0, 20),
    food: asNumber(status.food, 0, 20),
    totemCount: asInteger(status.totemCount, 0, 1000),
    goldenAppleCount: asInteger(status.goldenAppleCount, 0, 1000),
    position,
    dimension: String(status.dimension || '').slice(0, 40),
    lastStateAt: status.lastStateAt && !Number.isNaN(new Date(status.lastStateAt).getTime())
      ? new Date(status.lastStateAt)
      : null,
    updatedAt: new Date(),
    source
  };
}
```

```javascript
// Method Updates inside WorkerRegistry class:

  // WORKER-02: Prune stale secrets
  pruneStaleMemory() {
    const now = Date.now();
    for (const [botId, entry] of this.summaryCache.entries()) {
      if (now - entry.timestamp > 60000) {
        this.summaryCache.delete(botId);
      }
    }
    for (const [botId, logs] of this.botLogsCache.entries()) {
      if (Array.isArray(logs) && logs.length > MAX_LOGS_PER_BOT) {
        this.botLogsCache.set(botId, logs.slice(-MAX_LOGS_PER_BOT));
      }
    }
    for (const [botId, entry] of this.secretCache.entries()) {
      if (entry?.cachedAt && now - entry.cachedAt > SECRET_CACHE_TTL_MS) {
        this.secretCache.delete(botId);
      }
    }
  }

  // WORKER-02: TTL check on cached secrets
  async credential(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    const cached = this.secretCache.get(id);
    if (cached) {
      const isExpired = cached.cachedAt && (Date.now() - cached.cachedAt > SECRET_CACHE_TTL_MS);
      if (isExpired) {
        this.secretCache.delete(id);
      } else {
        if (typeof cached === 'object') {
          if (cached.enabled === false) return null;
          return cached.secret;
        }
        return cached;
      }
    }
    const record = await this.find(id);
    if (!record || record.enabled === false) {
      this.secretCache.delete(id);
      return null;
    }
    const secret = safeDecryptText(record.secretCiphertext, this.encryptionKey);
    if (secret) {
      this.secretCache.set(id, {
        secret,
        enabled: Boolean(record.enabled),
        cachedAt: Date.now()
      });
    }
    return secret || null;
  }

  // WORKER-06: Reject rotateSecret on disabled worker & update cache timestamp
  async rotateSecret(workerId) {
    const record = await this.find(workerId);
    if (!record || !record.enabled) {
      throw new Error(`Worker ${workerId} is not registered or is disabled.`);
    }
    const secret = generateWorkerSecret();
    await this.store.update(record.workerId, { secretCiphertext: encryptSecret(secret, this.encryptionKey) });
    this.secretCache.set(record.workerId, {
      secret,
      enabled: Boolean(record.enabled),
      cachedAt: Date.now()
    });
    return secret;
  }

  // WORKER-02: Programmatic Invalidation
  invalidateWorkerSecret(workerId) {
    if (!workerId) {
      this.secretCache.clear();
      return true;
    }
    const id = String(workerId).trim().toLowerCase();
    return this.secretCache.delete(id);
  }

  invalidate(workerId) {
    return this.invalidateWorkerSecret(workerId);
  }

  // WORKER-02: verifyBotSecretSync with TTL validation
  verifyBotSecretSync(workerId, secret) {
    if (!workerId || typeof secret !== 'string') return false;
    const id = String(workerId).trim().toLowerCase();
    const cached = this.secretCache.get(id);
    if (!cached) return false;
    const isExpired = cached.cachedAt && (Date.now() - cached.cachedAt > SECRET_CACHE_TTL_MS);
    if (isExpired) {
      this.secretCache.delete(id);
      return false;
    }
    const expected = typeof cached === 'object' ? cached.secret : cached;
    if (typeof cached === 'object' && cached.enabled === false) return false;
    if (!expected) return false;
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(secret, 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  // WORKER-08: Use canonical validateWorkerStatus in updateStatus
  async updateStatus(workerId, status, source) {
    const id = String(workerId || '').trim().toLowerCase();
    return this.statusLock.run(id, async () => {
      const existing = await this.find(id);
      if (!existing || existing.enabled === false) {
        this.secretCache.delete(id);
        return null;
      }

      const currentSeq = (this.summaryRequestSeq.get(id) || 0) + 1;
      this.summaryRequestSeq.set(id, currentSeq);

      const lastApplied = this.summaryLastAppliedSeq.get(id) || 0;
      if (currentSeq <= lastApplied) {
        return this.publicView(existing);
      }

      const safeStatus = validateWorkerStatus(status, source);

      if (safeStatus.lastStateAt && existing.status?.lastStateAt) {
        if (safeStatus.lastStateAt.getTime() < new Date(existing.status.lastStateAt).getTime()) {
          return this.publicView(existing);
        }
      }

      const updated = await this.store.update(id, { status: safeStatus, lastHeartbeat: new Date() });
      this.summaryLastAppliedSeq.set(id, currentSeq);
      this.summaryCache.set(id, { timestamp: Date.now(), data: safeStatus });

      if (this.adminNotifier && updated && safeStatus.state === 'error') {
        const errText = safeStatus.lastError || '';
        const isGameEvent = /kick|banned|ban\b|ip_limited|quitting|lobby/i.test(errText) || /kick|banned|ban\b|ip_limited/i.test(safeStatus.lastKickReason || '');
        if (!isGameEvent && errText) {
          void this.adminNotifier.sendAlert({
            source: 'Worker System',
            event: 'worker_system_error',
            message: `Tiến trình Worker **${updated.name || id}** (#${updated.botNumber}) gặp lỗi: ${errText}`,
            details: { workerId: id, botNumber: updated.botNumber, botName: updated.name, provider: updated.provider, error: errText },
            level: 'error'
          });
        }
      }

      return updated;
    });
  }

  // WORKER-05: Prevent addEvent on non-existent or disabled worker
  async addEvent(workerId, event) {
    const id = String(workerId || '').trim().toLowerCase();
    const existing = await this.find(id);
    if (!existing || existing.enabled === false) {
      return null;
    }

    const rawMsg = event?.message || event?.reason || '';
    const cleanMsg = extractChatMessage(rawMsg);
    const safeEvent = {
      type: String(event?.type || 'worker_event').slice(0, 48),
      message: cleanMsg.replace(/[\r\n\t]+/g, ' ').slice(0, 300),
      occurredAt: event?.occurredAt ? new Date(event.occurredAt) : new Date()
    };
    if (Number.isNaN(safeEvent.occurredAt.getTime())) safeEvent.occurredAt = new Date();

    const logs = this.botLogsCache.get(id) || [];
    logs.push(safeEvent);
    if (logs.length > MAX_LOGS_PER_BOT) logs.shift();
    this.botLogsCache.set(id, logs);

    await this.store.addEvent(id, safeEvent);

    if (this.adminNotifier && ['crash', 'process_error', 'system_error'].includes(safeEvent.type)) {
      void this.adminNotifier.sendAlert({
        source: 'Worker System',
        event: `worker_${safeEvent.type}`,
        message: `Tiến trình Worker \`${id}\` gặp lỗi: ${safeEvent.message}`,
        details: { workerId: id, eventType: safeEvent.type },
        level: 'error'
      });
    }

    return safeEvent;
  }

  // WORKER-01: Async verifyBotSecret returning boolean
  async verifyBotSecret(workerId, secret) {
    return Boolean(await this.isBotSecretRequestForBot(secret, workerId));
  }
```

---

### Specification 3: WORKER-03 in `src/http/app.js`
**Target File**: `D:\manager\src\http\app.js` (lines 45–54)

```diff
   // Helper to check worker bot secret
   function isBotSecretRequest(req) {
     const incoming = String(req?.headers?.['x-bot-secret'] || req?.headers?.['x-worker-secret'] || '').trim();
     if (!incoming) return false;
+
+    const path = String(req?.path || '');
+    const isWorkerRoute = path.startsWith('/api/worker') ||
+                          path.startsWith('/api/v1/workers') ||
+                          path === '/api/auth/verify-bot-access';
+
     const globalSecret = String(config.botSecretKey || '').trim();
-    if (globalSecret && timingSafeStringEquals(incoming, globalSecret)) return true;
+    if (globalSecret && timingSafeStringEquals(incoming, globalSecret)) {
+      if (!isWorkerRoute) {
+        logger?.warn('GLOBAL_BOT_SECRET_BLOCKED', { path, ip: req.ip });
+        return false;
+      }
+      logger?.warn('GLOBAL_BOT_SECRET_USED', { path, ip: req.ip });
+      return true;
+    }
+
     const botId = String(req?.headers?.['x-manager-bot-id'] || req?.body?.workerId || req?.body?.botId || req?.query?.botId || req?.params?.workerId || '').trim();
     if (botId && typeof registry.verifyBotSecretSync === 'function') {
       return registry.verifyBotSecretSync(botId, incoming);
     }
     return false;
   }
```

---

### Specification 4: WORKER-03, WORKER-05, WORKER-08 in `src/http/routes/worker-api.js`
**Target File**: `D:\manager\src\http\routes\worker-api.js`

```diff
   // Line 28: POST /events (WORKER-05)
   router.post('/events', auth, async (req, res, next) => {
     try {
       const event = req.body || {};
-      await registry.addEvent(req.workerId, event);
+      const result = await registry.addEvent(req.workerId, event);
+      if (!result) {
+        return res.status(404).json({ ok: false, error: 'worker_not_found_or_disabled' });
+      }
 
       // Check alerts
       if (adminNotifier) {
         if (event.type === 'bot_death') {
           adminNotifier.notifyBotDeath(req.workerId, event.reason || 'Không rõ nguyên nhân');
         } else if (event.type === 'low_totem') {
           adminNotifier.notifyLowTotem(req.workerId, event.count || 0);
         }
       }
 
       return res.json({ ok: true });
     } catch (error) { return next(error); }
   });
```

```diff
   // Line 83: POST /report (WORKER-03 & WORKER-08)
   router.post('/report', async (req, res) => {
     try {
       const incomingSecret = req.headers['x-bot-secret'] || req.headers['x-worker-secret'] || '';
       const workerId = String(req.body?.workerId || req.body?.id || req.headers['x-manager-bot-id'] || '').trim().toLowerCase();
       if (!workerId) return res.status(400).json({ ok: false, error: 'missing_worker_id' });
 
       const globalSecret = config.botSecretKey || '';
-      const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
-                       (await registry.authenticate(workerId, incomingSecret));
+      const isGlobal = Boolean(globalSecret && timingSafeStringEquals(incomingSecret, globalSecret));
+      let isAuthed = isGlobal;
+      if (isGlobal) {
+        logger?.warn('GLOBAL_BOT_SECRET_USED', {
+          action: 'worker-report',
+          workerId,
+          ip: req.ip
+        });
+        if (typeof workerStore?.addAudit === 'function') {
+          await workerStore.addAudit({
+            action: 'GLOBAL_BOT_SECRET_USED',
+            targetId: workerId,
+            actorId: 'system:global_secret',
+            details: { ip: req.ip, endpoint: '/report' }
+          }).catch(() => null);
+        }
+      } else {
+        isAuthed = await registry.authenticate(workerId, incomingSecret);
+      }
 
       if (!isAuthed) {
         return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
       }
 
       const existingWorker = await registry.find(workerId);
       if (!existingWorker || existingWorker.enabled === false) {
         return res.status(404).json({ ok: false, error: 'worker_not_found_or_disabled' });
       }
 
       const status = req.body?.status || req.body || {};
       await registry.updateStatus(workerId, status, 'worker-report');
```

---

### Specification 5: WORKER-04 & WORKER-07 in `src/storage/supabase-worker-store.js`
**Target File**: `D:\manager\src\storage\supabase-worker-store.js`

```javascript
// Add import and helper at top of file
const AsyncKeyLock = require('../services/async-key-lock');

function isRpcUnavailableError(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  const code = String(error.code || '').toUpperCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('function does not exist') ||
    msg.includes('schema cache')
  );
}

// In SupabaseWorkerStore constructor:
class SupabaseWorkerStore {
  constructor(client) {
    this.client = client;
    this.adapter = client.adapter || null;
    this.sequenceLock = new AsyncKeyLock(); // WORKER-04
    this.lastAllocatedBotNumber = 0;       // WORKER-04
  }

  // WORKER-04: Atomic nextBotNumber() with serialized monotonic fallback
  async nextBotNumber() {
    return this.sequenceLock.run('next_bot_number', async () => {
      let rpcError = null;
      try {
        const { data, error } = await this.client.rpc('manager_next_bot_number');
        if (!error && data !== null && data !== undefined) {
          const num = Number(data);
          if (Number.isInteger(num) && num > 0) {
            this.lastAllocatedBotNumber = Math.max(this.lastAllocatedBotNumber, num);
            return num;
          }
        }
        rpcError = error;
      } catch (err) {
        rpcError = err;
      }

      if (rpcError && !isRpcUnavailableError(rpcError)) {
        throw rpcError;
      }

      // Fallback: tính max bot_number + 1 có khóa đồng thời
      const workers = await this.list();
      const numbers = workers.map((w) => Number(w.botNumber || 0)).filter((n) => Number.isInteger(n) && n > 0);
      const dbMax = numbers.length > 0 ? Math.max(...numbers) : 0;
      const nextNum = Math.max(dbMax, this.lastAllocatedBotNumber) + 1;
      this.lastAllocatedBotNumber = nextNum;
      return nextNum;
    });
  }

  // WORKER-07: Non-silent patchSettings
  async patchSettings(workerId, patch) {
    let rpcError = null;
    try {
      const { data, error } = await this.client.rpc('manager_patch_worker_settings', {
        p_worker_id: workerId,
        p_patch: patch
      });
      if (!error) return data;
      rpcError = error;
    } catch (err) {
      rpcError = err;
    }

    if (rpcError && !isRpcUnavailableError(rpcError)) {
      throw rpcError;
    }

    const current = await this.get(workerId);
    if (!current) throw new Error(`Worker ${workerId} không tồn tại.`);
    const merged = { ...(current.settings || {}), ...patch };
    await this.update(workerId, { settings: merged });
    return merged;
  }

  // WORKER-07: Non-silent resetData with data === true check
  async resetData(workerId) {
    let rpcError = null;
    try {
      const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
      if (!error) {
        if (data === true) return;
        throw new Error(`Worker ${workerId} could not be reset or does not exist.`);
      }
      rpcError = error;
    } catch (err) {
      if (err.message && err.message.includes('could not be reset')) {
        throw err;
      }
      rpcError = err;
    }

    if (rpcError && !isRpcUnavailableError(rpcError)) {
      throw rpcError;
    }

    const worker = await this.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} is not registered.`);
    await this.update(workerId, {
      settings: {},
      status: { state: 'offline', online: false },
      events: [],
      lastEvent: null
    });
  }

  // WORKER-07: Non-silent addEvent
  async addEvent(workerId, event) {
    let rpcError = null;
    try {
      const { error } = await this.client.rpc('manager_append_worker_event', { p_worker_id: workerId, p_event: event });
      if (!error) return;
      rpcError = error;
    } catch (err) {
      rpcError = err;
    }

    if (rpcError && !isRpcUnavailableError(rpcError)) {
      throw rpcError;
    }

    await this.update(workerId, { lastEvent: event });
  }
```

---

## 5. Verification Method

### 1. Test Suite Architecture: `tests/worker-registry-audit.test.js`
To fulfill Gate 1 Acceptance Criteria (`tests/worker-registry-audit.test.js` passes 100%), the test suite must implement 8 isolated tests:

| Test Function | Target Item | Assertion Criteria |
|---|---|---|
| `testWorker01PromiseTruthinessBypass()` | WORKER-01 | Calling `POST /api/auth/verify-bot-access` with an incorrect `x-bot-secret` header MUST return HTTP 401 `{ ok: false, error: 'unauthorized_worker_secret' }`. Supplying the correct secret returns 200. |
| `testWorker02SecretCacheTTLAndInvalidation()` | WORKER-02 | Verifies that a cached secret is valid for <= 60s, expires after 61s (or clock shift), and calling `registry.invalidateWorkerSecret(botId)` purges the cache immediately. |
| `testWorker03ScopedGlobalBotSecret()` | WORKER-03 | Verifies that sending `x-bot-secret: <globalSecret>` to a non-worker route (e.g. `/api/manager/audit-logs`) is blocked and logs `GLOBAL_BOT_SECRET_BLOCKED`. Sending to `/report` succeeds and logs `GLOBAL_BOT_SECRET_USED`. |
| `testWorker04AtomicBotNumberGeneration()` | WORKER-04 | In fallback mode (mocked RPC unavailable), executing 10 concurrent `nextBotNumber()` calls produces 10 unique, strictly incrementing integers (`[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`) with zero collisions. |
| `testWorker05AddEventDisabledWorker()` | WORKER-05 | Calling `registry.addEvent()` on a disabled worker returns `null`, does not append to `botLogsCache`, and does not trigger `adminNotifier.sendAlert()`. Calling `POST /api/worker/events` on disabled worker returns HTTP 404. |
| `testWorker06RotateSecretDisabledWorker()` | WORKER-06 | Calling `registry.rotateSecret()` on a disabled worker rejects with `Error: Worker <id> is not registered or is disabled.` |
| `testWorker07NonSilentRpcErrorHandling()` | WORKER-07 | Mocking an RPC with `{ code: '42501', message: 'permission denied' }` in `resetData` or `addEvent` throws the error directly and does NOT execute table update fallback. |
| `testWorker08StrictStatusSchemaValidation()` | WORKER-08 | Passing invalid states (e.g. `'HACKED'`, `<script>`) normalizes to `'unknown'`. Coordinates outside `[-30000000, 30000000]` or NaN are discarded. Metrics are clamped to valid ranges. |

### 2. Execution Commands
```powershell
# 1. Run baseline test suite (must remain 100% green)
cmd.exe /c "cd /d D:\manager && npm test"

# 2. Run the dedicated worker registry audit suite
cmd.exe /c "cd /d D:\manager && node tests/worker-registry-audit.test.js"
```

### 3. Invalidation Conditions (Regression Gating)
- If `POST /api/auth/verify-bot-access` returns 200 on an invalid bot secret: **INVALIDATED** (WORKER-01 regression).
- If `secretCache` returns a rotated or invalidated secret without DB refresh: **INVALIDATED** (WORKER-02 regression).
- If `x-bot-secret: <globalSecret>` allows bypassing CSRF on `/api/manager/*`: **INVALIDATED** (WORKER-03 regression).
- If concurrent `nextBotNumber()` returns any duplicate integer: **INVALIDATED** (WORKER-04 regression).
- If `addEvent` logs an event for a disabled worker: **INVALIDATED** (WORKER-05 regression).
- If `rotateSecret` succeeds on a worker with `enabled: false`: **INVALIDATED** (WORKER-06 regression).
- If `resetData` catches and suppresses a Postgres `42501` error: **INVALIDATED** (WORKER-07 regression).
- If `validateWorkerStatus` accepts an arbitrary unrecognized state or out-of-bounds coordinates: **INVALIDATED** (WORKER-08 regression).
