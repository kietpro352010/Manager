# Phase 2 Manager Code Changes (CMD-01..08, API-05..09, SYNC-16-01..02)

## Summary of Changes
Surgical remediation of all 15 audit findings across Manager storage layer, command broker, user routing API, and worker registry.

---

### 1. `src/storage/supabase-command-store.js`
- **CMD-01**: Enforce policy RPC in enqueue fallback. In `enqueue()`, when `this.client.rpc('manager_enqueue_worker_command', ...)` fails, inspect error: only fall back if `isRpcUnavailableError(error)`. Non-missing RPC errors (e.g., code `42501` permission denied or constraint failure) are rethrown.
- **CMD-02**: Complete fallback disallows direct `queued -> completed` state transition. Replaced `.in('status', ['delivered', 'queued'])` with `.eq('status', 'delivered')`. Also added `!isRpcUnavailableError(error)` propagation.
- **CMD-03**: Atomic poll fallback with retry loop. In `take(workerId)`, prioritized atomic RPC `manager_take_worker_command` with non-unavailable error propagation. Added a bounded retry loop (`MAX_POLL_RETRIES = 3`) in the fallback path to handle concurrent competition between pollers cleanly.
- Updated `isRpcUnavailableError()` helper to include `function does not exist`, `not implemented`, and `schema cache`.

---

### 2. `src/services/command-broker.js`
- **CMD-04**: Added `waitForResult(commandId, { timeoutMs })` supporting durable lookups in the database via `commandStore.get(cid)`, recovering completed, failed, or expired command statuses after process restarts.
- **CMD-05**: In `dispatchRender()`, tagged fetch timeout with `code = 'result_timeout'` and mapped worker error `'execution_timeout'` to `code = 'execution_timeout'`. In `reportResult()`, handled late results for commands marked `'expired'` idempotently: updated `manager_commands` with result, synchronized status, and returned `{ ok: true, lateResult: true, status: 'completed' }`. Returned `{ ok: true, alreadyCompleted: true }` for already completed commands.
- **CMD-06**: Implemented `validateResultPayload(action, rawResult)` validating payload types, clamping string lengths, checking array/integer invariants for `inventory` (`items` must be array) and `window_click` (`slot` must be integer), and validating worker status schemas for lifecycle actions. Integrated validator into `acceptResult()` and `reportResult()`.
- **CMD-07**: Converted `cancelWorker(workerId)` to `async` function and ensured `await this.commandStore.clearWorker(id)`.
- **CMD-08**: Replaced all 5 occurrences of `mgr_${process.pid}` in `processOutboxBatch()` with `this.instanceId` (UUID-tagged instance identifier).
- **API-09**: Standardized return format across `dispatchRender()` and `dispatchPoll()` into symmetrical DTO: `{ ok, delivered, timedOut, commandId, action, result }`.

---

### 3. `src/http/routes/user-api.js`
- **API-05**: Added helper `evaluateCommandDispatch(dispatchResult, defaultErrorMessage)`. In `/bot/:id/send`, verified broker confirmation before returning 200; returns 504 on timeout/undelivered, returns 500 on execution error, and records audit log only on confirmed success.
- **API-06**: In `/bot/:id/window/click`, `/bot/:id/window/close`, and `/bot/:id/inventory/:invAction`, evaluated broker dispatch result using `evaluateCommandDispatch`, returning 504 on timeout and 500 on failure.
- **API-07**: Deferred updating `manuallyStopped` flag in `/bot/:id/:action` until worker execution is confirmed by broker dispatch.
- **API-08**: Added timeout and delivery check returning HTTP 504 on lifecycle actions (`start`, `stop`, `restart`, `reconnect`, `reset`, etc.) when command times out or is undelivered.

---

### 4. `src/services/worker-registry.js`
- **SYNC-16-01**: In `updateStatus()`, decoupled `lastHeartbeat` (Manager local clock) from `lastStateAt` (Worker reported clock). When `lastStateAt` is older than existing state, state overwrites are rejected but `lastHeartbeat` is refreshed using Manager's current time, preventing clock skew from rendering workers unreachable. Added `touchHeartbeat(workerId)` method.
- **API-07**: In `validateWorkerStatus()` and `updateStatus()`, preserved `manuallyStopped` boolean flag across status updates.

---

### 5. `src/storage/supabase-worker-store.js`
- **SYNC-16-02**: In `addEvent()`, implemented robust fallback when RPC `manager_append_worker_event` is unavailable. Retrieves existing worker, enforces idempotency using event ID and signature deduplication, maintains a bounded array of the last 100 events in `events`, and updates `lastEvent`.

---

### 6. `tests/command-execution-audit.test.js`
- Comprehensive automated regression test suite covering all 15 audit findings (CMD-01 through CMD-08, API-05 through API-09, SYNC-16-01, and SYNC-16-02) with 100% assertions passing.
- Wired into `package.json` test script.
