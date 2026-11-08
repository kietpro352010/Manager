'use strict';

const { encryptSecret, decryptSecret } = require('../utils/secrets');
const { normalizePublicUrl } = require('../config/host-runtime');

const SETTING_KEY = 'manager_runtime';

class ManagerRuntimeSettings {
  constructor({ store, encryptionKey, initial = {} }) {
    this.store = store;
    this.encryptionKey = encryptionKey;
    this.initial = initial;
    this.values = { publicBaseUrl: '', renderApiKey: '', link4mApiToken: '', link4mSecretKey: '' };
  }

  async initialize() {
    const stored = await this.store.getSetting(SETTING_KEY);
    const storedSecrets = stored?.secretsCiphertext
      ? JSON.parse(decryptSecret(stored.secretsCiphertext, this.encryptionKey)) : null;
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
    const secrets = {
      renderApiKey: values.renderApiKey,
      link4mApiToken: values.link4mApiToken,
      link4mSecretKey: values.link4mSecretKey
    };
    await this.store.setSetting(SETTING_KEY, {
      publicBaseUrl: values.publicBaseUrl,
      secretsCiphertext: encryptSecret(JSON.stringify(secrets), this.encryptionKey)
    });
  }
}

module.exports = { ManagerRuntimeSettings, SETTING_KEY };
