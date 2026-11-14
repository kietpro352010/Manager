# Changes — Worker Phase 2 (BotWorker Lifecycle, Transports & HTTP API)

## Executive Summary
Remediated and verified all 11 BotWorker findings in `D:\worker` covering transports, fleet state management, keepalive security, HTTP API standardization, and execution lifecycle/session management:
- **INT-10-01**: Pending-result retry queue with exponential backoff on `/result` failure (`src/transports/wispbyte-poller.js`).
- **INT-10-02**: Event reporting queue with retry, exponential backoff, and ACK verification (`body.ok`) (`src/transports/manager-reporter.js` & `src/services/worker-fleet.js`).
- **SEC-10-03**: Enforce HTTPS and strict whitelist `https://wispbyte.com` for keepalive cookies (`src/services/wispbyte-keepalive.js`).
- **HTTP-13-01**: Standardize Express JSON parser error mapping (400 `invalid_json`, 413 `payload_too_large`, 500 `internal_error`) (`src/http/app.js`).
- **HTTP-13-02**: Standardize Command endpoint error mapping (400 bad action, 409 conflict, 429 rate limit, 503 queue busy, 504 timeout) (`src/http/routes.js`).
- **RT-14-01**: Retain execution lock on task timeout until task terminates (wait for `execPromise` settle or 10s safety timeout); propagate abort signal to session (`abortPending`) (`src/services/worker-runtime.js`).
- **RT-14-02**: Propagate AbortSignal and cleanup mechanism to all 5 lifecycle actions (`start`, `stop`, `restart`, `reconnect`, `reset`) (`src/services/worker-runtime.js` & `src/game/minecraft-session.js`).
- **RT-14-03**: Deduct command rate limit quota only when command is admitted into execution queue (separate `checkCommandLimit` from `recordCommandLimit`) (`src/services/worker-runtime.js`).
- **FLEET-15-01**: Coordinate auto-start via `WorkerRuntime.execute('start')` instead of calling `session.start()` directly (`src/services/worker-fleet.js`).
- **FLEET-15-02**: Fleet state machine (`STOPPED`, `STARTING`, `RUNNING`, `STOPPING`) with concurrency locking against duplicate timer leaks (`src/services/worker-fleet.js`).
- **FLEET-15-03**: `cancellableSleep` with `AbortController` for Poller `stop()` to terminate backoff immediately (< 50ms) (`src/transports/wispbyte-poller.js`).

---

## Detailed File Modifications

### 1. `src/transports/wispbyte-poller.js` (INT-10-01, FLEET-15-03)
- Added `cancellableSleep(ms, signal)` supporting immediate abortion via `AbortController`.
- In `WispbytePoller`:
  - Added `this.stopController = new AbortController()` to immediately break out of backoff sleep on `stop()`.
  - Added `this.pendingResults = []` bounded buffer (FIFO drop oldest when > 100).
  - Added `enqueueResult(resultPayload)` and `flushPendingResults()` with exponential backoff (`Math.min(60000, 1000 * 2^attempts)`).
  - Flushes pending results before every polling cycle.
  - Catches `/result` network failure and enqueues the payload rather than dropping it.

### 2. `src/transports/manager-reporter.js` & `src/services/worker-fleet.js` (INT-10-02, FLEET-15-01, FLEET-15-02)
- In `manager-reporter.js`:
  - Added `post(path, payload)` with strict response validation: throws if `!response.ok` or `body.ok === false`.
  - Implemented `enqueueEvent(event)`: sanitizes passwords and tokens, bounds queue to 100 items, and schedules debounced flush.
  - Implemented `flushEventQueue()`: retries failed events with exponential backoff upon network or ACK failure.
  - Added `stop()` method to clear `eventFlushTimer`.
- In `worker-fleet.js`:
  - Defined `FleetState` enum: `STOPPED`, `STARTING`, `RUNNING`, `STOPPING`.
  - Guarded `start()` against concurrent invocations while `STARTING` or `RUNNING`.
  - Guarded `stop()` against concurrent invocations while `STOPPING` or `STOPPED`.
  - Coordinated bot auto-start through `instance.runtime.execute('start')` instead of direct session access.
  - Connected session event listener to `reporter.enqueueEvent(event)`.
  - Stopped reporter timers in `fleet.stop()`.

### 3. `src/services/wispbyte-keepalive.js` (SEC-10-03)
- Implemented `isAllowedPanelUrl(urlStr)` helper requiring protocol `https:` and hostname `wispbyte.com` or `*.wispbyte.com`.
- Disabled keepalive and set status to `error` if panel URL is insecure or non-whitelisted.
- Guarded `ping()` to immediately return error response if URL check fails.

### 4. `src/http/app.js` (HTTP-13-01)
- Standardized Express error handling middleware:
  - Returns HTTP 400 `{ ok: false, error: 'invalid_json' }` on JSON syntax / parse error.
  - Returns HTTP 413 `{ ok: false, error: 'payload_too_large' }` when body size exceeds limit.
  - Preserves standard error status or maps to 500 `{ ok: false, error: 'internal_error' }`.

### 5. `src/http/routes.js` (HTTP-13-02)
- Standardized error classification in `/api/v1/bots/:workerId/command`:
  - HTTP 409 for `LIFECYCLE_CONFLICT` or concurrent lifecycle operations in progress.
  - HTTP 429 for `RATE_LIMIT` or command rate limit reached.
  - HTTP 503 for `QUEUE_BUSY` when command queue is full.
  - HTTP 504 for `ETIMEDOUT` or execution / queue timeout.
  - HTTP 400 for bad action or invalid payload.

### 6. `src/services/worker-runtime.js` & `src/game/minecraft-session.js` (RT-14-01, RT-14-02, RT-14-03)
- In `worker-runtime.js`:
  - Retained execution lock (`settleLock`) on task timeout until `execPromise` terminates (or 10s safety limit) for non-lifecycle commands, preventing queued tasks from running concurrently with timed-out tasks.
  - Propagated timeout / abort signal to session via `this.session.abortPending(...)` for non-lifecycle commands.
  - Tracked active lifecycle with unique `activeLifecycleToken` to prevent late resolution of timed-out lifecycles from corrupting subsequent commands.
  - Included `stop` and `reset` in `CLEANUP_ON_ABORT_ACTIONS` and propagated `signal` to all 5 lifecycle actions (`start`, `stop`, `restart`, `reconnect`, `reset`).
  - Separated rate limit check (`checkCommandLimit`) from quota recording (`recordCommandLimit`), deducting quota only after all admission guards pass.
- In `minecraft-session.js`:
  - Added `{ signal }` parameter handling to `stop()`, `restart()`, and `resetData()`.
  - Immediately triggered `abortPending()` if signal is aborted.

### 7. `tests/integration.test.js`
- Verified all 24 integration tests pass 100% (covering INT-10-01..02, SEC-10-03, HTTP-13-01..02, RT-14-01..03, FLEET-15-01..03).
- Added lock retention assertion proving subsequent tasks wait for timed-out in-flight tasks before execution.
- Resolved unhandled promise rejection in rate limit admission test.
