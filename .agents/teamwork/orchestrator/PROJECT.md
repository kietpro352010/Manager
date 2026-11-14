# Project: KBOT v3 Full Master Audit Remediation & Verification

## Architecture
- **KBOT Manager** (`D:\manager`):
  - Express HTTP server (`src/http/app.js`, `src/http/routes/*.js`, `src/http/views/*.js`).
  - Worker Registry & Command Broker (`src/services/worker-registry.js`, `src/services/command-broker.js`, `src/services/async-key-lock.js`).
  - Storage Layer (`src/storage/supabase-*.js`, `src/storage/schema-sql.js`, `supabase/migrations/*.sql`).
  - Utilities & Helpers (`src/utils/secrets.js`, `src/utils/locks.js`).
- **KBOT BotWorker** (`D:\worker`):
  - Bot Worker Runtime & Fleet Management (`src/services/worker-runtime.js`, `src/services/worker-fleet.js`).
  - Transport Layer (`src/transports/wispbyte-poller.js`, `src/transports/outbox-poller.js`).
  - HTTP Server & Keepalive (`src/http/app.js`, `src/http/routes.js`, `src/services/wispbyte-keepalive.js`).
- **Test Frameworks**: Native Node.js `node:assert`, `node:test`, custom test runners executed via `npm test`.

## Feature Inventory & Milestones
| # | Feature / Bug ID | Severity | Milestone | Description |
|---|------------------|----------|-----------|-------------|
| 1 | AUTH-01 / SEC-01 | P1 | Phase 1 | Scrypt password hashing & automatic legacy password upgrade on login |
| 2 | AUTH-02 / SEC-02 | P1 | Phase 1 | Fail-closed DB session persistence in /register and /login (503 on failure) |
| 3 | AUTH-03 | P1 | Phase 1 | Session revocation & cookie clearing in /change-password |
| 4 | AUTH-04 | P1 | Phase 1 | Synchronized DB logout revocation via RPC revoke_manager_session & warning logs |
| 5 | AUTH-05 / SEC-05 | P2 | Phase 1 | Express trust proxy enablement & real req.ip in rate limiter |
| 6 | AUTH-06 / SEC-03 | P2 | Phase 1 | Bounded loginAttempts Map (MAX_ENTRIES = 5000) & expiration cleanup |
| 7 | SEC-04 | P2 | Phase 1 | Harmonized webSessionTtlHours in milliseconds across cookie Max-Age & DB |
| 8 | SEC-OBS-01 | P2 | Phase 1 | Preserve session.role in createManagerUserSession DB storage |
| 9 | AUTH-07 | P2 | Phase 1 | Explicit key redemption status reporting in /register (keyRedeemed, keyError) |
| 10 | AUTH-08 | P2 | Phase 1 | Single Source of Truth DB auth & instant RAM cache invalidation on login/logout |
| 11 | WORKER-01 | P1 | Phase 1 | Await registry.verifyBotSecret(botId, secret) in POST /api/auth/verify-bot-access |
| 12 | WORKER-02 / WKR-01 | P1 | Phase 1 | 60s TTL for worker secretCache & programmatic invalidateWorkerSecret method |
| 13 | WORKER-03 | P2 | Phase 1 | Scoped global bot secret usage with dedicated audit log |
| 14 | WORKER-04 | P2 | Phase 1 | Atomic bot sequence number generation in nextBotNumber fallback |
| 15 | WORKER-05 | P2 | Phase 1 | Prevent calling addEvent when worker is non-existent or disabled |
| 16 | WORKER-06 | P2 | Phase 1 | Prevent calling rotateSecret when worker is disabled |
| 17 | WORKER-07 | P2 | Phase 1 | Non-silent RPC error handling in supabase-worker-store (resetData, addEvent) |
| 18 | WORKER-08 | P2 | Phase 1 | Strict schema validation for Worker status payload |
| 19 | WKR-02 | P2 | Phase 1 | Secret rotation grace period and status signaling for BotWorker |
| 20 | WKR-03 | P2 | Phase 1 | Trim public /health endpoint in BotWorker to prevent diagnostics leakage |
| 21 | CMD-01 | P1 | Phase 2 | Enqueue fallback policy enforcement in supabase-command-store |
| 22 | CMD-02 | P1 | Phase 2 | Disallow direct queued -> completed transition in complete fallback |
| 23 | CMD-03 | P2 | Phase 2 | Atomic poll fallback with FOR UPDATE SKIP LOCKED |
| 24 | CMD-04 | P2 | Phase 2 | Durable result tracking on DB surviving process restart |
| 25 | CMD-05 | P2 | Phase 2 | Disambiguate execution_timeout vs result_timeout with idempotent RPC |
| 26 | CMD-06 | P2 | Phase 2 | Result payload schema validation per command action type |
| 27 | CMD-07 | P2 | Phase 2 | Convert cancelWorker to async and await clearWorker |
| 28 | CMD-08 | P2 | Phase 2 | UUID instanceId as outbox lock owner claim |
| 29 | API-05 | P1 | Phase 2 | Chat API /bot/:id/send returns 200 only upon Broker confirmation (504 timeout) |
| 30 | API-06 | P1 | Phase 2 | Window click/close & inventory verify broker result before 200 response |
| 31 | API-07 | P1 | Phase 2 | Defer manuallyStopped flag update until worker execution confirmed |
| 32 | API-08 | P1 | Phase 2 | Lifecycle handlers handle timeout and unconfirmed delivery with 504 |
| 33 | API-09 | P2 | Phase 2 | Symmetrical command response DTO between Render (push) and WispByte (pull) |
| 34 | INT-10-01 | P2 | Phase 2 | Pending result retry queue with exponential backoff on BotWorker |
| 35 | INT-10-02 | P2 | Phase 2 | Event queue with ACK between BotWorker and Manager |
| 36 | SEC-10-03 | P2 | Phase 2 | Force HTTPS and whitelist https://wispbyte.com for keepalive cookies |
| 37 | HTTP-13-01 | P2 | Phase 2 | Standardize HTTP JSON parser error mapping (400, 413, 500) on BotWorker |
| 38 | HTTP-13-02 | P2 | Phase 2 | Standardize Command endpoint error mapping (409, 429, 503, 504) on BotWorker |
| 39 | RT-14-01 | P1 | Phase 2 | Retain execution lock on task timeout and propagate signal to session |
| 40 | RT-14-02 | P1 | Phase 2 | Propagate AbortSignal and cleanup mechanism to all 5 lifecycle actions |
| 41 | RT-14-03 | P2 | Phase 2 | Deduct command rate limit quota only when accepted into queue |
| 42 | FLEET-15-01 | P1 | Phase 2 | Coordinate auto-start via WorkerRuntime.execute('start') |
| 43 | FLEET-15-02 | P1 | Phase 2 | Concurrency lock and Fleet state machine to prevent timer leaks |
| 44 | FLEET-15-03 | P2 | Phase 2 | Cancellable delay with AbortController for Poller stop() |
| 45 | SYNC-16-01 | P2 | Phase 2 | Decouple lastHeartbeat (Manager time) from lastStateAt (Worker time) |
| 46 | SYNC-16-02 | P2 | Phase 2 | Reliable addEvent fallback with dedicated table or idempotency key |
| 47 | P6-01 | P1 | Phase 3 | AsyncKeyLock retains lock on task timeout until execution terminates |
| 48 | P6-02 | P1 | Phase 3 | Durable savePendingAllocation with rollback on persistence failure |
| 49 | P6-03 | P1 | Phase 3 | DNS hostname lookup in proxy validation to prevent SSRF |
| 50 | P6-04 | P1 | Phase 3 | Secure Link4M return flow validation and server-to-server verification |
| 51 | P6-05 | P2 | Phase 3 | Restrict fixedIds allocation within plan targetCount quota |
| 52 | P6-06 | P2 | Phase 3 | Enforce Link4M dailyLimit before generating attempt URL |
| 53 | P6-07 | P2 | Phase 3 | Sanitize worker settings response via sanitizeBotForSession |
| 54 | P6-08 | P2 | Phase 3 | Process advisory locks for distributed synchronization |
| 55 | ACC-11-01 | P2 | Phase 3 | Check accessControl.isEntitled(user) in Discord /bots and /logs |
| 56 | ACC-11-02 | P1 | Phase 3 | Strict expiry check: non-permanent accounts require valid expiresAt |
| 57 | ACC-11-03 | P1 | Phase 3 | Synchronized deletion in both ASSIGNMENTS and manager_users.assigned_bot_ids |
| 58 | ACC-11-04 | P2 | Phase 3 | Validate worker existence in WorkerRegistry before granting access |
| 59 | DIS-12-01 | P2 | Phase 3 | Unified Discord Admin authorization check across interactions & commands |
| 60 | DIS-12-02 | P2 | Phase 3 | Fix services.discordClient?.isReady?.() check in admin commands |
| 61 | DIS-12-03 | P2 | Phase 3 | Decouple deep health check (DB latency, Broker, Gateway) from status |
| 62 | DIS-12-04 | P2 | Phase 3 | Escape HTML and verify response.ok in Telegram admin notifications |
| 63 | DIS-12-05 | P2 | Phase 3 | Admin notifier alert queue with delivery states and retry backoff |
| 64 | API-01 | P1 | Phase 3 | Standardize userRouter prefix under /api/user, limit aliases |
| 65 | API-02 | P2 | Phase 3 | Restrict CSRF bypass: require valid secret header for worker routes |
| 66 | API-03 | P1 | Phase 3 | Strict Array.isArray() validation for auto chat and schedules |
| 67 | API-04 | P1 | Phase 3 | Persist bot ordering in /bots/reorder into user metadata |
| 68 | P7-01 | P1 | Phase 3 | Remove undefined sanitizeBackupPayload call in saveBackup |
| 69 | P7-02 | P1 | Phase 3 | Harmonize backup filename format backup-YYYY-MM-DD...json |
| 70 | P7-03 | P1 | Phase 3 | Full restore support for both users and keys with reconciliation |
| 71 | P7-04 | P2 | Phase 3 | Implement DELETE /backups/:filename to delete from Supabase storage |
| 72 | ADM-20-01 | P2 | Phase 3 | Audit logs pagination (OFFSET) and multi-field filters (q, category, status, logType) |
| 73 | ADM-20-02 | P2 | Phase 3 | Persist trialGiftEnabled and trialDays in manager_settings table |
| 74 | DB-01 | P1 | Phase 4 | Use GET DIAGNOSTICS changed = ROW_COUNT; RETURN changed > 0 in reset RPC |
| 75 | DB-02 | P1 | Phase 4 | Explicit REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated across all 27 tables |
| 76 | DB-03 | P2 | Phase 4 | Add foreign key constraints across data relations |
| 77 | DB-04 | P2 | Phase 4 | Reconcile reset worker contract between migration and canonical schema-sql.js |
| 78 | DB-05 | P1 | Phase 4 | Safety guard in reset_and_setup.sql against execution in Production |
| 79 | DB-06 | P2 | Phase 4 | Advisory or row-level lock on Discord account linking |
| 80 | DB-07 | P2 | Phase 4 | Verify data === true and business payload in RPC responses |
| 81 | P7-05 | P1 | Phase 4 | Invariant verification v_attempt.user_id = p_user_id in manager_complete_link4m_reward |
| 82 | P7-06 | P2 | Phase 4 | Real workflow SQL test suite (backup create -> fetch -> restore -> delete) |
| 83 | UI-17-01 | P2 | Phase 5 | Display publicLicenseKey input when account is expired on login page |
| 84 | UI-17-02 | P2 | Phase 5 | Modal Focus Manager (focus trap, Escape closes topmost modal, restore focus) |
| 85 | UI-17-03 | P2 | Phase 5 | Mobile sidebar aria-expanded, aria-controls="appSidebar", Escape closes sidebar |
| 86 | UI-17-04 | P2 | Phase 5 | Landmark semantic <main id="mainContent"> and skip navigation link |
| 87 | UI-17-05 | P2 | Phase 5 | Convert logo div to accessible <button type="button"> |
| 88 | UI-18-01 | P2 | Phase 5 | Convert bot status filters to role="group" with aria-pressed |
| 89 | UI-18-02 | P2 | Phase 5 | Audit log UI text clarification and latest timestamp display |
| 90 | UI-18-03 | P2 | Phase 5 | Neutral "Đã lưu" label for backups unless integrity verified |
| 91 | UI-18-04 | P2 | Phase 5 | Exclude disabled accounts from permanent group in user filter |
| 92 | UI-18-05 | P2 | Phase 5 | Row-level loading states and disabled action buttons in User table |
| 93 | UI-19-01 | P2 | Phase 5 | Accessible button slots for Inventory with Enter/Space keyboard support |
| 94 | UI-19-02 | P2 | Phase 5 | Accessible button slots for 54 Remote GUI slots with keyboard navigation |
| 95 | UI-19-03 | P2 | Phase 5 | Connection error banner with retry button in bot detail view |
| 96 | UI-19-04 | P2 | Phase 5 | Reset timestamp on coordinate fetch error to allow immediate retry |
| 97 | UI-19-05 | P2 | Phase 5 | Concurrency flag detailGuiBusy to prevent spam clicks on GUI slots |
| 98 | E2E-01 | P1 | Phase 6 | Full cross-service integration and 100% test pass on Manager & BotWorker |

## Milestones & Gates
| # | Milestone Name | Scope | Prerequisite | Gate Criteria | Status |
|---|----------------|-------|--------------|---------------|--------|
| Phase 1 | Security, Auth & Worker Registry | Parts 1, 8, 2, 9 (20 bugs) | None | tests/auth-regression.test.js 100% PASS, tests/worker-registry-audit.test.js 100% PASS, all 37 baseline tests PASS | DONE |
| Phase 2 | Command Queue & BotWorker Lifecycle | Parts 3, 5-Sec2, 10, 13, 14, 15, 16 (23 bugs) | Phase 1 Gate | tests/command-execution-audit.test.js 100% PASS, BotWorker integration tests 100% PASS | IN_PROGRESS |
| Phase 3 | Authorization, Concurrency, Discord & Admin | Parts 6, 11, 12, 5-Sec1, 7-Sec1, 20 (23 bugs) | Phase 2 Gate | Authorization, proxy, backup, admin API tests 100% PASS | PLANNED |
| Phase 4 | Database Schema & SQL Migrations | Parts 4, 7-Sec2 (9 bugs) | Phase 3 Gate | Database schema & SQL migration tests 100% PASS | PLANNED |
| Phase 5 | Admin UI & Accessibility (a11y) | Parts 17, 18, 19 (15 bugs) | Phase 4 Gate | Accessibility and Admin UI tests 100% PASS | PLANNED |
| Phase 6 | E2E Integration & Full Regression | All 97 findings across both repos | Phase 5 Gate | npm test in D:\manager exits 0, npm test in D:\worker exits 0, 0 failures | PLANNED |
