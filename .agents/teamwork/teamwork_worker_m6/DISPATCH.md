## 2026-11-14T13:07:18Z

You are Worker M6 for Milestone 6: Gate 5 (Manager UI/UX & Accessibility) + Worker Authentication & Storage Event Deduplication Fixes across Manager (`D:\manager`) and Worker (`D:\worker`).

Original Request path: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\ORIGINAL_REQUEST.md
Scope document: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\PROJECT.md
Your state folder: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_worker_m6\

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

# SCOPE REQUIREMENTS

### G5-01: Public Login License Key Field Hint & Placeholder
In `D:\manager\src\http\views\login-html.js`:
- Inspect where `#regLicenseKeyHint` and `#regLicenseKey` input field are defined/rendered.
- When `trialGiftEnabled` is false (or dynamically based on client config / settings.trialGiftEnabled):
  - `#regLicenseKeyHint` must display `"(Bắt buộc nếu tắt dùng thử)"` (instead of `"(Có thể bỏ trống)"` when trial is disabled).
  - `#regLicenseKey` input placeholder must be `"Nhập mã License Key để kích hoạt tài khoản..."` (or if trial is enabled: `"Nhập mã License Key (nếu có)..."`).
  - Ensure client-side JavaScript updates this dynamically when fetching `/api/auth/login-config` or system settings if trial gift status is determined asynchronously.

### G5-02: Modal Focus Trapping, Escape Listener, and Focus Restoration
In `D:\manager\src\http\views\dashboard-html.js`:
- Implement a reusable modal focus management helper (e.g. `trapModalFocus(modalEl)` / `setupAccessibleModals()`):
  - When a modal opens: record `previousActiveElement = document.activeElement;` and focus the first focusable interactive element inside the modal.
  - Trap focus within modal: intercept `Tab` and `Shift+Tab` keydown events on the modal boundaries so focus cycles within the modal elements and does not escape to the background document.
  - Escape key listener: pressing `Escape` closes the currently open modal.
  - On modal close: restore focus back to `previousActiveElement`.
  - Ensure modals have accessible dialog attributes (`role="dialog"`, `aria-modal="true"`, and appropriate `aria-labelledby` or `aria-label`).

### G5-03: Semantic `<main>` Landmark
In `D:\manager\src\http\views\dashboard-html.js`:
- Locate the main content view wrapper (around line 5540) containing `#homePage`, `#detailPage`, `#userManagementPage`, `#auditPage`, `#backupPage`.
- Wrap or structure this container as a semantic `<main id="mainContent" class="app-main-content" role="main">...</main>` so screen readers and accessibility evaluators identify the primary landmark.

### G5-04: Accessible 54 GUI Slots & Inventory
In `D:\manager\src\http\views\dashboard-html.js`:
- In `detailRemoteGuiSlots` rendering (around line 12684) and `createDetailSlot` (around line 13293):
  - Ensure every interactive slot element has `role="button"`, `tabindex="0"`.
  - Provide an accessible label: `aria-label="Ô GUI #${idx}: ${safeName}${item?.count > 1 ? ' x' + item.count : ''}"`.
  - Add keyboard navigation/action support: listening to `keydown` for `Enter` and ` ` (Space) to trigger the corresponding click/slot action (`clickDetailGuiSlot(idx)` or slot action handler).

### G5-05: In-Flight Click Mutex on Action Buttons & GUI Slots
In `D:\manager\src\http\views\dashboard-html.js`:
- In `quickBotAction` (around line 10643) and GUI slot actions:
  - Add an in-flight click mutex (e.g. `_inFlightQuickActions = new Set()` or per-element `button.dataset.inFlight = 'true'` / `button.disabled = true`).
  - Prevent rapid double-clicks or spam clicks while an action request is in flight.
  - Disable or visually indicate busy state, and always re-enable / release mutex in `finally`.

### G6-01: Worker-to-Manager Bearer Token Fallback
In `D:\worker\src\http\auth.js` and `D:\worker\src\http\routes.js`:
- In `D:\worker\src\http\auth.js`: Check both `req.get('x-worker-secret')` AND `Authorization: Bearer <secret>`.
  - Extract token from `Authorization` header if format is `Bearer <token>` (trimmed, case-insensitive scheme).
  - Verify secret matches if either `x-worker-secret` or Bearer token is provided.
- In `D:\worker\src\http\routes.js` (around line 66-70 for diagnostics or protected endpoints): Ensure diagnostics and other endpoints accept both authentication mechanisms.

### G6-02: Fix SupabaseWorkerStore Event Deduplication Bug
In `D:\manager\src\storage\supabase-worker-store.js`:
- In `saveEvents` (around line 216-220):
  ```javascript
  const isDuplicate = existingEvents.some((e) =>
    (safeEvent.id && e.id === safeEvent.id) ||
    (Boolean(safeEvent.message) && Boolean(safeEvent.occurredAt) &&
     e.type === safeEvent.type && e.message === safeEvent.message && String(e.occurredAt) === String(safeEvent.occurredAt))
  );
  ```
  Ensure events that lack `message` or lack `occurredAt` are NOT falsely flagged as duplicates of other events with missing fields. Notice how `Boolean(safeEvent.message) && Boolean(safeEvent.occurredAt)` MUST be checked before comparing message/occurredAt, or use safe event equality checking. Ensure this passes `reproduce-sync-16-02-bug.test.js` if present and does not drop valid distinct events.

### G6-03: Chain Integration and Challenger Tests in Worker
In `D:\worker\package.json`:
- Update `"scripts": { "test": ... }` so running `npm test` runs:
  `node tests/integration.test.js && node tests/challenger_stress.test.js`

### Verification Requirements:
1. Create `D:\manager\tests\gate5-ui-worker.test.js`:
   - Unit/integration test testing the HTML output and client scripts of `login-html.js` (G5-01) and `dashboard-html.js` (G5-02, G5-03, G5-04, G5-05).
   - Test `D:\worker\src\http\auth.js` verifying Bearer token authentication works alongside `x-worker-secret` (G6-01).
   - Test `D:\manager\src\storage\supabase-worker-store.js` event deduplication logic (G6-02).
2. Integrate `gate5-ui-worker.test.js` into `D:\manager\package.json` test script.
3. Run both test suites:
   `cmd /c "cd /d D:\manager && npm test"`
   `cmd /c "cd /d D:\worker && npm test"`
   All tests in both repositories MUST pass 100% with exit code 0.
