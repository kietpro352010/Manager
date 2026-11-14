# Handoff Report: Explorer Phase 2 (Batch 2 - Manager User API & Worker State Sync)
**From**: `explorer_phase2_2`  
**To**: `sub_orch_phase2` / `worker_phase2`  
**Date**: 2026-11-14  
**Scope**: API-05, API-06, API-07, API-08, SYNC-16-01, SYNC-16-02  

---

## 1. Observation

Direct code observations from source files:

1. **API-05 (`/bot/:id/send`)**:
   - Path: `D:\manager\src\http\routes\user-api.js#L420-L428`
   - Verbatim code:
     ```javascript
     try {
       await broker.dispatch(worker.workerId, 'chat', { message });
       await store.addAudit({
         action: 'BOT_CHAT_SENT',
         targetId: worker.workerId,
         actorId: req.managerAuthSession.username,
         details: { message: message.slice(0, 100) }
       });

       return res.json({ ok: true, message: `Đã gửi tin nhắn tới server: "${message}"` });
     } catch (error) { ... }
     ```
   - In `D:\manager\src\services\command-broker.js#L255`, poll timeout resolves with `{ delivered: false, timedOut: true, commandId: actualCommandId }` without throwing. Because the return value of `broker.dispatch` is ignored, `/bot/:id/send` writes a successful audit log and returns HTTP 200 upon timeout.

2. **API-06 (`/bot/:id/window/click`, `/close`, `/inventory/:invAction`)**:
   - Path: `D:\manager\src\http\routes\user-api.js#L482-L510`
   - Verbatim code:
     ```javascript
     const result = await broker.dispatch(perm.worker.workerId, 'window_click', req.body || {});
     return res.json({ ok: true, message: 'Đã gửi thao tác click giao diện.', result: result?.result || null });
     // ...
     const result = await broker.dispatch(perm.worker.workerId, 'inventory', { action: invAction, ...req.body });
     return res.json({ ok: true, message: `Đã thực hiện thao tác ${invAction} kho đồ.`, result: result?.result || null });
     ```
   - No check is made on `result.timedOut`, `result.delivered`, or `result?.result?.ok`. If the command times out or worker execution fails, HTTP 200 is unconditionally returned.

3. **API-07 (`/bot/:id/:action` - manuallyStopped flag timing)**:
   - Path: `D:\manager\src\http\routes\user-api.js#L644-L650`
   - Verbatim code:
     ```javascript
     // Track manual stop status
     if (action === 'stop') {
       await registry.updateStatus(worker.workerId, { ...worker.status, manuallyStopped: true }, 'user-stop');
     } else if (action === 'start' || action === 'restart' || action === 'reconnect') {
       await registry.updateStatus(worker.workerId, { ...worker.status, manuallyStopped: false }, 'user-start');
     }

     const result = await broker.dispatch(worker.workerId, resolvedAction, req.body || {});
     ```
   - `registry.updateStatus` mutates `manuallyStopped` in database and cache BEFORE `broker.dispatch(...)`. If dispatch times out or fails, the flag remains corrupted in DB (`manuallyStopped = true`), permanently blocking auto-restart.
   - Furthermore, in `src/services/worker-registry.js#L75-L109`, `validateWorkerStatus` drops `manuallyStopped` because it is omitted from the return object, causing subsequent worker heartbeats to wipe out the flag.

4. **API-08 (`/bot/:id/:action` - timeout returning 504)**:
   - Path: `D:\manager\src\http\routes\user-api.js#L650-L678`
   - Verbatim code:
     ```javascript
     const result = await broker.dispatch(worker.workerId, resolvedAction, req.body || {});
     await store.addAudit({
       action: `BOT_${action.toUpperCase()}`,
       targetId: worker.workerId,
       actorId: req.managerAuthSession.username,
       details: { result: result?.result || 'dispatched' }
     });

     if (result?.result && typeof result.result === 'object' && result.result.ok === false) { ... }
     return res.json({ ok: true, message: ..., result: result?.result || null });
     ```
   - On timeout, `result` has `timedOut: true` and `result.result` is `undefined`. The error check evaluates to `false`, falling through to HTTP 200 with `result: null`, while audit log records success.

5. **SYNC-16-01 (`WorkerRegistry.updateStatus` clock skew & unreachability)**:
   - Path: `D:\manager\src\services\worker-registry.js#L415-L422`
   - Verbatim code:
     ```javascript
     if (safeStatus.lastStateAt && existing.status?.lastStateAt) {
       if (safeStatus.lastStateAt.getTime() < new Date(existing.status.lastStateAt).getTime()) {
         return this.publicView(existing);
       }
     }
     const updated = await this.store.update(id, { status: safeStatus, lastHeartbeat: new Date() });
     ```
   - If worker clock drifts behind Manager clock or earlier packet arrives, `lastStateAt < existing.lastStateAt` causes early return without calling `this.store.update`. `lastHeartbeat` is not updated. After 120s, `record.reachable` becomes `false` and broker throws `Wispbyte worker ... has not checked in recently.`

6. **SYNC-16-02 (`SupabaseWorkerStore.addEvent` loss of event history in fallback)**:
   - Path: `D:\manager\src\storage\supabase-worker-store.js#L192-L208`
   - Verbatim code:
     ```javascript
     if (rpcError && !isRpcUnavailableError(rpcError)) {
       throw rpcError;
     }

     // Fallback: cập nhật last_event trên worker row
     await this.update(workerId, { lastEvent: event });
     ```
   - Fallback only sets `{ lastEvent: event }` on `manager_workers`, completely ignoring and losing the `events` jsonb array. No deduplication or idempotency key.

---

## 2. Logic Chain

1. **API-05 & API-06**:
   - `broker.dispatchPoll` resolves `{ delivered: false, timedOut: true }` when timeout occurs.
   - HTTP routes in `user-api.js` must inspect `dispatchResult`. If `timedOut || delivered === false`, return HTTP 504. If `result?.ok === false`, return HTTP 500. Return HTTP 200 only when delivery and result are verified.
   - Helper `evaluateCommandDispatch(dispatchResult, defaultMsg)` provides a single, uniform evaluation mechanism across all 4 command routes (`/send`, `/window/click`, `/window/close`, `/inventory/:action`).

2. **API-07 & API-08**:
   - Reordering operations: `broker.dispatch(...)` must be called FIRST.
   - If `timedOut || delivered === false`, return HTTP 504 immediately without modifying `manuallyStopped` or logging audit success.
   - If `result?.result?.ok === false`, return HTTP 500 without modifying `manuallyStopped`.
   - Once execution is confirmed, update `manuallyStopped` (true for stop, false for start/restart/reconnect) and record audit log.
   - In `WorkerRegistry.updateStatus`, preserve `existing.status.manuallyStopped` across incoming status updates when not explicitly overridden.

3. **SYNC-16-01**:
   - Worker communication time is recorded by Manager (`new Date()`).
   - If `safeStatus.lastStateAt < existing.status.lastStateAt`, do not overwrite status fields, but DO update `lastHeartbeat: new Date()` via `store.update(id, { lastHeartbeat: managerNow })`.
   - This prevents clock drift on worker nodes from triggering false 120s offline timeouts.

4. **SYNC-16-02**:
   - When RPC `manager_append_worker_event` is unavailable, fallback must read current worker record, generate/verify idempotency event ID, deduplicate, and append to `events` array capped at 100 entries (mirroring PostgreSQL RPC behavior), then update `{ lastEvent: safeEvent, events: updatedEvents }`.
   - Fails closed on genuine DB error.

---

## 3. Caveats

- **Network timeouts vs Execution timeouts**: The 504 status code returned by Manager indicates gateway timeout waiting for worker response. If the worker eventually executed the command after timeout, the late result will be handled idempotently by `CommandBroker` (CMD-05).
- **Audit Logs on Failure**: If a command times out, audit log for `BOT_CHAT_SENT` or `BOT_START` is suppressed to avoid misleading admin audit history. An error log is recorded via logger.
- **RPC Availability**: In production, Supabase migration creates `manager_append_worker_event`. The fallback in `supabase-worker-store.js` is active only during schema migration gaps or degraded SQLite/mock environments.

---

## 4. Conclusion

The surgical fixes are fully designed, documented, and ready for immediate implementation by `worker_phase2`:
1. Add `evaluateCommandDispatch` to `user-api.js` and use it in `/bot/:id/send`, `/window/click`, `/window/close`, and `/inventory/:invAction`.
2. Defer `manuallyStopped` update and handle 504 timeout in `/bot/:id/:action`.
3. Preserve `manuallyStopped` and always update `lastHeartbeat` in `WorkerRegistry.updateStatus` regardless of `lastStateAt` comparison.
4. Update `SupabaseWorkerStore.addEvent` fallback to maintain bounded `events` array with idempotency key.

Detailed replacement snippets and patch instructions are located in:  
`D:\manager\.agents\teamwork\explorer_phase2_2\analysis.md`.

---

## 5. Verification Method

1. **Run Current Test Suites**:
   ```powershell
   Set-Location D:\manager; npm.cmd test
   ```
   *Expected result: 100% pass (0 failures).*

2. **Inspect Code Files**:
   - Verify `user-api.js` lines 420, 482, 644, 658 match proposed patch.
   - Verify `worker-registry.js` line 415 decouples `lastHeartbeat`.
   - Verify `supabase-worker-store.js` line 192 implements bounded events array fallback.

3. **Verify Against Audit Invalidation Conditions**:
   - Calling `/bot/:id/send` when broker times out MUST return HTTP 504 and MUST NOT insert audit log.
   - Calling `/bot/:id/stop` when broker times out MUST return HTTP 504 and MUST NOT set `manuallyStopped: true`.
   - Sending worker heartbeat with clock in the past MUST refresh `lastHeartbeat` and keep worker `reachable: true`.
