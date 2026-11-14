## 2026-11-14T06:21:24Z
You are Worker for Phase 2: Command Queue Engine, Inter-Service Transport, & BotWorker Lifecycle.

Working directory: D:\manager (and D:\worker)
State folder: D:\manager\.agents\teamwork\worker_phase2\

## Mandatory Files to Read First:
1. `D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md` (MUST read verbatim before doing any work)
2. `D:\manager\.agents\teamwork\orchestrator\PROJECT.md`
3. `D:\manager\.agents\teamwork\sub_orch_phase2\SCOPE.md`
4. Master Explorer Reports:
   - `D:\manager\.agents\teamwork\explorer_phase2_1\analysis.md` (CMD-01..08, API-09)
   - `D:\manager\.agents\teamwork\explorer_phase2_2\analysis.md` (API-05..08, SYNC-16-01..02)
   - `D:\manager\.agents\teamwork\explorer_phase2_3\analysis.md` (INT-10-01..02, SEC-10-03, HTTP-13-01..02, RT-14-01..03, FLEET-15-01..03)

## MANDATORY INTEGRITY WARNING:
> DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## User Directive - High Velocity & Quality:
"mục đích là fix các lỗi bug nhé" & "ko cần làm gì thừa thải hoặc không cần thiết quá, chỉ cần hiệu quả, chất lượng, tốc độ càng tốt".
Apply surgical code modifications directly based on the line-by-line analyses provided by the 3 Explorers.

## Implementation Tasks:
### A. Manager Scope (`D:\manager`):
1. `src/storage/supabase-command-store.js`: CMD-01, CMD-02, CMD-03.
2. `src/services/command-broker.js`: CMD-04, CMD-05, CMD-06, CMD-07, CMD-08, API-09.
3. `src/http/routes/user-api.js`: API-05, API-06, API-07, API-08.
4. `src/services/worker-registry.js`: SYNC-16-01, API-07.
5. `src/storage/supabase-worker-store.js`: SYNC-16-02.
6. `tests/command-execution-audit.test.js`: Comprehensive test suite for all 15 Manager findings.

### B. BotWorker Scope (`D:\worker`):
1. `src/transports/wispbyte-poller.js`: INT-10-01, FLEET-15-03.
2. `src/services/worker-fleet.js` & `src/transports/manager-reporter.js`: INT-10-02, FLEET-15-01, FLEET-15-02.
3. `src/services/wispbyte-keepalive.js`: SEC-10-03.
4. `src/http/app.js`: HTTP-13-01.
5. `src/http/routes.js`: HTTP-13-02.
6. `src/services/worker-runtime.js` & `src/game/minecraft-session.js`: RT-14-01, RT-14-02, RT-14-03.
7. BotWorker Tests: Integration test suite for all 11 BotWorker findings.

## Verification:
- Execute `npm test` in `D:\manager` and `node tests/command-execution-audit.test.js`.
- Execute `npm test` in `D:\worker`.
- Verify 100% pass across all test suites with 0 failures and 0 regressions.
