'use strict';

const { encryptSecret, decryptSecret } = require('../utils/secrets');
const { normalizePublicUrl } = require('../config/host-runtime');

const SETTING_KEY = 'manager_runtime';

class ManagerRuntimeSettings {
  constructor({ store, encryptionKey, initial = {} }) {
    this.store = store;
    this.encryptionKey = encryptionKey;
    this.initial = initial;
    this.secretsDecryptionFailed = false;
    this.rawSecretsCiphertext = null;
    this.values = { publicBaseUrl: '', renderApiKey: '', link4mApiToken: '', link4mSecretKey: '' };
  }

  async initialize() {
    const stored = await this.store.getSetting(SETTING_KEY);
    let storedSecrets = null;
    this.secretsDecryptionFailed = false;
    this.rawSecretsCiphertext = null;
    if (stored?.secretsCiphertext) {
      try {
        const decrypted = decryptSecret(stored.secretsCiphertext, this.encryptionKey);
        if (decrypted) storedSecrets = JSON.parse(decrypted);
      } catch (_) {
        this.secretsDecryptionFailed = true;
        this.rawSecretsCiphertext = stored.secretsCiphertext;
        storedSecrets = null;
        console.warn('[SECURITY WARNING] Không thể giải mã runtime secretsCiphertext. Giữ nguyên ciphertext thô để tránh ghi đè làm mất Render API key / Link4M token.');
      }
    }
    this.values = {
      publicBaseUrl: normalizePublicUrl(stored?.publicBaseUrl || this.initial.publicBaseUrl),
      renderApiKey: String(storedSecrets?.renderApiKey ?? this.initial.renderApiKey ?? '').trim(),
      link4mApiToken: String(storedSecrets?.link4mApiToken ?? this.initial.link4mApiToken ?? '').trim(),
      link4mSecretKey: String(storedSecrets?.link4mSecretKey ?? this.initial.link4mSecretKey ?? '').trim()
    };

    // Migrate optional host-provided integration keys into encrypted Supabase settings once.
    if (!stored?.secretsCiphertext && (this.values.renderApiKey || this.values.link4mApiToken || this.values.link4mSecretKey || this.values.publicBaseUrl)) {
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
