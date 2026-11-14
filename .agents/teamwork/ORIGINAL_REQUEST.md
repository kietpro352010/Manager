# Original User Request
## Initial Request — 2026-11-14T08:18:10Z
Remediate KBOT V3 starting with Gate 3 (23 bugs across AsyncKeyLock, Entitlement concurrency, SSRF proxy validation, access control, Discord admin & alerting, API routes, and cloud backup/admin API) across Manager (`D:\manager`) and BotWorker (`D:\worker`), then continue seamlessly through Gates 4, 5, and 6 to achieve full system stability and 100% test pass rate. Prioritize speed, efficiency, and surgical accuracy with strict test verification.

Integrity mode: development

## Requirements

### R1. Gate 3 Remediation in Manager (D:\manager) and Worker (D:\worker)
Remediate the 23 bugs in Gate 3 across the codebase:
- Concurrency & Network Security (Part 6): In `D:\manager\src\services\async-key-lock.js`, do not release the lock on timeout while the underlying task is still executing; the lock must remain held until the running task settles to prevent concurrent mutation of the critical section (P6-01). In `D:\manager\src\services\entitlement-service.js`, catch and handle `savePendingAllocation` errors durably without losing compensation state (P6-02). In `D:\manager\src\services\proxy-validation.js`, resolve hostnames via `dns.promises.lookup()` and validate resolved IPs against forbidden private/loopback ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`) before allowing proxy connections (P6-03). In `D:\manager\src\services\link4m-service.js`, verify tokens with backend API and enforce daily link limit checks prior to returning provider attempt URLs (P6-04, P6-06). In `D:\manager\src\services\entitlement-service.js`, cap fixed bot IDs allocation strictly at package quota `targetCount` (P6-05). In `D:\manager\src\http\routes\user-api.js`, pass `/bot/:id/settings` updates through `sanitizeBotForSession()` (P6-07). Ensure license key activation transactions cannot double-consume or race under parallel requests (P6-08).
- Access Control & Assignment Integrity (Part 11): In `D:\manager\src\services\access-control.js#L87`, fix `isEntitled()` so that if `isPermanent === false`, `expiresAt === null` is treated as unentitled (return false), returning true only if `expiresAt && new Date(expiresAt).getTime() > Date.now()` (ACC-11-01). In `D:\manager\src\discord\handlers\panel-handler.js`, check `accessControl.isEntitled(user)` before displaying bot lists in `/bots` and bot logs in `/logs` (ACC-11-02). In `D:\manager\src\storage\supabase-dashboard-store.js` and worker removal workflows, synchronously clean up bot assignments from both the `ASSIGNMENTS` table and `manager_users.assigned_bot_ids` array when a worker is removed or disabled, eliminating empty catch blocks (ACC-11-03). In `D:\manager\src\services\access-control.js`, verify that target bot/worker exists in `WorkerRegistry` before creating an assignment in `grant()` (ACC-11-04).
- Discord Admin, Alerting & Router Security (Part 12 & Part 5 Sec 1): In `D:\manager\src\discord\commands\admin.js`, unify admin authorization with the interaction handler, safely check `services.discordClient?.isReady?.()`, and implement a deep `/admin health` probe that measures DB latency, CommandBroker pending count, Discord Gateway latency, and Worker fleet reachability distinct from `/admin status` (DIS-12-01, DIS-12-02). In `D:\manager\src\services\admin-notifier.js`, escape HTML special characters in Telegram messages, verify `response.ok` on fetch, and implement an in-memory retry queue with exponential backoff for failed alerts (DIS-12-03, DIS-12-04). Add rate limiting to alert notifications to prevent flooding during system outages (DIS-12-05). In `D:\manager\src\http\app.js`, mount `userRouter` strictly at `/api/user`, and do not wildcard exempt worker routes from CSRF without checking `x-worker-secret` or bearer token (API-01, API-02). In `D:\manager\src\http\routes\user-api.js`, enforce `Array.isArray(schedules)` validation on bot schedules, and implement real database persistence for `/bots/reorder` (API-03, API-04).
- Cloud Backup & Admin API Contracts (Part 7 Sec 1 & Part 20): In `D:\manager\src\storage\supabase-client.js#L1966`, resolve ReferenceError in `saveBackup()` where it calls `sanitizeBackupPayload()` (P7-01). In `D:\manager\src\http\routes\admin-api.js`, align backup filename format to `backup-YYYY-MM-DDTHH-mm-ss.json`, ensure backup restore restores both `users` and `keys`, and implement `DELETE /backups/:filename` via `store.deleteBackup()` (P7-02, P7-03). Implement real pagination (`page`, `limit`) and filters (`q`, `category`, `status`, `logType`) in `GET /api/manager/audit-logs`, returning `{ ok: true, logs, page, limit, total, totalPages }` (ADM-20-01). Persist `trialGiftEnabled` and `trialDays` into Supabase `manager_settings` (key: `'system_settings'`), and return `{ ok: true, settings: { ... } }` in `GET /api/manager/settings/system` (ADM-20-02).

### R2. Continuous Remediation through Gates 4, 5, and 6
Continue remediation through subsequent gates in sequence:
- Gate 4 (Database Schema & Security): Maintain database schema parity across migrations; verify `ROW_COUNT` before proceeding in `manager_reset_worker_data`; execute `REVOKE ALL ON ... FROM public` across tables and grant minimal required privileges; add disaster recovery guards to `reset_and_setup.sql`; enforce `v_attempt.user_id = p_user_id` invariant in Link4M SQL procedures.
- Gate 5 (Manager UI/UX & Accessibility): Implement public login license key registration field; implement modal focus trapping and accessible dialog attributes; provide semantic `<main>` landmark in dashboard layout; ensure accessible buttons with ARIA labels and keyboard support for 54 GUI slots and inventory slots; implement an in-flight click mutex to prevent spam-clicking action buttons.
- Gate 6 (Final End-to-End Verification): Verify complete test suite pass rate with zero regressions across both repositories.

## Verification Resources
- Manager test suite executed via `cmd /c "cd /d D:\manager && npm test"`
- Worker test suite executed via `cmd /c "cd /d D:\worker && npm test"`
- Targeted unit and integration tests written for each bug fix

## Acceptance Criteria

### Gate 3 Remediation
- [ ] `AsyncKeyLock` does not release lock on timeout while underlying task is executing, preventing concurrent access until settled.
- [ ] `savePendingAllocation` errors are caught and handled durably without losing compensation state.
- [ ] Proxy validation rejects private and loopback IP addresses (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`) after DNS lookup.
- [ ] Link4M verifies tokens with the backend and enforces daily link limits prior to returning provider attempt URLs.
- [ ] Fixed bot ID allocation is capped strictly at `targetCount`.
- [ ] `/bot/:id/settings` updates are passed through `sanitizeBotForSession()`.
- [ ] License key activation transactions prevent double-consumption and concurrent activation races.
- [ ] `isEntitled()` returns false when `isPermanent === false` and `expiresAt === null`, and only returns true when `expiresAt` is in the future.
- [ ] Discord panel `/bots` and `/logs` check `isEntitled()` before displaying data.
- [ ] Worker removal/disablement synchronously deletes assignments from `ASSIGNMENTS` table and `manager_users.assigned_bot_ids`.
- [ ] `grant()` validates that target bot/worker exists in `WorkerRegistry`.
- [ ] Discord admin command authorization is unified with interaction handler and safely checks Discord client readiness.
- [ ] `/admin health` probe returns DB latency, CommandBroker pending count, Discord Gateway latency, and Worker fleet reachability.
- [ ] Telegram alert notifications escape HTML special characters, verify `response.ok`, and retry failed alerts with exponential backoff.
- [ ] Alert notifications enforce rate limiting to prevent flooding during outages.
- [ ] `userRouter` is mounted at `/api/user`.
- [ ] CSRF exemption for worker routes requires valid worker secret or bearer token.
- [ ] Bot schedule updates validate `Array.isArray(schedules)`.
- [ ] `/bots/reorder` persists new bot ordering to the database.
- [ ] `saveBackup()` completes without ReferenceError.
- [ ] Backup filename conforms to `backup-YYYY-MM-DDTHH-mm-ss.json`, restore recovers both users and keys, and backup deletion is implemented.
- [ ] `GET /api/manager/audit-logs` returns paginated and filtered results with `{ ok: true, logs, page, limit, total, totalPages }`.
- [ ] `trialGiftEnabled` and `trialDays` persist to `manager_settings` (`'system_settings'`) and are returned by `GET /api/manager/settings/system`.

### Continuous Remediation (Gates 4 - 6)
- [ ] Gate 4 database migrations maintain schema parity, minimal public privileges, Link4M user_id invariant checks, and disaster recovery guards.
- [ ] Gate 5 UI provides accessible dialogs, focus trapping, semantic landmarks, accessible GUI slots, and button click mutexes.
- [ ] Gate 6 full test suite pass rate: `cmd /c "cd /d D:\manager && npm test"` and `cmd /c "cd /d D:\worker && npm test"` pass with 100% success and zero regressions.

## Follow-up — 2026-11-14T12:26:57Z
URGENT USER DIRECTIVE: "dẩy nhanh tốc độ công việc, mà vẫn đảm bảo chất lượng, không lo vấn đề hết quota"
(Accelerate work speed to maximum, maintain top quality and surgical accuracy, no quota restrictions/concerns - full speed ahead through Gate 4, Gate 5, and Gate 6!).
