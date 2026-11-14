# Phase 2 Investigation & Surgical Remediation Plan: BotWorker Lifecycle, Transports & HTTP API

## Executive Summary
This document provides the complete root-cause analysis, exact line numbers, and surgical patch specifications for all 11 BotWorker findings in Phase 2 across `D:\worker`:
- **INT-10-01**: Pending-result retry queue with exponential backoff (`src/transports/wispbyte-poller.js`)
- **INT-10-02**: Event reporting queue with retry and ACK verification (`src/services/worker-fleet.js` & `src/transports/manager-reporter.js`)
- **SEC-10-03**: Enforce HTTPS and strict whitelist `https://wispbyte.com` for keepalive cookies (`src/services/wispbyte-keepalive.js`)
- **HTTP-13-01**: Standardize Express JSON parser error mapping (400, 413, 500) (`src/http/app.js`)
- **HTTP-13-02**: Standardize Command endpoint error mapping (400, 409, 429, 503, 504) (`src/http/routes.js`)
- **RT-14-01**: Retain execution lock on task timeout until task terminates; propagate signal to entire session (`src/services/worker-runtime.js`)
- **RT-14-02**: Propagate AbortSignal and cleanup mechanism to all 5 lifecycle actions (`start`, `stop`, `restart`, `reconnect`, `reset`) (`src/services/worker-runtime.js` & `src/game/minecraft-session.js`)
- **RT-14-03**: Deduct command rate limit quota only when command is admitted into execution queue (`src/services/worker-runtime.js`)
- **FLEET-15-01**: Coordinate auto-start via `WorkerRuntime.execute('start')` instead of `session.start()` (`src/services/worker-fleet.js`)
- **FLEET-15-02**: Fleet state machine (`STOPPED`, `STARTING`, `RUNNING`, `STOPPING`) with concurrency locking to prevent timer leaks (`src/services/worker-fleet.js`)
- **FLEET-15-03**: Cancellable delay with AbortController for Poller `stop()` to terminate backoff immediately (`src/transports/wispbyte-poller.js`)

---

## Detailed Findings & Surgical Patch Specifications

### 1. INT-10-01: Pending-Result Retry Queue with Exponential Backoff
- **File**: `D:\worker\src\transports\wispbyte-poller.js` (lines 57-69)
- **Current Observation**:
  ```javascript
  if (response.command?.action) {
    const command = response.command;
    let result;
    if (command.expiresAt && Date.parse(command.expiresAt) <= Date.now()) {
      result = { ok: false, error: 'command_expired' };
    } else {
      try { result = await this.runtime.execute(command.action, command.payload || {}); }
      catch (error) { result = { ok: false, error: error.message }; }
    }
    await this.request(`/api/v1/workers/${encodeURIComponent(this.config.workerId)}/result`, {
      commandId: command.commandId, action: command.action, result, completedAt: new Date().toISOString()
    });
    await sleep(500);
  }
  ```
- **Bug Mechanism**: If sending `/result` fails (e.g., transient network blip, 502/503 from Manager), an exception is thrown, caught by `catch (error)` in `run()`, and the command result is lost forever. The Manager command waiter will time out even though the worker actually completed the task.
- **Surgical Solution**:
  1. Add `this.pendingResults = [];` and `this.maxPendingResults = 100;` in `constructor`.
  2. Implement `enqueueResult({ commandId, action, result, completedAt })` with bounded buffer (FIFO drop oldest if >= 100).
  3. Implement `flushPendingResults()`: iterates through `pendingResults`; sends pending results whose `Date.now() >= nextRetryAt`; on success removes from queue; on failure increments `item.attempts += 1`, calculates exponential backoff `Math.min(60000, 1000 * 2^attempts)`, and updates `item.nextRetryAt`.
  4. At the beginning of each poll loop cycle (and immediately after command execution), invoke `await this.flushPendingResults()`.

---

### 2. INT-10-02: Event Reporting Queue with Retry and ACK Verification
- **File**: `D:\worker\src\services\worker-fleet.js` (line ~52) & `D:\worker\src\transports\manager-reporter.js` (lines 17-19, 103-114)
- **Current Observation**:
  In `worker-fleet.js#L52`:
  ```javascript
  session.on('event', (event) => {
    void reporter.sendEvent(event).catch((error) => logger.warn('manager_event_delivery_failed', {
      workerId: botConfig.workerId, error: error.message
    }));
  });
  ```
  In `manager-reporter.js#L103`:
  ```javascript
  async sendEvent(event) {
    const sanitized = { ...event, message: ..., reason: ..., occurredAt: new Date().toISOString() };
    const path = `/api/v1/workers/${encodeURIComponent(this.workerId)}/events`;
    return this.post(path, sanitized);
  }
  ```
- **Bug Mechanism**: `reporter.sendEvent` calls `this.post` which only checks `response.ok`. It does not parse or verify `{ ok: true }` ACK from Manager, and if the network request fails, the event is immediately dropped with a warn log. Critical bot events (e.g. `bot_death`, `low_totem`, `kicked`) are lost.
- **Surgical Solution**:
  In `manager-reporter.js`:
  1. Initialize `this.eventQueue = [];` and `this.eventFlushTimer = null;` (already declared as stubs).
  2. In `enqueueEvent(event)`: sanitize fields, redact passwords, cap queue at 100 items, push `{ event: sanitized, attempts: 0, nextRetryAt: 0 }`, and schedule flush.
  3. In `flushEventQueue()`:
     Send each event where `Date.now() >= nextRetryAt`.
     Verify ACK:
     ```javascript
     const body = await response.json().catch(() => ({}));
     if (!response.ok || !body.ok) throw new Error(body.error || `manager_ack_failed_${response.status}`);
     ```
     On failure, apply exponential backoff `Math.min(60000, 1000 * 2^Math.min(attempts, 5))` and reschedule flush.
  4. In `worker-fleet.js#L52`: update listener to `session.on('event', (event) => reporter.enqueueEvent(event));`.
  5. In `worker-fleet.js#stop()`: invoke `instance.reporter.stop()` to clear timers.

---

### 3. SEC-10-03: Enforce HTTPS & Whitelist `https://wispbyte.com` for Keepalive Cookies
- **File**: `D:\worker\src\services\wispbyte-keepalive.js` (lines ~29-41)
- **Current Observation**:
  ```javascript
  constructor(config = {}, logger = console, { fetchImpl = global.fetch } = {}) {
    this.cookie = String(config.cookie || '').trim();
    this.panelUrl = String(config.panelUrl || DEFAULT_PANEL_URL).trim();
  ...
  async ping() {
    ...
    const res = await this.fetch(this.panelUrl, {
      method: 'GET',
      headers: { 'Cookie': this.cookie, ... }
  ```
- **Bug Mechanism**: If `WISPBYTE_PANEL_URL` is set to plaintext `http://` or an arbitrary domain (e.g., SSRF or attacker URL), sensitive session cookies are transmitted unencrypted or to untrusted third parties.
- **Surgical Solution**:
  1. Add strict URL validator:
     ```javascript
     function isAllowedPanelUrl(urlStr) {
       try {
         const parsed = new URL(urlStr);
         if (parsed.protocol !== 'https:') return false;
         return parsed.hostname === 'wispbyte.com' || parsed.hostname.endsWith('.wispbyte.com');
       } catch {
         return false;
       }
     }
     ```
  2. In `constructor`: if `this.enabled && !isAllowedPanelUrl(this.panelUrl)`, disable keepalive, set `lastStatus = 'error'`, and log security warning.
  3. In `ping()`: immediately return `{ success: false, status: 'error', message: 'Insecure or unwhitelisted panel URL' }` if `!isAllowedPanelUrl(this.panelUrl)`.

---

### 4. HTTP-13-01: Standardize Express JSON Parser Error Mapping (400, 413, 500)
- **File**: `D:\worker\src\http\app.js` (lines 14-17)
- **Current Observation**:
  ```javascript
  app.use((error, _req, res, _next) => {
    dependencies.logger.error('http_request_failed', { name: error.name || 'Error' });
    res.status(500).json({ ok: false, error: 'internal_error' });
  });
  ```
- **Bug Mechanism**: The error middleware unconditionally converts all errors into HTTP 500, including JSON syntax errors (malformed body) and body size limit exceeded (`entity.too.large`), masking client errors as server crashes.
- **Surgical Solution**:
  Standardize error classification:
  ```javascript
  app.use((error, _req, res, _next) => {
    dependencies.logger.error('http_request_failed', { name: error.name || 'Error', message: error.message });
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status === 400 || error.type === 'entity.parse.failed' || (error instanceof SyntaxError && 'body' in error)) {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
    if (status === 413 || error.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'payload_too_large' });
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: status === 404 ? 'not_found' : 'internal_error'
    });
  });
  ```

---

### 5. HTTP-13-02: Standardize Command Endpoint Error Mapping (400, 409, 429, 503, 504)
- **File**: `D:\worker\src\http\routes.js` (lines 20-29)
- **Current Observation**:
  ```javascript
  router.post(`${prefix}/command`, resolveInstance, async (req, res, next) => {
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: 'unsupported_action' });
    try {
      const result = await req.workerInstance.runtime.execute(action, req.body?.payload || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'command_failed' });
    }
  });
  ```
- **Bug Mechanism**: All runtime errors (timeout, queue busy, lifecycle conflicts, rate limits) are returned as HTTP 400 (`Bad Request`), preventing callers/Manager from knowing if they should retry (503/429), abort (409), or handle timeout (504).
- **Surgical Solution**:
  Map error codes and messages to standardized HTTP statuses:
  ```javascript
  router.post(`${prefix}/command`, resolveInstance, async (req, res, next) => {
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: 'unsupported_action' });
    try {
      const result = await req.workerInstance.runtime.execute(action, req.body?.payload || {});
      return res.json({ ok: true, result });
    } catch (error) {
      const msg = error.message || '';
      let status = 400;
      if (error.status && Number.isInteger(error.status)) {
        status = error.status;
      } else if (error.code === 'ETIMEDOUT' || /timed out/i.test(msg)) {
        status = 504;
      } else if (error.code === 'QUEUE_BUSY' || /queue is busy/i.test(msg)) {
        status = 503;
      } else if (error.code === 'RATE_LIMIT' || /rate limit/i.test(msg)) {
        status = 429;
      } else if (error.code === 'LIFECYCLE_CONFLICT' || /already in progress|conflicting/i.test(msg)) {
        status = 409;
      } else if (/unsupported|payload/i.test(msg)) {
        status = 400;
      }
      return res.status(status).json({ ok: false, error: msg || 'command_failed' });
    }
  });
  ```

---

### 6. RT-14-01: Retain Execution Lock on Task Timeout Until Task Terminates; Propagate Signal to Session
- **File**: `D:\worker\src\services\worker-runtime.js` (lines 220-252)
- **Current Observation**:
  ```javascript
  const execPromise = Promise.resolve().then(() =>
    this.executeNow(action, payload, { signal: execController.signal })
  );
  execPromise.catch(() => {});

  try {
    return await Promise.race([execPromise, execTimeoutOrAbortPromise]);
  } catch (err) {
    if (execController.signal.aborted && isLifecycle) {
      await this.cleanupAbortedLifecycle(action, err);
    }
    throw err;
  } finally {
    ...
    if (this.activeLifecycle === action) {
      this.activeLifecycle = null;
    }
  }
  ...
  const task = this.execution.then(() => runTask());
  this.execution = task.then(() => undefined, () => undefined);
  ```
- **Bug Mechanism**:
  1. When timeout occurs, `execTimeoutOrAbortPromise` rejects and `runTask()` rethrows `err`.
  2. `this.execution` immediately advances because `task.then(() => undefined, () => undefined)` settles as soon as `runTask()` rejects, even though `execPromise` may still be running in the background!
  3. Consequently, the next queued command runs concurrently with the timed-out in-flight task, corrupting bot state or violating session concurrency.
  4. Non-lifecycle commands (`chat`, `inventory`, `look`, `window_click`) did not propagate the abort signal to the session.
- **Surgical Solution**:
  1. Propagate signal to the session:
     When `execController.signal.aborted` fires:
     - If `isLifecycle`, invoke `await this.cleanupAbortedLifecycle(action, err);`.
     - Also notify session: `if (typeof this.session?.abortPending === 'function') { this.session.abortPending(err?.code === 'ETIMEDOUT' ? 'command_timeout' : 'command_aborted'); }`.
  2. Retain execution lock:
     Ensure `this.execution` waits for `execPromise` to settle (or until cleanup finishes, bounded by safety timeout):
     ```javascript
     const settleLock = Promise.race([
       execPromise.catch(() => {}),
       new Promise((r) => { const t = setTimeout(r, 10000); t.unref?.(); })
     ]);
     this.execution = Promise.allSettled([task, settleLock]).then(() => undefined);
     ```
  3. Keep `this.activeLifecycle` locked during cleanup, clearing only after cleanup completes.

---

### 7. RT-14-02: Propagate AbortSignal and Cleanup Mechanism to All 5 Lifecycle Actions
- **File**: `D:\worker\src\services\worker-runtime.js` (lines 8-9, 61-70, 264-277) & `D:\worker\src\game\minecraft-session.js` (lines 497-532)
- **Current Observation**:
  - `CLEANUP_ON_ABORT_ACTIONS` only contains `['start', 'restart', 'reconnect']`. `stop` and `reset` are excluded!
  - `executeNow` line 269: `case 'stop': return this.session.stop('manager_stop');` (ignores `signal`).
  - `executeNow` line 277: `case 'reset': return this.session.resetData();` (ignores `signal`).
- **Bug Mechanism**: If `stop` or `reset` times out or receives an external abort signal while queued or executing, the cleanup handler skips them and the session does not receive the cancellation signal.
- **Surgical Solution**:
  1. In `worker-runtime.js`:
     Update `CLEANUP_ON_ABORT_ACTIONS`:
     ```javascript
     const CLEANUP_ON_ABORT_ACTIONS = new Set(['start', 'stop', 'restart', 'reconnect', 'reset']);
     ```
  2. In `executeNow`:
     ```javascript
     case 'stop': return this.session.stop('manager_stop', { signal });
     case 'reset': return this.session.resetData({ signal });
     ```
  3. In `minecraft-session.js`:
     Update `stop(reason, { emitEvent, signal } = {})` and `resetData({ signal } = {})` to accept `{ signal }` and check `signal?.aborted`.

---

### 8. RT-14-03: Deduct Command Rate Limit Quota Only When Command Is Accepted Into Queue
- **File**: `D:\worker\src\services\worker-runtime.js` (lines 103-107, 255-260)
- **Current Observation**:
  ```javascript
  this.applyCommandLimit();
  if (this.pendingCommands >= MAX_PENDING_COMMANDS) {
    throw new Error('Worker command queue is busy. Try again shortly.');
  }
  const isLifecycle = LIFECYCLE_ACTIONS.has(action);
  const conflictingLifecycle = this.activeLifecycle || this.getQueuedLifecycleAction();
  if (isLifecycle && conflictingLifecycle) {
    throw new Error(`A lifecycle operation (${conflictingLifecycle}) is already in progress. Conflicting ${action} command rejected.`);
  }
  ```
  And `applyCommandLimit()`:
  ```javascript
  applyCommandLimit() {
    const now = Date.now();
    this.commandTimes = this.commandTimes.filter((time) => now - time < 60000);
    if (this.commandTimes.length >= 30) throw new Error('Worker command rate limit reached. Try again in a minute.');
    this.commandTimes.push(now);
  }
  ```
- **Bug Mechanism**: `applyCommandLimit()` checks and pushes `now` to `this.commandTimes` *before* checking `pendingCommands >= 10` or lifecycle conflict. If the queue is busy or conflicting, the command is rejected at admission, but its rate limit quota was already deducted!
- **Surgical Solution**:
  Split into admission check and quota deduction:
  ```javascript
  checkCommandLimit() {
    const now = Date.now();
    this.commandTimes = this.commandTimes.filter((time) => now - time < 60000);
    if (this.commandTimes.length >= 30) {
      const err = new Error('Worker command rate limit reached. Try again in a minute.');
      err.code = 'RATE_LIMIT';
      throw err;
    }
  }

  recordCommandLimit() {
    this.commandTimes.push(Date.now());
  }

  applyCommandLimit() {
    this.checkCommandLimit();
    this.recordCommandLimit();
  }
  ```
  In `execute(...)`:
  1. Call `this.checkCommandLimit();`.
  2. Check `this.pendingCommands >= MAX_PENDING_COMMANDS` (with `err.code = 'QUEUE_BUSY'`).
  3. Check conflicting lifecycle (with `err.code = 'LIFECYCLE_CONFLICT'`).
  4. Only after all admission guards pass: call `this.recordCommandLimit();` and `this.pendingCommands += 1;`.

---

### 9. FLEET-15-01: Coordinate Auto-Start via `WorkerRuntime.execute('start')`
- **File**: `D:\worker\src\services\worker-fleet.js` (line 158)
- **Current Observation**:
  ```javascript
  if (!this.stopping && !instance.session.isHeld()) await instance.session.start();
  ```
- **Bug Mechanism**: Calling `session.start()` directly bypasses `WorkerRuntime`'s lifecycle mutex (`activeLifecycle`), rate limit guards, execution timeout, and bootstrap refresh.
- **Surgical Solution**:
  Replace line 158 with:
  ```javascript
  if (!this.stopping && !instance.session.isHeld()) {
    await instance.runtime.execute('start').catch((error) => {
      this.logger.warn('worker_auto_start_failed', { workerId: instance.config.workerId, error: error.message });
    });
  }
  ```

---

### 10. FLEET-15-02: Fleet State Machine (`STOPPED`, `STARTING`, `RUNNING`, `STOPPING`) with Concurrency Locking
- **File**: `D:\worker\src\services\worker-fleet.js` (lines 20-30, 95-125, 164-175)
- **Current Observation**:
  ```javascript
  async start() {
    if (this.heartbeatTimer) return;
    this.stopping = false;
    ... // async bootstrap loop
    this.heartbeatTimer = setInterval(...);
  ```
- **Bug Mechanism**: `this.heartbeatTimer` is only assigned *after* the async bootstrap loop. If `fleet.start()` is invoked concurrently or multiple times in rapid succession, both invocations pass `if (this.heartbeatTimer) return;`, resulting in duplicate intervals, duplicate pollers, and permanent timer leaks.
- **Surgical Solution**:
  1. Define explicit state enum:
     ```javascript
     const FleetState = Object.freeze({
       STOPPED: 'STOPPED',
       STARTING: 'STARTING',
       RUNNING: 'RUNNING',
       STOPPING: 'STOPPING'
     });
     ```
  2. In `constructor`: `this.state = FleetState.STOPPED;`.
  3. In `start()`:
     ```javascript
     if (this.state === FleetState.STARTING || this.state === FleetState.RUNNING) {
       return;
     }
     this.state = FleetState.STARTING;
     this.stopping = false;
     ...
     if (this.stopping) {
       this.state = FleetState.STOPPED;
       return;
     }
     ...
     this.state = FleetState.RUNNING;
     ```
  4. In `stop()`:
     ```javascript
     if (this.state === FleetState.STOPPING || this.state === FleetState.STOPPED) {
       return;
     }
     this.state = FleetState.STOPPING;
     this.stopping = true;
     ...
     this.state = FleetState.STOPPED;
     ```

---

### 11. FLEET-15-03: Cancellable Delay with AbortController for Poller `stop()`
- **File**: `D:\worker\src\transports\wispbyte-poller.js` (lines 3, 69, 75, 87-97)
- **Current Observation**:
  ```javascript
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  ...
  async stop() {
    this.stopping = true;
    this.activeController?.abort();
    await this.loopPromise?.catch(() => {});
  }
  ```
- **Bug Mechanism**: When the poller encounters an error (e.g. network failure), it enters backoff sleep for up to 60,000ms (`await sleep(delay);` line 88). `stop()` only aborts `this.activeController` (which is for fetch, not sleep). Therefore, `stop()` hangs for up to 60 seconds waiting for `sleep()` to finish, blocking fleet shutdown or process termination.
- **Surgical Solution**:
  1. Implement cancellable sleep:
     ```javascript
     function cancellableSleep(ms, signal) {
       return new Promise((resolve) => {
         if (signal?.aborted) return resolve();
         let timer = null;
         const onAbort = () => {
           if (timer) clearTimeout(timer);
           resolve();
         };
         timer = setTimeout(() => {
           if (signal) signal.removeEventListener('abort', onAbort);
           resolve();
         }, ms);
         if (signal) signal.addEventListener('abort', onAbort, { once: true });
       });
     }
     ```
  2. In `WispbytePoller`:
     `this.stopController = new AbortController();` in `constructor` and reset on `start()`.
  3. In `stop()`:
     ```javascript
     async stop() {
       this.stopping = true;
       this.stopController?.abort();
       this.activeController?.abort();
       await this.loopPromise?.catch(() => {});
     }
     ```
  4. Replace all `sleep(...)` calls in `run()` with `await cancellableSleep(ms, this.stopController.signal);`.

---

## Verification & Test Plan

1. **Unit & Integration Regression in `D:\worker`**:
   Execute `node tests/integration.test.js` (all 13 baseline integration tests must continue to pass 100%).
2. **Quality Gate 2 Tests**:
   Verify new test assertions covering:
   - Poller stop terminates immediately during 60s backoff (< 50ms).
   - Pending-result retry queue flushed on reconnect.
   - Event reporting queue retries on failure and verifies `{ ok: true }` ACK.
   - Keepalive URL rejects HTTP and non-wispbyte domains.
   - Express error handler returns 400 for bad JSON, 413 for oversized body, 500 for server error.
   - Command endpoint returns 409 (conflict), 429 (rate limit), 503 (queue busy), 504 (timeout).
   - Rate limit quota is NOT deducted when rejected due to busy queue or conflict.
   - Fleet state machine prevents duplicate timers on concurrent `start()` calls.
   - Auto-start uses `runtime.execute('start')`.
