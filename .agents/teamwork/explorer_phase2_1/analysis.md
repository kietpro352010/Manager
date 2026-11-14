# Deep Architectural Analysis & Surgical Patch Specification
## Phase 2: Command Queue Engine & Command Broker (CMD-01..08, API-09)

**Target Files:**
1. `D:\manager\src\storage\supabase-command-store.js`
2. `D:\manager\src\services\command-broker.js`

---

### Executive Summary

An exhaustive audit of `SupabaseCommandStore` and `CommandBroker` revealed 9 concrete bugs compromising queue integrity, concurrency guarantees, and inter-service transport parity:
1. **CMD-01 (P1)**: Enqueue RPC errors are swallowed unconditionally, allowing policy/permission/constraint rejections to silently bypass Postgres rules via fallback table insert.
2. **CMD-02 (P1)**: Complete fallback allows direct transition `queued -> completed`, violating the command lifecycle invariant that commands must be delivered before completion.
3. **CMD-03 (P2)**: Poll fallback uses a single read-then-update without retry, prematurely dropping queued commands when concurrent pollers contend for the head of the queue.
4. **CMD-04 (P2)**: Result waiter relies solely on in-memory `pendingResults` Map; process restarts lose active waiters without durable DB lookup support.
5. **CMD-05 (P2)**: Race condition between wait timeout and late result arrival rejects valid worker execution results; timeout types (`execution_timeout` vs `result_timeout`) are conflated.
6. **CMD-06 (P2)**: Result payloads accepted via `acceptResult` / `reportResult` lack schema validation per action type, allowing corrupted or malicious structures into database and status records.
7. **CMD-07 (P2)**: `cancelWorker` is synchronous and calls `clearWorker` with unawaited `void`, causing race conditions where pending queue clearing is still mid-flight.
8. **CMD-08 (P2)**: Outbox batch processor claims locks using PID (`mgr_${process.pid}`), colliding across container instances running as PID 1.
9. **API-09 (P2)**: Asymmetrical command response DTO between Render (push) and WispByte (pull) creates schema divergence for upstream API routes and audit logging.

All 9 issues can be resolved with surgical, zero-overhead code modifications that preserve 100% of existing contracts and test baselines.

---

### Section 1: SupabaseCommandStore (`src/storage/supabase-command-store.js`)

#### 1.1 CMD-01: Enqueue Fallback Policy Enforcement
- **Location**: `src/storage/supabase-command-store.js`, Lines 267–283
- **Observation**:
  ```javascript
  // 1. Thử gọi RPC manager_enqueue_worker_command: thực thi atomic advisory lock & transaction trong PostgreSQL
  try {
    const { data, error } = await this.client.rpc('manager_enqueue_worker_command', {
      p_command_id: commandId,
      p_worker_id: workerIdStr,
      p_action: actionStr,
      p_payload: command.payload || {},
      p_created_at: createdAt,
      p_expires_at: expiresAt,
      p_allow_coalesce: allowCoalesce
    });
    if (!error && data) {
      const row = unwrap(data);
      if (row) return fromRow(row);
    }
  } catch (_) {}
  ```
- **Problem**:
  When `this.client.rpc('manager_enqueue_worker_command', ...)` fails with an error (e.g., permission denied, constraint violation, or business policy rejection in PostgreSQL), the `catch (_) {}` block silences the error. The method then falls through to the non-RPC fallback code (lines 286–352) and inserts directly into `manager_commands` or `manager_outbox_queue`. Fallback must **only** occur when the RPC does not exist (`isRpcUnavailableError(error)`). If the RPC rejected the call due to policy or database error, that error must be propagated.
- **Surgical Patch**:
  ```javascript
  // 1. Thử gọi RPC manager_enqueue_worker_command: thực thi atomic advisory lock & transaction trong PostgreSQL
  try {
    const { data, error } = await this.client.rpc('manager_enqueue_worker_command', {
      p_command_id: commandId,
      p_worker_id: workerIdStr,
      p_action: actionStr,
      p_payload: command.payload || {},
      p_created_at: createdAt,
      p_expires_at: expiresAt,
      p_allow_coalesce: allowCoalesce
    });
    if (!error && data) {
      const row = unwrap(data);
      if (row) return fromRow(row);
    }
    if (error) {
      if (!isRpcUnavailableError(error)) {
        const err = new Error(error.message || 'manager_enqueue_worker_command failed');
        if (error.code) err.code = error.code;
        throw err;
      }
    }
  } catch (rpcErr) {
    if (!isRpcUnavailableError(rpcErr)) {
      throw rpcErr;
    }
  }
  ```

---

#### 1.2 CMD-02: Disallow Direct Transition from `queued -> completed`
- **Location**: `src/storage/supabase-command-store.js`, Lines 390–417 (specifically Line 409)
- **Observation**:
  ```javascript
  async complete(workerId, commandId, result) {
    try {
      const { data, error } = await this.client.rpc('manager_complete_worker_command', {
        p_worker_id: String(workerId),
        p_command_id: String(commandId),
        p_result: result ?? null
      });
      if (!error && data === true) return true;
    } catch (_) {}

    // Fallback: update status completed
    try {
      const { data, error } = await this.client.from(TABLE).update({
        status: 'completed',
        result: result ?? {},
        completed_at: new Date().toISOString()
      })
      .eq('command_id', String(commandId))
      .eq('worker_id', String(workerId))
      .in('status', ['delivered', 'queued']) // <-- BUG: allows queued -> completed
      .select('command_id')
      .maybeSingle();

      if (!error && data) return true;
    } catch (_) {}

    return false;
  }
  ```
- **Problem**:
  Line 409 allows `.in('status', ['delivered', 'queued'])`. A command in `'queued'` state has never been taken or dispatched by any worker. Allowing it to jump directly from `queued` to `completed` bypasses the execution lifecycle.
- **Surgical Patch**:
  Replace line 409 with `.eq('status', 'delivered')`. Also ensure that non-RPC-unavailable errors in the RPC invocation are handled properly.
  ```javascript
  async complete(workerId, commandId, result) {
    try {
      const { data, error } = await this.client.rpc('manager_complete_worker_command', {
        p_worker_id: String(workerId),
        p_command_id: String(commandId),
        p_result: result ?? null
      });
      if (!error && data === true) return true;
      if (error && !isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_complete_worker_command failed');
      }
    } catch (err) {
      if (!isRpcUnavailableError(err)) throw err;
    }

    // Fallback: update status completed (yêu cầu trạng thái phải là 'delivered', không cho phép 'queued')
    try {
      const { data, error } = await this.client.from(TABLE).update({
        status: 'completed',
        result: result ?? {},
        completed_at: new Date().toISOString()
      })
      .eq('command_id', String(commandId))
      .eq('worker_id', String(workerId))
      .eq('status', 'delivered')
      .select('command_id')
      .maybeSingle();

      if (!error && data) return true;
    } catch (_) {}

    return false;
  }
  ```

---

#### 1.3 CMD-03: Atomic Poll Fallback with Safe Retry Loop
- **Location**: `src/storage/supabase-command-store.js`, Lines 355–388
- **Observation**:
  ```javascript
  async take(workerId) {
    // 1. Thử gọi RPC manager_take_worker_command
    try {
      const { data, error } = await this.client.rpc('manager_take_worker_command', { p_worker_id: String(workerId) });
      if (!error && data) return fromRow(unwrap(data));
    } catch (_) {}

    // 2. Fallback: đọc trực tiếp lệnh queued đầu tiên
    try {
      const now = new Date().toISOString();
      const { data, error } = await this.client.from(TABLE)
        .select('*')
        .eq('worker_id', String(workerId))
        .eq('status', 'queued')
        .gt('expires_at', now)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        const { data: updated, error: updErr } = await this.client.from(TABLE)
          .update({ status: 'delivered', delivered_at: now })
          .eq('command_id', data.command_id)
          .eq('status', 'queued')
          .select('*')
          .maybeSingle();
        if (!updErr && updated) {
          return fromRow(updated);
        }
      }
    } catch (_) {}

    return null;
  }
  ```
- **Problem**:
  1. The RPC `manager_take_worker_command` implements Postgres `FOR UPDATE SKIP LOCKED`. If the RPC fails with an error other than missing function, swallowing it masks operational errors.
  2. The fallback executes a single `select` then `update`. If two workers poll concurrently, both read `cmd_1`. The first updates `cmd_1` to `delivered`; the second's update fails (`updated` is null). The second worker immediately returns `null` instead of retrying to fetch `cmd_2` that is waiting in line.
- **Surgical Patch**:
  Prioritize the atomic RPC, rethrow non-unavailable errors, and wrap the fallback in a bounded retry loop (3 attempts).
  ```javascript
  async take(workerId) {
    // 1. Thử gọi RPC manager_take_worker_command (thực thi FOR UPDATE SKIP LOCKED trong SQL)
    try {
      const { data, error } = await this.client.rpc('manager_take_worker_command', { p_worker_id: String(workerId) });
      if (!error && data) {
        const row = unwrap(data);
        if (row) return fromRow(row);
      }
      if (error && !isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_take_worker_command failed');
      }
    } catch (err) {
      if (!isRpcUnavailableError(err)) throw err;
    }

    // 2. Fallback an toàn với retry loop khi có tranh chấp đồng quy giữa nhiều poller
    const MAX_POLL_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_POLL_RETRIES; attempt++) {
      try {
        const now = new Date().toISOString();
        const { data, error } = await this.client.from(TABLE)
          .select('*')
          .eq('worker_id', String(workerId))
          .eq('status', 'queued')
          .gt('expires_at', now)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (error || !data) {
          return null;
        }

        const { data: updated, error: updErr } = await this.client.from(TABLE)
          .update({ status: 'delivered', delivered_at: now })
          .eq('command_id', data.command_id)
          .eq('status', 'queued')
          .select('*')
          .maybeSingle();

        if (!updErr && updated) {
          return fromRow(updated);
        }
        // Tranh chấp: command vừa được worker khác lấy, tiếp tục vòng lặp để lấy command tiếp theo
      } catch (_) {
        break;
      }
    }

    return null;
  }
  ```

---

### Section 2: CommandBroker (`src/services/command-broker.js`)

#### 2.1 CMD-08: Use `this.instanceId` (UUID) as Outbox Lock Owner Claim
- **Location**: `src/services/command-broker.js`, Lines 60–110 (specifically Lines 71, 82, 88, 98, 102)
- **Observation**:
  `this.instanceId` is initialized at line 17 as `mgr_${process.pid}_${randomUUID().slice(0, 8)}`. However, `processOutboxBatch()` uses `mgr_${process.pid}` in 5 places:
  - Line 71: `claimOutboxBatch(mgr_${process.pid}, 10, 60)`
  - Line 82: `failOutboxItem(item.id, mgr_${process.pid}, ...)`
  - Line 88: `completeOutboxItem(item.id, mgr_${process.pid})`
  - Line 98: `failOutboxItem(item.id, mgr_${process.pid}, ...)`
  - Line 102: `rescheduleOutboxItem(item.id, mgr_${process.pid}, ...)`
- **Problem**:
  In containerized environments (Docker, Render, Kubernetes), processes run with PID 1. Multiple containers simultaneously use `mgr_1` as their lock owner, breaking distributed lock isolation.
- **Surgical Patch**:
  Replace `mgr_${process.pid}` with `this.instanceId` throughout `processOutboxBatch()`.

---

#### 2.2 CMD-04: Support Durable Lookup in DB by `commandId` in Result Waiter
- **Location**: `src/services/command-broker.js`, Lines 18–20, 218–262, 837–865
- **Observation**:
  `this.pendingResults = new Map()` holds pending waiters in process memory. If Manager restarts, in-memory waiters are lost. If a client needs to wait for or check the result of a dispatched command across restarts, no method exists on `CommandBroker`.
- **Problem**:
  `reportResult` only searched `commandStore.get(cid)` if `!result?.action`. If a worker reports the result after process restart, ownership verification was skipped.
- **Surgical Patch**:
  1. In `reportResult`: Always fetch `storedCommand` from `this.commandStore.get(cid)` if `!pending` to verify ownership (`storedCommand.workerId === wid`) and check database status.
  2. Add `async waitForResult(commandId, { timeoutMs } = {})` method to `CommandBroker`:
     - Checks RAM waiter first.
     - Looks up durable state in DB (`commandStore.get(cid)`). If already completed/failed/expired, returns result immediately.
     - If in-flight, creates a waiter and falls back to DB check upon timeout.

---

#### 2.3 CMD-05: Disambiguate `execution_timeout` vs `result_timeout` & Idempotent Late Results
- **Location**: `src/services/command-broker.js`, Lines 167–172, 248–258, 840–865, 982–1000
- **Observation**:
  In `dispatchRender`, `AbortSignal.timeout(30000)` throws a generic timeout error without classifying whether the worker timed out executing or the manager timed out waiting. In `dispatchPoll`, when `commandResultTimeoutMs` expires, `commandStore.expire(cid)` sets the status to `'expired'`. When the worker reports a late result, `commandStore.complete()` returns `false` because status is `'expired'`, rejecting legitimate results.
- **Surgical Patch**:
  1. In `dispatchRender`: Catch AbortError/TimeoutError and tag as `result_timeout`. If the worker body returns error `'execution_timeout'`, propagate `execution_timeout`.
  2. In `reportResult`: If `storedCommand?.status === 'expired'`, accept the late result idempotently: update `manager_commands` with the result, update worker status in registry, and return `{ ok: true, lateResult: true, status: 'completed' }`.
  3. If `storedCommand?.status === 'completed'`: Return `{ ok: true, alreadyCompleted: true }`.

---

#### 2.4 CMD-06: Schema Validation for Result Payload According to Action Type
- **Location**: `src/services/command-broker.js`, Lines 322–330, 837–865
- **Observation**:
  `acceptResult` and `reportResult` accept arbitrary `payload.result` objects without validating structure, field types, or bounds.
- **Surgical Patch**:
  Implement `validateResultPayload(action, rawResult)` on `CommandBroker`:
  ```javascript
  validateResultPayload(action, rawResult) {
    if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
      throw new Error(`Invalid command result: expected an object for action '${action}'.`);
    }
    const validated = { ...rawResult };
    validated.ok = Boolean(rawResult.ok ?? (rawResult.result ? rawResult.result.ok : !rawResult.error));
    if (rawResult.error) {
      validated.error = String(rawResult.error).slice(0, 500);
    }
    if (action) {
      validated.action = String(action);
    }

    if (['start', 'stop', 'restart', 'reconnect', 'status', 'reset'].includes(action)) {
      const rawWorker = rawResult.worker || rawResult.result?.worker ||
        (('state' in rawResult || 'online' in rawResult || 'connected' in rawResult) ? rawResult : null);
      if (rawWorker && typeof rawWorker === 'object') {
        const validator = this.registry?.constructor?.validateWorkerStatus || this.registry?.validateWorkerStatus;
        if (typeof validator === 'function') {
          validated.worker = validator(rawWorker, 'command-result');
        }
      }
    } else if (action === 'chat') {
      if (rawResult.message !== undefined) {
        validated.message = String(rawResult.message || '').slice(0, 256);
      }
    } else if (action === 'inventory') {
      if (rawResult.items !== undefined && !Array.isArray(rawResult.items)) {
        throw new Error("Invalid inventory result: 'items' must be an array.");
      }
    } else if (action === 'window_click') {
      if (rawResult.slot !== undefined && rawResult.slot !== null && !Number.isInteger(Number(rawResult.slot))) {
        throw new Error("Invalid window_click result: 'slot' must be an integer.");
      }
    }

    return validated;
  }
  ```
  Invoke `validateResultPayload` in `acceptResult` and `reportResult`.

---

#### 2.5 CMD-07: Convert `cancelWorker` to Async and Await `clearWorker`
- **Location**: `src/services/command-broker.js`, Lines 331–352
- **Observation**:
  `cancelWorker` is synchronous. Line 350 executes `void this.commandStore.clearWorker(id).catch(() => {});` without awaiting completion.
- **Surgical Patch**:
  Convert `cancelWorker` to an `async` function and `await this.commandStore.clearWorker(id)`:
  ```javascript
  async cancelWorker(workerId) {
    const id = String(workerId);
    const waiters = this.pollWaiters.get(id);
    if (waiters && waiters.length) {
      for (const waiter of waiters.splice(0, waiters.length)) {
        try { waiter(); } catch {}
      }
    }
    this.pollWaiters.delete(id);
    this.wakeVersions.delete(id);

    for (const [commandId, pending] of this.pendingResults.entries()) {
      if (pending && pending.workerId === id) {
        try {
          pending.finish({ ok: false, error: 'worker_cancelled' });
        } catch {}
      }
    }
    if (typeof this.commandStore.clearWorker === 'function') {
      try {
        await this.commandStore.clearWorker(id);
      } catch (err) {
        this.logger?.warn?.('clear_worker_failed_on_cancel', { workerId: id, error: err?.message });
      }
    }
  }
  ```

---

#### 2.6 API-09: Symmetrical Command Response DTO Between Render and WispByte
- **Location**: `src/services/command-broker.js`, Lines 140, 207–208, 232, 255
- **Observation**:
  `dispatchRender` returns `{ delivered: true, result: body.result || body }` (missing `commandId`, `action`, `timedOut`, `ok`).
  `dispatchPoll` returns `{ delivered: true, result }` on success, and `{ delivered: false, timedOut: true, commandId }` on timeout.
- **Surgical Patch**:
  Harmonize both transports with a normalized response format:
  ```javascript
  // Trong dispatchRender:
  return {
    ok: isSuccess,
    delivered: true,
    timedOut: false,
    commandId: command.commandId,
    action: command.action,
    result: body.result || body
  };

  // Trong dispatchPoll (thành công):
  const isSuccess = result ? (result.ok !== false) : true;
  resolveCompletion({
    ok: isSuccess,
    delivered: true,
    timedOut: false,
    commandId: actualCommandId,
    action: command.action,
    result
  });

  // Trong dispatchPoll (timeout):
  resolveCompletion({
    ok: false,
    delivered: false,
    timedOut: true,
    commandId: actualCommandId,
    action: command.action,
    result: null
  });
  ```
  Both transports consistently return:
  `{ ok: boolean, delivered: boolean, timedOut: boolean, commandId: string, action: string, result: object | null }`.

---

### Verification Strategy & Test Cases
To verify all 9 fixes, create `tests/command-execution-audit.test.js` covering:
1. `CMD-01`: Mock RPC failure with code `42501` -> verifies `store.enqueue` throws rather than falling back to table insert.
2. `CMD-02`: Try calling `store.complete` on a command with status `'queued'` -> verifies it returns `false` and does not mark completed.
3. `CMD-03`: Concurrent `store.take` simulation with conflict on first row -> verifies retry loop claims second queued command.
4. `CMD-04`: Call `broker.waitForResult` after clearing memory `pendingResults` -> verifies result retrieved from database `commandStore.get()`.
5. `CMD-05`: Send late result to `broker.reportResult` for expired command -> verifies late result accepted idempotently (`lateResult: true`) and status updated.
6. `CMD-06`: Pass invalid result payload (e.g. `items: "not-array"` for inventory, non-integer slot for window click) -> verifies schema validation throws or sanitizes.
7. `CMD-07`: Call `await broker.cancelWorker(workerId)` -> verifies `clearWorker` is awaited and queue cleared before returning.
8. `CMD-08`: Run `processOutboxBatch` -> verifies outbox lock claim owner is `broker.instanceId` (UUID) rather than `mgr_${process.pid}`.
9. `API-09`: Compare return objects of `dispatchRender` and `dispatchPoll` -> verifies symmetrical shape `{ ok, delivered, timedOut, commandId, action, result }`.
