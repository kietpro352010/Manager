# Handoff Report: Requirement R1 Survey & Analysis (AUTH-01 through AUTH-08)

**Target System**: KBOT Manager (Node.js) at `D:\manager`  
**Milestone**: Requirement R1: Authentication, Session Lifecycle & Authorization  
**Author**: Explorer Subagent (`ce16bd75-c1d7-4430-920b-0b489c85904f`)  
**Date**: 2026-11-13  

---

## 1. Observation

Direct code inspections across `D:\manager` revealed the following exact file locations, code fragments, and runtime behaviors for each requirement item:

### AUTH-01: Password Encryption vs. Scrypt Hash & Auto-Migration
- **File**: `src/utils/secrets.js`
  - Lines 108–131: `encryptUserPassword(value, key = null)` implements two-way AES-256-GCM encryption with static fallback key `kbot_enterprise_stable_encryption_key_v11` (lines 123–124) when `MANAGER_MASTER_KEY` / `MANAGER_ENCRYPTION_KEY` is not set.
  - Lines 178–182: `hashPassword(password)` produces a secure one-way Scrypt hash:
    ```javascript
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt$N=16384,r=8,p=1$${salt}$${derived.toString('hex')}`;
    ```
  - Lines 184–231: `verifyPassword(password, storedValue)` (and alias `verifyUserPassword` line 257) already supports Scrypt hashes, AES-256-GCM ciphertexts (`isStoredCredentialCiphertext`), and plaintext with timing-safe comparison.
- **File**: `src/http/routes/auth-api.js`
  - Line 125: `/register` computes `const encryptedPass = encryptUserPassword(cleanPassword);` and stores it into `store.registerTrialUser` (line 134) or `store.setAccess` (line 143).
  - Lines 314–318: `/login` verifies password:
    ```javascript
    const passMatch = verifyUserPassword(cleanPassword, user.password);
    if (!passMatch) {
      return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    }
    ```
    There is no check or migration if `user.password` is still in AES-256-GCM ciphertext or plaintext.
  - Line 472: `/change-password` encrypts new password with AES-256-GCM:
    ```javascript
    const encrypted = encryptUserPassword(newPassword);
    user.password = encrypted;
    await store.setAccess(session.userId, { password: encrypted }, 'user-change-password');
    ```
- **File**: `src/storage/supabase-dashboard-store.js`
  - Lines 391–395 (`setAccess`):
    ```javascript
    if (fields.password) {
      userRow.password = isStoredCredentialCiphertext(fields.password)
        ? fields.password
        : encryptUserPassword(fields.password);
    }
    ```
    If `fields.password` is a `scrypt$...` hash, `isStoredCredentialCiphertext` returns `false`, causing `setAccess` to re-encrypt the Scrypt hash with AES-256-GCM.
  - Lines 610–612 (`registerTrialUser`):
    ```javascript
    const safePassword = password
      ? (isStoredCredentialCiphertext(password) ? password : encryptUserPassword(password))
      : '';
    ```
- **File**: `src/storage/supabase-client.js`
  - Line 476 (`userToDatabaseRows`): `encPassword = encryptUserPassword(String(u.password ?? ''));`. Re-encrypts non-ciphertext fields.

### AUTH-02: DB Session Persistence in `/register` and `/login` (Fail-Closed)
- **File**: `src/http/routes/auth-api.js`
  - Lines 209–213 (in `/register`):
    ```javascript
    activeSessions.set(tokenHash, session);
    if (store.adapter?.createManagerUserSession) {
      await store.adapter.createManagerUserSession(session, 1).catch(() => false);
    }
    ```
  - Lines 365–369 (in `/login` user flow):
    ```javascript
    activeSessions.set(tokenHash, session);
    if (store.adapter?.createManagerUserSession) {
      await store.adapter.createManagerUserSession(session, 1).catch(() => false);
    }
    ```
  - Lines 282–286 (in `/login` admin flow):
    ```javascript
    activeSessions.set(tokenHash, session);
    if (store.adapter?.createManagerUserSession) {
      await store.adapter.createManagerUserSession(session, 1).catch(() => false);
    }
    ```
- **File**: `src/storage/supabase-client.js`
  - Lines 1224–1248: `createManagerUserSession(session, expectedUserRevision)` invokes RPC `create_manager_user_session`. Returns `{ ok: true, revision: ... }` on success, or `{ ok: false, error: ... }` on error.
- **Behavior**: Any rejection or error returned by `createManagerUserSession` is swallowed by `.catch(() => false)`. The session remains in RAM `activeSessions`, and a cookie + 200/201 response is sent to the client. On another instance or following server restart, the session does not exist in PostgreSQL `manager_sessions`, causing immediate HTTP 401 unauthorized errors for that user.

### AUTH-03: Session Revocation in `/change-password`
- **File**: `src/http/routes/auth-api.js`
  - Lines 443–480 (`POST /change-password`):
    - Admin change-password (lines 456–465) updates `registry.setAdminPassword(hashed)` and `registry.save()`. It does not evict `activeSessions`, does not call DB revocation, and does not clear the session cookie.
    - User change-password (lines 467–476) calls `store.setAccess(...)` and returns `{ ok: true, message: 'Đổi mật khẩu thành công.' }`.
    - Neither branch calls `store.adapter.revokeUserSessions(...)`.
    - Neither branch deletes sessions from memory `activeSessions`.
    - Neither branch clears the cookie header. Old sessions on all devices remain permanently active.

### AUTH-04: `/logout` Swallowing DB Revoke Errors
- **File**: `src/http/routes/auth-api.js`
  - Lines 400–418 (`POST /logout`):
    ```javascript
    const token = getRequestManagerSessionToken(req);
    if (token) {
      const tokenHash = hashSessionToken(token);
      activeSessions.delete(tokenHash);
      if (typeof store.adapter?.deleteSession === 'function') {
        await store.adapter.deleteSession(tokenHash).catch(() => false);
      }
      if (typeof store.adapter?.deleteManagerSession === 'function') {
        await store.adapter.deleteManagerSession(tokenHash).catch(() => false);
      }
    }
    res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));
    return res.json({ ok: true, message: 'Đăng xuất thành công.' });
    ```
- **File**: `src/storage/supabase-client.js`
  - Lines 1285–1294: `deleteSession(tokenHash)` calls RPC `revoke_manager_session({ p_token_hash: tokenHash })`. Returns `true` on success, `false` on failure.
  - Notice `deleteManagerSession` is dead code (does not exist in `store.adapter`).
- **Behavior**: If `store.adapter.deleteSession` fails (network issue or DB error), `.catch(() => false)` silently swallows the error and returns HTTP 200. No log warning is emitted. The session row stays active in PostgreSQL `manager_sessions`.

### AUTH-05: Rate Limiter IP Resolution & Express Trust Proxy
- **File**: `src/http/routes/auth-api.js`
  - Line 123 (`/register`):
    `const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';`
  - Line 248 (`/login`):
    `const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();`
- **File**: `src/http/app.js`
  - Line 37: `const app = express(); app.disable('x-powered-by');`
  - `trust proxy` is never configured on the Express app instance.
- **File**: `src/http/routes/user-api.js`
  - Line 737: `const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';`
- **Behavior**: Any client can forge `X-Forwarded-For: <arbitrary_ip>` and rotate IPs on every request, completely evading `checkRateLimit(clientIp, cleanUsername)`.

### AUTH-06: Rate Limiter Map Bounds (OOM DoS Prevention)
- **File**: `src/http/routes/auth-api.js`
  - Lines 65–94:
    ```javascript
    const loginAttempts = new Map();
    function checkRateLimit(ip, username) {
      const now = Date.now();
      const key = `${ip}:${String(username).toLowerCase()}`;
      const record = loginAttempts.get(key);
      if (!record || now - record.windowStart > 15 * 60 * 1000) {
        loginAttempts.set(key, { count: 1, windowStart: now });
        return { allowed: true };
      }
      if (record.count >= 10) {
        const waitMinutes = Math.ceil((15 * 60 * 1000 - (now - record.windowStart)) / 60000);
        return { allowed: false, error: `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${waitMinutes} phút.` };
      }
      record.count++;
      return { allowed: true };
    }
    setInterval(() => {
      const now = Date.now();
      for (const [key, val] of loginAttempts.entries()) {
        if (now - val.windowStart > 15 * 60 * 1000) loginAttempts.delete(key);
      }
    }, 5 * 60 * 1000).unref();
    ```
- **Behavior**: `loginAttempts` is completely unbounded. An attacker sending thousands of requests with generated usernames/IPs will force the Map to expand indefinitely during the 5-minute cleanup interval, triggering heap exhaustion and process crash (DoS).

### AUTH-07: Key Redemption Error Reporting in Registration
- **File**: `src/http/routes/auth-api.js`
  - Lines 175–188:
    ```javascript
    if (providedKey) {
      try {
        await entitlementService.redeem(userId, providedKey, 'user');
        const refreshed = await store.getUser(cleanUsername);
        if (refreshed) {
          assignedBotIds = refreshed.assignedBotIds || refreshed.workerIds || assignedBotIds;
          planName = refreshed.planName || planName;
          isPermanent = Boolean(refreshed.isPermanent);
        }
      } catch (keyErr) {
        logger.warn('Key redemption on register failed', { error: keyErr.message, username: cleanUsername });
      }
    }
    ```
  - Lines 222–234: The response payload only returns `ok: true`, `token`, `user`, and `message: 'Đăng ký tài khoản thành công!'`.
- **Behavior**: If a user supplies a key during registration that fails to redeem (e.g., invalid, expired, or out of bots), the failure is silently suppressed in the HTTP response. The user receives a 201 response with default trial access without being informed that the key failed.

### AUTH-08: Auth Consistency Between DB and RAM Cache
- **File**: `src/storage/supabase-dashboard-store.js`
  - Lines 573–591 (`getUser`):
    ```javascript
    async getUser(username) {
      if (!username) return null;
      const cacheKey = `user:${String(username).toLowerCase()}`;
      const cached = this.getCached(cacheKey);
      if (cached) return cached;
      ...
    ```
    `getUser` does not accept a `bypassCache` option (unlike `getAccess(userId, { bypassCache = false })`).
- **File**: `src/http/app.js`
  - Lines 154–176: `invalidateUserSessions(identifier)` is provided to `adminRouter`, but not to `authRouter`.
- **File**: `src/http/routes/auth-api.js`:
  - `/login` calls `store.getUser(cleanUsername)` without cache bypass.
  - `/change-password` modifies the user password without invalidating cache or active sessions.

---

## 2. Logic Chain

1. **Reversible Encryption vs. One-Way Hash (AUTH-01)**:
   - Storing user passwords in two-way AES-256-GCM with a static fallback key (`kbot_enterprise_stable_encryption_key_v11`) in `src/utils/secrets.js` violates standard password storage practices.
   - `src/utils/secrets.js` already provides `hashPassword` (Scrypt with $N=16384, r=8, p=1$) and `verifyPassword` / `verifyUserPassword` which supports Scrypt, ciphertext, and plaintext.
   - Replacing `encryptUserPassword` with `hashPassword` in `/register` and `/change-password` ensures all new or updated credentials are one-way hashed.
   - In `/login`, when `verifyUserPassword(cleanPassword, user.password)` succeeds, checking `!String(user.password || '').startsWith('scrypt$')` allows immediate and transparent auto-migration of legacy AES-256-GCM passwords to Scrypt via `store.setAccess(userId, { password: newScryptHash }, 'auth-migrate-scrypt')`.
   - In `src/storage/supabase-dashboard-store.js` (lines 392, 611) and `supabase-client.js` (line 476), methods must check `String(password).startsWith('scrypt$')` to avoid double-encrypting Scrypt strings.

2. **Session Persistence Fail-Closed Contract (AUTH-02)**:
   - In distributed deployments, if a session is only stored in Node.js RAM (`activeSessions`) because DB persistence failed, subsequent requests routed to other instances (or this instance after restart) will query Supabase DB (`read_manager_authorization`), find nothing, and reject the client with HTTP 401.
   - When DB adapter is enabled (`store.adapter?.isEnabled()`), `createManagerUserSession` must be strictly enforced. If it fails or returns `ok: false`, the local session in `activeSessions` must be deleted (`activeSessions.delete(tokenHash)`), and the route must return HTTP 503 instead of issuing an invalid session.

3. **Session Revocation Invariant (AUTH-03 & AUTH-04)**:
   - Password changes indicate account recovery or compromised credentials. Retaining existing sessions violates standard session lifecycle rules.
   - Calling `store.adapter.revokeUserSessions(userId)` invokes PostgreSQL RPC `revoke_manager_user_sessions`, which atomically revokes all DB sessions for that user across all instances.
   - Removing all matching sessions from in-memory `activeSessions` and emitting `Set-Cookie` with Max-Age 0 enforces re-login on the current client.
   - On `/logout`, calling `store.adapter.deleteSession(tokenHash)` and logging a warning if it fails provides observability into RPC failures without breaking local logout.

4. **IP Spoofing & DoS Protection (AUTH-05 & AUTH-06)**:
   - Untrusted `X-Forwarded-For` headers can be manipulated by attackers to bypass IP-based rate limiting.
   - Enabling `app.set('trust proxy', 1)` in Express ensures `req.ip` is extracted according to trusted reverse proxy hops.
   - Unbounded Maps in long-running processes are a classic DoS vector. Bounding `loginAttempts` with `MAX_ENTRIES` (e.g. 5,000), coupled with immediate expiration pruning and FIFO eviction of the oldest entry upon reaching capacity, eliminates OOM risk.

5. **Clarity of Registration Outcomes (AUTH-07 & AUTH-08)**:
   - Swallowing key redemption errors during `/register` conceals key failures from the user.
   - Adding `keyRedeemed: Boolean` and `keyError: String` to the registration response payload allows the client application to inform the user immediately.
   - Ensuring `store.getUser` supports `{ bypassCache = false }` and invalidating cached records on credentials update maintains strict consistency between DB and RAM cache.

---

## 3. Caveats

1. **Bot Credentials vs. User Passwords**:
   - Bot credentials (e.g. Minecraft passwords and Proxy passwords in `supabase-client.js:1536-1550`) MUST remain reversible via AES-256-GCM because bots must transmit cleartext passwords to Minecraft servers and SOCKS/HTTP proxies. Only user and admin login passwords must be Scrypt-hashed.
2. **Admin Account in Database**:
   - The admin account (`admin`) is typically configured via environment variables (`ADMIN_PASSWORD`, `ADMIN_USERNAME`) and does not necessarily exist in the `manager_users` PostgreSQL table. RPC `create_manager_user_session` requires an entry in `manager_users`. As established in `src/http/app.js:210-222`, env admin sessions are tracked in memory (`isEnvAdminCached`). Fail-closed DB persistence applies to regular user registration and login.
3. **Multi-Instance Invalidation**:
   - While `store.adapter.revokeUserSessions` invalidates sessions in PostgreSQL, other running manager instances learn of the revocation on the next request via `fetchManagerAuthorization` (which verifies against DB).

---

## 4. Conclusion & Recommended Implementation Strategy

### Detailed Implementation Blueprint

#### 1. AUTH-01: Scrypt Hashing & Auto-Migration
- **In `src/http/routes/auth-api.js`**:
  - In `/register` (line 125): Replace `encryptUserPassword(cleanPassword)` with `hashPassword(cleanPassword)`.
  - In `/change-password` (line 472): Replace `encryptUserPassword(newPassword)` with `hashPassword(newPassword)`.
  - In `/login` (after line 317):
    ```javascript
    if (!String(user.password || '').startsWith('scrypt$')) {
      try {
        const migratedHash = hashPassword(cleanPassword);
        await store.setAccess(userId, { password: migratedHash }, 'auth-migrate-scrypt');
        user.password = migratedHash;
        logger?.info('User password auto-migrated to scrypt', { userId, username: cleanUsername });
      } catch (migErr) {
        logger?.warn('Password auto-migration to scrypt failed', { userId, error: migErr.message });
      }
    }
    ```
- **In `src/storage/supabase-dashboard-store.js`**:
  - In `setAccess` (lines 391–395):
    ```javascript
    if (fields.password) {
      const p = String(fields.password);
      userRow.password = (p.startsWith('scrypt$') || isStoredCredentialCiphertext(p))
        ? p
        : hashPassword(p);
    }
    ```
  - In `registerTrialUser` (lines 610–612):
    ```javascript
    const safePassword = password
      ? ((String(password).startsWith('scrypt$') || isStoredCredentialCiphertext(password)) ? password : hashPassword(password))
      : '';
    ```
- **In `src/storage/supabase-client.js`**:
  - In `userToDatabaseRows` (line 476): Preserve `scrypt$` hashes directly:
    ```javascript
    if (!process.env.MANAGER_MASTER_KEY_PREVIOUS && u._rawEncryptedPassword && isStoredCredentialCiphertext(u._rawEncryptedPassword) && String(u.password ?? '') === u._decryptedPasswordSnapshot) {
      encPassword = u._rawEncryptedPassword;
    } else if (String(u.password ?? '').startsWith('scrypt$')) {
      encPassword = String(u.password);
    } else {
      encPassword = encryptUserPassword(String(u.password ?? ''));
    }
    ```

#### 2. AUTH-02: Fail-Closed DB Session Persistence
- **In `src/http/routes/auth-api.js`**:
  - In `/register` (replacing lines 209–213):
    ```javascript
    activeSessions.set(tokenHash, session);
    const dbAdapterEnabled = typeof store.adapter?.isEnabled !== 'function' || store.adapter.isEnabled();
    if (typeof store.adapter?.createManagerUserSession === 'function' && dbAdapterEnabled) {
      try {
        const persistRes = await store.adapter.createManagerUserSession(session, 1);
        if (!persistRes || (typeof persistRes === 'object' && persistRes.ok === false)) {
          activeSessions.delete(tokenHash);
          return res.status(503).json({
            ok: false,
            error: 'Lưu trữ phiên đăng nhập thất bại. Vui lòng thử lại sau.'
          });
        }
      } catch (dbErr) {
        activeSessions.delete(tokenHash);
        logger.error('Failed to persist session to DB on register', { error: dbErr.message, username: cleanUsername });
        return res.status(503).json({
          ok: false,
          error: 'Dịch vụ lưu trữ session tạm thời không khả dụng. Vui lòng thử lại sau.'
        });
      }
    }
    ```
  - In `/login` user flow (replacing lines 365–369): Apply identical fail-closed check, deleting `tokenHash` from `activeSessions` and returning HTTP 503 on persistence failure.

#### 3. AUTH-03: Session Revocation in `/change-password`
- **In `src/http/routes/auth-api.js`**:
  - Inside `/change-password`:
    - After updating the password:
      1. If regular user:
         ```javascript
         if (typeof store.adapter?.revokeUserSessions === 'function') {
           await store.adapter.revokeUserSessions(session.userId || session.username).catch(() => null);
         }
         ```
      2. Evict RAM sessions:
         ```javascript
         if (session.role === 'admin') {
           for (const [hash, s] of activeSessions.entries()) {
             if (s && s.role === 'admin') activeSessions.delete(hash);
           }
         } else {
           for (const [hash, s] of activeSessions.entries()) {
             if (s && (s.userId === session.userId || s.username === session.username)) {
               activeSessions.delete(hash);
             }
           }
         }
         ```
      3. Invalidate store cache:
         ```javascript
         if (typeof store.invalidateCache === 'function') store.invalidateCache();
         ```
      4. Clear session cookie:
         ```javascript
         res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));
         return res.json({ ok: true, message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
         ```

#### 4. AUTH-04: Warning Log on Logout Revoke Failure
- **In `src/http/routes/auth-api.js`**:
  - Inside `/logout` (lines 400–418):
    ```javascript
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
          logger.warn('Error revoking session from database on logout', { tokenHash, error: dbErr.message });
        }
      }
    }
    ```

#### 5. AUTH-05: IP Resolution via Express Trust Proxy
- **In `src/http/app.js`**:
  - Line 38: Add `app.set('trust proxy', 1);`.
- **In `src/http/routes/auth-api.js`**:
  - Replace lines 123 and 248 with:
    `const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';`
- **In `src/http/routes/user-api.js`**:
  - Replace line 737 with:
    `const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';`

#### 6. AUTH-06: Bounded Rate Limiter Map
- **In `src/http/routes/auth-api.js`**:
  - Refactor `checkRateLimit`:
    ```javascript
    const MAX_RATE_LIMIT_ENTRIES = 5000;
    const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

    function checkRateLimit(ip, username) {
      const now = Date.now();
      const key = `${ip}:${String(username).toLowerCase()}`;
      const record = loginAttempts.get(key);
      if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
        if (loginAttempts.size >= MAX_RATE_LIMIT_ENTRIES) {
          // 1. Purge expired entries
          for (const [k, v] of loginAttempts.entries()) {
            if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) loginAttempts.delete(k);
          }
          // 2. FIFO eviction if still at capacity
          if (loginAttempts.size >= MAX_RATE_LIMIT_ENTRIES) {
            const oldestKey = loginAttempts.keys().next().value;
            if (oldestKey) loginAttempts.delete(oldestKey);
          }
        }
        loginAttempts.set(key, { count: 1, windowStart: now });
        return { allowed: true };
      }
      if (record.count >= 10) {
        const waitMinutes = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 60000);
        return { allowed: false, error: `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${waitMinutes} phút.` };
      }
      record.count++;
      return { allowed: true };
    }
    ```

#### 7. AUTH-07: Key Redemption Status in Registration
- **In `src/http/routes/auth-api.js`**:
  - In `/register`:
    ```javascript
    let keyRedeemed = false;
    let keyError = null;
    if (providedKey) {
      try {
        await entitlementService.redeem(userId, providedKey, 'user');
        keyRedeemed = true;
        const refreshed = await store.getUser(cleanUsername);
        if (refreshed) {
          assignedBotIds = refreshed.assignedBotIds || refreshed.workerIds || assignedBotIds;
          planName = refreshed.planName || planName;
          isPermanent = Boolean(refreshed.isPermanent);
        }
      } catch (err) {
        keyRedeemed = false;
        keyError = err.message || 'Mã quà tặng không hợp lệ hoặc đã hết lượt.';
        logger.warn('Key redemption on register failed', { error: keyError, username: cleanUsername });
      }
    }
    ...
    const responsePayload = {
      ok: true,
      token,
      user: {
        id: userId,
        username: cleanUsername,
        role: 'user',
        assignedBotIds,
        isPermanent,
        expiresAt: session.expiresAt
      },
      message: (providedKey && !keyRedeemed)
        ? `Đăng ký tài khoản thành công, nhưng kích hoạt mã quà tặng thất bại: ${keyError}`
        : 'Đăng ký tài khoản thành công!'
    };
    if (providedKey) {
      responsePayload.keyRedeemed = keyRedeemed;
      if (!keyRedeemed) {
        responsePayload.keyError = keyError;
      }
    }
    return res.status(201).json(responsePayload);
    ```

#### 8. AUTH-08: DB Auth and RAM Cache Consistency
- **In `src/storage/supabase-dashboard-store.js`**:
  - Update `getUser(username, { bypassCache = false } = {})`:
    ```javascript
    async getUser(username, { bypassCache = false } = {}) {
      if (!username) return null;
      const cacheKey = `user:${String(username).toLowerCase()}`;
      if (!bypassCache) {
        const cached = this.getCached(cacheKey);
        if (cached) return cached;
      }
      let user = null;
      if (this.adapter && typeof this.adapter.fetchUserAuthorization === 'function') {
        const res = await this.adapter.fetchUserAuthorization(null, username);
        if (res.ok && res.user) user = res.user;
      }
      if (!user) {
        user = await this.getAccess(username, { bypassCache });
      }
      if (user) {
        this.setCached(cacheKey, user);
      }
      return user;
    }
    ```
  - In `/login`: Call `await store.getUser(cleanUsername, { bypassCache: true })`.

---

## 5. Verification Method

### Automated Commands
1. Run existing baseline tests:
   ```powershell
   cd D:\manager; npm.cmd test
   ```
   *Expected outcome*: Exit code 0, 100% tests PASS (37 test sections across `integration.test.js`, `services-wiring.test.js`, `storage-sql.test.js`).

2. Specific regression assertions for R1 items to be added:
   - **AUTH-01 Test**:
     - Register user -> Verify `user.password.startsWith('scrypt$')`.
     - Seed user with legacy AES-256-GCM ciphertext -> Log in -> Verify login succeeds AND `user.password.startsWith('scrypt$')` (auto-migration).
     - Change password -> Verify new password in store starts with `scrypt$`.
   - **AUTH-02 Test**:
     - Mock `createManagerUserSession` returning `{ ok: false }` or throwing -> Call `/register` and `/login` -> Verify HTTP 503 and session not stored in `activeSessions`.
   - **AUTH-03 Test**:
     - Login user -> Call `/change-password` -> Verify `revokeUserSessions` called on adapter, `activeSessions` deleted for user, and `Set-Cookie` expired.
   - **AUTH-04 Test**:
     - Mock `deleteSession` returning `false` / throwing -> Call `/logout` -> Verify `logger.warn` invoked with failure context.
   - **AUTH-05 Test**:
     - Send request with spoofed `X-Forwarded-For: 203.0.113.195` without proxy trust -> Verify rate limiter uses actual trusted IP (`req.ip`).
   - **AUTH-06 Test**:
     - Insert >5,000 distinct attempts into `loginAttempts` -> Verify Map size remains `<= 5000` and oldest entries are evicted without OOM.
   - **AUTH-07 Test**:
     - Call `/register` with an invalid key -> Verify response status is 201, `keyRedeemed: false`, and `keyError` is present.
   - **AUTH-08 Test**:
     - Update user in DB -> Query `/login` or middleware -> Verify fresh user status is reflected immediately without stale cache interference.

### Invalidation Conditions
- If `tests/services-wiring.test.js` or `tests/integration.test.js` fails with non-zero exit code.
- If bot credentials encryption is accidentally converted to one-way Scrypt (breaking Minecraft/proxy connections).
- If regular users fail to log in due to missing `manager_users` rows.
