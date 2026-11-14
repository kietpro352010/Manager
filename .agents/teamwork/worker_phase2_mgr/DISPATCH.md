## 2026-11-14T06:42:24Z
You are Worker 1 for Phase 2: Manager Command Queue Engine & State Synchronization.

Working directory: D:\manager
State folder: D:\manager\.agents\teamwork\worker_phase2_mgr\

## Mandatory Files to Read First:
1. `D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md` (MUST read verbatim before doing any work)
2. `D:\manager\.agents\teamwork\orchestrator\PROJECT.md`
3. `D:\manager\.agents\teamwork\sub_orch_phase2\SCOPE.md`
4. Master Explorer Reports:
   - `D:\manager\.agents\teamwork\explorer_phase2_1\analysis.md` (CMD-01..08, API-09)
   - `D:\manager\.agents\teamwork\explorer_phase2_2\analysis.md` (API-05..08, SYNC-16-01..02)

## MANDATORY INTEGRITY WARNING:
> DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## User Directive - High Velocity & Quality:
"mục đích là fix các lỗi bug nhé" & "ko cần làm gì thừa thải hoặc không cần thiết quá, chỉ cần hiệu quả, chất lượng, tốc độ càng tốt".
Apply surgical code modifications directly following the exact line-by-line analyses in `explorer_phase2_1\analysis.md` and `explorer_phase2_2\analysis.md`.

## Exclusive Write Ownership (in D:\manager):
1. `src/storage/supabase-command-store.js`:
   - CMD-01: Enforce policy RPC in enqueue fallback; only fall back if RPC is unavailable (`isRpcUnavailableError`).
   - CMD-02: Complete fallback disallow direct `queued -> completed` (require `.eq('status', 'delivered')`).
   - CMD-03: Poll fallback retry loop with bounded attempts on concurrent conflict.
2. `src/services/command-broker.js`:
   - CMD-04: Support durable lookup in DB by `commandId` in result waiter so restarts don't lose status.
   - CMD-05: Disambiguate `execution_timeout` vs `result_timeout`; idempotent handling of late results for expired commands.
   - CMD-06: Schema validation for result payload per action type (`validateResultPayload`).
   - CMD-07: Convert `cancelWorker` to async and `await this.commandStore.clearWorker(id)`.
   - CMD-08: Use `this.instanceId` (UUID) as outbox lock owner claim instead of PID.
   - API-09: Symmetrical command response DTO between Render and WispByte (`{ ok, delivered, timedOut, commandId, action, result }`).
3. `src/http/routes/user-api.js`:
   - API-05: Chat API `/bot/:id/send` returns 200 only upon Broker confirmation (return 504 on timeout/undelivered).
   - API-06: Window click/close & inventory verify broker confirmation before returning 200 (return 504 on timeout, 500 on execution error).
   - API-07: Defer setting `manuallyStopped` until worker execution of STOP/START is confirmed.
   - API-08: Lifecycle handlers handle timeout and unconfirmed delivery by returning HTTP 504.
4. `src/services/worker-registry.js`:
   - SYNC-16-01: Decouple `lastHeartbeat` (Manager time) from `lastStateAt` (Worker time) to prevent clock skew dropouts.
   - API-07: Preserve `manuallyStopped` flag in `updateStatus`.
5. `src/storage/supabase-worker-store.js`:
   - SYNC-16-02: Reliable `addEvent` fallback maintaining bounded 100-event array in `events` column with idempotency key deduplication.
6. `tests/command-execution-audit.test.js`:
   - Write comprehensive automated test suite in `D:\manager\tests\command-execution-audit.test.js` validating all 15 Manager findings.

## Verification:
- Run `cmd /c "cd /d D:\manager && npm test"` and verify all existing tests continue to pass 100%.
- Run `cmd /c "cd /d D:\manager && node tests/command-execution-audit.test.js"` and verify all 15 findings pass 100%.

## Deliverables:
- Write `D:\manager\.agents\teamwork\worker_phase2_mgr\changes.md`.
- Write `D:\manager\.agents\teamwork\worker_phase2_mgr\handoff.md`.
- Send completion message to parent.
