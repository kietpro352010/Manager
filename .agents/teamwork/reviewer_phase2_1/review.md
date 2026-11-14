# Phase 2 Review Report: Manager Command Queue Engine & State Synchronization

**Reviewer**: Reviewer 1 (Archetype: Reviewer & Adversarial Critic)  
**Date**: 2026-11-14  
**Working Directory**: `D:\manager`  
**Target Scope**: 15 Manager audit findings (CMD-01..08, API-05..09, SYNC-16-01..02)

---

## 1. Review Summary

**Verdict**: **APPROVE**

All 15 findings assigned to Manager Worker in Phase 2 have been surgically remediated, verified against the master remediation plan and `SCOPE.md`, and validated through independent execution of automated test suites and adversarial stress tests.

No integrity violations, fake test mocks, or dummy implementations were found. The code changes adhere strictly to project conventions, fail-closed security invariants, and distributed state machine contracts.

---

## 2. Integrity Verification

As required by reviewer protocol, the following integrity violation checks were performed:
- **Hardcoded test results embedded in source code**: None. All logic dynamically checks parameters, errors, and database rows.
- **Dummy or facade implementations**: None. Storage, broker, and routing implementations contain real error handling, regex/range clamping, schema validations, and concurrency loops.
- **Shortcuts bypassing the intended task**: None. All 15 findings were implemented directly in production source files.
- **Fabricated verification outputs or logs**: None. `npm test` and `node tests/command-execution-audit.test.js` were independently executed and verified with exit code 0.
- **Self-certifying work without independent verification**: Verified. An independent adversarial stress suite of 7 attack vectors was executed against the implementation.

---

## 3. Findings & Code Inspection Details

### 3.1 `src/storage/supabase-command-store.js` (CMD-01, CMD-02, CMD-03)
- **CMD-01 (Enqueue Fallback Policy RPC Enforcement)**:
  - `isRpcUnavailableError(error)` checks Postgres error codes `PGRST202`, `42883`, and message phrases like `function does not exist`, `not implemented`, and `schema cache`.
  - In `enqueue()`, when `this.client.rpc('manager_enqueue_worker_command', ...)` fails with a non-unavailable error (e.g., code `42501` permission denied, `23514` check constraint violation, `23505` unique violation, statement timeout `57014`), the error is immediately re-thrown. This prevents bypassing RLS policies or masking database outages.
- **CMD-02 (Complete Fallback State Machine Invariant)**:
  - In `complete()`, the fallback update previously matched `.in('status', ['delivered', 'queued'])`. It now strictly matches `.eq('status', 'delivered')`.
  - Commands in `queued`, `failed`, or `expired` status cannot transition directly to `completed`.
- **CMD-03 (Poll Fallback Atomic Concurrency Retry Loop)**:
  - `take()` prioritizes RPC `manager_take_worker_command` (which uses `FOR UPDATE SKIP LOCKED` in SQL).
  - In fallback mode, a bounded retry loop (`MAX_POLL_RETRIES = 3`) handles concurrent competition between pollers cleanly without infinite loops or hanging workers.

### 3.2 `src/services/command-broker.js` (CMD-04, CMD-05, CMD-06, CMD-07, CMD-08, API-09)
- **CMD-04 (Durable Result Tracking in DB Surviving Restart)**:
  - `waitForResult(commandId, { timeoutMs })` checks in-memory `pendingResults`, queries `commandStore.get(cid)` from persistent storage, and polls DB if in-flight. Recovers completed, failed, and expired statuses across process restarts.
- **CMD-05 (Disambiguate Timeouts & Idempotent Late Results)**:
  - In `dispatchRender()`, network/fetch timeout is tagged `code = 'result_timeout'` (`timedOut: true`), while worker execution failure is mapped to `code = 'execution_timeout'`.
  - In `reportResult()`, late results for commands marked `'expired'` are idempotently accepted: updates `manager_commands` status to `completed`, syncs worker status with `manager-command-poll-late`, and returns `{ ok: true, lateResult: true, status: 'completed' }`.
  - Guards against cross-worker result spoofing: returns `{ ok: false, error: 'COMMAND_OWNERSHIP_MISMATCH' }` if `storedCommand.workerId !== wid`.
- **CMD-06 (Result Payload Schema Validation)**:
  - Implemented `validateResultPayload(action, rawResult)` validating types, bounding string lengths (error to 500, chat to 256), enforcing `items` is an array for `inventory`, `slot` is an integer for `window_click`, and validating worker status schemas via `validateWorkerStatus`.
- **CMD-07 (Async `cancelWorker` Awaiting `clearWorker`)**:
  - `cancelWorker(workerId)` converted to async function, clears in-memory waiters/pendingResults, and awaits `this.commandStore.clearWorker(id)`.
- **CMD-08 (UUID `instanceId` as Outbox Lock Owner Claim)**:
  - Replaced `mgr_${process.pid}` with `this.instanceId = mgr_${process.pid}_${randomUUID().slice(0, 8)}` in `processOutboxBatch()` across claim, complete, fail, and reschedule methods. Defeats PID-1 container collision issues.
- **API-09 (Symmetrical Command Response DTO)**:
  - Unified `dispatchRender()` and `dispatchPoll()` return structures into `{ ok, delivered, timedOut, commandId, action, result }`.

### 3.3 `src/http/routes/user-api.js` (API-05, API-06, API-07, API-08)
- **API-05 (Chat API Confirmation & Error Mapping)**:
  - `/bot/:id/send` verifies broker delivery via `evaluateCommandDispatch()`. Returns 504 on timeout/undelivered, 500 on execution error, and 200 with audit log `BOT_CHAT_SENT` only on confirmed success.
- **API-06 (Window GUI & Inventory Broker Confirmation)**:
  - `/bot/:id/window/click`, `/close`, and `/inventory/:invAction` verify broker result before returning 200 (returns 504 on timeout, 500 on failure).
- **API-07 (Deferred `manuallyStopped` Flag Mutation)**:
  - In `/bot/:id/:action`, updating `manuallyStopped` is deferred until after `broker.dispatch()` confirms execution. If the command times out or fails, `manuallyStopped` remains unchanged.
- **API-08 (Lifecycle 504 Handlers)**:
  - Lifecycle endpoints (`start`, `stop`, `restart`, `reconnect`, `reset`) return HTTP 504 on timeout or unconfirmed delivery (`!result || result.timedOut || result.delivered === false`).

### 3.4 `src/services/worker-registry.js` (SYNC-16-01, API-07)
- **SYNC-16-01 (Decouple `lastHeartbeat` from `lastStateAt`)**:
  - In `updateStatus()`, if worker's reported `lastStateAt` is older than existing state, the state update is rejected, but `lastHeartbeat` is refreshed using Manager's local clock (`managerNow`), preventing clock skew from falsely marking workers unreachable. Added `touchHeartbeat(workerId)`.
- **API-07 (Preserve `manuallyStopped` Flag)**:
  - Status reports preserve `existing.status?.manuallyStopped` if not explicitly provided in the payload.

### 3.5 `src/storage/supabase-worker-store.js` (SYNC-16-02)
- **SYNC-16-02 (Reliable `addEvent` Fallback)**:
  - When RPC `manager_append_worker_event` is unavailable, fallback retrieves worker row, deduplicates events using `id` and signature `(type, message, occurredAt)`, maintains a bounded array of the last 100 events, and updates `lastEvent`.

---

## 4. Verified Claims

| # | Claim | Verification Method | Result |
|---|-------|---------------------|--------|
| 1 | CMD-01: Non-unavailable RPC errors rethrow in `enqueue` | Executed test asserting code `42501`, `23514`, `23505` rethrow | PASS |
| 2 | CMD-02: Complete fallback disallows direct `queued -> completed` | Tested `store.complete` on queued vs delivered status | PASS |
| 3 | CMD-03: Poll fallback bounded retry loop on concurrency conflict | Simulated 3 consecutive collisions; verified bounded termination | PASS |
| 4 | CMD-04: `waitForResult` durable DB lookup recovers status across restarts | Tested recovery of completed, failed, and expired DB records | PASS |
| 5 | CMD-05: Late result for expired command accepted idempotently | Tested late result report; verified status updated to completed | PASS |
| 6 | CMD-06: Result payload validated and bounded per action | Fuzzed payload with invalid slot, items, strings; verified assertions | PASS |
| 7 | CMD-07: `cancelWorker` is async and awaits `clearWorker` | Verified Promise return type and execution completion | PASS |
| 8 | CMD-08: Outbox lock claim uses UUID `instanceId` | Verified lock owner claim in `processOutboxBatch` | PASS |
| 9 | API-09: Symmetrical DTO across Render (push) and WispByte (pull) | Inspected return shapes of both dispatches | PASS |
| 10 | API-05: `/bot/:id/send` returns 504 on timeout, audit only on success | Verified HTTP response codes and audit log invocation | PASS |
| 11 | API-06: Window GUI & inventory verify broker confirmation | Verified 504 on timeout and 500 on inner ok: false | PASS |
| 12 | API-07: `manuallyStopped` deferred until broker confirmed | Verified flag not set on 504 timeout; set on 200 success | PASS |
| 13 | API-08: Lifecycle endpoints return 504 on timeout/undelivered | Verified HTTP 504 response code on timeout | PASS |
| 14 | SYNC-16-01: `lastHeartbeat` updated despite clock skew in `lastStateAt` | Verified Manager timestamp refreshed on stale/future state | PASS |
| 15 | SYNC-16-02: `addEvent` fallback deduplicates and bounds to 100 | Verified deduplication by signature and array length clamp | PASS |

---

## 5. Adversarial Stress Test Results

An independent adversarial stress suite of 7 attack vectors was executed against the implementation:

1. **Attack Vector 1 (RPC Policy Error vs Missing RPC)**:
   - Scenario: Database throws Postgres errors `23514` (check constraint), `23505` (unique violation), and `57014` (query timeout) during `enqueue`.
   - Behavior: Immediately rethrown. Fallback table query never executed. When `PGRST202` or `schema cache` error occurred, fallback executed cleanly.
   - Result: PASS.
2. **Attack Vector 2 (Complete Fallback State Invariant Protection)**:
   - Scenario: Attacker or buggy worker attempts to transition commands in `queued`, `failed`, or `expired` status directly to `completed`.
   - Behavior: Fallback returned `false`; database row status unmodified. Only commands in `delivered` status transitioned to `completed`.
   - Result: PASS.
3. **Attack Vector 3 (Poller Conflict Bounding)**:
   - Scenario: High-concurrency worker polling where all queued items collide on update.
   - Behavior: Retry loop terminated cleanly after 3 attempts without hanging or memory leakage.
   - Result: PASS.
4. **Attack Vector 4 (Result Spoofing & Late Result Acceptance)**:
   - Scenario: Worker B attempts to report results for Worker A's command; Worker A reports result after timeout.
   - Behavior: Spoofing rejected with `COMMAND_OWNERSHIP_MISMATCH`. Late result accepted idempotently with `lateResult: true`.
   - Result: PASS.
5. **Attack Vector 5 (Result Payload Fuzzing)**:
   - Scenario: Worker sends malicious/malformed payloads: non-objects, non-array inventory items, float/string window click slots, 1000-char error messages.
   - Behavior: Non-objects and malformed slots/items strictly rejected; string lengths safely clamped.
   - Result: PASS.
6. **Attack Vector 6 (Clock Skew Decoupling)**:
   - Scenario: Worker reports `lastStateAt` 16 minutes in the future, then later reports `lastStateAt` from 10 minutes ago.
   - Behavior: State overwrite rejected, but `lastHeartbeat` refreshed using Manager's local clock, keeping worker reachable.
   - Result: PASS.
7. **Attack Vector 7 (Event Deduplication & Bounding)**:
   - Scenario: Repeated identical events and flood of 120 events in fallback mode.
   - Behavior: Identical signature deduplicated; events array strictly capped at 100 elements.
   - Result: PASS.

---

## 6. Coverage & Risk Assessment

- **Blast Radius**: Changes are contained within Manager storage adapters, broker, user router, and worker registry.
- **Regression Risk**: Negligible. All existing baseline test suites (`integration.test.js`, `services-wiring.test.js`, `storage-sql.test.js`, `auth-regression.test.js`, `worker-registry-audit.test.js`) continue to pass 100% with exit code 0.
- **Interface Compatibility**: Verified. Symmetrical command response DTO preserves compatibility with both Render push and WispByte poller consumers.

---

## 7. Conclusion

Reviewer 1 recommends **APPROVE** for Phase 2 Manager Command Queue Engine & State Synchronization.
