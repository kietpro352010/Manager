'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { encryptUserPassword, decryptUserPassword, isStoredCredentialCiphertext } = require('../utils/secrets');
const { isPrivateOrBlockedIp, isLocalOrPrivateHost } = require('./proxy-validation');

const DEFAULT_PANEL_URL = 'https://wispbyte.com/client';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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
  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIpAddress(hostname)) {
      throw new Error('Panel URL không được trỏ tới dải IP mạng nội bộ.');
    }
    return;
  }
  const records = await dns.lookup(hostname, { all: true }).catch(() => []);
  for (const rec of records) {
    if (rec?.address && isPrivateOrBlockedIpAddress(rec.address)) {
      throw new Error('Panel URL phân giải sang địa chỉ IP nội bộ (SSRF blocked).');
    }
  }
}

function maskCookie(cookie) {
  if (!cookie || typeof cookie !== 'string') return '';
  if (cookie.length <= 8) return '********';
  return cookie.slice(0, 4) + '****' + cookie.slice(-4);
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
  }

  async getAccounts() {
    let accounts = [];

    // 1. Check Supabase manager_settings first
    if (this.store && typeof this.store.getSetting === 'function') {
      try {
        const saved = await this.store.getSetting('wispbyte_accounts');
        if (Array.isArray(saved) && saved.length > 0) {
          accounts = saved.map((a) => {
            const copy = { ...a };
            if (copy.cookie && isStoredCredentialCiphertext(copy.cookie)) {
              try {
                copy.cookie = decryptUserPassword(copy.cookie, this.encryptionKey);
              } catch (_) {}
            }
            return copy;
          });
        }
      } catch (err) {
        this.logger.warn?.('wispbyte_get_accounts_store_failed', { error: err.message });
      }
    }

    // 2. If no DB accounts, parse from WISPBYTE_ACCOUNTS JSON or single WISPBYTE_COOKIE
    if (accounts.length === 0) {
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
    }

    return accounts;
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
        if (copy.cookie && !isStoredCredentialCiphertext(copy.cookie)) {
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

    const rawPanelUrl = String(panelUrl || this.defaultPanelUrl || DEFAULT_PANEL_URL).trim();
    const cleanPanelUrl = validatePanelUrl(rawPanelUrl);

    const accounts = await this.getAccounts();
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
  }

  async deleteAccount(id) {
    const accId = String(id || '').trim().toLowerCase();
    const accounts = await this.getAccounts();
    const filtered = accounts.filter((a) => a.id !== accId);
    if (filtered.length === accounts.length) return false;
    await this.saveAccounts(filtered);
    return true;
  }

  async pingAccount(account) {
    const rawUrl = (account.panelUrl || this.defaultPanelUrl || DEFAULT_PANEL_URL).trim();
    const targetUrl = validatePanelUrl(rawUrl);
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

    try {
      if (this.fetch === global.fetch) {
        await assertPublicPanelHost(targetUrl);
      }
      this.logger.info?.('wispbyte_manager_ping_start', { accountId: account.id, targetUrl });
      const res = await this.fetch(targetUrl, {
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
      });

      const location = res.headers.get('location') || '';
      const html = await res.text().catch(() => '');

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
        if ((lower.includes('login with discord') || lower.includes('sign in to your account'))
            && !lower.includes('logout') && !lower.includes('servers')) {
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
        message: `Connection error: ${err.message}`
      };
    }
  }

  async checkAll({ notifyDiscord = true } = {}) {
    if (this.isChecking) {
      return { success: false, message: 'Check is already running in background.' };
    }

    this.isChecking = true;
    try {
      const accounts = await this.getAccounts();
      if (accounts.length === 0) {
        return { success: true, total: 0, results: [], message: 'No Wispbyte accounts configured.' };
      }

      this.logger.info?.('wispbyte_keepalive_check_all_started', { count: accounts.length });
      const results = [];
      const now = new Date().toISOString();

      for (const acc of accounts) {
        const res = await this.pingAccount(acc);
        acc.lastPingAt = now;
        acc.lastStatus = res.status;
        acc.lastMessage = res.message;
        if (res.success) {
          acc.renewCount = (acc.renewCount || 0) + 1;
        }
        results.push({ ...res, lastPingAt: now, renewCount: acc.renewCount });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      await this.saveAccounts(accounts);

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

    this.initialTimer = setTimeout(() => {
      void this.checkAll({ notifyDiscord: true }).catch(() => {});
    }, 60000);
    this.initialTimer.unref?.();

    this.timer = setInterval(() => {
      void this.checkAll({ notifyDiscord: true }).catch(() => {});
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
