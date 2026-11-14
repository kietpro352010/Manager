## 2026-11-14T06:50:47Z
You are Challenger 2 for Phase 2: BotWorker Lifecycle, Transports & HTTP API.

Working directory: D:\worker
State folder: D:\manager\.agents\teamwork\challenger_phase2_2\

## Mandatory Files to Read First:
1. `D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md` (MUST read verbatim before doing any work)
2. `D:\manager\.agents\teamwork\orchestrator\PROJECT.md`
3. `D:\manager\.agents\teamwork\sub_orch_phase2\SCOPE.md`
4. Worker Report: `D:\manager\.agents\teamwork\worker_phase2_wkr\handoff.md`

## Mission:
Empirically and adversarially challenge the BotWorker fixes for INT-10-01..02, SEC-10-03, HTTP-13-01..02, RT-14-01..03, FLEET-15-01..03:
1. Stress test `poller.stop()`: verify `cancellableSleep` terminates backoff sleep immediately (< 50ms) instead of hanging up to 60s.
2. Stress test pending-result retry queue: verify failed `/result` reports are queued and flushed upon reconnect with exponential backoff.
3. Stress test event reporting queue: verify ACK validation (`body.ok`) and retry on failure.
4. Adversarially test keepalive panel URL: test SSRF and HTTP bypass attempts; verify only HTTPS and `*.wispbyte.com` are allowed.
5. Stress test HTTP error mappings: verify 400 for bad JSON, 413 for body > 32kb, 409 for lifecycle conflict, 429 for rate limit, 503 for queue busy, 504 for timeout.
6. Stress test rate limit quota: verify rejected commands do NOT deduct quota.
7. Stress test fleet concurrency: verify concurrent `fleet.start()` calls do not create duplicate timers.
8. Run tests:
   `cmd /c "cd /d D:\worker && npm test"`

## Deliverables:
- Write adversarial test results to `D:\manager\.agents\teamwork\challenger_phase2_2\challenge.md`.
- Write `D:\manager\.agents\teamwork\challenger_phase2_2\handoff.md` with explicit verdict: `APPROVE` or `FAIL`.
- Send completion message to parent.
