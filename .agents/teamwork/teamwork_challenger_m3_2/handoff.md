# Adversarial Challenge Report: Gate 3 Milestone 3 (API-01 through API-04)

**Date**: 2026-11-14T10:36:00Z  
**Author**: `teamwork_challenger_m3_2` (Adversarial Challenger 2 / Critic & Specialist)  
**Target Codebase**: `D:\manager`  
**Milestone**: Gate 3 Milestone 3 (Router Security & User API: API-01..04)  
**Final Verdict**: **APPROVE (CLEAN)**

---

## 1. Observation

Direct empirical observations were gathered by executing independent adversarial probes against `D:\manager\src` modules and running the project test suites:

### 1.1 API-01: Strict Mounting of `userRouter` at `/api/user`
- In `D:\manager\src\http\app.js` (lines 446–456):
  ```javascript
  const userRouter = createUserApi({ ... });
  app.use('/api/user', userRouter);
  ```
- No secondary or wildcard mounts of `userRouter` exist.
- Testing direct routes under `/api/user`:
  - `GET /api/user/bots` returns HTTP 401 unauthenticated (`{ ok: false, error: ... }`), confirming active mounting.
  - `POST /api/user/bots/reorder` returns HTTP 401 unauthenticated.
- Testing legacy shadowed aliases:
  - `GET /api/manager/bots` returns HTTP 403 (routed strictly to `adminRouter`, requiring admin credentials).
  - `POST /api/manager/bots/reorder` returns HTTP 403 (routed strictly to `adminRouter`).
  - `GET /api/rewards/link4m/bots` returns HTTP 404 Not Found.
  - `GET /api/public/bots` returns HTTP 404 Not Found.
  - `GET /api/bots` (bare alias) returns HTTP 404 Not Found.
  - `POST /api/bots/reorder` (bare alias) returns HTTP 404 Not Found.
  - `POST /api/bot/bot-1/auto-chat` (bare alias) returns HTTP 404 Not Found.

### 1.2 API-02: Gated CSRF Exemption for Worker Routes
- In `D:\manager\src\http\app.js` (lines 132–173):
  ```javascript
  if (req.path.startsWith('/api/worker/') || req.path.startsWith('/api/v1/workers/')) {
    const authHeader = String(req.headers['authorization'] || '');
    const hasBearer = authHeader.startsWith('Bearer ') && authHeader.slice(7).trim().length > 0;
    if (isBotSecretRequest(req) || hasBearer) {
      return next();
    }
  }
  ```
- Tested endpoints: `POST /api/worker/commands`, `POST /api/worker/report`, `PUT /api/v1/workers/bot-1/status`, `POST /api/v1/workers/bot-1/heartbeat`.
- Cross-origin browser mutation without secret or Bearer token (`Origin: http://evil.com`, `Sec-Fetch-Site: cross-site`) -> All returned HTTP 403 with `{ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (Origin mismatch).' }`.
- Valid `x-worker-secret` (per-bot) or `x-bot-secret` -> Bypassed CSRF (HTTP status handed over to route handler, e.g. 404/400/500/200, never 403 CSRF).
- Valid global secret (`config.botSecretKey`) -> Bypassed CSRF.
- Valid `Authorization: Bearer <token>` -> Bypassed CSRF.
- Tested 10 adversarial credential edge cases:
  - Empty Bearer token (`Bearer `), Bearer without space (`Bearer`), whitespace-only token (`Bearer     `) -> HTTP 403 CSRF.
  - Non-Bearer schemes (`Basic ...`, `Token ...`) -> HTTP 403 CSRF.
  - Empty secret (`x-worker-secret: ""`), whitespace secret (`x-worker-secret: "   "`), empty bot secret (`x-bot-secret: ""`) -> HTTP 403 CSRF.
  - Invalid secrets (`x-worker-secret: "wrong_secret"`) -> HTTP 403 CSRF.

### 1.3 API-03: Bot Schedules Array Validation
- In `D:\manager\src\http\routes\user-api.js` (lines 516–518, 535–537):
  - In `POST /bot/:id/auto-chat`:
    ```javascript
    if (!Array.isArray(req.body?.autoChatSchedules)) {
      return res.status(400).json({ ok: false, error: 'Schedules must be an array.' });
    }
    ```
  - In `POST /bot/:id/bot-schedules`:
    ```javascript
    if (!Array.isArray(req.body?.botSchedules)) {
      return res.status(400).json({ ok: false, error: 'Schedules must be an array.' });
    }
    ```
- Tested non-array inputs for `auto-chat` and `bot-schedules`:
  - String (`"invalid"`), integer (`12345`), empty object (`{}`), object with fields (`{ time: '12:00' }`), `null`, boolean (`true`, `false`), missing property (empty body `{}`).
  - Result: All returned HTTP 400 with `{ ok: false, error: 'Schedules must be an array.' }`.
  - Database verification: Confirmed `registry.updateSettings` was called 0 times across all invalid inputs. The database is never overwritten with empty arrays or corrupted data.
- Tested valid array inputs:
  - `[]` (empty array) -> HTTP 200, `registry.updateSettings` persisted `[]`.
  - Populated schedule array -> HTTP 200, `registry.updateSettings` persisted array.

### 1.4 API-04: Real DB Persistence for `/bots/reorder`
- In `D:\manager\src\http\routes\user-api.js` (lines 274–308):
  - Validates `rawOrder = req.body?.botIds || req.body?.order` is a non-empty array of non-empty strings.
  - Verifies every bot ID belongs to `session.assignedBotIds`.
  - Persists to database via `store.setAccess(userId, { workerIds: updatedOrder }, session.username)` or `store.updateUser(userId, { assigned_bot_ids: updatedOrder })`.
  - Updates in-memory `session.assignedBotIds = updatedOrder`.
  - Returns `{ ok: true, message: 'Đã lưu thứ tự bot.', order: updatedOrder }`.
- Tested reordering validation:
  - Non-array inputs (string, number, null, object, boolean, missing) -> HTTP 400; store untouched; session unchanged.
  - Empty array (`{ botIds: [] }`, `{ order: [] }`) -> HTTP 400; store untouched; session unchanged.
  - Malformed array elements (numbers, empty string `""`, whitespace `"   "`, `null`, `{}`) -> HTTP 400; store untouched; session unchanged.
- Tested authorization:
  - User has `assignedBotIds: ['bot-alpha', 'bot-beta', 'bot-gamma']`.
  - Request with unassigned bot ID (`['bot-alpha', 'bot-unauthorized-999']`) -> HTTP 403 `{ ok: false, error: 'Chứa bot ID không thuộc quyền quản lý của bạn.' }`; store untouched; session unchanged.
- Tested persistence:
  - Valid reorder `{ botIds: ['bot-gamma', 'bot-alpha', 'bot-beta'] }` -> HTTP 200; `store.setAccess` invoked with `userId: 'usr_reorder_challenger'`, `data: { workerIds: ['bot-gamma', 'bot-alpha', 'bot-beta'] }`, `actor: 'challenger_user'`; session `assignedBotIds` updated in-memory.
  - Valid reorder with `{ order: [...] }` property -> HTTP 200; store and session updated.
  - Fallback to `store.updateUser` when `store.setAccess` is missing -> HTTP 200; `store.updateUser` invoked with `assigned_bot_ids`.
  - Database exception propagation -> HTTP 500 `{ ok: false, error: 'Database disk full' }`.

---

## 2. Logic Chain

1. **API-01**:
   - `createApp` mounts `userRouter` strictly using `app.use('/api/user', userRouter)`.
   - Legacy aliases at `/api/manager`, `/api/rewards/link4m`, `/api/public`, and `/api` were removed.
   - Empirical requests to `/api/manager/bots` are now received by `adminRouter` (returning 403 admin auth required), eliminating the route-shadowing vulnerability where regular user endpoints intercepted manager admin calls.
   - Empirical requests to `/api/rewards/link4m/bots`, `/api/public/bots`, `/api/bots`, `/api/bots/reorder` return 404, proving no alias leakages exist.

2. **API-02**:
   - The CSRF middleware explicitly checks whether requests beginning with `/api/worker/` or `/api/v1/workers/` contain valid worker authentication: either `isBotSecretRequest(req)` or `Authorization: Bearer <token>`.
   - Any cross-origin request lacking these credentials falls through to standard CSRF validation: when `originHost !== host`, it triggers an immediate HTTP 403 rejection.
   - Attackers attempting to spoof tokens with empty or malformed strings (`Bearer`, `Bearer `, `Basic ...`, empty secrets, invalid secrets) fail credential checks and are blocked by the CSRF check with HTTP 403.
   - Legitimate worker processes presenting valid secrets or tokens bypass CSRF without issue.

3. **API-03**:
   - In both `/bot/:id/auto-chat` and `/bot/:id/bot-schedules`, `Array.isArray()` guard clauses execute prior to touching the store or registry.
   - If `!Array.isArray(...)`, execution terminates immediately with HTTP 400 `{ ok: false, error: 'Schedules must be an array.' }`.
   - Registry/database write methods (`updateSettings`) are never called on malformed input, eliminating the previous regression where non-array payloads were coerced to `[]` and wiped stored schedules.

4. **API-04**:
   - In `POST /bots/reorder`, the request body must contain a non-empty array of valid non-empty string IDs under `botIds` or `order`.
   - Ownership is strictly enforced by asserting that every submitted bot ID is included in `session.assignedBotIds`; any foreign ID results in an immediate HTTP 403.
   - On authorized input, the update is dispatched to `store.setAccess` (or fallback `store.updateUser`), in-memory session state is updated, and the new array is returned in the response.

---

## 3. Caveats

- **No Caveats**: The implementation handles all primary paths, defensive fallbacks (`store.setAccess` vs `store.updateUser`), empty/malformed inputs, and authorization boundaries without facades or shortcuts.
- No files in `D:\manager` were modified during this adversarial challenge; probe scripts ran strictly in temporary scratch memory and were deleted upon completion.

---

## 4. Conclusion

**Verdict: APPROVE (CLEAN)**

The fixes implemented for Gate 3 Milestone 3 (API-01 through API-04) are robust, genuine, and resilient against adversarial attack vectors:
1. `userRouter` is strictly isolated at `/api/user` with zero alias shadowing.
2. Worker endpoints are protected against cross-origin CSRF forgery while allowing authenticated workers to communicate via secrets or Bearer tokens.
3. Bot schedule endpoints strictly enforce array data structures and protect stored configurations from corruption.
4. Bot reordering authenticates bot tenancy, enforces non-empty array structures, and reliably commits ordering to persistent storage.

---

## 5. Verification Method

### 5.1 Verification Commands and Results

1. **Independent Adversarial Probe Suite (Suites 1–4, 60+ assertions)**:
   - Executed probe script outside `D:\manager` with `NODE_PATH=D:\manager\node_modules`:
     ```powershell
     $env:NODE_PATH="D:\manager\node_modules"; node C:\Users\kietp\.gemini\antigravity\scratch\probe_m3_2\probe-m3-2.js
     ```
   - **Result**:
     ```
     ========================================================================
     CHALLENGER 2 ADVERSARIAL EMPIRICAL PROBE: GATE 3 MILESTONE 3 (API-01..04)
     ========================================================================
     SUITE 1 (API-01): Strict userRouter mounting verified with zero shadowing.
     SUITE 2 (API-02): Gated CSRF exemption for worker routes fully verified.
     SUITE 3 (API-03): Bot schedules array validation verified.
     SUITE 4 (API-04): Real DB persistence for /bots/reorder fully verified.
     ========================================================================
     🎉 ALL 4 ADVERSARIAL TEST SUITES PASSED EMPIRICALLY IN 220ms!
     ========================================================================
     ```
   - Exit code: `0`.
   - Scratch directory `C:\Users\kietp\.gemini\antigravity\scratch\probe_m3_2` was deleted and verified removed (`Test-Path: False`).

2. **Milestone 3 Dedicated Test Suite**:
   - Command:
     ```cmd
     cmd /c "cd /d D:\manager && node tests/gate3-m3-discord-router.test.js"
     ```
   - **Result**:
     ```
     🎉 ALL GATE 3 MILESTONE 3 (DIS-12-01..05, API-01..04) TESTS PASSED 100%!
     ```
   - Exit code: `0`.

3. **Prior Milestone Regression Test Suites (M1 & M2)**:
   - Command:
     ```cmd
     cmd /c "cd /d D:\manager && node tests/gate3-m2-access-control.test.js && node tests/gate3-m1-concurrency.test.js"
     ```
   - **Result**:
     ```
     🎉 ALL GATE 3 MILESTONE 2 (ACC-11-01 to ACC-11-04) TESTS PASSED 100%!
     🎉 ALL GATE 3 MILESTONE 1 (P6-01 to P6-08) TESTS PASSED 100%!
     ```
   - Exit code: `0`.

4. **Full Manager Regression Suite (`npm test`)**:
   - Command:
     ```cmd
     cmd /c "cd /d D:\manager && npm test"
     ```
   - **Result**:
     - All Manager Integration Tests (15/15) PASSED.
     - All Manager Services Wiring Tests PASSED.
     - All Storage & SQL Tests PASSED.
     - All Auth Hardening Tests (AUTH-01..08) PASSED.
     - All Worker Registry & Storage Hardening Tests (WORKER-01..08, WKR-01..03) PASSED.
     - All Command Queue & Lifecycle Audit Tests (CMD-01..08, API-05..09, SYNC-16-01..02) PASSED.
   - Exit code: `0`.
