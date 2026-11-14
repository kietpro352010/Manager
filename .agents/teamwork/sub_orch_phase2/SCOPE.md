# Scope: Phase 2 — Command Queue Engine, Inter-Service Transport, & BotWorker Lifecycle

## Overview
Remediate all 23 findings across Parts 3, 5-Sec2, 10, 13, 14, 15, and 16 from the master remediation plan in `D:\manager` and `D:\worker`.

## Target Repositories & Working Directories
- Primary: `D:\manager`
- Secondary: `D:\worker`

## Feature Inventory (23 findings)
| # | Bug ID | Severity | File | Description & Surgical Fix |
|---|--------|----------|------|-----------------------------|
| 1 | CMD-01 | P1 | D:\manager\src\storage\supabase-command-store.js#L260 | Enqueue fallback: enforce policy RPC; only fallback when RPC is unavailable. |
| 2 | CMD-02 | P1 | D:\manager\src\storage\supabase-command-store.js#L409 | Complete fallback: disallow direct transition from `queued -> completed`; require status to be `delivered`. |
| 3 | CMD-03 | P2 | D:\manager\src\storage\supabase-command-store.js#L365 | Poll fallback: prioritize atomic RPC with `FOR UPDATE SKIP LOCKED`; safe retry loop. |
| 4 | CMD-04 | P2 | D:\manager\src\services\command-broker.js#L20 | Result waiter: support durable lookup in DB by `commandId` so restarts don't lose status. |
| 5 | CMD-05 | P2 | D:\manager\src\services\command-broker.js#L170 | Disambiguate `execution_timeout` vs `result_timeout`; idempotent RPC to resolve race condition with late results. |
| 6 | CMD-06 | P2 | D:\manager\src\services\command-broker.js#L322 | Schema validation for result payload according to action type before saving. |
| 7 | CMD-07 | P2 | D:\manager\src\services\command-broker.js#L350 | Convert `cancelWorker` to async function and `await this.commandStore.clearWorker(...)`. |
| 8 | CMD-08 | P2 | D:\manager\src\services\command-broker.js#L65 | Use `this.instanceId` (UUID) as outbox lock owner claim instead of PID. |
| 9 | API-05 | P1 | D:\manager\src\http\routes\user-api.js#L420 | Chat API `/bot/:id/send` returns 200 only upon Broker confirmation; return 504 on timeout/undelivered. |
| 10 | API-06 | P1 | D:\manager\src\http\routes\user-api.js#L482 | Window click/close & inventory verify broker confirmation (`delivered`, `timedOut`, `result.ok`) before returning 200. |
| 11 | API-07 | P1 | D:\manager\src\http\routes\user-api.js#L644 | Defer setting `manuallyStopped` flag until worker execution of STOP/START is confirmed. |
| 12 | API-08 | P1 | D:\manager\src\http\routes\user-api.js#L658 | Lifecycle handlers handle timeout and unconfirmed delivery by returning HTTP 504. |
| 13 | API-09 | P2 | D:\manager\src\services\command-broker.js#L140 | Symmetrical command response DTO between Render (push) and WispByte (pull). |
| 14 | INT-10-01 | P2 | D:\worker\src\transports\wispbyte-poller.js#L57 | Pending-result retry queue with exponential backoff on BotWorker. |
| 15 | INT-10-02 | P2 | D:\worker\src\services\worker-fleet.js#L52 | Event reporting queue with retry and ACK between Manager and BotWorker. |
| 16 | SEC-10-03 | P2 | D:\worker\src\services\wispbyte-keepalive.js#L29 | Enforce HTTPS and strict whitelist `https://wispbyte.com` for keepalive cookies. |
| 17 | HTTP-13-01 | P2 | D:\worker\src\http\app.js#L14 | Standardize HTTP JSON parser error mapping: syntax error -> 400, body too large -> 413, server error -> 500. |
| 18 | HTTP-13-02 | P2 | D:\worker\src\http\routes.js#L26 | Standardize Command endpoint error mapping: conflict -> 409, busy -> 503, timeout -> 504. |
| 19 | RT-14-01 | P1 | D:\worker\src\services\worker-runtime.js#L226 | Retain execution lock on task timeout until task terminates; propagate signal to entire session. |
| 20 | RT-14-02 | P1 | D:\worker\src\services\worker-runtime.js#L68 | Propagate AbortSignal and cleanup mechanism to all 5 lifecycle actions (`start`, `stop`, `restart`, `reload`, `reset`). |
| 21 | RT-14-03 | P2 | D:\worker\src\services\worker-runtime.js#L103 | Deduct command rate limit quota only when command is accepted into the execution queue. |
| 22 | FLEET-15-01 | P1 | D:\worker\src\services\worker-fleet.js#L158 | Coordinate auto-start via `WorkerRuntime.execute('start')` instead of calling `session.start()` directly. |
| 23 | FLEET-15-02 | P1 | D:\worker\src\services\worker-fleet.js#L96 | Fleet state machine (`STOPPED`, `STARTING`, `RUNNING`, `STOPPING`) with concurrency locking to prevent timer leaks. |
| 24 | FLEET-15-03 | P2 | D:\worker\src\transports\wispbyte-poller.js#L88 | Cancellable delay with AbortController for Poller `stop()` to terminate backoff immediately. |
| 25 | SYNC-16-01 | P2 | D:\manager\src\services\worker-registry.js#L292 | Decouple `lastHeartbeat` (Manager time) from `lastStateAt` (Worker time) to prevent clock skew issues. |
| 26 | SYNC-16-02 | P2 | D:\manager\src\storage\supabase-worker-store.js#L138 | Reliable addEvent fallback with dedicated table or idempotency key. |

## Gate 2 Acceptance Criteria
1. `tests/command-execution-audit.test.js` passes 100% (covering CMD-01..08, API-05..09, SYNC-16-01..02).
2. BotWorker integration test suite passes 100% (covering INT-10-01..02, SEC-10-03, HTTP-13-01..02, RT-14-01..03, FLEET-15-01..03).
3. All previous test suites (Auth regression, Worker registry audit, integration, services-wiring, storage-sql) continue to pass 100%.
4. Reviewer verdict: APPROVE from 2 reviewers.
5. Challenger verdict: PASS from 2 challengers.
6. Forensic Auditor verdict: CLEAN from teamwork_auditor.
