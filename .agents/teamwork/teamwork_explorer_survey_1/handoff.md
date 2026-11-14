# Handoff Report: Gate 3 - Part 6 (Concurrency & Network Security) & Part 11 (Access Control & Assignment Integrity)

**Investigator**: `teamwork_explorer_survey_1`  
**Working Directory**: `D:\manager`  
**Date**: 2026-11-14T08:40:00Z  
**Status**: Investigation Complete (Read-Only)

---

## 1. Observation

### Item 1: P6-01 — AsyncKeyLock Timeout Lock Release
- **File**: `D:\manager\src\services\async-key-lock.js`
- **Lines**: 49–65
- **Direct Observation**:
  ```javascript
  49:   let execTimer = null;
  50:   const execTimeoutPromise = new Promise((_, reject) => {
  51:     if (executionTimeoutMs > 0) {
  52:       execTimer = setTimeout(() => {
  53:         reject(new Error(`Execution timeout for local key lock: ${key} (${executionTimeoutMs}ms)`));
  54:       }, executionTimeoutMs);
  55:       execTimer.unref?.();
  56:     }
  57:   });
  58: 
  59:   try {
  60:     return await Promise.race([task(), execTimeoutPromise]);
  61:   } finally {
  62:     if (execTimer) clearTimeout(execTimer);
  63:     release();
  64:     this.decrementCount(key, tail);
  65:   }
  ```
  When `execTimeoutPromise` rejects due to timeout, the `finally` block executes immediately. `release()` (which resolves the `hold` promise on line 17–24) and `this.decrementCount(key, tail)` are executed while the background `task()` is still running. The next chained task waiting on `tail` is unblocked and executes concurrently with `task()`.

### Item 2: P6-02 — EntitlementService Pending Allocation Error Handling & Compensation State
- **File**: `D:\manager\src\services\entitlement-service.js`
- **Lines**: 268–299
- **Direct Observation**:
  ```javascript
  269:   const missingWorkers = Math.max(0, targetCount - desired.length);
  270:   if (missingWorkers > 0) {
  271:     const nowIso = new Date().toISOString();
  272:     const allocUsername = String(member?.username || cleanUserId).trim().toLowerCase();
  273:     if (this.store.adapter && typeof this.store.adapter.savePendingAllocation === 'function') {
  274:       await this.store.adapter.savePendingAllocation({
  275:         id: `alloc_${crypto.randomUUID()}`,
  276:         username: allocUsername,
  277:         targetBotCount: targetCount,
  278:         currentAssigned: desired.length,
  279:         missingBotCount: missingWorkers,
  280:         status: 'pending_retry',
  281:         createdAt: nowIso
  282:       }).catch((err) => {
  283:         this.logger?.warn('enqueue_pending_allocation_failed', { userId: cleanUserId, error: err.message });
  284:       });
  285:     } else {
  286:       await this.store.client?.from?.('manager_pending_allocations')?.insert?.({
  ...
  295:       }).catch((err) => {
  296:         this.logger?.warn('enqueue_pending_allocation_failed', { userId: cleanUserId, error: err.message });
  297:       });
  298:     }
  299:   }
  ```
  And in `D:\manager\src\storage\supabase-client.js:2276-2280`:
  `savePendingAllocation` catches its own HTTP error and returns `false`. Neither the boolean `false` nor the `.catch` warning preserves compensation state. Once `redeemKeyWithAccess` has committed the key consumption, if `savePendingAllocation` fails, the missing allocation is silently lost with no retry queue record or compensation tracking.

### Item 3: P6-03 — Proxy Validation SSRF & DNS Lookup
- **File**: `D:\manager\src\services\proxy-validation.js`
- **Lines**: 161–184
- **Direct Observation**:
  ```javascript
  161: function validateProxyUrl(rawUrl) {
  ...
  181:   if (isLocalOrPrivateHost(url.hostname)) {
  182:     throw new Error('Proxy không được trỏ về địa chỉ nội bộ hoặc loopback.');
  183:   }
  ...
  ```
  `validateProxyUrl` is synchronous. `isLocalOrPrivateHost(hostname)` checks string literals and `isPrivateOrBlockedIp(host)`. Because `net.isIP(hostname)` returns 0 for hostnames (e.g. `localtest.me` or attacker-controlled domains pointing to `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`), `isPrivateOrBlockedIp` returns `false`. No DNS resolution is performed, allowing SSRF.
  In `D:\manager\src\http\routes\user-api.js:579` and `602`:
  `validateProxyUrl(proxyUrl);` is called synchronously inside `async` route handlers.

### Item 4: P6-04, P6-06 — Link4M Service Token Verification & Daily Limits
- **File**: `D:\manager\src\services\link4m-service.js`
- **Lines**: 222–248, 340–363
- **Direct Observation**:
  In `startAttemptLocked`:
  ```javascript
  222:   const now = new Date();
  223:   const active = await this.store.findActiveLinkAttempt(userId, now);
  224:   if (active?.providerUrl) {
  225:     return {
  226:       attemptId: active.attemptId,
  227:       providerUrl: active.providerUrl,
  228:       expiresAt: active.expiresAt,
  229:       rewardHours: active.rewardHours,
  230:       reused: true
  231:     };
  232:   }
  233:   if (active) await this.store.expireLinkAttempt(active.attemptId);
  234:   await this.store.expireLinkAttempts(userId, now);
  235: 
  236:   const todayStart = vietnamDayStart(now);
  237:   const usedToday = await this.store.countLinkRewards(userId, todayStart);
  238:   const dailyLimit = Number(this.config.dailyLimit || 2);
  239:   if (usedToday >= dailyLimit) {
  240:     throw new Error(`Bạn đã đạt giới hạn ${dailyLimit} lượt vượt link nhận thưởng hôm nay.`);
  241:   }
  ```
  Lines 223–232 return `active.providerUrl` BEFORE checking `usedToday >= dailyLimit` (line 239) and cooldown (line 244).
  In `verifyAndClaimReward(token, attemptId)` and `POST /rewards/link4m/verify` (`user-api.js:854-869`):
  Token verification must strictly validate nonces and verify `tokenHash` against database/RPC before claiming.

### Item 5: P6-05 — EntitlementService Fixed Bot IDs Quota Cap
- **File**: `D:\manager\src\services\entitlement-service.js`
- **Lines**: 224–248
- **Direct Observation**:
  ```javascript
  224:   const currentIds = Array.isArray(member?.workerIds) ? member.workerIds.map(String) : [];
  225:   const desired = [...currentIds];
  226:   const fixedIds = Array.isArray(key.workerIds) ? key.workerIds.map(String) : (Array.isArray(key.botIds) ? key.botIds.map(String) : []);
  227:   const candidates = await this.registry.list();
  228:   const registeredIds = new Set(candidates.map((w) => String(w.workerId)));
  229:   const targetCount = Math.max(currentIds.length, Number(key.botCount) || 1);
  230: 
  231:   // Gán các bot cố định trong key
  232:   for (const workerId of fixedIds) {
  233:     if (desired.includes(workerId)) continue;
  234:     if (!registeredIds.has(workerId)) continue;
  235:     const assigned = await this.store.assignedUser(workerId);
  236:     if (assigned && assigned.userId !== cleanUserId) continue;
  237:     desired.push(workerId);
  238:   }
  ```
  The loop at line 232 pushes all valid `fixedIds` into `desired` without checking `if (desired.length >= targetCount) break;`. While the free bots loop at line 243 checks `if (desired.length >= targetCount) break;`, the `fixedIds` loop does not, allocating beyond the package quota.

### Item 6: P6-07 — Bot Settings Sanitization on Update
- **File**: `D:\manager\src\http\routes\user-api.js`
- **Lines**: 617–651
- **Direct Observation**:
  ```javascript
  640:     await registry.saveConfig(worker.workerId, updatedConfig);
  ...
  648:     return res.json({ ok: true, message: 'Đã cập nhật cài đặt bot thành công.', bot: updatedConfig });
  ```
  `updatedConfig` contains `...worker`, which holds internal fields such as `secretKey`, `url`, `sourceUrl`, `proxy`, `ipAddress`, etc. It is returned directly in the response without `sanitizeBotForSession(updatedConfig, req.managerAuthSession)`.

### Item 7: P6-08 — License Key Activation Transactions & Concurrency
- **File**: `D:\manager\src\services\entitlement-service.js`, `D:\manager\src\http\routes\auth-api.js`, `D:\manager\src\http\routes\user-api.js`, `supabase/migrations/20261112000000_reconcile_full_manager_schema.sql:3727-3850`
- **Direct Observation**:
  In `entitlement-service.js:170-174`:
  ```javascript
  async redeem(userId, rawCode, discordRole = 'user') {
    const run = () => this.redeemLocked(userId, rawCode, discordRole);
    if (!this.userLock) return run();
    return this.userLock.run('global:bot_allocation', () => this.userLock.run(userId, run));
  }
  ```
  The in-memory lock wraps `global:bot_allocation` and `userId`. Locking on `key:${codeHash}` guarantees that concurrent redemptions of the same key across any caller serialize before reading `this.store.getKey()`. In Postgres, `manager_redeem_code_with_access` uses `FOR UPDATE` on `manager_keys` (line 3758) and checks `used = true OR used_count >= max_uses` (line 3798), raising an exception if already consumed.

### Item 8: ACC-11-01 — AccessControl isEntitled Null Expiration Handling
- **File**: `D:\manager\src\services\access-control.js`
- **Lines**: 82–90
- **Direct Observation**:
  ```javascript
  82:   isEntitled(member) {
  83:     if (!member) return false;
  84:     const status = String(member.status || 'active').toLowerCase();
  85:     if (status !== 'active') return false;
  86:     if (member.isPermanent === true) return true;
  87:     if (!member.expiresAt) return true; // Null expiresAt with active status is treated as lifetime or unexpired
  88:     const expiryTime = Date.parse(member.expiresAt);
  89:     return Number.isFinite(expiryTime) && expiryTime > Date.now();
  90:   }
  ```
  Line 87 explicitly returns `true` when `member.expiresAt` is null/empty and `isPermanent` is false. This incorrectly grants lifetime entitlement to non-permanent accounts without an expiration timestamp.

### Item 9: ACC-11-02 — Discord Panel /bots and /logs isEntitled Checks
- **Files**: `D:\manager\src\discord\commands\bots.js`, `D:\manager\src\discord\commands\logs.js`, `D:\manager\src\discord\handlers\panel-handler.js`
- **Lines**: `bots.js:12-27`, `logs.js:17-42`, `panel-handler.js:156-168`
- **Direct Observation**:
  In `bots.js`:
  ```javascript
  const user = await resolveLinkedUser(interaction, services);
  ...
  const userBots = await getUserBots(user, services);
  return renderBotsList({ user, workers: userBots, page: 0 });
  ```
  Neither `bots.js` nor `logs.js` nor `getUserBots()` checks `services.accessControl.isEntitled(user)` for non-admin users. An expired user can still execute `/bots` and `/logs` and view bot lists and bot logs.

### Item 10: ACC-11-03 — Worker Removal Assignments and User Array Cleanup
- **File**: `D:\manager\src\storage\supabase-dashboard-store.js`
- **Lines**: 564–568
- **Direct Observation**:
  ```javascript
  564:   async removeWorkerAssignments(workerId) {
  565:     try {
  566:       await this.client.from(ASSIGNMENTS).delete().eq('worker_id', workerId);
  567:     } catch (_) {}
  568:   }
  ```
  1. It only deletes from `manager_assignments` (`ASSIGNMENTS`), failing to update `manager_users.assigned_bot_ids`.
  2. It has an empty catch block `catch (_) {}`, silently discarding DB errors.
  When `WorkerRegistry.remove(workerId)` calls `removeWorkerAssignments(id)`, ghost worker IDs remain inside users' `assigned_bot_ids` in `manager_users`.

### Item 11: ACC-11-04 — AccessControl grant() Worker Existence Validation
- **File**: `D:\manager\src\services\access-control.js`
- **Lines**: 111–132
- **Direct Observation**:
  ```javascript
  116:   const workerIds = [...new Set((options.workerIds || []).map((id) => String(id).trim().toLowerCase()).filter(Boolean))];
  117:   if (workerIds.some((id) => !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id))) throw new Error('One or more worker IDs are invalid.');
  ```
  `grant()` validates workerId string format against a regex, but does not verify whether the worker exists in `WorkerRegistry`. Contrast this with `EntitlementService.createCode` (`entitlement-service.js:120-121`), which verifies all worker IDs against `registry.list()`.

---

## 2. Logic Chain

1. **P6-01**: From Observation 1, in `AsyncKeyLock.run()`, `execTimeoutPromise` triggers before `task()` settles. Because `release()` is called in the `finally` block, `hold` resolves immediately and the next queued task acquires the lock while the previous `task()` continues executing.  
   *Conclusion*: We must distinguish execution timeout from normal task settlement. When a timeout occurs, caller gets rejected immediately, but lock release (`release()` and `decrementCount`) must be deferred to `taskPromise.finally()`.

2. **P6-02**: From Observation 2, `savePendingAllocation` errors are caught and logged as warnings, while the method returns `{ success: true, missingWorkers }`.  
   *Conclusion*: If `savePendingAllocation` fails, compensation state is lost. Handling it durably requires attempting a fallback queue entry (such as `enqueueOutbox` or updating user record with compensation metadata) and propagating an explicit status or error so compensation is not dropped.

3. **P6-03**: From Observation 3, `validateProxyUrl` is synchronous and only calls `isLocalOrPrivateHost`, which performs regex and IP checks without DNS lookup. A malicious hostname resolving to `127.0.0.1` or `10.0.0.0/8` bypasses validation completely.  
   *Conclusion*: `validateProxyUrl` must be `async`, resolve hostnames using `dns.promises.lookup(hostname, { all: true })`, and validate all resolved IPs against private/loopback/metadata CIDRs. The callers in `user-api.js` (`/bot/:id/proxy/test` and `/bot/:id/proxy`) are already async and must `await validateProxyUrl(proxyUrl)`.

4. **P6-04 & P6-06**: From Observation 4, `startAttemptLocked` returns a cached active attempt URL before checking `usedToday >= dailyLimit` or cooldown.  
   *Conclusion*: Daily limit and cooldown validation must be placed at the very entry of `startAttemptLocked` before any attempt lookup or URL generation. Additionally, claim verification must require both `token` and `attemptId` and verify the token hash against the backend store/RPC.

5. **P6-05**: From Observation 5, `redeemLocked` loops over `fixedIds` and pushes them into `desired` without checking `desired.length >= targetCount`.  
   *Conclusion*: Add `if (desired.length >= targetCount) break;` inside the `fixedIds` iteration.

6. **P6-07**: From Observation 6, `POST /bot/:id/settings` directly responds with `{ bot: updatedConfig }`, bypassing `sanitizeBotForSession`.  
   *Conclusion*: Pass `updatedConfig` through `sanitizeBotForSession(updatedConfig, req.managerAuthSession)` before returning the JSON response.

7. **P6-08**: From Observation 7, parallel key redemption calls can race in memory if only locked on `userId`.  
   *Conclusion*: Add `key:${codeHash}` to the lock acquisition chain in `EntitlementService.redeem` to serialize requests for the same key code. PostgreSQL `FOR UPDATE` on `manager_keys` guarantees transactional serialization across instances.

8. **ACC-11-01**: From Observation 8, line 87 of `access-control.js` returns `true` if `!member.expiresAt` when `status === 'active'`.  
   *Conclusion*: Change line 87 to return `false` if `!member.expiresAt`, and return true only if `new Date(member.expiresAt).getTime() > Date.now()`.

9. **ACC-11-02**: From Observation 9, `/bots` and `/logs` in Discord commands display bots and logs without checking `isEntitled`.  
   *Conclusion*: In `src/discord/commands/bots.js` and `src/discord/commands/logs.js`, verify `user.role === 'admin' || (services.accessControl && services.accessControl.isEntitled(user))` and return an unauthorized/expired embed if false. Also ensure `getUserBots()` in `panel-handler.js` respects this check.

10. **ACC-11-03**: From Observation 10, `removeWorkerAssignments` in `supabase-dashboard-store.js` has an empty catch block and only deletes from `manager_assignments`.  
    *Conclusion*: Remove empty catch block, propagate/handle errors, and remove `workerId` from `manager_users.assigned_bot_ids` in addition to deleting from `manager_assignments`.

11. **ACC-11-04**: From Observation 11, `grant()` in `access-control.js` does not verify worker existence in `WorkerRegistry`.  
    *Conclusion*: Provide `registry` to `AccessControl`, and in `grant()`, check that every assigned worker ID exists in `WorkerRegistry` (via `registry.list()` or `registry.find()`), throwing if any ID is missing.

---

## 3. Caveats

- **No Caveats on Bug Locations**: All 11 bugs have been pinpointed to exact lines and functions in `D:\manager`.
- **Read-Only Scope**: In accordance with the assignment instructions, no code files or test files in `D:\manager` have been modified during this exploration.
- **Existing Test Suite**: Running `cmd.exe /c "npm --prefix D:\manager test"` executes 6 test suites and all 15 Phase 2 audit tests pass 100%. Targeted unit tests must be added to verify these 11 new fixes without regressing existing tests.

---

## 4. Conclusion & Surgical Fix Strategy

### Summary Matrix

| Bug ID | File Path | Line(s) | Fix Summary |
|---|---|---|---|
| **P6-01** | `src/services/async-key-lock.js` | 49–66 | On execution timeout, set `timedOut = true`, reject caller, and defer `release()` and `decrementCount` to `taskPromise.finally()`. |
| **P6-02** | `src/services/entitlement-service.js` | 270–299 | Catch and handle `savePendingAllocation` errors durably, logging and storing fallback compensation state. |
| **P6-03** | `src/services/proxy-validation.js`, `src/http/routes/user-api.js` | 161–184; 579, 602 | Make `validateProxyUrl` async, resolve hostnames via `dns.promises.lookup()`, validate against private/loopback/metadata IP ranges, and `await` in `user-api.js`. |
| **P6-04, P6-06** | `src/services/link4m-service.js` | 222–248, 340–363 | Move daily limit & cooldown checks before active attempt reuse; enforce strict token verification with backend. |
| **P6-05** | `src/services/entitlement-service.js` | 231–238 | Break `fixedIds` iteration when `desired.length >= targetCount` to cap allocation strictly at quota. |
| **P6-07** | `src/http/routes/user-api.js` | 648 | Wrap `updatedConfig` with `sanitizeBotForSession(updatedConfig, req.managerAuthSession)` in `POST /bot/:id/settings`. |
| **P6-08** | `src/services/entitlement-service.js` | 170–175 | Acquire in-memory key lock `key:${codeHash}` in `redeem()` to eliminate concurrent double-consumption races. |
| **ACC-11-01** | `src/services/access-control.js` | 87 | In `isEntitled()`, if `!member.isPermanent`, return `false` on null `expiresAt`, returning true only if `expiresAt` is in the future. |
| **ACC-11-02** | `src/discord/commands/bots.js`, `logs.js`, `panel-handler.js` | 25, 30, 156–168 | Check `accessControl.isEntitled(user)` before displaying bot lists in `/bots` and bot logs in `/logs`. |
| **ACC-11-03** | `src/storage/supabase-dashboard-store.js` | 564–568 | Delete assignment from `ASSIGNMENTS` table AND remove `workerId` from `manager_users.assigned_bot_ids`, eliminating empty catch blocks. |
| **ACC-11-04** | `src/services/access-control.js` | 116–122 | Check that assigned worker IDs exist in `WorkerRegistry` before creating assignments in `grant()`. |

---

## 5. Verification Method

### Test Commands
1. **Full Manager Suite**:
   ```cmd
   cmd /c "cd /d D:\manager && npm test"
   ```
2. **Targeted Verification Tests to Add**:
   - `tests/async-key-lock.test.js`: Test that when task 1 times out after 50ms while running a 150ms task, task 2 queued on the same key does NOT start executing until 150ms has elapsed.
   - `tests/proxy-validation.test.js`: Test `validateProxyUrl` with domain names resolving to `127.0.0.1`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, and `::1`, confirming all are rejected with SSRF errors.
   - `tests/link4m-limits.test.js`: Test that a user with an existing active attempt who has reached `dailyLimit` receives `Bạn đã đạt giới hạn...` error on `startAttempt` instead of reusing the attempt URL.
   - `tests/entitlement-quota.test.js`: Test that redeeming a key with 5 `workerIds` on a 2-bot quota only assigns 2 bots.
   - `tests/user-api-sanitization.test.js`: Test `POST /bot/:id/settings` as a non-admin rental user and verify that `secretKey`, `url`, and `proxy` are stripped from the response body.
   - `tests/access-control-entitlement.test.js`: Test `isEntitled({ status: 'active', isPermanent: false, expiresAt: null }) === false`.
   - `tests/discord-entitlement.test.js`: Test that an expired user invoking `/bots` or `/logs` receives the `⛔ TÀI KHOẢN HẾT HẠN HOẶC BỊ KHÓA` embed.
   - `tests/worker-removal-cleanup.test.js`: Test that `removeWorkerAssignments('worker-1')` deletes the row from `manager_assignments` AND removes `'worker-1'` from `manager_users.assigned_bot_ids`.
   - `tests/access-control-grant.test.js`: Test that `accessControl.grant()` with a non-existent worker ID throws an error.

### Invalidation Conditions
- If any existing test in `npm test` fails.
- If `AsyncKeyLock` releases the lock on timeout before the task settling callback runs.
- If `validateProxyUrl` permits domain names resolving to loopback or RFC 1918 IPs.
- If `isEntitled` returns true for a user where `isPermanent: false` and `expiresAt: null`.
