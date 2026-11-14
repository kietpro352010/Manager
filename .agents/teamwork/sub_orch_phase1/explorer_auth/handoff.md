# Investigation & Surgical Strategy Report: Auth & Secrets (Phase 1)

**Agent**: Explorer 1 (Explorer Auth)  
**State folder**: `D:\manager\.agents\teamwork\sub_orch_phase1\explorer_auth\`  
**Date**: 2026-11-14T05:15:00Z  
**Target Repo**: `D:\manager`  
**Milestone**: Phase 1: Security, Authentication, & Worker Registry Foundation  
**Scope**: 10 Findings (AUTH-01/SEC-01, AUTH-02/SEC-02, AUTH-03, AUTH-04, AUTH-05/SEC-05, AUTH-06/SEC-03, SEC-04, SEC-OBS-01, AUTH-07, AUTH-08)

---

## 1. Observation

### 1.1 AUTH-01 / SEC-01: Password Hashing & Legacy Auto-Migration
- **File**: `D:\manager\src\utils\secrets.js`
- **Lines 108–131**: `encryptUserPassword(value, key = null)` uses two-way `aes-256-gcm` returning `aes256$gcm$iv$tag$ct`.
- **Lines 178–182**: `hashPassword(password)` is defined as:
  ```javascript
  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt$N=16384,r=8,p=1$${salt}$${derived.toString('hex')}`;
  }
  ```
  *Observation*: `hashPassword` does not accept a custom salt parameter (signature is `hashPassword(password)`), limiting deterministic unit testing or custom salt injection if needed.
- **Lines 184–231**: `verifyPassword(password, storedValue)` handles both legacy AES-256 (`isStoredCredentialCiphertext(stored)` via `decryptUserPassword`) and Scrypt (`stored.startsWith('scrypt$')`).
- **File**: `D:\manager\src\http\routes\auth-api.js` lines 374–383:
  ```javascript
  if (!String(user.password || '').startsWith('scrypt$')) {
    try {
      const migratedHash = hashPassword(cleanPassword);
      await store.setAccess(userId, { password: migratedHash }, 'auth-migrate-scrypt');
      user.password = migratedHash;
      logger.info?.('User password auto-migrated to scrypt', { userId, username: cleanUsername });
    } catch (migErr) {
      logger.warn?.('Password auto-migration to scrypt failed', { userId, error: migErr.message });
    }
  }
  ```
- **File**: `D:\manager\src\storage\supabase-dashboard-store.js` lines 375–398:
  *Critical Observation*: `setAccess(userId, values, actorId)` creates `userRow = { id: userId, username: cleanUsername, role: String(fields.role || 'user'), status: String(fields.status || 'active'), is_permanent: Boolean(fields.isPermanent), expires_at: fields.expiresAt || null, ... }` and executes `upsert(userRow, { onConflict: 'username' })`.
  Calling `store.setAccess(userId, { password: migratedHash })` with only `password` will inadvertently overwrite and reset `role`, `status`, `isPermanent`, and `expiresAt` unless existing fields are merged!

### 1.2 AUTH-02 / SEC-02: Fail-Closed DB Session Persistence
- **File**: `D:\manager\src\http\routes\auth-api.js`
- **Lines 230–248** (`/register`):
  Checks `store.adapter.createManagerUserSession(session, 1)`. If `persistRes.ok === false` or throws, it calls `activeSessions.delete(tokenHash)` and returns HTTP 503.
- **Lines 328–332** (Admin `/login`):
  ```javascript
  activeSessions.set(tokenHash, session);
  if (store.adapter?.createManagerUserSession) {
    await store.adapter.createManagerUserSession(session, 1).catch(() => false);
  }
  ```
  *Critical Observation*: Admin login catches and swallows DB session failures with `.catch(() => false)`. The session remains in RAM and returns HTTP 200 instead of failing closed!
- **Lines 424–443** (Regular user `/login`):
  If `createManagerUserSession` returns `{ ok: false }` or throws, it purges RAM and returns HTTP 503.
- *Observation*: Return payload currently has `{ ok: false, error: 'Lưu trữ phiên đăng nhập thất bại. Vui lòng thử lại sau.' }` rather than the standard error code `'database_unavailable'`.

### 1.3 AUTH-03: Session Revocation on Password Change
- **File**: `D:\manager\src\http\routes\auth-api.js`
- **Lines 544–552** (Admin):
  Calls `store.adapter.revokeUserSessions('admin')`, purges `activeSessions` where `s.role === 'admin'`, invalidates cache, and sets cookie `Max-Age=0`.
- **Lines 564–574** (User):
  Calls `store.adapter.revokeUserSessions(session.userId || session.username)`, purges `activeSessions` for that user, invalidates cache, and sets cookie `Max-Age=0`.
- **Line 562**:
  Calls `await store.setAccess(session.userId, { password: hashedPassword }, 'user-change-password');`.
  *Observation*: Like AUTH-01, passing `{ password: hashedPassword }` alone into `setAccess` risks clearing other user columns during upsert unless `user`'s existing fields are preserved.

### 1.4 AUTH-04: Synchronized DB Logout Revocation
- **File**: `D:\manager\src\http\routes\auth-api.js` lines 475–496:
  ```javascript
  const token = getRequestManagerSessionToken(req);
  if (token) {
    const tokenHash = hashSessionToken(token);
    activeSessions.delete(tokenHash);
    if (typeof store.adapter?.deleteSession === 'function') {
      try {
        const deleted = await store.adapter.deleteSession(tokenHash);
        if (!deleted) {
          logger.warn('Failed to revoke session from database on logout', { tokenHash });
        }
      } catch (dbErr) {
        logger.warn('Failed to revoke session from database on logout', { tokenHash, error: dbErr.message });
      }
    }
  }
  ```
- **File**: `D:\manager\src\storage\supabase-client.js` lines 1287–1296:
  `deleteSession(tokenHash)` calls RPC `'revoke_manager_session'` with `{ p_token_hash: tokenHash }`.
- *Observation*: `logger.warn` logs `tokenHash` and `error`, but does NOT log a `correlationId` as required by the specification.

### 1.5 AUTH-05 / SEC-05: Express Trust Proxy & Real req.ip
- **File**: `D:\manager\src\http\app.js` line 39:
  `app.set('trust proxy', 1);` is already set.
- **File**: `D:\manager\src\http\routes\auth-api.js` lines 138 & 294:
  `const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';`
- **File**: `D:\manager\src\http\routes\user-api.js` line 737:
  `const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';`
- *Observation*: Express trust proxy is enabled (`1`), which parses standard `X-Forwarded-For` headers from reverse proxies.

### 1.6 AUTH-06 / SEC-03: Bounded loginAttempts Map
- **File**: `D:\manager\src\http\routes\auth-api.js` lines 65–108:
  ```javascript
  const MAX_RATE_LIMIT_ENTRIES = 5000;
  const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
  const loginAttempts = new Map();
  ...
  if (record.count >= 10) { ... }
  ```
- *Observation*: `loginAttempts` is bounded to 5000 with FIFO eviction and periodic cleanup, but `RATE_LIMIT_WINDOW_MS` is hardcoded to 15m and `MAX_LOGIN_ATTEMPTS` is hardcoded to 10. `config.loginWindowMs` and `config.maxLoginAttempts` are NOT consumed.

### 1.7 SEC-04: Harmonized Session TTL in Milliseconds
- **File**: `D:\manager\src\config\env.js` line 146:
  `webSessionTtlHours: positiveInt(env.WEB_SESSION_TTL_HOURS, 24, 1, 720),`
- **File**: `D:\manager\src\http\routes\auth-api.js` lines 62–63:
  `const sessionDurationMs = (config.sessionTtlDays || 7) * 24 * 60 * 60 * 1000;`
  `const cookieMaxAge = Math.floor(sessionDurationMs / 1000);`
- *Observation*: Discrepancy between `config.webSessionTtlHours` (defined in config/env.js, in hours) and `config.sessionTtlDays` (checked in auth-api.js, in days). `auth-api.js` ignores `config.webSessionTtlHours` unless updated.

### 1.8 SEC-OBS-01: Preserve role in DB Session Storage
- **File**: `D:\manager\src\storage\supabase-client.js` line 1235:
  ```javascript
  const row = {
      token_hash: String(session.tokenHash || ''), user_id: String(session.userId || ''),
      username: String(session.username || ''), role: 'user',
  ...
  ```
- *Observation*: Line 1235 hardcodes `role: 'user'` when calling RPC `create_manager_user_session`. Admin sessions stored in DB lose their `'admin'` role and revert to `'user'`.

### 1.9 AUTH-07: Explicit Key Redemption Reporting
- **File**: `D:\manager\src\http\routes\auth-api.js` lines 191–208 & 270–279:
  In `/register`, when a key is provided, `keyRedeemed` (boolean) and `keyError` (string or undefined) are explicitly attached to the response JSON.
- *Observation*: `/login` (lines 385–393) also allows key redemption (`if (providedKey)`), but does NOT return `keyRedeemed` or `keyError` in its response JSON.

### 1.10 AUTH-08: DB Auth as Single Source of Truth & Cache Invalidation
- **File**: `D:\manager\src\http\routes\auth-api.js` line 355:
  `const user = await store.getUser(cleanUsername, { bypassCache: true });`
- **File**: `D:\manager\src\http\app.js` lines 208–277:
  Dynamic session middleware checks `store.adapter.fetchManagerAuthorization(tokenHash)`. On failure or user disabled, it deletes the session and calls `store.invalidateCache()`.
- **File**: `D:\manager\src\storage\supabase-dashboard-store.js` line 575:
  `getUser(username, { bypassCache = false } = {})` bypasses the in-memory cache when requested.
- *Observation*: In `/login`, when regular user password is auto-migrated or login succeeds, `store.invalidateCache()` should be explicitly invoked to ensure no stale cache remains.

---

## 2. Logic Chain

1. **AUTH-01/SEC-01**:
   - Because `encryptUserPassword` produces two-way AES-256 ciphertexts, user passwords in the DB could be decrypted if the master key is leaked.
   - One-way hashing with Scrypt (`hashPassword`) prevents reverse engineering of stored credentials.
   - Because legacy users already have AES-256 encrypted passwords in DB, when they log in: `verifyPassword` decrypts and validates legacy AES passwords. Upon successful validation, the system immediately hashes the plaintext with `hashPassword` and saves it via `store.setAccess`.
   - To prevent `setAccess` from overwriting existing user columns (`role`, `status`, `expiresAt`, `assignedBotIds`), `setAccess` must merge with the existing user record: `{ ...user, password: migratedHash }`.
   - Upgrading `hashPassword(password, salt = null)` allows optional salt parameter for unit test repeatability while preserving automatic 16-byte random salt generation.

2. **AUTH-02/SEC-02**:
   - Under distributed or high-availability deployments, if DB persistence fails but RAM session succeeds, requests routed to another node or after a restart will fail authentication.
   - In `/login` line 330, Admin login used `.catch(() => false)`. If Supabase session persistence fails for Admin, it leaves an unsynced RAM session.
   - Therefore, both `/login` (Admin and user) and `/register` must fail closed: if `createManagerUserSession` returns `{ ok: false }` or throws, the RAM session must be purged via `activeSessions.delete(tokenHash)`, and HTTP 503 with error code `'database_unavailable'` must be returned.

3. **AUTH-03**:
   - When a password is changed, existing sessions on all devices must be invalidated immediately to prevent an attacker with a hijacked session from maintaining access.
   - Calling `store.adapter.revokeUserSessions(userId)` revokes DB sessions.
   - Iterating `activeSessions` and deleting entries matching `s.userId === userId || s.username === username` purges local memory.
   - Setting `clearCookieHeader` expires the client browser cookie immediately (`Max-Age=0`).
   - In `store.setAccess`, passing `{ ...user, password: hashedPassword }` prevents zeroing out user permissions.

4. **AUTH-04**:
   - When a user logs out, the DB session must be revoked via RPC `revoke_manager_session` (called by `store.adapter.deleteSession`).
   - If the DB call fails or returns false, security operations must trace the failure. Including a unique `correlationId` (from headers or generated UUID) in `logger.warn` ensures audit observability.

5. **AUTH-05/SEC-05**:
   - When running behind a reverse proxy (Render, Cloudflare, NGINX), `req.connection.remoteAddress` is the proxy's IP.
   - Setting `app.set('trust proxy', 1)` enables Express to parse the client IP into `req.ip`.
   - All rate limiters and audit loggers must rely on `req.ip || req.socket?.remoteAddress || '127.0.0.1'`.

6. **AUTH-06/SEC-03**:
   - An unbounded `loginAttempts` map allows memory exhaustion (DoS/OOM) by sending millions of unique IP/username pairs.
   - Capping size at `MAX_RATE_LIMIT_ENTRIES = 5000` with FIFO eviction (evicting oldest entry `loginAttempts.keys().next().value`) prevents OOM.
   - Hardcoding values disables configuration control. Reading `config.loginWindowMs` (default 15m) and `config.maxLoginAttempts` (default 10) allows dynamic configuration.

7. **SEC-04**:
   - Session lifetime must be consistent across client cookies and database records.
   - `config.webSessionTtlHours` defines TTL in hours.
   - Computing `sessionDurationMs = (Number(config?.webSessionTtlHours) || 24) * 3600 * 1000` harmonizes `cookieMaxAge = Math.floor(sessionDurationMs / 1000)` and `session.expiresAt = Date.now() + sessionDurationMs`.

8. **SEC-OBS-01**:
   - In `supabase-client.js#L1235`, `role: 'user'` was hardcoded in `createManagerUserSession`.
   - Changing to `role: String(session.role || 'user')` ensures that Admin sessions persist with `role: 'admin'`, preventing privilege downgrade during DB authorization verification.

9. **AUTH-07**:
   - During registration, if a license key is provided but fails activation (e.g. expired or exhausted), returning only a generic message without structured fields breaks client handling.
   - Returning `keyRedeemed: false` and `keyError: string` gives explicit feedback while keeping account registration successful. Harmonizing this in `/login` provides consistency.

10. **AUTH-08**:
    - The database must be the single source of truth for user status and credentials.
    - `/login` must call `store.getUser(cleanUsername, { bypassCache: true })`.
    - Successful login, logout, and password change must call `store.invalidateCache()`.

---

## 3. Caveats

1. **Bot Passwords vs User Passwords**:
   - User passwords (web login) MUST use Scrypt one-way hashing.
   - In-game Minecraft bot passwords and proxy passwords stored in `manager_bots` MUST continue to use reversible AES-256-GCM (`encryptUserPassword` / `decryptUserPassword` or `encryptSecret` / `decryptSecret`) because the BotWorker must send plaintext credentials to Minecraft servers and proxies.
2. **Backward Compatibility**:
   - Older unit tests may pass `config.sessionTtlDays`. Fallback logic must support `webSessionTtlHours` first, then `sessionTtlDays`, then default 24h.
3. **Database Availability**:
   - In web-only mode or test environments where `store.adapter.isEnabled()` returns false, session persistence should not block login unless the adapter is active.

---

## 4. Conclusion & Surgical Fix Strategy

### Proposal 1: `src/utils/secrets.js` (AUTH-01 / SEC-01)
Update `hashPassword` signature to support optional `salt`:
```javascript
function hashPassword(password, salt = null) {
  const actualSalt = salt && typeof salt === 'string' && salt.length >= 8
    ? salt
    : crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), actualSalt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$N=16384,r=8,p=1$${actualSalt}$${derived.toString('hex')}`;
}
```

### Proposal 2: `src/storage/supabase-client.js#L1235` (SEC-OBS-01)
Preserve `session.role`:
```diff
--- a/src/storage/supabase-client.js
+++ b/src/storage/supabase-client.js
@@ -1233,3 +1233,3 @@
         const row = {
             token_hash: String(session.tokenHash || ''), user_id: String(session.userId || ''),
-            username: String(session.username || ''), role: 'user',
+            username: String(session.username || ''), role: String(session.role || 'user'),
             assigned_bot_ids: Array.isArray(session.assignedBotIds) ? session.assignedBotIds : [],
```

### Proposal 3: `src/http/routes/auth-api.js` (AUTH-02, AUTH-03, AUTH-04, AUTH-06, SEC-04, AUTH-07)
```javascript
// 1. Harmonized TTL & Bounded Rate Limiting (lines 61-108)
const sessionDurationMs = (Number.isSafeInteger(Number(config?.webSessionTtlHours)) && Number(config.webSessionTtlHours) > 0)
  ? Number(config.webSessionTtlHours) * 3600 * 1000
  : (Number.isSafeInteger(Number(config?.sessionTtlDays)) && Number(config.sessionTtlDays) > 0
    ? Number(config.sessionTtlDays) * 24 * 3600 * 1000
    : 24 * 3600 * 1000);
const cookieMaxAge = Math.floor(sessionDurationMs / 1000);

const MAX_RATE_LIMIT_ENTRIES = (config && Number.isSafeInteger(Number(config.maxRateLimitEntries)) && Number(config.maxRateLimitEntries) > 0)
  ? Number(config.maxRateLimitEntries)
  : 5000;
const RATE_LIMIT_WINDOW_MS = (config && Number.isSafeInteger(Number(config.loginWindowMs)) && Number(config.loginWindowMs) > 0)
  ? Number(config.loginWindowMs)
  : (15 * 60 * 1000);
const MAX_LOGIN_ATTEMPTS = (config && Number.isSafeInteger(Number(config.maxLoginAttempts)) && Number(config.maxLoginAttempts) > 0)
  ? Number(config.maxLoginAttempts)
  : 10;

// 2. Admin Login Fail-Closed (lines 328-333)
activeSessions.set(tokenHash, session);
const dbAdapterEnabled = typeof store.adapter?.isEnabled !== 'function' || store.adapter.isEnabled();
if (typeof store.adapter?.createManagerUserSession === 'function' && dbAdapterEnabled) {
  try {
    const persistRes = await store.adapter.createManagerUserSession(session, 1);
    if (!persistRes || (typeof persistRes === 'object' && persistRes.ok === false)) {
      activeSessions.delete(tokenHash);
      return res.status(503).json({
        ok: false,
        error: 'database_unavailable',
        message: 'Lưu trữ phiên đăng nhập quản trị thất bại. Vui lòng thử lại sau.'
      });
    }
  } catch (dbErr) {
    activeSessions.delete(tokenHash);
    logger.error('Failed to persist admin session to DB on login', { error: dbErr.message });
    return res.status(503).json({
      ok: false,
      error: 'database_unavailable',
      message: 'Dịch vụ lưu trữ session tạm thời không khả dụng. Vui lòng thử lại sau.'
    });
  }
}

// 3. User Password Auto-Migration with Field Preservation (lines 374-383)
if (!String(user.password || '').startsWith('scrypt$')) {
  try {
    const migratedHash = hashPassword(cleanPassword);
    await store.setAccess(userId, { ...user, password: migratedHash }, 'auth-migrate-scrypt');
    user.password = migratedHash;
    if (typeof store.invalidateCache === 'function') store.invalidateCache();
    logger.info?.('User password auto-migrated to scrypt', { userId, username: cleanUsername });
  } catch (migErr) {
    logger.warn?.('Password auto-migration to scrypt failed', { userId, error: migErr.message });
  }
}

// 4. Logout Revocation with Correlation ID (lines 475-495)
const correlationId = req.headers?.['x-correlation-id'] || req.headers?.['x-request-id'] || `corr_${crypto.randomUUID().slice(0, 8)}`;
if (token) {
  const tokenHash = hashSessionToken(token);
  activeSessions.delete(tokenHash);
  if (typeof store.adapter?.deleteSession === 'function') {
    try {
      const deleted = await store.adapter.deleteSession(tokenHash);
      if (!deleted) {
        logger.warn('Failed to revoke session from database on logout', { correlationId, tokenHash });
      }
    } catch (dbErr) {
      logger.warn('Failed to revoke session from database on logout', { correlationId, tokenHash, error: dbErr.message });
    }
  }
  if (typeof store.invalidateCache === 'function') store.invalidateCache();
}

// 5. Change Password Field Preservation (lines 560-563)
const hashedPassword = hashPassword(newPassword);
user.password = hashedPassword;
await store.setAccess(session.userId, { ...user, password: hashedPassword }, 'user-change-password');
```

---

## 5. Verification Method

To independently verify all findings and proposals:

1. **Run Automated Auth Regression Test Suite**:
   ```powershell
   node D:\manager\tests\auth-regression.test.js
   ```
   *Expected*:
   - AUTH-01: Scrypt hashing, auto-migration & store preservation verified.
   - AUTH-02: Fail-closed DB session persistence verified.
   - AUTH-03: /change-password session revocation verified.
   - AUTH-04: /logout DB revoke failure warning log verified.
   - AUTH-05: Express trust proxy & clientIp resolution verified.
   - AUTH-06: Bounded Map rate limiter verified.
   - AUTH-07: Explicit keyRedeemed and keyError response verified.
   - AUTH-08: DB auth & RAM cache consistency verified.
   - Exit code: 0 with `ALL AUTH-01 THROUGH AUTH-08 REGRESSION TESTS PASSED 100%!`.

2. **Verify Baseline Tests**:
   ```powershell
   node D:\manager\tests\integration.test.js
   node D:\manager\tests\services-wiring.test.js
   node D:\manager\tests\storage-sql.test.js
   ```
   *Expected*: All baseline integration and wiring tests continue to pass 100%.

3. **Inspect Modified Files for Invariants**:
   - `src/utils/secrets.js`: `hashPassword` exports valid Scrypt string `scrypt$N=16384,r=8,p=1$...`.
   - `src/storage/supabase-client.js`: `role: String(session.role || 'user')` on line 1235.
   - `src/http/routes/auth-api.js`: All 10 points correctly wired.
