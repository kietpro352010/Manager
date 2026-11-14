## 2026-11-14T10:05:34Z
You are worker_m3 (Implementation Specialist) for Gate 3 Milestone 3 (Discord Admin, Alerting & Router Security).

Working directory: D:\manager
State folder: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_worker_m3\

Mandatory Documents to read first:
- ORIGINAL_REQUEST: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\PROJECT.md
- Survey 2 Report: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_explorer_survey_2\handoff.md

Exclusive Write Ownership for this Milestone:
- `D:\manager\src\discord\commands\admin.js`
- `D:\manager\src\discord\handlers\interaction-handler.js`
- `D:\manager\src\services\admin-notifier.js`
- `D:\manager\src\http\app.js`
- `D:\manager\src\http\routes\user-api.js`
- `D:\manager\tests\gate3-m3-discord-router.test.js` (create dedicated test suite here)
Do NOT modify files outside this list.

Milestone 3 Tasks to Implement:

1. DIS-12-01: Unified Discord Admin Authorization
   - In `D:\manager\src\discord\handlers\interaction-handler.js`, export and expand `isUserAdmin(interaction, services, user)` to comprehensively check:
     - `services.config?.adminUserId === userId`
     - `services.accessControl?.adminUserId === userId`
     - `interaction.guild?.ownerId === userId`
     - Discord Administrator permission (`interaction.memberPermissions?.has('Administrator') || interaction.memberPermissions?.has(8n)`)
     - `services.accessControl?.roleFor(interaction.member, interaction) === 'admin'`
     - Linked user role: `user?.role === 'admin'`
   - In `D:\manager\src\discord\commands\admin.js`, use the unified `isUserAdmin(interaction, services, user)` check so that admin command gating has 100% parity with interaction handling.

2. DIS-12-02: Safe Discord Client Check & Deep /admin health Probe
   - In `D:\manager\src\discord\commands\admin.js`:
     - Safely check client ready state: `Boolean((services.discordClient || services.client)?.isReady?.())`.
     - Separate `subcommand === 'health'` from `subcommand === 'status'`.
     - Implement a deep probe for `/admin health` that measures:
       - Database connection & latency (e.g. via `store.adapter.testConnection()` or fallback ping)
       - CommandBroker pending queue count: `(services.commandBroker || services.broker)?.pendingResults?.size ?? 0`
       - Discord Gateway WebSocket ping: `(services.discordClient || services.client)?.ws?.ping ?? -1`
       - Worker fleet reachability: query `registry.list()`, count active/reachable workers vs total
     - Format and return a distinct health embed (`🏥 KIỂM TRA SỨC KHỎE HỆ THỐNG — HEALTH PROBE`).

3. DIS-12-03: Telegram HTML Escaping in AdminNotifier
   - In `D:\manager\src\services\admin-notifier.js`:
     - Implement `escapeTelegramHtml(str)` that escapes `&` to `&amp;`, `<` to `&lt;`, and `>` to `&gt;`.
     - Ensure all dynamic parameters (`event`, `message`, `source`, `details` values) are passed through `escapeTelegramHtml()` before interpolation into Telegram messages.

4. DIS-12-04: AdminNotifier response.ok Verification & Exponential Backoff Retry Queue
   - In `D:\manager\src\services\admin-notifier.js`:
     - In `dispatchTelegram`, inspect `response.ok` on `fetch()`. If `!response.ok`, throw an error (e.g. `new Error('Telegram API responded with HTTP ' + res.status)`).
     - Implement an in-memory retry queue (`this.retryQueue = []`) with exponential backoff (e.g., base 1000ms, max 30000ms, max 3 retries) for failed DM and Telegram notifications so transient network/API failures are not permanently lost.

5. DIS-12-05: Alert Rate Limiting during System Outages
   - In `D:\manager\src\services\admin-notifier.js`:
     - Implement sliding-window rate limiting (e.g., maximum 15 alerts per 60 seconds) to prevent alert flooding during mass worker failures or cluster outages.
     - When throttled, buffer or aggregate notifications and emit a rate-limit notice instead of bombarding the channel.

6. API-01: Mount userRouter Strictly at /api/user
   - In `D:\manager\src\http\app.js`:
     - Mount `userRouter` strictly at `/api/user`:
       `app.use('/api/user', userRouter);`
     - Remove erroneous route aliases that shadow manager routes (`/api/manager`, `/api/rewards/link4m`, `/api/public`, `/api`).

7. API-02: Gated CSRF Exemption for Worker Routes
   - In `D:\manager\src\http\app.js`:
     - In CSRF protection middleware, do NOT wildcard exempt `/api/worker/` or `/api/v1/workers/` unconditionally.
     - Require that worker requests present valid authentication: `isBotSecretRequest(req)` OR a valid Bearer token (`req.headers['authorization']?.startsWith('Bearer ')`) before exempting from CSRF. Reject unauthorized browser-based cross-origin mutations.

8. API-03: Bot Schedules Array Validation
   - In `D:\manager\src\http\routes\user-api.js`:
     - In `POST /bot/:id/auto-chat` and `POST /bot/:id/bot-schedules`:
       Strictly enforce `Array.isArray(req.body.autoChatSchedules)` and `Array.isArray(req.body.botSchedules)`.
       If the input is not an array (e.g. string, object, null), return HTTP 400 (`{ ok: false, error: 'Schedules must be an array.' }`) instead of silently converting to `[]`.

9. API-04: Real Database Persistence for /bots/reorder
   - In `D:\manager\src\http\routes\user-api.js`:
     - In `POST /bots/reorder`:
       Validate `botIds` (or `order`) from `req.body` is a non-empty array of strings.
       Verify all submitted bot IDs belong to `session.assignedBotIds`.
       Persist the updated order to database via `store.setAccess(...)` or direct user update on `manager_users.assigned_bot_ids`.
       Update the in-memory session `session.assignedBotIds = updatedOrder`.
       Return `{ ok: true, message: 'Đã lưu thứ tự bot.', order: updatedOrder }`.


## 2026-11-14T10:16:55Z
**Context**: Milestone 3 Implementation Status Check
**Content**: Checking in on progress for Gate 3 Milestone 3 (DIS-12-01..05, API-01..04). Have you started modifying the target files or drafting gate3-m3-discord-router.test.js?
**Action**: Please update your progress.md with your current subtask status or let me know if you encountered any blockers.


## 2026-11-14T10:26:38Z
**Context**: Milestone 3 Completion Status
**Content**: I noticed `tests/gate3-m3-discord-router.test.js` is already written (727 lines). What is your current status with the test executions (gate3-m3, gate3-m2, gate3-m1, npm test) and handoff.md generation?
**Action**: Please report status or provide handoff.md when ready.
