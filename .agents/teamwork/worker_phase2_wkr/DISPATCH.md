## 2026-11-14T06:42:34Z
You are Worker 2 for Phase 2: BotWorker Lifecycle, Transports & HTTP API.

Working directory: D:\worker
State folder: D:\manager\.agents\teamwork\worker_phase2_wkr\

## Mandatory Files to Read First:
1. `D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md` (MUST read verbatim before doing any work)
2. `D:\manager\.agents\teamwork\orchestrator\PROJECT.md`
3. `D:\manager\.agents\teamwork\sub_orch_phase2\SCOPE.md`
4. Master Explorer Report:
   - `D:\manager\.agents\teamwork\explorer_phase2_3\analysis.md` (INT-10-01..02, SEC-10-03, HTTP-13-01..02, RT-14-01..03, FLEET-15-01..03)

## MANDATORY INTEGRITY WARNING:
> DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## User Directive - High Velocity & Quality:
"mục đích là fix các lỗi bug nhé" & "ko cần làm gì thừa thải hoặc không cần thiết quá, chỉ cần hiệu quả, chất lượng, tốc độ càng tốt".
Apply surgical code modifications directly following the exact line-by-line analysis and code diffs in `explorer_phase2_3\analysis.md`.

## Exclusive Write Ownership (in D:\worker):
1. `src/transports/wispbyte-poller.js`:
   - INT-10-01: Pending-result retry queue with exponential backoff on `/result` failure.
   - FLEET-15-03: `cancellableSleep` with `AbortController` for Poller `stop()` to terminate backoff immediately (< 50ms).
2. `src/services/worker-fleet.js` & `src/transports/manager-reporter.js`:
   - INT-10-02: Event reporting queue with retry, backoff, and ACK verification (`body.ok`).
   - FLEET-15-01: Coordinate auto-start via `WorkerRuntime.execute('start')`.
   - FLEET-15-02: Fleet state machine (`STOPPED`, `STARTING`, `RUNNING`, `STOPPING`) with concurrency locking against duplicate timer leaks.
3. `src/services/wispbyte-keepalive.js`:
   - SEC-10-03: Enforce HTTPS and strict whitelist `https://wispbyte.com` for keepalive cookies.
4. `src/http/app.js`:
   - HTTP-13-01: Standardize JSON parser error mapping (400 invalid JSON, 413 payload too large, 500 server error).
5. `src/http/routes.js`:
   - HTTP-13-02: Standardize Command endpoint error mapping (400, 409 conflict, 429 rate limit, 503 queue busy, 504 timeout).
6. `src/services/worker-runtime.js` & `src/game/minecraft-session.js`:
   - RT-14-01: Retain execution lock on task timeout until task terminates; propagate signal to session.
   - RT-14-02: Propagate AbortSignal and cleanup mechanism to all 5 lifecycle actions (`start`, `stop`, `restart`, `reconnect`, `reset`).
   - RT-14-03: Deduct command rate limit quota only when command is admitted into execution queue.
7. BotWorker Tests:
   - Update `D:\worker\tests\integration.test.js` (and/or add test cases) to verify all 11 BotWorker findings.

## Verification:
- Run `cmd /c "cd /d D:\worker && npm test"` and verify all integration tests pass 100% (0 failures, 0 regressions).

## Deliverables:
- Write `D:\manager\.agents\teamwork\worker_phase2_wkr\changes.md`.
- Write `D:\manager\.agents\teamwork\worker_phase2_wkr\handoff.md`.
- Send completion message to parent.
