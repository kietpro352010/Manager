# Adversarial Challenge Report — BotWorker Phase 2

## Challenge Summary

**Overall risk assessment**: LOW
**Milestone**: Phase 2 — BotWorker Lifecycle, Transports & HTTP API (INT-10-01..02, SEC-10-03, HTTP-13-01..02, RT-14-01..03, FLEET-15-01..03)
**Evaluated Repository**: `D:\worker`
**Independent Stress Test Suite**: `D:\worker\tests\challenger_stress.test.js` (8 stress testing suites, 100% PASS)
**Standard Integration Test Suite**: `npm test` (`tests/integration.test.js` — 24 tests, 100% PASS)

---

## Adversarial Hypotheses & Challenges

### 1. Poller Stop Latency & Cancellable Sleep (FLEET-15-03)
- **Assumption challenged**: Poller backoff sleep (`cancellableSleep`) terminates immediately (< 50ms) when `poller.stop()` is invoked, without hanging up to 60s.
- **Attack scenario**: Inject connection failures to drive backoff delay to maximum (~48,000ms – 60,000ms). Trigger `poller.stop()` while poller is in deep backoff sleep. Execute rapid start-stop-start cycles and concurrent stop calls.
- **Blast radius**: If this fails, worker process shutdown hangs for up to 1 minute, preventing timely container termination, deployment rotation, and graceful restart on host nodes.
- **Empirical result**:
  - Deep backoff sleep (24s–60s) cancelled in **0ms** (well below the 50ms SLA).
  - 5 rapid start/stop cycles resolved in **0–1ms** each.
  - Concurrent `stop()` calls resolved in **0ms** without unhandled rejections or deadlocks.
- **Status**: PASSED.

---

### 2. Pending-Result Retry Queue & Backoff Resilience (INT-10-01)
- **Assumption challenged**: BotWorker safely buffers command execution results during Manager disconnection, enforces a bounded FIFO queue, and flushes with exponential backoff without dropping results upon network recovery.
- **Attack scenario**: Flood poller with 150 command results during network outage; simulate repeated HTTP 503 errors on `/result`; verify backoff interval progression; recover network and verify delivery.
- **Blast radius**: Result loss causes Manager command broker to time out commands that actually executed, causing client state divergence, retry loops, and unconfirmed actions.
- **Empirical result**:
  - Buffer capped at exactly 100 items; oldest 50 items safely pruned (FIFO).
  - Exponential backoff calculated correctly: Attempt 1 = ~2000ms; Attempt 2 = ~4000ms.
  - Flush requests before `nextRetryAt` window are skipped to protect network bandwidth.
  - When connection is restored, pending results are delivered with full fidelity (`commandId`, `action`, `result`) and queue drains to 0.
  - `flushPendingResults` safely exits early when `stopping === true`.
- **Status**: PASSED.

---

### 3. Event Reporting Queue ACK Validation & Credential Redaction (INT-10-02)
- **Assumption challenged**: `ManagerReporter.enqueueEvent` scrubs sensitive credentials, enforces 100-item bound, and `flushEventQueue` validates body ACK (`body.ok === true`), retrying if Manager returns HTTP 200 with `{ ok: false }` or HTTP 500.
- **Attack scenario**: Enqueue events containing raw passwords, tokens, and sensitive slash commands (`/login secret_pass_123`, `password: secret_pass_456`). Respond with HTTP 200 `{ ok: false }` and HTTP 500. Then return `{ ok: true }`. Flood with 150 events.
- **Blast radius**: Leaking credentials in manager audit logs or Discord webhooks; silent event loss if 200 OK without `body.ok` is treated as success.
- **Empirical result**:
  - `password` and `token` fields deleted; `/login` command and `password:` string values redacted to `*** REDACTED ***`.
  - HTTP 200 with `{ ok: false }` and HTTP 500 both trigger retry with backoff.
  - ACK `{ ok: true }` immediately dequeues event.
  - Queue capped at 100 items with oldest items pruned.
- **Status**: PASSED.

---

### 4. Keepalive Panel URL Strict HTTPS & SSRF Prevention (SEC-10-03)
- **Assumption challenged**: Only valid HTTPS URLs on `wispbyte.com` or `*.wispbyte.com` are allowed; all SSRF attempts, loopback IPs, cloud metadata, arbitrary protocols, and suffix hijackings are rejected without making network requests.
- **Attack scenario**: Execute battery of 23 attack vectors including `http://`, `ftp://`, `file://`, `javascript:`, `ws://`, `https://wispbyte.com.evil.com`, `https://evilwispbyte.com`, `https://127.0.0.1`, `https://169.254.169.254`, `https://localhost:8443`, authority spoofing `https://wispbyte.com@attacker.com`, and malformed URIs.
- **Blast radius**: Critical SSRF vulnerability leaking session cookies or AWS IAM metadata to external attacker servers.
- **Empirical result**:
  - All 23 malicious attack vectors were rejected at instantiation (`enabled = false`, `lastStatus = 'error'`).
  - Zero network fetch requests were triggered for invalid URLs (`ping()` exits immediately).
  - Valid URLs (`https://wispbyte.com/client`, `https://panel.wispbyte.com/client`, etc.) succeed.
  - Omitted `panelUrl` safely defaults to `https://wispbyte.com/client`.
- **Status**: PASSED.

---

### 5. HTTP Error Code Mapping Contracts (HTTP-13-01, HTTP-13-02)
- **Assumption challenged**: Express router strictly maps client and execution errors to standardized HTTP status codes (400, 401, 404, 409, 413, 429, 503, 504).
- **Attack scenario**: Send malformed JSON (`{"action":`), oversized payloads (>32kb), unsupported actions, simulated lifecycle conflicts, rate limit errors, queue busy errors, and execution timeouts against live Express HTTP server.
- **Blast radius**: Unmapped errors return generic 500s or 400s, causing Manager broker to misinterpret worker status and fail retry/failover logic.
- **Empirical result**:
  - Malformed JSON -> HTTP 400 `{ ok: false, error: 'invalid_json' }`.
  - Body > 32kb -> HTTP 413 `{ ok: false, error: 'payload_too_large' }`.
  - Unsupported action -> HTTP 400 `{ ok: false, error: 'unsupported_action' }`.
  - `LIFECYCLE_CONFLICT` -> HTTP 409.
  - `RATE_LIMIT` -> HTTP 429.
  - `QUEUE_BUSY` -> HTTP 503.
  - `ETIMEDOUT` -> HTTP 504.
  - Invalid secret -> HTTP 401 `{ ok: false, error: 'unauthorized' }`.
- **Status**: PASSED.

---

### 6. Rate Limit Quota Non-Deduction on Rejected Commands (RT-14-03)
- **Assumption challenged**: Commands rejected prior to queue admission (bad payload, oversized body, unsupported action, lifecycle conflict, queue busy) do NOT consume rate limit quota.
- **Attack scenario**: Blast 50 invalid/conflicting commands that fail admission checks. Verify `commandTimes` length remains 0. Then execute 30 valid commands to confirm full quota availability before the 31st command is blocked.
- **Blast radius**: Malicious or buggy clients spamming invalid inputs could exhaust worker rate limit quota, causing denial of service for legitimate manager commands.
- **Empirical result**:
  - 50 rejected commands produced exactly **0 deductions** in `commandTimes`.
  - All 30 subsequent valid commands were admitted and executed cleanly.
  - Command 31 was rejected with `RATE_LIMIT`.
- **Status**: PASSED.

---

### 7. Fleet Concurrency & Duplicate Timer Leaks (FLEET-15-02)
- **Assumption challenged**: Concurrent invocations of `fleet.start()` do not create duplicate heartbeat or resource monitor intervals, and `fleet.stop()` cleans all timers.
- **Attack scenario**: Fire 10 concurrent `fleet.start()` calls; check timer instances; fire 5 more while running; fire 5 concurrent `fleet.stop()` calls; restart and stop again.
- **Blast radius**: Interval timer leaks cause cumulative CPU spikes, redundant heartbeat flooding to Manager, and uncollected memory references.
- **Empirical result**:
  - Exactly one `heartbeatTimer` and one `resourceTimer` created.
  - Duplicate `start()` calls ignored.
  - All timers set to `null` and cleared on `stop()`.
  - Fleet restarts cleanly without leaking prior timers.
- **Status**: PASSED.

---

### 8. Task Timeout Execution Lock Retention & Queued Conflict Safety (RT-14-01, RT-14-02)
- **Assumption challenged**: When a non-lifecycle command times out, subsequent queued tasks are held until the background task completes (or safety timeout expires), preventing concurrent bot actions. Also, conflicting lifecycle commands are rejected immediately if another lifecycle is queued.
- **Attack scenario**:
  - Launch slow Task 1 (100ms) with 25ms timeout. Launch Task 2 immediately upon timeout. Verify Task 2 does not execute while Task 1 is running.
  - Launch slow Chat task; queue `stop`; send `restart` while `stop` is waiting. Verify `restart` is immediately rejected with 409 `LIFECYCLE_CONFLICT`.
- **Blast radius**: Concurrently executing Minecraft actions corrupt bot internal inventory, pathfinding, and connection states.
- **Empirical result**:
  - Task 2 waited until Task 1 completed before executing; zero overlap.
  - Queued lifecycle check immediately blocked conflicting command with `LIFECYCLE_CONFLICT`.
- **Status**: PASSED.

---

## Stress Test Results

| Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|
| 1.1 Deep backoff sleep (up to 60s) cancelled | Stop in < 50ms | Stopped in 0ms | PASS |
| 1.2 Rapid start/stop cycles (x5) | Each stop in < 50ms | Stopped in 0–1ms | PASS |
| 1.3 Concurrent stop calls (x3) | Resolve in < 50ms | Resolved in 0ms | PASS |
| 2.1 Result queue overflow (150 items) | Cap at 100, prune FIFO | Bounded at 100, oldest dropped | PASS |
| 2.2 Result retry exponential backoff | 2s, 4s backoff; flush on recovery | Exact exponential intervals verified | PASS |
| 2.3 Result flush while stopping | No-op, preserve items | No requests sent, preserved | PASS |
| 3.1 Credential redaction in events | Strip pass/token, redact commands | Redacted to *** REDACTED *** | PASS |
| 3.2 Event retry on non-ACK & 500 | Retried with backoff until ACK | Retried on {ok:false} & 500; cleared on ACK | PASS |
| 3.3 Event queue overflow (150 items) | Cap at 100, prune FIFO | Bounded at 100, oldest dropped | PASS |
| 4.1 23 SSRF & HTTP bypass vectors | Reject at init, 0 network requests | All 23 disabled, 0 fetches | PASS |
| 4.2 Valid HTTPS wispbyte.com URLs | Allowed, ping succeeds | All 5 valid URLs accepted | PASS |
| 4.3 Omitted panelUrl | Defaults to https://wispbyte.com/client | Default applied safely | PASS |
| 5.1 Malformed JSON body | HTTP 400 invalid_json | HTTP 400 invalid_json | PASS |
| 5.2 Payload > 32kb | HTTP 413 payload_too_large | HTTP 413 payload_too_large | PASS |
| 5.3 Unsupported action | HTTP 400 unsupported_action | HTTP 400 unsupported_action | PASS |
| 5.4 Lifecycle conflict error | HTTP 409 | HTTP 409 | PASS |
| 5.5 Rate limit error | HTTP 429 | HTTP 429 | PASS |
| 5.6 Queue busy error | HTTP 503 | HTTP 503 | PASS |
| 5.7 Command timeout error | HTTP 504 | HTTP 504 | PASS |
| 5.8 Invalid worker secret | HTTP 401 | HTTP 401 | PASS |
| 6.1 50 rejected commands quota check | 0 deductions in commandTimes | 0 deductions in commandTimes | PASS |
| 6.2 30 legitimate commands quota check | Deduct exactly 30 | Exactly 30 recorded | PASS |
| 6.3 Command 31 quota check | Rejected with RATE_LIMIT | Rejected with RATE_LIMIT | PASS |
| 7.1 10 concurrent fleet.start() | Exactly 1 set of timers created | 1 timer set created, RUNNING | PASS |
| 7.2 5 concurrent fleet.stop() | Timers nulled, state STOPPED | Timers nulled, state STOPPED | PASS |
| 7.3 Fleet restart after stop | Clean restart without timer leak | Re-started & stopped cleanly | PASS |
| 8.1 Task timeout execution lock | Subsequent task held until done | Task 2 executed only after Task 1 finished | PASS |
| 8.2 Queued lifecycle conflict | Immediate rejection with 409 | Rejected immediately with 409 | PASS |

---

## Unchallenged Areas
- Full cross-service live integration with Supabase real database instance (scoped to Phase 6 E2E).
- Real Minecraft network protocol against live external servers (scoped to manual QA / E2E).
