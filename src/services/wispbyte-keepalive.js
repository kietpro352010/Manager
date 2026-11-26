'use strict';

const net = require('node:net');
const { encryptUserPassword, decryptUserPassword, isStoredCredentialCiphertext } = require('../utils/secrets');
const { redactStringSecrets } = require('../utils/logger');
const { isPrivateOrBlockedIp, isLocalOrPrivateHost, resolveAndValidateHost } = require('./proxy-validation');

let undiciLib = null;
try {
  undiciLib = require('undici');
} catch (_) {}

const DEFAULT_PANEL_URL = 'https://wispbyte.com/client';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB cap

function isPrivateOrBlockedIpAddress(ip) {
  return isPrivateOrBlockedIp(ip);
}

function validatePanelUrl(urlStr) {
  const raw = String(urlStr || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Panel URL không đúng định dạng URL.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Panel URL không được chứa thông tin đăng nhập (username/password).');
  }
  if (parsed.hostname.includes('%') || raw.includes('%25')) {
    throw new Error('Panel URL chứa ký tự zone ID không hợp lệ.');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.metadata.google.internal') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('Panel URL không được trỏ tới máy chủ nội bộ hoặc địa chỉ metadata.');
  }
  if (net.isIP(hostname) && isPrivateOrBlockedIpAddress(hostname)) {
    throw new Error('Panel URL không được trỏ tới dải IP mạng nội bộ.');
  }
  if (isLocalOrPrivateHost(hostname)) {
    throw new Error('Panel URL không được trỏ tới dải IP mạng nội bộ.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Panel URL chỉ chấp nhận giao thức HTTPS để bảo vệ cookie phiên.');
  }
  return raw;
}

async function assertPublicPanelHost(urlStr) {
  const parsed = new URL(urlStr);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  try {
    return await resolveAndValidateHost(hostname, { allowLocal: false });
  } catch (err) {
    if (/Không thể phân giải DNS|Lỗi phân giải DNS/i.test(err.message)) {
      throw new Error('Không thể phân giải DNS cho Panel URL.');
    }
    throw new Error('Panel URL phân giải sang địa chỉ IP nội bộ (SSRF blocked).');
  }
}

function maskCookie(cookie) {
  if (!cookie || typeof cookie !== 'string') return '';
  if (cookie.length <= 8) return '********';
  return cookie.slice(0, 4) + '****' + cookie.slice(-4);
}

async function readResponseTextCapped(res, maxBytes = MAX_RESPONSE_BYTES) {
  if (!res) return '';
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
        if (totalBytes + buf.length > maxBytes) {
          const remaining = maxBytes - totalBytes;
          if (remaining > 0) chunks.push(buf.subarray(0, remaining));
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(buf);
        totalBytes += buf.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof res.text === 'function') {
    const text = await res.text().catch(() => '');
    return String(text || '').slice(0, maxBytes);
  }
  return '';
}

class WispbyteKeepAliveManager {
  constructor({ store, config = {}, logger = console, fetchImpl = global.fetch, adminNotifier } = {}) {
    this.store = store;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.adminNotifier = adminNotifier;
    this.encryptionKey = config.encryptionKey;
    this.intervalMs = Number(config.wispbyteIntervalMs) || TWENTY_FOUR_HOURS_MS;
    this.defaultCookie = String(config.wispbyteCookie || '').trim();
    this.defaultPanelUrl = String(config.wispbytePanelUrl || DEFAULT_PANEL_URL).trim();
    this.accountsJson = String(config.wispbyteAccountsJson || '').trim();

    this.timer = null;
    this.initialTimer = null;
    this.discordClient = null;
    this.adminRoleId = config.adminRoleId || '';
    this.isChecking = false;
    this._accountsLock = Promise.resolve();
  }

  _withAccountsLock(fn) {
    const run = this._accountsLock.then(() => fn());
    this._accountsLock = run.catch(() => {});
    return run;
  }

  _decryptStoredAccounts(saved) {
    return saved.map((a) => {
      const copy = { ...a };
      if (copy.cookie && isStoredCredentialCiphertext(copy.cookie)) {
        const rawCipher = copy.cookie;
        try {
          const decrypted = decryptUserPassword(rawCipher, this.encryptionKey);
          if (typeof decrypted === 'string' && decrypted.length > 0) {
            copy.cookie = decrypted;
          } else {
            copy._rawCookieCiphertext = rawCipher;
            copy._decryptFailed = true;
            copy.cookie = '';
          }
        } catch (_) {
          copy._rawCookieCiphertext = rawCipher;
          copy._decryptFailed = true;
          copy.cookie = '';
        }
      }
      return copy;
    });
  }

  _getEnvFallbackAccounts() {
    let accounts = [];
    if (this.accountsJson) {
      try {
        const parsed = JSON.parse(this.accountsJson);
        if (Array.isArray(parsed)) accounts = parsed;
      } catch (_) {}
    }

    if (accounts.length === 0 && this.defaultCookie) {
      accounts.push({
        id: 'primary',
        name: 'Primary Wispbyte Host',
        cookie: this.defaultCookie,
        panelUrl: this.defaultPanelUrl,
        renewCount: 0,
        lastStatus: 'idle',
        lastPingAt: null,
        lastMessage: 'Configured from environment'
      });
    }
    return accounts;
  }

  async getAccountsStrict() {
    if (this.store && typeof this.store.getSetting === 'function') {
      const saved = await this.store.getSetting('wispbyte_accounts', { bypassCache: true });
      if (Array.isArray(saved)) {
        return this._decryptStoredAccounts(saved);
      }
    }
    return this._getEnvFallbackAccounts();
  }

  async getAccounts() {
    try {
      return await this.getAccountsStrict();
    } catch (err) {
      this.logger.warn?.('wispbyte_get_accounts_store_failed', { error: err.message });
      return this._getEnvFallbackAccounts();
    }
  }

  async getPublicAccounts() {
    const accounts = await this.getAccounts();
    return accounts.map((a) => ({
      ...a,
      cookie: maskCookie(a.cookie),
      cookieMasked: true
    }));
  }

  async saveAccounts(accounts) {
    if (this.store && typeof this.store.setSetting === 'function') {
      const encryptedAccounts = accounts.map((a) => {
        const copy = { ...a };
        const rawCipher = copy._rawCookieCiphertext;
        const decryptFailed = copy._decryptFailed === true;
        delete copy._rawCookieCiphertext;
        delete copy._decryptFailed;
        if (decryptFailed && rawCipher) {
          copy.cookie = rawCipher;
        } else if (copy.cookie && !isStoredCredentialCiphertext(copy.cookie)) {
          copy.cookie = encryptUserPassword(copy.cookie, this.encryptionKey);
        }
        return copy;
      });
      await this.store.setSetting('wispbyte_accounts', encryptedAccounts);
    }
  }

  async addOrUpdateAccount({ id, name, cookie, panelUrl }) {
    const accId = String(id || '').trim().toLowerCase();
    if (!accId || !/^[a-z0-9_-]{2,32}$/.test(accId)) {
      throw new Error('Account ID must be 2–32 lowercase alphanumeric characters, dashes, or underscores.');
    }
    const cleanCookie = String(cookie || '').trim();
    if (!cleanCookie || cleanCookie.length < 10) {
      throw new Error('Cookie must be a valid cookie string.');
    }
    if (/[\r\n]/.test(cleanCookie)) {
      throw new Error('Cookie must not contain CRLF control characters.');
    }
    if (!/^[\x20-\x7e]+$/.test(cleanCookie)) {
      throw new Error('Cookie must contain only printable ASCII characters.');
    }

    const rawPanelUrl = String(panelUrl || this.defaultPanelUrl || DEFAULT_PANEL_URL).trim();
    const cleanPanelUrl = validatePanelUrl(rawPanelUrl);

    return this._withAccountsLock(async () => {
      const accounts = await this.getAccountsStrict();
      const existingIndex = accounts.findIndex((a) => a.id === accId);
      const updated = {
        id: accId,
        name: String(name || accId).trim().slice(0, 48),
        cookie: cleanCookie,
        panelUrl: cleanPanelUrl,
        renewCount: existingIndex >= 0 ? (accounts[existingIndex].renewCount || 0) : 0,
        lastStatus: existingIndex >= 0 ? accounts[existingIndex].lastStatus : 'idle',
        lastPingAt: existingIndex >= 0 ? accounts[existingIndex].lastPingAt : null,
        lastMessage: 'Saved, ready for ping'
      };

      if (existingIndex >= 0) {
        accounts[existingIndex] = updated;
      } else {
        accounts.push(updated);
      }

      await this.saveAccounts(accounts);
      return {
        ...updated,
        cookie: maskCookie(cleanCookie),
        cookieMasked: true
      };
    });
  }

  async deleteAccount(id) {
    const accId = String(id || '').trim().toLowerCase();
    return this._withAccountsLock(async () => {
      const accounts = await this.getAccountsStrict();
      const filtered = accounts.filter((a) => a.id !== accId);
      if (filtered.length === accounts.length) return false;
      await this.saveAccounts(filtered);
      return true;
    });
  }

  async pingAccount(account) {
    let targetUrl;
    try {
      const rawUrl = (account.panelUrl || this.defaultPanelUrl || DEFAULT_PANEL_URL).trim();
      targetUrl = validatePanelUrl(rawUrl);
    } catch (urlErr) {
      return {
        id: account.id,
        name: account.name || account.id,
        success: false,
        status: 'error',
        message: urlErr?.message || 'Invalid panel URL'
      };
    }
    if (account._decryptFailed) {
      return {
        id: account.id,
        name: account.name || account.id,
        success: false,
        status: 'error',
        message: 'Cookie decryption failed (check encryption key)'
      };
    }
    const cookieHeader = (account.cookie || '').trim();

    if (!cookieHeader) {
      return {
        id: account.id,
        name: account.name || account.id,
        success: false,
        status: 'error',
        message: 'No cookie configured'
      };
    }
    if (/[\r\n]/.test(cookieHeader)) {
      return {
        id: account.id,
        name: account.name || account.id,
        success: false,
        status: 'error',
        message: 'Cookie contains CRLF control characters'
      };
    }
    if (!/^[\x20-\x7e]+$/.test(cookieHeader)) {
      return {
        id: account.id,
        name: account.name || account.id,
        success: false,
        status: 'error',
        message: 'Cookie contains invalid non-printable ASCII characters'
      };
    }

    let pinnedAgent = null;
    try {
      const resolved = await assertPublicPanelHost(targetUrl);
      if (this.fetch === global.fetch && undiciLib?.Agent && resolved?.ip) {
        const pinnedIp = resolved.ip;
        const pinnedFamily = resolved.family || net.isIP(pinnedIp) || 4;
        pinnedAgent = new undiciLib.Agent({
          connect: {
            lookup: (_host, opts, cb) => {
              if (opts && opts.all) {
                return cb(null, [{ address: pinnedIp, family: pinnedFamily }]);
              }
              return cb(null, pinnedIp, pinnedFamily);
            }
          }
        });
      }

      this.logger.info?.('wispbyte_manager_ping_start', { accountId: account.id, targetUrl });
      const fetchOpts = {
        method: 'GET',
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': DEFAULT_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000)
      };
      if (pinnedAgent) {
        fetchOpts.dispatcher = pinnedAgent;
      }

      const res = await this.fetch(targetUrl, fetchOpts);
      const location = redactStringSecrets(res.headers.get('location') || '');
      const html = await readResponseTextCapped(res, MAX_RESPONSE_BYTES);

      if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
        const locLower = location.toLowerCase();
        if (locLower.includes('login') || locLower.includes('auth') || locLower.includes('discord')) {
          return {
            id: account.id,
            name: account.name || account.id,
            success: false,
            status: 'expired',
            message: `Session cookie expired (redirected to ${location})`
          };
        }
        if (
          locLower.includes('maintenance') ||
          locLower.includes('suspended') ||
          locLower.includes('banned') ||
          locLower.includes('cdn-cgi') ||
          locLower.includes('challenge') ||
          locLower.includes('captcha') ||
          locLower.includes('error')
        ) {
          return {
            id: account.id,
            name: account.name || account.id,
            success: false,
            status: 'error',
            message: `Panel unavailable or blocked (HTTP ${res.status} -> ${location})`
          };
        }
        return {
          id: account.id,
          name: account.name || account.id,
          success: true,
          status: 'ok',
          message: `HTTP ${res.status} -> ${location}`
        };
      }

      if (res.status === 200) {
        const lower = html.toLowerCase();
        if (
          lower.includes('cdn-cgi/challenge') ||
          lower.includes('cf-browser-verification') ||
          lower.includes('just a moment...') ||
          lower.includes('attention required! | cloudflare') ||
          lower.includes('under maintenance') ||
          lower.includes('maintenance mode') ||
          lower.includes('account suspended') ||
          lower.includes('has been suspended') ||
          lower.includes('you have been banned') ||
          lower.includes('account banned')
        ) {
          return {
            id: account.id,
            name: account.name || account.id,
            success: false,
            status: 'error',
            message: 'Client panel returned Cloudflare challenge or maintenance/suspended notice'
          };
        }

        const looksLikeLogin =
          lower.includes('login with discord') ||
          lower.includes('sign in to your account') ||
          lower.includes('name="password"') ||
          lower.includes('/auth/login');
        if (looksLikeLogin && !lower.includes('logout')) {
          return {
            id: account.id,
            name: account.name || account.id,
            success: false,
            status: 'expired',
            message: 'Client panel returned login page (Cookie expired)'
          };
        }
        return {
          id: account.id,
          name: account.name || account.id,
          success: true,
          status: 'ok',
          message: 'Client panel accessed successfully (HTTP 200)'
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          id: account.id,
          name: account.name || account.id,
          success: false,
          status: 'error',
          message: `HTTP ${res.status} (Cloudflare challenge or forbidden)`
        };
      }

      return {
        id: account.id,
        name: account.name || account.id,
        success: false,
        status: 'error',
        message: `HTTP ${res.status}`
      };
    } catch (err) {
      return {
        id: account.id,
        name: account.name || account.id,
        success: false,
        status: 'error',
        message: `Connection error: ${redactStringSecrets(err.message)}`
      };
    } finally {
      if (pinnedAgent && typeof pinnedAgent.close === 'function') {
        await pinnedAgent.close().catch(() => {});
      }
    }
  }

  async checkAll({ notifyDiscord = true, skipFreshWithinMs = 0 } = {}) {
    if (this.isChecking) {
      return { success: false, message: 'Check is already running in background.' };
    }

    this.isChecking = true;
    try {
      const accounts = await this.getAccountsStrict();
      if (accounts.length === 0) {
        return { success: true, total: 0, results: [], message: 'No Wispbyte accounts configured.' };
      }

      this.logger.info?.('wispbyte_keepalive_check_all_started', { count: accounts.length });
      const results = [];
      const now = new Date().toISOString();
      const nowMs = Date.now();

      const statusById = new Map();
      for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const lastPingMs = acc.lastPingAt ? Date.parse(acc.lastPingAt) : NaN;
        if (
          skipFreshWithinMs > 0 &&
          acc.lastStatus === 'ok' &&
          Number.isFinite(lastPingMs) &&
          (nowMs - lastPingMs) >= 0 &&
          (nowMs - lastPingMs) < skipFreshWithinMs
        ) {
          results.push({
            id: acc.id,
            name: acc.name || acc.id,
            success: true,
            skippedFresh: true,
            status: 'ok',
            message: acc.lastMessage || 'Skipped (already verified recently by peer instance)',
            lastPingAt: acc.lastPingAt,
            renewCount: acc.renewCount || 0
          });
          continue;
        }
        const snapshotCookie = acc.cookie;
        const res = await this.pingAccount(acc);
        acc.lastPingAt = now;
        acc.lastStatus = res.status;
        acc.lastMessage = res.message;
        if (res.success) {
          acc.renewCount = (acc.renewCount || 0) + 1;
        }
        statusById.set(acc.id, {
          snapshotCookie,
          lastPingAt: acc.lastPingAt,
          lastStatus: acc.lastStatus,
          lastMessage: acc.lastMessage,
          renewCount: acc.renewCount
        });
        results.push({ ...res, lastPingAt: now, renewCount: acc.renewCount });
        if (i < accounts.length - 1) {
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 2000);
            t.unref?.();
          });
        }
      }

      // Re-read fresh accounts strictly inside lock so concurrent admin updates/deletes are never overwritten or resurrected
      await this._withAccountsLock(async () => {
        const latestAccounts = await this.getAccountsStrict();
        const mergedAccounts = latestAccounts.map((acc) => {
          const update = statusById.get(acc.id);
          if (!update) return acc;
          if (acc._decryptFailed || acc.cookie !== update.snapshotCookie) {
            return acc;
          }
          return {
            ...acc,
            lastPingAt: update.lastPingAt,
            lastStatus: update.lastStatus,
            lastMessage: update.lastMessage,
            renewCount: update.renewCount
          };
        });
        await this.saveAccounts(mergedAccounts);
      });

      const okCount = results.filter((r) => r.success).length;
      const expiredList = results.filter((r) => r.status === 'expired');

      if (notifyDiscord && expiredList.length > 0) {
        this.logger.warn?.('wispbyte_accounts_expired', { expiredCount: expiredList.length });
        if (this.adminNotifier) {
          void this.adminNotifier.sendAlert({
            source: 'Wispbyte',
            event: 'wispbyte_cookie_expired',
            message: `⚠️ Phát hiện **${expiredList.length}** tài khoản Wispbyte bị hết hạn session cookie hoặc không thể gia hạn 14 ngày!`,
            details: {
              expiredAccounts: expiredList.map((a) => `${a.name} (${a.id})`).join(', '),
              actionRequired: 'Dùng lệnh /wispbyte add để cập nhật lại cookie mới!'
            },
            level: 'error'
          });
        }
      }

      return {
        success: true,
        total: accounts.length,
        okCount,
        expiredCount: expiredList.length,
        results
      };
    } finally {
      this.isChecking = false;
    }
  }

  start({ discordClient, adminRoleId } = {}) {
    if (this.timer) return;
    this.discordClient = discordClient || this.discordClient;
    this.adminRoleId = adminRoleId || this.adminRoleId;

    this.logger.info?.('wispbyte_keepalive_scheduler_started', {
      intervalHours: Math.round(this.intervalMs / 3600000)
    });

    const freshWindowMs = Math.max(60000, Math.floor(this.intervalMs * 0.75));
    this.initialTimer = setTimeout(() => {
      void this.checkAll({ notifyDiscord: true, skipFreshWithinMs: freshWindowMs }).catch(() => {});
    }, 60000);
    this.initialTimer.unref?.();

    this.timer = setInterval(() => {
      void this.checkAll({ notifyDiscord: true, skipFreshWithinMs: freshWindowMs }).catch(() => {});
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getStatus() {
    const accounts = await this.getAccounts();
    return accounts.map((acc) => ({
      id: acc.id,
      name: acc.name || acc.id,
      panelUrl: acc.panelUrl || DEFAULT_PANEL_URL,
      lastStatus: acc.lastStatus || 'idle',
      lastPingAt: acc.lastPingAt,
      lastMessage: acc.lastMessage || '—',
      renewCount: acc.renewCount || 0
    }));
  }
}

module.exports = WispbyteKeepAliveManager;
module.exports.validatePanelUrl = validatePanelUrl;
module.exports.maskCookie = maskCookie;
module.exports.assertPublicPanelHost = assertPublicPanelHost;
