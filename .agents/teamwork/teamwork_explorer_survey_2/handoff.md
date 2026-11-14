# Handoff Report: Gate 3 Investigation (Survey 2)
**Date**: 2026-11-14T08:39:00Z  
**Author**: `teamwork_explorer_survey_2`  
**Target Codebase**: `D:\manager`  
**Scope**: Discord Admin, Alerting & Router Security (DIS-12-01..05, API-01..04) & Cloud Backup & Admin API Contracts (P7-01..03, ADM-20-01..02)

---

## 1. Observation

### 1.1 DIS-12-01 & DIS-12-02: Discord Admin Command Authorization & Deep Health Probe
- **File**: `D:\manager\src\discord\commands\admin.js` (lines 26–31, 84–116)
- **File**: `D:\manager\src\discord\handlers\interaction-handler.js` (lines 68–101, 124–133)
- **Direct Observations**:
  - In `src/discord/handlers/interaction-handler.js` (lines 68–101), `isUserAdmin(interaction, services)` checks:
    1. `services.config?.adminUserId === userId`
    2. `services.accessControl?.adminUserId === userId`
    3. `interaction.guild?.ownerId === userId`
    4. Discord Administrator permissions (`interaction.memberPermissions?.has('Administrator')` / `8n`)
    5. `services.accessControl?.roleFor(interaction.member, interaction) === 'admin'`
    However, it does **not** check the linked database user (`user?.role === 'admin'`).
  - In `src/discord/commands/admin.js` (lines 27–30):
    ```javascript
    const user = await resolveLinkedUser(interaction, services);
    const isSuperAdmin = user?.role === 'admin' ||
      (services.config?.adminUserId && services.config.adminUserId === interaction.user.id) ||
      interaction.guild?.ownerId === interaction.user.id;
    ```
    This check omits `services.accessControl?.adminUserId`, Discord Administrator permissions (`Administrator` / `8n`), and `services.accessControl?.roleFor(interaction.member) === 'admin'`. If a user passes `isUserAdmin` in the interaction handler, `admin.js` can still reject them with HTTP/Discord access denied.
  - In `src/discord/commands/admin.js` (line 111):
    ```javascript
    discord: { ok: services.client ? services.client.isReady() : true }
    ```
    This assumes `services.client` exists and `isReady` is callable without optional chaining, and ignores `services.discordClient` which is standard across the manager.
  - In `src/discord/commands/admin.js` (lines 85–116):
    `subcommand === 'status'` and `subcommand === 'health'` are joined into the same branch (`if (subcommand === 'status' || subcommand === 'health')`) and return identical data via `renderAdminStatus({ stats, systemInfo })`. `/admin health` does not probe DB latency, CommandBroker pending count, Discord Gateway latency, or Worker fleet reachability.

### 1.2 DIS-12-03, DIS-12-04, DIS-12-05: Admin Notifier Telegram Escaping, Retry Queue & Rate Limiting
- **File**: `D:\manager\src\services\admin-notifier.js` (lines 53–80, 114–130, 225–270)
- **Direct Observations**:
  - In `src/services/admin-notifier.js` (lines 230–255), Telegram HTML formatting interpolates raw strings:
    ```javascript
    text += `<b>Sự kiện:</b> <code>${event}</code>\n`;
    if (message) text += `<b>Chi tiết:</b> ${message}\n`;
    ```
    If `message`, `event`, or `details` contains `<`, `>`, or `&` (e.g. `<anonymous>`, XML errors, HTML tags), Telegram Bot API returns HTTP 400 (`Bad Request: can't parse entities: ...`) and the notification fails.
  - In `src/services/admin-notifier.js` (lines 257–266):
    ```javascript
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.telegramChatId, text: text.slice(0, 4000), parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8000)
    });
    ```
    The response is not checked. If `response.ok` is `false` (e.g., HTTP 400, 429, 500), no error is raised, and the failure is silently treated as successful delivery.
  - In `src/services/admin-notifier.js` (lines 218–222, 267–269), both `dispatchDm` and `dispatchTelegram` catch and swallow all errors with `this.logger?.warn?.(...)`. No retry queue exists, and failed alerts are permanently lost.
  - In `src/services/admin-notifier.js` (lines 53–80): Rate limiting only exists as a per-key deduplication cooldown (`dedupKey = `${source}:${event}:${details.workerId || details.id || ''}:${message.slice(0, 80)}`;`). During a cluster outage (e.g. 50 workers failing simultaneously), 50 distinct keys enter `pendingBatch`, flush, and then trigger rapid consecutive requests to Discord and Telegram (1 every 600ms), exceeding Telegram's 1 msg/sec limit and flooding the admin.

### 1.3 API-01 & API-02: HTTP App Router Mounts & CSRF Exemption Gating
- **File**: `D:\manager\src\http\app.js` (lines 131–145, 440–455)
- **Direct Observations**:
  - In `src/http/app.js` (lines 141–142), CSRF middleware unconditionally exempts worker paths:
    ```javascript
    if (req.path === '/api/auth/login' ||
        ...
        req.path.startsWith('/api/worker/') ||
        req.path.startsWith('/api/v1/workers/')) {
      return next();
    }
    ```
    Any POST/PUT/PATCH/DELETE to `/api/worker/` or `/api/v1/workers/` bypasses CSRF checks completely without verifying whether the request carries `x-worker-secret`, `x-bot-secret`, or a Bearer token.
  - In `src/http/app.js` (lines 450–454):
    ```javascript
    app.use('/api/manager', userRouter);
    app.use('/api/rewards/link4m', userRouter); // Route alias for Link4m
    app.use('/api/public', userRouter); // Route alias for public stats
    app.use('/api/user', userRouter); // Route alias for user discord & settings
    app.use('/api', userRouter); // Route alias for generic API calls
    ```
    `userRouter` is mounted at `/api/manager`, `/api/rewards/link4m`, `/api/public`, `/api/user`, and `/api`. This exposes all user endpoints under the manager route space, clashing with `adminRouter` (mounted at `/api/manager`), and violating the strict contract requiring `userRouter` to be mounted strictly at `/api/user`.

### 1.4 API-03 & API-04: Bot Schedules Validation & Reorder Persistence
- **File**: `D:\manager\src\http\routes\user-api.js` (lines 274–276, 484, 499)
- **Direct Observations**:
  - In `src/http/routes/user-api.js` (lines 484, 499):
    ```javascript
    const schedules = Array.isArray(req.body?.autoChatSchedules) ? req.body.autoChatSchedules : [];
    ...
    const schedules = Array.isArray(req.body?.botSchedules) ? req.body.botSchedules : [];
    ```
    If non-array payloads (e.g. `{ botSchedules: "invalid" }` or `{ botSchedules: null }`) are submitted, they silently fallback to `[]` and overwrite existing schedules instead of returning HTTP 400.
  - In `src/http/routes\user-api.js` (lines 274–276):
    ```javascript
    router.post('/bots/reorder', requireSession, async (req, res) => {
      return res.json({ ok: true, message: 'Đã lưu thứ tự bot.' });
    });
    ```
    `/bots/reorder` is a dummy stub that returns 200 without saving the new bot order to `manager_users.assigned_bot_ids` or updating `session.assignedBotIds`.

### 1.5 P7-01: SupabaseClient `sanitizeBackupPayload` ReferenceError
- **File**: `D:\manager\src\storage\supabase-client.js` (line 1968)
- **Direct Observations**:
  - In `src/storage/supabase-client.js` (lines 1965–1979):
    ```javascript
    async saveBackup(name, payload) {
        if (!this.isEnabled() || !name || !payload) return false;
        try {
            const safePayload = sanitizeBackupPayload(payload);
            const serialized = JSON.stringify(safePayload);
    ```
    `sanitizeBackupPayload` is invoked at line 1968, but is never defined or imported in `supabase-client.js`. Executing `saveBackup` throws `ReferenceError: sanitizeBackupPayload is not defined`.

### 1.6 P7-02 & P7-03: Backup Filename, Complete Restore & Backup Deletion
- **File**: `D:\manager\src\http\routes\admin-api.js` (lines 446, 460–475, 477–483)
- **Direct Observations**:
  - Line 446: `const name = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;` uses an underscore (`backup_...`) rather than `backup-YYYY-MM-DDTHH-mm-ss.json`, failing the regex in `supabase-client.js:1955` (`/^backup-[A-Za-z0-9._-]+\.json$/`).
  - Lines 466–470: Backup restore only restores `backup.registry` via `registry.saveConfig()`, completely omitting `backup.users` and `backup.keys`.
  - Lines 477–483: `DELETE /backups/:filename` is a stub returning `{ ok: true, message: 'Đã xóa bản sao lưu.' }` without calling `store.deleteBackup(filename)`.

### 1.7 ADM-20-01 & ADM-20-02: Audit Logs Pagination & System Settings Persistence
- **File**: `D:\manager\src\http\routes\admin-api.js` (lines 281–289, 585–603)
- **Direct Observations**:
  - Lines 281–289 (`GET /audit-logs`): Only parses `limit`, completely ignores `page`, `q`, `category`, `status`, `logType`, and returns `{ ok: true, logs }` without `{ ok: true, logs, page, limit, total, totalPages }`.
  - Lines 585–593 (`GET /settings/system`): Returns static values from `config` (`publicBaseUrl`, `renderApiKey`, `link4mApiToken`, `wispbyteEnabled`). `trialGiftEnabled` and `trialDays` are missing.
  - Lines 595–603 (`POST /settings/system`): Only modifies in-memory `config.publicBaseUrl`. It does not persist `trialGiftEnabled` or `trialDays` to Supabase `manager_settings` under key `'system_settings'`.

---

## 2. Logic Chain

1. **Discord Authorization (DIS-12-01)**: `interaction-handler.js` and `admin.js` implement divergent authorization rules. By centralizing authorization in `isUserAdmin(interaction, services, user)` and verifying config admin ID, accessControl admin ID, guild owner ID, Discord Administrator permission bits, accessControl role, and database user role, both layers achieve 100% authorization parity.
2. **Deep Health Probe (DIS-12-02)**: `/admin status` summarizes high-level memory, uptime, and worker counts. A separate `/admin health` deep probe is required to directly measure DB latency (`store.adapter.testConnection()`), CommandBroker queue load (`commandBroker.pendingResults.size`), Discord gateway WebSocket latency (`client.ws.ping`), and worker reachability (`reachable` flag / heartbeat freshness).
3. **Telegram HTML Parsing & Response Gating (DIS-12-03, DIS-12-04)**: Dynamic values in HTML-formatted messages break parsing if `<`, `>`, `&` are unescaped. Using `escapeTelegramHtml()` guarantees payload validity. Checking `res.ok` on `fetch` ensures non-2xx responses are caught rather than silently ignored.
4. **Retry Queue & Outage Rate Limiting (DIS-12-04, DIS-12-05)**: Unhandled dispatch errors must be captured into an in-memory `retryQueue` with exponential backoff (e.g., $1\text{s} \times 2^{\text{retry}}$, max 30s, max 3 retries). A sliding window rate limiter (e.g., max 15 alerts/min) prevents Telegram/Discord flooding during major cluster outages.
5. **Worker Route CSRF & Strictly Scoped userRouter (API-01, API-02)**: Wildcard CSRF exemption on `/api/worker/` exposes worker control actions to browser cross-site forgery. Requiring `isBotSecretRequest(req)` or a Bearer token before granting exemption closes the CSRF vulnerability. Restricting `userRouter` strictly to `/api/user` prevents route shadowing over `/api/manager` and enforce clean boundary separation.
6. **Schedule Array Validation & Reorder Persistence (API-03, API-04)**: Silently converting non-array schedules to empty arrays leads to accidental data loss. Enforcing `Array.isArray(schedules)` with HTTP 400 rejection protects schedule integrity. For `/bots/reorder`, saving the reordered bot list to `manager_users.assigned_bot_ids` via `store.setAccess` and updating in-memory session ensures persistence.
7. **Backup Sanitization, Format, Restore & Delete (P7-01..03)**: Defining `sanitizeBackupPayload` in `supabase-client.js` resolves the unhandled `ReferenceError`. Formatting filenames as `backup-YYYY-MM-DDTHH-mm-ss.json` aligns with Supabase storage constraints. Restoring `users` and `keys` along with `registry` prevents loss of user accounts and license keys on restore. Invoking `store.deleteBackup(filename)` provides real deletion functionality.
8. **Audit Logs Contract & Settings Persistence (ADM-20-01, ADM-20-02)**: Real pagination (`page`, `limit`) and filtering (`q`, `category`, `status`, `logType`) with `{ ok: true, logs, page, limit, total, totalPages }` fulfills the admin API contract. Reading and writing `trialGiftEnabled` and `trialDays` in `manager_settings` under key `'system_settings'` fulfills the system settings contract.

---

## 3. Caveats

1. **Database Adapter vs Direct Supabase Client**: In tests without a live PostgreSQL database, `store.adapter` or mock stores are used. All fixes must gracefully check both `store.adapter` methods and direct Supabase client methods.
2. **Discord Client Injections**: Across different handlers and services, the client is variously passed as `services.discordClient` or `services.client`. Fixes must check `services.discordClient || services.client` to avoid regressions in headless test harnesses.
3. **Existing Tests Untouched**: Per explorer instructions, zero modifications have been made to any production or test files during this survey.

---

## 4. Conclusion & Surgical Fix Strategy

### Fix 1: `D:\manager\src\discord\commands\admin.js` & `interaction-handler.js`
- In `interaction-handler.js`: Export and expand `isUserAdmin(interaction, services, user)` to check `services.config?.adminUserId`, `services.accessControl?.adminUserId`, `interaction.guild?.ownerId`, Discord `Administrator` permissions (`interaction.memberPermissions?.has('Administrator') || interaction.memberPermissions?.has(8n)`), `services.accessControl?.roleFor(interaction.member, interaction) === 'admin'`, and `user?.role === 'admin'`.
- In `admin.js`: Import and use `isUserAdmin(interaction, services, user)`.
- In `admin.js`: Replace `services.client.isReady()` with `Boolean((services.discordClient || services.client)?.isReady?.())`.
- In `admin.js`: Separate `subcommand === 'health'` from `status`. Implement a deep probe returning:
  - Database latency via `store.adapter.testConnection()` or `store.testConnection()`
  - CommandBroker pending count via `(services.commandBroker || services.broker)?.pendingResults?.size ?? 0`
  - Discord Gateway ping via `(services.discordClient || services.client)?.ws?.ping ?? -1`
  - Worker fleet reachability via `registry.list()`, counting `worker.reachable || (Date.now() - new Date(worker.lastHeartbeat).getTime() <= 120000)`
  Render as a dedicated embed titled `🏥 KIỂM TRA SỨC KHỎE HỆ THỐNG — HEALTH PROBE`.

### Fix 2: `D:\manager\src\services\admin-notifier.js`
- Add `escapeTelegramHtml(str)` escaping `&` to `&amp;`, `<` to `&lt;`, and `>` to `&gt;`. Wrap all dynamic fields (`event`, `message`, `source`, `details` values) in `dispatchTelegram`.
- In `dispatchTelegram`: Capture `res = await fetch(...)`, check `if (!res.ok)`, and throw `new Error('Telegram API responded with HTTP ' + res.status)`.
- Implement `this.retryQueue = []` with exponential backoff:
  - Base delay: 1000ms, max delay: 30000ms, max retries: 3.
  - On failed DM or Telegram delivery, enqueue failed item and process via `scheduleRetry()`.
- Implement sliding-window rate limiting:
  - Track `this.alertTimestamps = []` within a 60,000ms window, capped at `maxAlertsPerMinute = 15`.
  - When limit is reached, buffer or consolidate alerts and emit a throttled notification warning.

### Fix 3: `D:\manager\src\http\app.js`
- Mount `userRouter` strictly at `/api/user`:
  ```javascript
  app.use('/api/user', userRouter);
  ```
  Remove `app.use('/api/manager', userRouter)`, `app.use('/api/rewards/link4m', userRouter)`, `app.use('/api/public', userRouter)`, and `app.use('/api', userRouter)`.
- In CSRF middleware, remove `/api/worker/` and `/api/v1/workers/` from the unconditional exemption list. Check:
  ```javascript
  if (req.path.startsWith('/api/worker/') || req.path.startsWith('/api/v1/workers/')) {
    const authHeader = String(req.headers['authorization'] || '');
    const hasBearer = authHeader.startsWith('Bearer ') && authHeader.slice(7).trim().length > 0;
    if (isBotSecretRequest(req) || hasBearer) {
      return next();
    }
  }
  ```

### Fix 4: `D:\manager\src\http\routes\user-api.js`
- In `POST /bot/:id/auto-chat` and `POST /bot/:id/bot-schedules`:
  Validate that `req.body.autoChatSchedules` (or `req.body.botSchedules`) is an array. If `!Array.isArray(...)`, return `res.status(400).json({ ok: false, error: '...' })`.
- In `POST /bots/reorder`:
  Parse `botIds = req.body.botIds || req.body.order`. Ensure `Array.isArray(botIds) && botIds.length > 0`.
  Filter/verify that submitted bot IDs belong to `session.assignedBotIds`.
  Save updated list to `manager_users.assigned_bot_ids` via `store.setAccess(session.userId || session.username, { workerIds: updatedOrder }, session.username)`.
  Update `session.assignedBotIds = updatedOrder`. Return `{ ok: true, message: 'Đã lưu thứ tự bot.', order: updatedOrder }`.

### Fix 5: `D:\manager\src\storage\supabase-client.js`
- Define `sanitizeBackupPayload(payload)`:
  ```javascript
  function sanitizeBackupPayload(payload) {
    if (!payload || typeof payload !== 'object') return {};
    return {
      registry: Array.isArray(payload.registry) ? payload.registry : [],
      users: Array.isArray(payload.users) ? payload.users : [],
      keys: Array.isArray(payload.keys) ? payload.keys : [],
      createdAt: payload.createdAt || payload.timestamp || new Date().toISOString(),
      ...payload
    };
  }
  ```

### Fix 6: `D:\manager\src\http\routes\admin-api.js` (Backups)
- In `POST /backups/create`: Generate name with format:
  `const name = 'backup-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';`
- In `POST /backups/:filename/restore`:
  Restore `backup.users` via `store.setAccess(u.userId || u.id || u.username, u, 'backup-restore')`.
  Restore `backup.keys` via `store.createKey(key)`.
- In `DELETE /backups/:filename`:
  Invoke `await store.deleteBackup(req.params.filename)`.

### Fix 7: `D:\manager\src\http\routes\admin-api.js` (Audit Logs & Settings)
- In `GET /audit-logs`:
  Parse `page = Math.max(1, parseInt(req.query?.page, 10) || 1)` and `limit = Math.min(500, Math.max(1, parseInt(req.query?.limit, 10) || 50))`.
  Filter by `q`, `category`, `status`, `logType`.
  Compute `total = filtered.length`, `totalPages = Math.max(1, Math.ceil(total / limit))`, and slice array for the page.
  Return `{ ok: true, logs: paginated, page, limit, total, totalPages }`.
- In `GET /settings/system`:
  Fetch from `store.getSetting('system_settings')`. Return `{ ok: true, settings: { trialGiftEnabled, trialDays, publicBaseUrl, ... } }`.
- In `POST /settings/system`:
  Merge incoming `trialGiftEnabled` and `trialDays` into existing settings and persist via `store.setSetting('system_settings', merged)`. Return `{ ok: true, settings: merged }`.

---

## 5. Verification Method

1. **Run Current Test Suite**:
   ```cmd
   cmd /c "cd /d D:\manager && npm test"
   ```
   Must pass 100% with 0 regressions.
2. **Dedicated Gate 3 Verification Tests**:
   Create a focused test file (e.g. `tests/gate3-survey2-verification.test.js`) verifying:
   - Admin command authorization matrix (Discord role, guild owner, Administrator bit, database user role).
   - `/admin health` returns distinct probe payload with DB latency, CommandBroker pending count, Discord Gateway latency, and Worker fleet reachability.
   - `AdminNotifier` Telegram escaping on inputs containing `<foo>&<bar>`, verifying `res.ok`, and retry queue execution on HTTP 500.
   - `AdminNotifier` rate limit suppression during 20 rapid alerts.
   - `userRouter` mounted strictly at `/api/user`.
   - CSRF rejection on `/api/worker/...` when no secret or Bearer token is provided; acceptance when provided.
   - Schedule validation 400 rejection on non-array input.
   - `/bots/reorder` persistence to `assigned_bot_ids`.
   - `saveBackup` execution without ReferenceError.
   - Backup filename matching `/^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/`.
   - Backup restore recovering `users` and `keys`.
   - Backup delete calling `store.deleteBackup()`.
   - `GET /api/manager/audit-logs` pagination and filtering returning `{ ok: true, logs, page, limit, total, totalPages }`.
   - `trialGiftEnabled` and `trialDays` persistence and retrieval via `GET /api/manager/settings/system`.
