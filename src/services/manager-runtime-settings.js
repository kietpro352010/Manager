'use strict';

const { encryptSecret, decryptSecret } = require('../utils/secrets');
const { DEFAULT_PUBLIC_MANAGER_URL, normalizePublicUrl, isPublicHttpsUrl } = require('../config/host-runtime');

const SETTING_KEY = 'manager_runtime';
const ACTIVE_URLS_SETTING_KEY = 'active_manager_urls';
const ACTIVE_URL_HEARTBEAT_MS = 10 * 60 * 1000;
const ACTIVE_URL_STALE_MS = 2 * 60 * 60 * 1000;
const MAX_ACTIVE_URLS = 8;

class ManagerRuntimeSettings {
  constructor({ store, encryptionKey, previousEncryptionKey = null, initial = {} }) {
    this.store = store;
    this.encryptionKey = encryptionKey;
    this.previousEncryptionKey = previousEncryptionKey;
    this.initial = initial;
    this.secretsDecryptionFailed = false;
    this.rawSecretsCiphertext = null;
    this.activeManagerUrls = [];
    this._activeUrlLastSeen = new Map();
    this._lastUrlRecordAt = new Map();
    this._lastUrlsFetchAt = 0;
    this._urlSyncChain = null;
    this._heartbeatTimer = null;
    this.values = { publicBaseUrl: '', renderApiKey: '', link4mApiToken: '', link4mSecretKey: '', link4mMode: 'api', link4mUrl: '' };
  }

  _tryDecryptJson(ciphertext) {
    if (!ciphertext || !this.encryptionKey) return { ok: false, data: null, attempted: Boolean(ciphertext) };
    try {
      const decrypted = decryptSecret(ciphertext, this.encryptionKey, this.previousEncryptionKey);
      return decrypted ? { ok: true, data: JSON.parse(decrypted), attempted: true } : { ok: false, data: null, attempted: true };
    } catch (_) {
      return { ok: false, data: null, attempted: true };
    }
  }

  _tryDecryptText(ciphertext) {
    if (!ciphertext || !this.encryptionKey) return { ok: false, value: '', attempted: Boolean(ciphertext) };
    try {
      const decrypted = decryptSecret(ciphertext, this.encryptionKey, this.previousEncryptionKey);
      return { ok: true, value: String(decrypted || '').trim(), attempted: true };
    } catch (_) {
      return { ok: false, value: '', attempted: true };
    }
  }

  async initialize() {
    const stored = await this.store.getSetting(SETTING_KEY, { bypassCache: true });
    const sysStored = await Promise.resolve(this.store.getSetting('system_settings', { bypassCache: true })).catch(() => null);
    let storedSecrets = null;
    this.secretsDecryptionFailed = false;
    this.rawSecretsCiphertext = null;
    if (stored?.secretsCiphertext) {
      const res = this._tryDecryptJson(stored.secretsCiphertext);
      if (res.ok && res.data) {
        storedSecrets = res.data;
      } else {
        this.secretsDecryptionFailed = true;
        this.rawSecretsCiphertext = stored.secretsCiphertext;
        storedSecrets = null;
        console.warn('[SECURITY WARNING] Không thể giải mã runtime secretsCiphertext. Giữ nguyên ciphertext thô để tránh ghi đè làm mất Render API key / Link4M token.');
      }
    }

    const sysApiRes = this._tryDecryptText(sysStored?.link4mApiTokenCiphertext);
    const sysSecRes = this._tryDecryptText(sysStored?.link4mSecretKeyCiphertext);
    const sysClearedApi = sysStored && typeof sysStored === 'object' && sysStored.hasLink4mApiToken === false && !sysStored.link4mApiTokenCiphertext;
    const sysClearedSec = sysStored && typeof sysStored === 'object' && sysStored.hasLink4mSecretKey === false && !sysStored.link4mSecretKeyCiphertext;

    const resolvedApiToken = sysApiRes.ok && sysApiRes.value
      ? sysApiRes.value
      : (storedSecrets?.link4mApiToken !== undefined && String(storedSecrets.link4mApiToken).trim()
        ? String(storedSecrets.link4mApiToken).trim()
        : (sysClearedApi ? '' : String(this.initial.link4mApiToken ?? '').trim()));

    const resolvedSecretKey = sysSecRes.ok && sysSecRes.value
      ? sysSecRes.value
      : (storedSecrets?.link4mSecretKey !== undefined && String(storedSecrets.link4mSecretKey).trim()
        ? String(storedSecrets.link4mSecretKey).trim()
        : (sysClearedSec ? '' : String(this.initial.link4mSecretKey ?? '').trim()));

    const sysModeRaw = String(sysStored?.link4mMode || '').trim().toLowerCase();
    const resolvedMode = ['api', 'custom_url'].includes(sysModeRaw) ? sysModeRaw : 'api';
    const resolvedUrl = String(sysStored?.link4mUrl || '').trim();

    this.values = {
      publicBaseUrl: normalizePublicUrl(sysStored?.publicBaseUrl || stored?.publicBaseUrl || this.initial.publicBaseUrl),
      renderApiKey: String(storedSecrets?.renderApiKey ?? this.initial.renderApiKey ?? '').trim(),
      link4mApiToken: resolvedApiToken,
      link4mSecretKey: resolvedSecretKey,
      link4mMode: resolvedMode,
      link4mUrl: resolvedUrl
    };

    const recoveredFromSys = Boolean(
      (sysApiRes.ok && sysApiRes.value && sysApiRes.value !== String(storedSecrets?.link4mApiToken || '').trim()) ||
      (sysSecRes.ok && sysSecRes.value && sysSecRes.value !== String(storedSecrets?.link4mSecretKey || '').trim())
    );

    // Migrate optional host-provided or system_settings integration keys into encrypted Supabase settings once.
    if (
      (!stored?.secretsCiphertext && (this.values.renderApiKey || this.values.link4mApiToken || this.values.link4mSecretKey || this.values.publicBaseUrl)) ||
      (recoveredFromSys && !this.secretsDecryptionFailed)
    ) {
      await this.persist();
    }

    try {
      const urlsStored = await Promise.resolve(this.store.getSetting(ACTIVE_URLS_SETTING_KEY, { bypassCache: true })).catch(() => null);
      this._hydrateActiveUrlsRecord(urlsStored);
      this._lastUrlsFetchAt = Date.now();
    } catch (_) {}

    if (isPublicHttpsUrl(this.initial?.publicBaseUrl)) {
      void this.recordActiveManagerUrl(this.initial.publicBaseUrl).catch(() => {});
    }
    if (Array.isArray(this.initial?.managerUrls)) {
      for (const extraUrl of this.initial.managerUrls) {
        if (isPublicHttpsUrl(extraUrl)) {
          void this.recordActiveManagerUrl(extraUrl).catch(() => {});
        }
      }
    }

    return this.snapshot();
  }

  _hydrateActiveUrlsRecord(record) {
    if (!record || typeof record !== 'object') return;
    const now = Date.now();
    const nextMap = new Map(this._activeUrlLastSeen);
    const items = Array.isArray(record.entries) ? record.entries : (Array.isArray(record.urls) ? record.urls.map((u) => ({ url: u })) : []);
    for (const entry of items) {
      const url = typeof entry === 'string' ? entry : entry?.url;
      if (!isPublicHttpsUrl(url)) continue;
      const norm = normalizePublicUrl(url);
      const seenMs = entry?.lastSeenAt ? Date.parse(entry.lastSeenAt) : now;
      if (Number.isFinite(seenMs) && (now - seenMs) > ACTIVE_URL_STALE_MS) continue;
      const prev = nextMap.get(norm) || 0;
      nextMap.set(norm, Math.max(prev, Number.isFinite(seenMs) ? seenMs : now));
    }
    this._activeUrlLastSeen = nextMap;
    this.activeManagerUrls = [...nextMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ACTIVE_URLS)
      .map(([u]) => u);
  }

  async refreshActiveManagerUrls({ maxAgeMs = 15000 } = {}) {
    if (!this.store || typeof this.store.getSetting !== 'function') return this.getActiveManagerUrls();
    const now = Date.now();
    if (this._lastUrlsFetchAt && (now - this._lastUrlsFetchAt) < maxAgeMs) {
      return this.getActiveManagerUrls();
    }
    this._lastUrlsFetchAt = now;
    try {
      const record = await this.store.getSetting(ACTIVE_URLS_SETTING_KEY, { bypassCache: true });
      this._hydrateActiveUrlsRecord(record);
    } catch (_) {}
    return this.getActiveManagerUrls();
  }

  getActiveManagerUrls(preferredUrl = '') {
    const urls = [];
    const pushIfValid = (candidate, allowLocal = false) => {
      const norm = normalizePublicUrl(candidate);
      if (!norm) return;
      if (!allowLocal && !isPublicHttpsUrl(norm)) return;
      if (!urls.includes(norm)) urls.push(norm);
    };
    pushIfValid(preferredUrl, true);
    pushIfValid(this.values.publicBaseUrl, false);
    for (const u of this.activeManagerUrls) pushIfValid(u, false);
    pushIfValid(DEFAULT_PUBLIC_MANAGER_URL, false);
    return urls.slice(0, MAX_ACTIVE_URLS);
  }

  recordActiveManagerUrl(candidateUrl, { force = false } = {}) {
    if (!isPublicHttpsUrl(candidateUrl)) return Promise.resolve(false);
    const norm = normalizePublicUrl(candidateUrl);
    if (!norm) return Promise.resolve(false);
    const now = Date.now();
    const lastRecorded = this._lastUrlRecordAt.get(norm) || 0;
    if (!force && lastRecorded && (now - lastRecorded) < ACTIVE_URL_HEARTBEAT_MS) {
      return Promise.resolve(false);
    }
    this._lastUrlRecordAt.set(norm, now);
    this._activeUrlLastSeen.set(norm, now);
    if (!this.activeManagerUrls.includes(norm)) {
      this.activeManagerUrls = [norm, ...this.activeManagerUrls].slice(0, MAX_ACTIVE_URLS);
    }
    if (!this.store || typeof this.store.getSetting !== 'function' || typeof this.store.setSetting !== 'function') {
      return Promise.resolve(false);
    }
    const task = async () => {
      try {
        const existing = await Promise.resolve(this.store.getSetting(ACTIVE_URLS_SETTING_KEY, { bypassCache: true })).catch(() => null);
        this._hydrateActiveUrlsRecord(existing);
        const nowIso = new Date().toISOString();
        const mergedMap = new Map(this._activeUrlLastSeen);
        mergedMap.set(norm, Date.now());
        const sorted = [...mergedMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_ACTIVE_URLS);
        const entries = sorted.map(([url, ts]) => ({ url, lastSeenAt: new Date(ts).toISOString() }));
        const urls = sorted.map(([url]) => url);
        this._activeUrlLastSeen = new Map(sorted);
        this.activeManagerUrls = urls;
        await this.store.setSetting(ACTIVE_URLS_SETTING_KEY, {
          urls,
          entries,
          updatedAt: nowIso
        });
        return true;
      } catch (_) {
        return false;
      }
    };
    const prev = this._urlSyncChain || Promise.resolve();
    const cur = prev.then(task, task);
    this._urlSyncChain = cur.catch(() => {});
    return cur;
  }

  startHeartbeat(intervalMs = ACTIVE_URL_HEARTBEAT_MS) {
    this.stopHeartbeat();
    const effectiveMs = Math.max(60000, Number(intervalMs) || ACTIVE_URL_HEARTBEAT_MS);
    const pulse = () => {
      const selfUrl = this.values?.publicBaseUrl || this.initial?.publicBaseUrl || '';
      if (isPublicHttpsUrl(selfUrl)) {
        void this.recordActiveManagerUrl(selfUrl, { force: true }).catch(() => {});
      }
      if (Array.isArray(this.initial?.managerUrls)) {
        for (const extraUrl of this.initial.managerUrls) {
          if (isPublicHttpsUrl(extraUrl)) {
            void this.recordActiveManagerUrl(extraUrl, { force: true }).catch(() => {});
          }
        }
      }
      void this.refreshActiveManagerUrls({ maxAgeMs: 0 }).catch(() => {});
    };
    this._heartbeatTimer = setInterval(pulse, effectiveMs);
    this._heartbeatTimer.unref?.();
    return this._heartbeatTimer;
  }

  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  snapshot() { return { ...this.values }; }

  publicStatus() {
    return {
      publicUrlConfigured: Boolean(this.values.publicBaseUrl),
      renderApiConfigured: Boolean(this.values.renderApiKey),
      link4mApiConfigured: Boolean(this.values.link4mApiToken),
      link4mWebhookConfigured: Boolean(this.values.link4mSecretKey)
    };
  }

  async update(patch = {}) {
    const run = async () => {
      const hasSecretPatch = ['renderApiKey', 'link4mApiToken', 'link4mSecretKey'].some((key) => Object.hasOwn(patch, key));
      if (this.secretsDecryptionFailed && hasSecretPatch) {
        throw new Error('Không thể cập nhật cấu hình bí mật khi chưa giải mã được dữ liệu hiện tại.');
      }
      const next = { ...this.values };
      if (Object.hasOwn(patch, 'publicBaseUrl')) {
        const raw = String(patch.publicBaseUrl || '').trim();
        const normalized = raw ? normalizePublicUrl(raw) : '';
        if (raw && !normalized) throw new Error('Public manager URL must be a valid HTTPS URL without credentials.');
        next.publicBaseUrl = normalized;
      }
      for (const key of ['renderApiKey', 'link4mApiToken', 'link4mSecretKey']) {
        if (!Object.hasOwn(patch, key)) continue;
        const value = String(patch[key] || '').trim();
        if (value.length > 4096) throw new Error(`${key} exceeds the allowed length.`);
        next[key] = value;
      }
      await this.persist(next);
      this.values = next;
      return this.snapshot();
    };
    const prev = this._updateChain || Promise.resolve();
    const current = prev.then(run, run);
    this._updateChain = current.catch(() => {});
    return current;
  }

  async persist(values = this.values) {
    let ciphertext;
    if (this.secretsDecryptionFailed && this.rawSecretsCiphertext) {
      ciphertext = this.rawSecretsCiphertext;
    } else {
      const secrets = {
        renderApiKey: values.renderApiKey,
        link4mApiToken: values.link4mApiToken,
        link4mSecretKey: values.link4mSecretKey
      };
      ciphertext = encryptSecret(JSON.stringify(secrets), this.encryptionKey);
    }
    await this.store.setSetting(SETTING_KEY, {
      publicBaseUrl: values.publicBaseUrl,
      secretsCiphertext: ciphertext
    });
  }

  async getRoleSettings() {
    try {
      if (this.store && typeof this.store.getSetting === 'function') {
        const stored = await this.store.getSetting('discord_access');
        if (stored && typeof stored === 'object') {
          return {
            guildId: String(stored.guildId || '').trim(),
            adminRoleId: String(stored.adminRoleId || '').trim(),
            userRoleId: String(stored.userRoleId || '').trim(),
            adminUserId: String(stored.adminUserId || '').trim()
          };
        }
      }
    } catch (_) {}
    return null;
  }
}

module.exports = {
  ManagerRuntimeSettings,
  SETTING_KEY,
  ACTIVE_URLS_SETTING_KEY,
  ACTIVE_URL_HEARTBEAT_MS,
  ACTIVE_URL_STALE_MS
};
