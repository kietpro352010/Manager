'use strict';

const { encryptSecret, decryptSecret } = require('../utils/secrets');
const { normalizePublicUrl } = require('../config/host-runtime');

const SETTING_KEY = 'manager_runtime';

class ManagerRuntimeSettings {
  constructor({ store, encryptionKey, previousEncryptionKey = null, initial = {} }) {
    this.store = store;
    this.encryptionKey = encryptionKey;
    this.previousEncryptionKey = previousEncryptionKey;
    this.initial = initial;
    this.secretsDecryptionFailed = false;
    this.rawSecretsCiphertext = null;
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
    return this.snapshot();
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

module.exports = { ManagerRuntimeSettings, SETTING_KEY };
