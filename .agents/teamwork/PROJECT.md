# Project: KBOT V3 Remediation (Gates 3-6)

## Architecture
- **Manager (`D:\manager`)**: Node.js/Express control plane for Minecraft bot operations, providing REST/web API, Discord bot integration, Access Control & Entitlement management, Admin Alerting, Cloud Backups, and Supabase/PostgreSQL persistence.
- **Worker (`D:\worker`)**: Node.js execution engine running Mineflayer bot instances, receiving commands from Manager via HTTP/broker, reporting state and diagnostics.
- **Persistence & Security**: Supabase PostgreSQL schemas (27 tables, 52 RPCs) enforcing Row-Level Security, transaction integrity, CSRF protection, and SSRF proxy validation.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | P6-01 | AsyncKeyLock retains lock on execution timeout until underlying task settles | M1 | ORIGINAL_REQUEST §R1 |
| 2 | P6-02 | EntitlementService handles savePendingAllocation errors durably with compensation state | M1 | ORIGINAL_REQUEST §R1 |
| 3 | P6-03 | Proxy validation resolves hostnames via DNS and blocks private/loopback CIDRs | M1 | ORIGINAL_REQUEST §R1 |
| 4 | P6-04, P6-06 | Link4M verifies tokens and enforces daily limit prior to returning attempt URLs | M1 | ORIGINAL_REQUEST §R1 |
| 5 | P6-05 | EntitlementService fixed bot ID allocation capped strictly at targetCount | M1 | ORIGINAL_REQUEST §R1 |
| 6 | P6-07 | Wrap /bot/:id/settings responses with sanitizeBotForSession | M1 | ORIGINAL_REQUEST §R1 |
| 7 | P6-08 | License key redemption concurrency locking (memory key lock & Postgres FOR UPDATE) | M1 | ORIGINAL_REQUEST §R1 |
| 8 | ACC-11-01 | isEntitled returns false on null expiresAt when isPermanent is false | M2 | ORIGINAL_REQUEST §R1 |
| 9 | ACC-11-02 | Discord panel /bots and /logs verify accessControl.isEntitled(user) | M2 | ORIGINAL_REQUEST §R1 |
| 10 | ACC-11-03 | Synchronously delete worker assignments from ASSIGNMENTS and assigned_bot_ids array | M2 | ORIGINAL_REQUEST §R1 |
| 11 | ACC-11-04 | AccessControl grant() verifies worker exists in WorkerRegistry | M2 | ORIGINAL_REQUEST §R1 |
| 12 | DIS-12-01 | Unified admin authorization across admin.js and interaction-handler.js | M3 | ORIGINAL_REQUEST §R1 |
| 13 | DIS-12-02 | Deep /admin health probe (DB latency, Broker queue, Discord ping, Worker reachability) | M3 | ORIGINAL_REQUEST §R1 |
| 14 | DIS-12-03 | Escape HTML special characters (&, <, >) in Telegram alerts | M3 | ORIGINAL_REQUEST §R1 |
| 15 | DIS-12-04 | AdminNotifier verifies response.ok and retries failed alerts with exponential backoff | M3 | ORIGINAL_REQUEST §R1 |
| 16 | DIS-12-05 | Sliding-window rate limiting on alert notifications during cluster outages | M3 | ORIGINAL_REQUEST §R1 |
| 17 | API-01 | Mount userRouter strictly at /api/user | M3 | ORIGINAL_REQUEST §R1 |
| 18 | API-02 | Gated CSRF exemption for worker routes (require secret or bearer token) | M3 | ORIGINAL_REQUEST §R1 |
| 19 | API-03 | Enforce Array.isArray validation on bot schedules | M3 | ORIGINAL_REQUEST §R1 |
| 20 | API-04 | Real database persistence for /bots/reorder | M3 | ORIGINAL_REQUEST §R1 |
| 21 | P7-01 | Resolve ReferenceError in saveBackup by defining sanitizeBackupPayload | M4 | ORIGINAL_REQUEST §R1 |
| 22 | P7-02 | Backup filename formatting (backup-YYYY-MM-DDTHH-mm-ss.json) and deletion | M4 | ORIGINAL_REQUEST §R1 |
| 23 | P7-03 | Backup restore restores both users and keys in addition to registry | M4 | ORIGINAL_REQUEST §R1 |
| 24 | ADM-20-01 | Paginated and filtered GET /api/manager/audit-logs returning standard contract | M4 | ORIGINAL_REQUEST §R1 |
| 25 | ADM-20-02 | Persist trialGiftEnabled and trialDays in manager_settings ('system_settings') | M4 | ORIGINAL_REQUEST §R1 |
| 26 | G4-01 | manager_reset_worker_data ROW_COUNT check across all 4 SQL sources | M5 | ORIGINAL_REQUEST §R2 |
| 27 | G4-02 | reset_and_setup.sql disaster recovery guard | M5 | ORIGINAL_REQUEST §R2 |
| 28 | G4-03 | Link4M manager_complete_link4m_reward user invariant enforcement | M5 | ORIGINAL_REQUEST §R2 |
| 29 | G4-04 | Database 4-way schema parity validation across migrations and setup scripts | M5 | ORIGINAL_REQUEST §R2 |
| 30 | G5-01 | Public login license key registration field hint/placeholder when trial disabled | M6 | ORIGINAL_REQUEST §R2 |
| 31 | G5-02 | Modal focus trapping, Escape listener, and focus restoration | M6 | ORIGINAL_REQUEST §R2 |
| 32 | G5-03 | Semantic <main> landmark in dashboard layout | M6 | ORIGINAL_REQUEST §R2 |
| 33 | G5-04 | Accessible buttons with ARIA labels and keyboard support for 54 GUI slots & inventory | M6 | ORIGINAL_REQUEST §R2 |
| 34 | G5-05 | In-flight click mutex on action buttons and GUI slots | M6 | ORIGINAL_REQUEST §R2 |
| 35 | G6-01 | Worker-to-manager authentication Bearer token fallback in D:\worker | M6 | Survey 3 Finding |
| 36 | G6-02 | Fix event deduplication bug with undefined properties in supabase-worker-store.js | M6 | Survey 3 Finding |
| 37 | G6-03 | Chain integration and challenger tests in D:\worker\package.json | M6 | Survey 3 Finding |
| 38 | G6-04 | 100% full-suite regression test pass across D:\manager and D:\worker | M7 | ORIGINAL_REQUEST §R2 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Gate 3: Concurrency & Network Security | P6-01 to P6-08 (`async-key-lock.js`, `entitlement-service.js`, `proxy-validation.js`, `link4m-service.js`, `user-api.js`) | none | DONE (Passed Gate 1 in Iteration 2: 7/7 M1 tests passed, 6/6 manager suites passed, all verifiers APPROVE/CLEAN) |
| M2 | Gate 3: Access Control & Assignment Integrity | ACC-11-01 to ACC-11-04 (`access-control.js`, `panel-handler.js`, `bots.js`, `logs.js`, `supabase-dashboard-store.js`) | M1 | DONE (Passed Gate 2 in Iteration 1: 4/4 M2 tests passed, 6/6 manager suites passed, all verifiers APPROVE/CLEAN) |
| M3 | Gate 3: Discord Admin, Alerting & Router Security | DIS-12-01 to DIS-12-05, API-01 to API-04 (`admin.js`, `interaction-handler.js`, `admin-notifier.js`, `app.js`, `user-api.js`) | M2 | DONE (Passed Gate 3 in Iteration 1: 9/9 M3 tests passed, 6/6 manager suites passed, all verifiers APPROVE/CLEAN) |
| M4 | Gate 3: Cloud Backup & Admin API Contracts | P7-01 to P7-03, ADM-20-01 to ADM-20-02 (`supabase-client.js`, `admin-api.js`) | M3 | DONE (Passed Gate 4 in Iteration 1: 6/6 M4 tests passed, 6/6 manager suites passed, verifiers APPROVE/CLEAN) |
| M5 | Gate 4: Database Schema & Security | G4-01 to G4-04 (`reset_and_setup.sql`, `setup.sql`, `schema-sql.js`, `reconcile_full_manager_schema.sql`) | M4 | DONE (Passed Gate 5 in Iteration 1: 4/4 G4 tests passed, 7/7 storage-sql passed, 7/7 manager suites passed, verifiers APPROVE/CLEAN) |
| M6 | Gate 5 & Worker/Storage Fixes | G5-01 to G5-05, G6-01 to G6-03 (`dashboard-html.js`, `login-html.js`, `worker/src/http/auth.js`, `worker/src/http/routes.js`, `worker/package.json`, `supabase-worker-store.js`) | M5 | DONE (Passed Gate 6 in Iteration 1: 7/7 G5 tests passed, 8/8 manager suites passed, worker integration & 8 challenger tests passed, all verifiers APPROVE, Auditor CLEAN) |
| M7 | Gate 6: Final Verification & Zero Regressions | G6-04 (Full test suite execution on Manager and Worker) | M6 | DONE (Passed Gate 6 in Iteration 1: 100% test pass rate across Manager and Worker, Forensic Auditor CLEAN, Reviewer APPROVE) |

## Interface Contracts
### Manager ↔ Worker HTTP
- Headers: `x-worker-secret: <secret>` OR `Authorization: Bearer <secret>`, `x-manager-bot-id: <botId>`
- Endpoints: `POST /api/v1/commands`, `GET /api/v1/diagnostics`, `POST /api/v1/kill`
- Error formatting: `{ ok: false, error: '<code_or_message>' }`

### Manager ↔ Client API
- User routes mounted strictly at `/api/user/*`
- Admin routes mounted at `/api/manager/*`
- Audit logs: `GET /api/manager/audit-logs?page=N&limit=M&q=...&category=...&status=...&logType=...` -> `{ ok: true, logs: [...], page: N, limit: M, total: T, totalPages: P }`
- System settings: `GET /api/manager/settings/system` -> `{ ok: true, settings: { trialGiftEnabled, trialDays, publicBaseUrl, ... } }`

## Code Layout
- `D:\manager\src\services\`: AsyncKeyLock, EntitlementService, AccessControl, ProxyValidation, Link4MService, AdminNotifier
- `D:\manager\src\http\`: Express app setup, CSRF middleware, route handlers (`user-api.js`, `admin-api.js`, `auth-api.js`)
- `D:\manager\src\discord\`: Discord commands (`admin.js`, `bots.js`, `logs.js`) and interaction handlers
- `D:\manager\src\storage\`: Supabase client and worker store (`supabase-client.js`, `supabase-dashboard-store.js`, `supabase-worker-store.js`, `schema-sql.js`)
- `D:\manager\supabase\`: SQL schemas and migrations (`setup.sql`, `reset_and_setup.sql`, migrations/*.sql)
- `D:\worker\src\`: Worker HTTP server, authentication (`auth.js`), routes (`routes.js`), transports
