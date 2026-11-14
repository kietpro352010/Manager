# Handoff Report: Worker Landscape & Gates 4, 5, 6 Survey

**Author:** teamwork_explorer_survey_3  
**Date:** 2026-11-14T08:40:00Z  
**State Folder:** `C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_explorer_survey_3\`  
**Target Repositories:** `D:\manager` and `D:\worker`

---

## 1. Observation

### 1.1 Worker (`D:\worker`) Landscape
- **Package Configuration (`D:\worker\package.json`)**:
  - Main entry: `src/index.js` (line 6)
  - Test script: `"test": "node tests/integration.test.js"` (line 9).
  - Dependencies: `dotenv` (^17.4.2), `express` (^4.21.2), `helmet` (^8.1.0), `mineflayer` (^4.37.1), `socks` (^2.8.3), `cross-env` (^7.0.3).
  - Engine requirement: Node >= 20 (currently running v24.21.0).
- **Existing Test Execution**:
  - `node tests/integration.test.js`: Passed 100% (24/24 assertion blocks in ~9 seconds). Covers 15 unified actions, lifecycle mutex, timing-safe auth, bounded reconnect, task timeout lock retention, queued cancellation, poller backoff retry, keepalive HTTPS whitelist, Express JSON error mapping (400, 413, 500), command endpoint status codes (400, 409, 429, 503, 504), rate limit deduction upon admission, and auto-start fleet state machine.
  - `node tests/challenger_stress.test.js`: Passed 100% (8/8 adversarial challenges in ~2 seconds). Covers deep backoff sleep cancellation (<50ms), queue FIFO capping (100 items), SSRF URL vectors (23/23 vectors), HTTP error mapping, and rate limit deduction.
  - Note: `challenger_stress.test.js` exists in `D:\worker\tests` but is **not** chained in `package.json` `"scripts.test"`.
- **Worker-to-Manager Authentication & Communication**:
  - `D:\worker\src\http\auth.js:16-25`:
    ```javascript
    function requireWorkerSecret(secret, { previousSecret = null, graceUntil = 0 } = {}) {
      return (req, res, next) => {
        const supplied = req.get('x-worker-secret') || '';
        if (safeEqual(supplied, secret)) return next();
        if (previousSecret && Date.now() < graceUntil && safeEqual(supplied, previousSecret)) {
          return next();
        }
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      };
    }
    ```
    Observed: It only extracts `req.get('x-worker-secret')`. It does NOT support `Authorization: Bearer <secret>`.
  - `D:\worker\src\http\routes.js:66-70`:
    ```javascript
    router.get('/api/v1/diagnostics', (req, res) => {
      const secret = req.get('x-worker-secret') || '';
      const authed = Array.isArray(config.bots) && config.bots.some((b) => safeEqual(secret, b.secret));
      if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });
    ```
    Observed: Diagnostic route also strictly expects `x-worker-secret` and ignores Bearer token.
  - `D:\worker\src\transports\manager-reporter.js:41-47`:
    Sends headers: `'x-worker-secret': this.secret` and `'x-manager-bot-id': String(this.workerId)`.
  - `D:\worker\src\transports\wispbyte-poller.js:89`:
    Sends headers: `'x-worker-secret': this.config.secret`.

---

### 1.2 Gate 4: Database Schema & Security in `D:\manager`
- **SQL Files Inventory**:
  - Canonical embedded string: `D:\manager\src\storage\schema-sql.js` (166,707 bytes)
  - Canonical setup: `D:\manager\supabase\setup.sql` (167,621 bytes)
  - Canonical reset & setup: `D:\manager\supabase\reset_and_setup.sql` (171,175 bytes)
  - Migrations:
    - `20261107_manager_schema.sql`
    - `20261108000000_durable_worker_commands.sql`
    - `20261109000000_atomic_entitlement_rewards.sql`
    - `20261110000000_atomic_worker_settings.sql`
    - `20261111000000_worker_reset_data.sql`
    - `20261111120000_command_two_phase_sync.sql`
    - `20261112000000_reconcile_full_manager_schema.sql`
    - `20261112120000_session_revocation_and_migration_guards.sql`
- **`manager_reset_worker_data` Implementation**:
  - In `D:\manager\supabase\reset_and_setup.sql:2417-2435` and `reconcile_full_manager_schema.sql:2840-2858`:
    ```sql
    CREATE OR REPLACE FUNCTION public.manager_reset_worker_data(
      p_worker_id text
    )
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $reset_data$
    BEGIN
      UPDATE public.manager_workers
      SET settings = '{}'::jsonb,
          status = '{"state":"offline","online":false}'::jsonb,
          events = '[]'::jsonb,
          last_event = NULL,
          updated_at = now()
      WHERE worker_id = p_worker_id;
      RETURN true;
    END;
    $reset_data$;
    ```
    Observed: No `ROW_COUNT` check. If `worker_id = p_worker_id` matches 0 rows (non-existent or disabled worker), the function executes 0 updates and unconditionally returns `true`.
  - In earlier migration `20261111000000_worker_reset_data.sql:81-82`:
    `get diagnostics changed = row_count; return changed > 0;` was present, but was replaced during full schema reconciliation.
- **`reset_and_setup.sql` Disaster Recovery Guard**:
  - In `D:\manager\supabase\reset_and_setup.sql:8-16`:
    ```sql
    -- PHẦN 1: XÓA SẠCH TOÀN BỘ BẢNG, VIEW, SEQUENCE & HÀM CŨ/SAI TRONG `public`
    BEGIN;
    DO $$
    DECLARE
      v_rel record;
      v_fn record;
    BEGIN
      -- 1. Xóa toàn bộ bảng / view thuộc hệ thống Manager & Bot trong schema public
    ```
    Observed: No disaster recovery guard check exists. Any execution drops all 27 tables and 52 functions immediately without confirmation or config check.
- **`REVOKE ALL ON ... FROM public` & Minimal Privileges**:
  - Most tables have `REVOKE ALL ON ... FROM PUBLIC, anon, authenticated;` and `GRANT ... TO service_role`.
  - Notice `manager_users`:
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.manager_users FROM service_role;`
    `GRANT SELECT ON TABLE public.manager_users TO service_role;`
    (Mutations forced through SECURITY DEFINER RPCs with revision bump checks).
- **Link4M SQL Procedure `v_attempt.user_id = p_user_id` Invariant**:
  - In `D:\manager\supabase\reset_and_setup.sql:3533-3568` and `reconcile_full_manager_schema.sql:3931-3965` (`manager_complete_link4m_reward`):
    ```sql
    BEGIN
      UPDATE public.manager_link4m_attempts
      SET status = 'rewarded',
          rewarded_at = v_now,
          completed_at = v_now,
          verified_at = COALESCE(verified_at, v_now),
          updated_at = v_now
      WHERE attempt_id = p_attempt_id
        AND status = 'processing'
      RETURNING * INTO v_attempt;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Phiên vượt link không ở trạng thái đang xử lý hoặc đã kết thúc.';
      END IF;
    ```
    Observed: The `WHERE` clause does NOT enforce `v_attempt.user_id = p_user_id`. In `20261109000000_atomic_entitlement_rewards.sql:42`, it was `where attempt_id = p_attempt_id and user_id = p_user_id and status = 'processing'`. Without this check, a race or mismatched user can complete an attempt belonging to someone else.
- **Database Schema Parity**:
  - Enforced by `D:\manager\tests\storage-sql.test.js:1360-1440`.
  - Verifies exact match: 27 base tables, 52 unique functions with `SECURITY DEFINER` and `SET search_path = public, pg_temp`, 4 security invoker views (`manager_audit`, `backups`, `system_settings`, `bot_schedules`), across `src/storage/schema-sql.js`, `supabase/setup.sql`, `supabase/reset_and_setup.sql`, and migrations.

---

### 1.3 Gate 5: Manager UI/UX & Accessibility in `D:\manager`
- **Views Architecture**:
  - `D:\manager\src\http\views\login-html.js`: Renders public login and registration page.
  - `D:\manager\src\http\views\dashboard-html.js`: Renders main SPA dashboard (680 KB string).
- **Public Login License Key Field**:
  - `login-html.js:1481-1488`:
    Input `#regLicenseKey` exists inside `#publicRegisterForm`.
  - `login-html.js:1893-1897`:
    When `trialGiftEnabled === false`, code sets:
    `if (keyHint) keyHint.textContent = '(Có thể bỏ trống)';`
    `if (keyInput) keyInput.placeholder = 'Có thể bỏ trống nếu chưa có mã Key...';`
    Observed: When trial gifts are disabled in system settings, registration without a license key fails or leaves user unentitled. The UI hint/placeholder contradicts this by saying "(Có thể bỏ trống)".
- **Modal Focus Trapping & Accessible Attributes**:
  - `dashboard-html.js:6416-7426` and `15280-15391`:
    15+ modals declared with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="..."`.
  - Observed: Zero focus trapping logic exists. `dashboard-html.js` has no `keydown` listener trapping Tab inside open modals. When Tab is pressed, focus escapes the modal into the inert background DOM. No Escape key listener closes the modal, and closing a modal does not restore focus to the triggering element.
- **Semantic `<main>` Landmark**:
  - `dashboard-html.js:5540`: `<div class="app-main-column">` wraps the main content sections (`#homePage`, `#detailPage`, `#userManagementPage`, `#auditPage`, `#backupPage`).
  - Observed: Zero `<main>` tags or `role="main"` attributes exist in `dashboard-html.js`.
- **54 GUI Slots & Player Inventory Slots (ARIA & Keyboard)**:
  - 54 GUI slots (`dashboard-html.js:12684-12694` in `detailRemoteGuiSlots`):
    Rendered as `<div>` elements with inline `onclick="clickDetailGuiSlot(idx)"`.
    Observed: Missing `role="button"`, missing `tabindex="0"`, missing `aria-label`, missing `onkeydown` handler for Enter/Space. Completely inaccessible to screen reader and keyboard-only users.
  - Inventory slots (`dashboard-html.js:13292-13306` in `createDetailSlot`):
    Rendered as `const el = document.createElement('div'); el.className = 'inventory-slot...'`.
    Observed: Missing `role="button"`, missing `tabindex="0"`, missing `aria-label`, missing keyboard support.
- **Action Buttons In-Flight Click Mutex**:
  - `dashboard-html.js:10643-10691` (`quickBotAction(event, id, action)`):
    Observed: Does not disable the clicked button (`event.currentTarget`), has no in-flight mutex tracking active requests per bot. Rapid spam-clicking fires parallel network requests, causing worker command collisions (`LIFECYCLE_CONFLICT`), queue congestion, and rate limit errors.
  - `clickDetailGuiSlot(slot)` (`dashboard-html.js:12697`):
    Observed: Does not guard against rapid spam clicking.
  - Contrast with `detailAction(action)` (`dashboard-html.js:13698`):
    `detailAction` already correctly uses `if (detailLifecycleActionInFlight) return; detailLifecycleActionInFlight = true;` and disables buttons.

---

### 1.4 Gate 6: Verification Status & Test Infrastructure
- **`D:\worker`**:
  - Test suites: `tests/integration.test.js` (24 blocks, PASS), `tests/challenger_stress.test.js` (8 challenges, PASS).
  - Exit code: 0 for both when run with `node tests/<file>.test.js`.
- **`D:\manager`**:
  - Standard `npm test` runs 6 files:
    1. `tests/integration.test.js`: PASS (15/15)
    2. `tests/services-wiring.test.js`: PASS (15/15)
    3. `tests/storage-sql.test.js`: PASS (7/7)
    4. `tests/auth-regression.test.js`: PASS (8/8)
    5. `tests/worker-registry-audit.test.js`: PASS (10/10)
    6. `tests/command-execution-audit.test.js`: PASS (15/15)
    Total run time: ~18 seconds. All 70 test blocks PASS.
  - Additional standalone test suites in `D:\manager\tests`:
    - `tests/adversarial-auth-stress.test.js`: PASS (18/18)
    - `tests/adversarial-challenger2.test.js`: PASS (6/6)
    - `tests/reproduce-sync-16-02-bug.test.js`: **FAILS** with:
      `AssertionError [ERR_ASSERTION]: Both distinct events must be recorded! (1 !== 2)`
    - `tests/adversarial-phase2-challenge.test.js`: **FAILS** at Challenge 8 with:
      `AssertionError [ERR_ASSERTION]: Events array must be capped at 100, got 1`
  - Root Cause of the Challenge 8 / SYNC-16-02 failure:
    In `D:\manager\src\storage\supabase-worker-store.js:219`:
    ```javascript
    const isDuplicate = existingEvents.some((e) =>
      (safeEvent.id && e.id === safeEvent.id) ||
      (e.type === safeEvent.type && e.message === safeEvent.message && String(e.occurredAt) === String(safeEvent.occurredAt))
    );
    ```
    When events lack `message` and `occurredAt`, `undefined === undefined` and `"undefined" === "undefined"` evaluate to `true`, causing distinct events of the same `type` to be falsely dropped as duplicates!

---

## 2. Logic Chain

### 2.1 Worker-to-Manager Authentication (Gate 3/API-02 & Worker Auth)
1. **Observation**: `D:\worker\src\http\auth.js:18` checks `const supplied = req.get('x-worker-secret') || '';`.
2. **Observation**: `D:\manager\src\http\app.js` and Gate 3 requirements state CSRF exemptions for worker routes require checking `x-worker-secret` OR bearer token.
3. **Reasoning**: If a caller sends `Authorization: Bearer <secret>` to Worker, `req.get('x-worker-secret')` is empty, leading to 401 Unauthorized.
4. **Conclusion**: `D:\worker\src\http\auth.js` and `D:\worker\src\http\routes.js:67` must extract token from `req.get('x-worker-secret')` or `Authorization: Bearer <token>`.

### 2.2 `manager_reset_worker_data` ROW_COUNT Invariant (Gate 4)
1. **Observation**: `D:\manager\supabase\reset_and_setup.sql:2426-2433` executes `UPDATE public.manager_workers ... WHERE worker_id = p_worker_id;` and returns `true`.
2. **Reasoning**: In PostgreSQL PL/pgSQL, an `UPDATE` that matches 0 rows does not raise an exception; `ROW_COUNT` is 0. Returning `true` signals to the caller (CommandBroker / WorkerStore) that the worker data was reset successfully, even when the worker does not exist or was disabled.
3. **Conclusion**: Must verify `GET DIAGNOSTICS v_row_count = ROW_COUNT;` and return `v_row_count > 0` (or `IF v_row_count = 0 THEN RETURN false; END IF;`), maintaining identical logic across `reset_and_setup.sql`, `setup.sql`, `schema-sql.js`, and `20261112000000_reconcile_full_manager_schema.sql`.

### 2.3 `reset_and_setup.sql` Disaster Recovery Guard (Gate 4)
1. **Observation**: Line 9 of `reset_and_setup.sql` starts a transaction that drops all 27 tables, sequences, and 52 functions unconditionally.
2. **Reasoning**: A DBA or developer executing this script against a production or staging database accidentally would lose all user entitlements, audit logs, and keys with zero confirmation barrier.
3. **Conclusion**: A disaster recovery guard must be added at line 8 that checks `current_setting('kingmc.allow_reset', true) = 'true'`. If not set, it aborts with a descriptive `RAISE EXCEPTION`.

### 2.4 Link4M Invariant `v_attempt.user_id = p_user_id` (Gate 4)
1. **Observation**: `manager_complete_link4m_reward` (`reset_and_setup.sql:3562`) updates `manager_link4m_attempts` with `WHERE attempt_id = p_attempt_id AND status = 'processing'`.
2. **Reasoning**: If user B submits an attempt ID created by user A, the query updates the attempt without checking ownership.
3. **Conclusion**: Must enforce `AND (user_id IS NULL OR user_id = '' OR user_id = p_user_id)` or check `IF v_attempt.user_id IS NOT NULL AND v_attempt.user_id <> '' AND v_attempt.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'USER_MISMATCH'; END IF;`.

### 2.5 Manager UI/UX Accessibility & Click Mutex (Gate 5)
1. **Observation**: `dashboard-html.js` lacks `<main>`, lacks focus trapping on modals, renders GUI slots and inventory slots as bare `<div>` elements without ARIA/keyboard support, and `quickBotAction` does not disable buttons during fetch.
2. **Reasoning**: WCAG 2.1 AA and ARIA 1.2 standards require semantic landmarks (`<main>`), modal focus confinement (`Tab` wrap, `Escape` to close), accessible clickable controls (`role="button"`, `tabindex="0"`, `aria-label`, Enter/Space activation), and stateful disabled buttons during in-flight mutations.
3. **Conclusion**: Surgical enhancements in `dashboard-html.js` and `login-html.js` resolve all Gate 5 requirements without breaking existing styles.

---

## 3. Caveats
- **Live PostgreSQL & Discord Gateway**: `tests/postgres-real.test.js` was not executed as it requires live Supabase/PostgreSQL connection strings. All unit, integration, and adversarial tests using mock adapters and in-memory clients were executed and verified directly.
- **Disk Latency on First `discord.js` Require**: On Windows, the initial load of `require('discord.js')` took ~2 minutes before disk cache warmup; subsequent runs execute in ~2 seconds. Test commands should use adequate timeout buffers (e.g. 60-120s) if running in a fresh VM or container.
- **Read-Only Investigation Compliance**: Zero source code or test files were modified during this exploration. All proposed changes are documented as surgical snippets ready for implementers.

---

## 4. Conclusion & Actionable Surgical Blueprint

### 4.1 Worker (`D:\worker`) Fixes
1. **`D:\worker\src\http\auth.js`**:
   Update `requireWorkerSecret` to extract token from `x-worker-secret` OR `Authorization: Bearer <token>`:
   ```javascript
   function extractSuppliedSecret(req) {
     const direct = req.get('x-worker-secret');
     if (direct) return direct.trim();
     const auth = req.get('authorization') || '';
     if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
     return '';
   }

   function requireWorkerSecret(secret, { previousSecret = null, graceUntil = 0 } = {}) {
     return (req, res, next) => {
       const supplied = extractSuppliedSecret(req);
       if (safeEqual(supplied, secret)) return next();
       if (previousSecret && Date.now() < graceUntil && safeEqual(supplied, previousSecret)) {
         return next();
       }
       return res.status(401).json({ ok: false, error: 'unauthorized' });
     };
   }
   ```
2. **`D:\worker\src\http\routes.js:67`**:
   Use `extractSuppliedSecret(req)` in `/api/v1/diagnostics`.
3. **`D:\worker\package.json`**:
   Update `"test"` script:
   `"test": "node tests/integration.test.js && node tests/challenger_stress.test.js"`

### 4.2 Gate 4 Database Schema Fixes (`D:\manager`)
1. **`manager_reset_worker_data` ROW_COUNT check**:
   Apply to `reset_and_setup.sql:2417`, `setup.sql:2417`, `schema-sql.js`, and `20261112000000_reconcile_full_manager_schema.sql:2840`:
   ```sql
   CREATE OR REPLACE FUNCTION public.manager_reset_worker_data(
     p_worker_id text
   )
   RETURNS boolean
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp
   AS $reset_data$
   DECLARE
     v_row_count integer := 0;
   BEGIN
     UPDATE public.manager_workers
     SET settings = '{}'::jsonb,
         status = '{"state":"offline","online":false}'::jsonb,
         events = '[]'::jsonb,
         last_event = NULL,
         updated_at = now()
     WHERE worker_id = p_worker_id;
     GET DIAGNOSTICS v_row_count = ROW_COUNT;
     RETURN v_row_count > 0;
   END;
   $reset_data$;
   ```
2. **`reset_and_setup.sql` Disaster Recovery Guard**:
   Add at line 8:
   ```sql
   -- DISASTER RECOVERY GUARD: Prevent accidental execution on production/staging
   DO $$
   BEGIN
     IF current_setting('kingmc.allow_reset', true) IS DISTINCT FROM 'true' THEN
       RAISE EXCEPTION 'DISASTER RECOVERY GUARD: reset_and_setup.sql will drop all manager and bot tables. To proceed, execute "SET kingmc.allow_reset = ''true'';" before running this script.';
     END IF;
   END $$;
   ```
3. **Link4M `manager_complete_link4m_reward` User Invariant**:
   In `reset_and_setup.sql:3556`, `setup.sql:3556`, `schema-sql.js`, and `reconcile_full_manager_schema.sql:3956`:
   ```sql
     UPDATE public.manager_link4m_attempts
     SET status = 'rewarded',
         rewarded_at = v_now,
         completed_at = v_now,
         verified_at = COALESCE(verified_at, v_now),
         updated_at = v_now
     WHERE attempt_id = p_attempt_id
       AND status = 'processing'
       AND (user_id IS NULL OR user_id = '' OR user_id = p_user_id)
     RETURNING * INTO v_attempt;
   ```
4. **Maintain 4-Way Parity**:
   Run `node tests/storage-sql.test.js` to verify all 27 tables, 52 functions, indexes, and grants pass parity validation.

### 4.3 Gate 5 UI/UX & Accessibility Fixes (`D:\manager`)
1. **Public Login License Key (`login-html.js:1893-1897`)**:
   When `trialGiftEnabled === false`, dynamically update `#regLicenseKeyHint` to `"(Bắt buộc nếu tắt dùng thử)"` and placeholder to `"Nhập mã License Key để kích hoạt tài khoản..."`.
2. **Semantic `<main>` Landmark (`dashboard-html.js:5540, 6412`)**:
   Wrap the section views (`#homePage`, `#detailPage`, `#userManagementPage`, `#auditPage`, `#backupPage`) with `<main id="mainContent" class="app-main-content" role="main">...</main>`.
3. **Modal Focus Trapping (`dashboard-html.js`)**:
   Add a reusable `trapModalFocus(modalEl)` function:
   - On open: store `document.activeElement` as `previousActiveElement`, find all focusable elements (`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`), focus the first element.
   - On `keydown`:
     - If `key === 'Tab'`: if shiftKey and on first element, focus last element; if !shiftKey and on last element, focus first element.
     - If `key === 'Escape'`: call modal's close function.
   - On close: restore focus to `previousActiveElement`.
4. **54 GUI Slots & Inventory Slots ARIA & Keyboard (`dashboard-html.js:12684, 13293`)**:
   - In `detailRemoteGuiSlots`:
     Add `role="button"`, `tabindex="0"`, `aria-label="Ô GUI #${idx}: ${safeName}${item?.count > 1 ? ' x' + item.count : ''}"`, and `onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();clickDetailGuiSlot(${idx});}"`.
   - In `createDetailSlot`:
     Add `el.setAttribute('role', 'button')`, `el.setAttribute('tabindex', '0')`, `el.setAttribute('aria-label', ...)`, and keyboard event listener.
5. **Action Buttons In-Flight Click Mutex (`dashboard-html.js:10643`)**:
   In `quickBotAction(event, id, action)`:
   ```javascript
   const actionKey = String(id) + ':' + action;
   if (window._inFlightQuickActions && window._inFlightQuickActions.has(actionKey)) return;
   if (!window._inFlightQuickActions) window._inFlightQuickActions = new Set();
   window._inFlightQuickActions.add(actionKey);
   const btn = event.currentTarget;
   if (btn) btn.disabled = true;
   try {
     // ... execute requestJson ...
   } finally {
     window._inFlightQuickActions.delete(actionKey);
     if (btn) btn.disabled = false;
   }
   ```
   Apply equivalent guard to `clickDetailGuiSlot(slot)`.

### 4.4 Gate 6: Fix Identified SYNC-16-02 Event Deduplication Bug
In `D:\manager\src\storage\supabase-worker-store.js:216-220`:
Change:
```javascript
const existingEvents = Array.isArray(current.events) ? current.events : [];
const isDuplicate = existingEvents.some((e) =>
  (safeEvent.id && e.id === safeEvent.id) ||
  (Boolean(safeEvent.message) && Boolean(safeEvent.occurredAt) &&
   e.type === safeEvent.type && e.message === safeEvent.message && String(e.occurredAt) === String(safeEvent.occurredAt))
);
```
This immediately resolves both `reproduce-sync-16-02-bug.test.js` and `adversarial-phase2-challenge.test.js` Challenge 8.

---

## 5. Verification Method

To independently verify all findings and test suites:

1. **Worker Tests**:
   ```powershell
   cmd /c "cd /d D:\worker && node tests/integration.test.js"
   cmd /c "cd /d D:\worker && node tests/challenger_stress.test.js"
   ```
   Expected: Both exit code 0, 100% assertions passed.

2. **Manager Storage & SQL Schema Parity**:
   ```powershell
   cmd /c "cd /d D:\manager && node tests/storage-sql.test.js"
   ```
   Expected: Exit code 0, 100% 4-way parity across all 27 tables and 52 RPCs.

3. **Manager Full Regression Suite**:
   ```powershell
   cmd /c "cd /d D:\manager && npm test"
   ```
   Expected: Exit code 0 across all 6 suites (`integration`, `services-wiring`, `storage-sql`, `auth-regression`, `worker-registry-audit`, `command-execution-audit`).

4. **Manager Adversarial Suites**:
   ```powershell
   cmd /c "cd /d D:\manager && node tests/adversarial-auth-stress.test.js"
   cmd /c "cd /d D:\manager && node tests/adversarial-challenger2.test.js"
   cmd /c "cd /d D:\manager && node tests/reproduce-sync-16-02-bug.test.js"
   cmd /c "cd /d D:\manager && node tests/adversarial-phase2-challenge.test.js"
   ```
   Expected: The latter two currently fail and verify the exact root cause in `supabase-worker-store.js:219`.

**Invalidation Conditions**:
- If `storage-sql.test.js` fails with divergence error, SQL functions/tables were modified in one file without updating all 4 canonical sources.
- If `adversarial-phase2-challenge.test.js` still reports `Events array must be capped at 100, got 1`, the event deduplication logic in `supabase-worker-store.js` has not properly guarded undefined fields.
