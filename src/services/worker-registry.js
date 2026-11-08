'use strict';

const crypto = require('node:crypto');
const { isLocalOrPrivateHost } = require('./proxy-validation');
const { encryptSecret, decryptSecret, generateWorkerSecret } = require('../utils/secrets');

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const ACTIONS = new Set([
  'start', 'stop', 'restart', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy'
]);

class WorkerRegistry {
  constructor({ store, accessStore, encryptionKey, renderApi, adminNotifier }) {
    this.store = store;
    this.accessStore = accessStore;
    this.encryptionKey = encryptionKey;
    this.renderApi = renderApi;
    this.adminNotifier = adminNotifier;
  }

  async add({ workerId, name, provider, serviceUrl = '', serviceId = '' }) {
    const id = String(workerId || '').trim().toLowerCase();
    const label = String(name || id).trim().slice(0, 64) || id;
    const host = String(provider || '').trim().toLowerCase();
    let url = String(serviceUrl || '').trim().replace(/\/+$/, '');
    const renderServiceId = String(serviceId || '').trim();
    if (!ID_PATTERN.test(id)) throw new Error('Worker ID must be 2–40 lowercase letters, numbers, underscores, or hyphens.');
    if (!['render', 'wispbyte'].includes(host)) throw new Error('Provider must be render or wispbyte.');
    if (host === 'render' && !url && !renderServiceId) throw new Error('Render workers need a service URL or Render service ID.');
    if (url && !/^https:\/\//i.test(url) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(url)) throw new Error('Worker URL must use HTTPS.');
    if (host === 'render' && !url && renderServiceId) {
      if (!this.renderApi) throw new Error('Configure the Render API key through /setup → Integration secrets, or provide the worker HTTPS URL.');
      const service = await this.renderApi.getService(renderServiceId);
      url = String(service.url || '').replace(/\/+$/, '');
      if (!url) throw new Error('The selected Render service has no public HTTPS URL.');
    }
    if (await this.store.get(id)) throw new Error(`Worker ${id} already exists.`);

    const secret = generateWorkerSecret();
    const botNumber = await this.store.nextBotNumber();
    const now = new Date();
    const record = {
      botNumber, workerId: id, name: label, provider: host, serviceUrl: url, renderServiceId,
      secretCiphertext: encryptSecret(secret, this.encryptionKey), enabled: true,
      settings: { afkMode: null, proxyCiphertext: null, mcCredentialsCiphertext: null, afkManaged: false, proxyManaged: false },
      status: { state: 'registered', online: false }, events: [], createdAt: now, updatedAt: now
    };
    await this.store.create(record);
    return { worker: this.publicView(record), secret };
  }

  async remove(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    const removed = await this.store.remove(id);
    if (removed) await this.accessStore?.removeWorkerAssignments(id);
    return removed;
  }
  computeReachable(record) {
    if (!record) return null;
    record.reachable = Boolean(record.lastHeartbeat && Date.now() - new Date(record.lastHeartbeat).getTime() <= 120000);
    return record;
  }
  async find(workerId) {
    const record = await this.store.get(String(workerId || '').trim().toLowerCase());
    return this.computeReachable(record);
  }
  async findByNumber(botNumber) {
    const number = Number(botNumber);
    if (!Number.isInteger(number) || number <= 0) return null;
    const record = await this.store.getByNumber(number);
    return this.computeReachable(record);
  }
  async list() { return (await this.store.list()).map((record) => this.publicView(record)); }

  async credential(workerId) {
    const record = await this.find(workerId);
    if (!record || !record.enabled) return null;
    return decryptSecret(record.secretCiphertext, this.encryptionKey);
  }

  async rotateSecret(workerId) {
    const record = await this.find(workerId);
    if (!record) throw new Error(`Worker ${workerId} is not registered.`);
    const secret = generateWorkerSecret();
    await this.store.update(record.workerId, { secretCiphertext: encryptSecret(secret, this.encryptionKey) });
    return secret;
  }

  async resetData(workerId) {
    const record = await this.find(workerId);
    if (!record || !record.enabled) throw new Error(`Worker ${workerId} is not registered or is disabled.`);
    await this.store.resetData(record.workerId);
    return this.publicView(await this.find(record.workerId));
  }

  async authenticate(workerId, presentedSecret) {
    const expected = await this.credential(workerId).catch(() => null);
    if (!expected || typeof presentedSecret !== 'string') return false;
    const left = Buffer.from(expected);
    const right = Buffer.from(presentedSecret);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  async updateStatus(workerId, status, source) {
    const asNumber = (value, max = Number.MAX_SAFE_INTEGER) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
      ? Math.max(0, Math.min(max, Number(value))) : null;
    const safeStatus = {
      state: String(status?.state || 'unknown').slice(0, 40),
      online: Boolean(status?.online ?? status?.connected),
      username: String(status?.username || '').slice(0, 64),
      uptimeSeconds: Number.isFinite(Number(status?.uptimeSeconds)) ? Math.max(0, Number(status.uptimeSeconds)) : null,
      pingMs: asNumber(status?.pingMs, 600000),
      managerLatencyMs: asNumber(status?.managerLatencyMs, 600000),
      transport: String(status?.transport || '').slice(0, 24),
      reconnectAttempts: Number.isFinite(Number(status?.reconnectAttempts)) ? Math.max(0, Number(status.reconnectAttempts)) : 0,
      reconnectCount: Number.isFinite(Number(status?.reconnectCount)) ? Math.max(0, Number(status.reconnectCount)) : 0,
      afkMode: 'still',
      proxyEnabled: Boolean(status?.proxyEnabled),
      lastError: String(status?.lastError || '').slice(0, 240),
      lastKickReason: String(status?.lastKickReason || '').slice(0, 240),
      restriction: String(status?.restriction || '').slice(0, 40) || null,
      maintenanceWindow: Boolean(status?.maintenanceWindow),
      maintenanceTimeZone: String(status?.maintenanceTimeZone || '').slice(0, 40),
      maintenanceStart: String(status?.maintenanceStart || '').slice(0, 5),
      maintenanceEnd: String(status?.maintenanceEnd || '').slice(0, 5),
      tps: typeof status?.tps === 'number' && Number.isFinite(status.tps) ? Math.max(0, Math.min(20, status.tps)) : null,
      cpuPercent: asNumber(status?.cpuPercent, 100),
      rssMb: asNumber(status?.rssMb, 65536),
      heapUsedMb: asNumber(status?.heapUsedMb, 65536),
      bandwidthRxBps: asNumber(status?.bandwidthRxBps, 10_000_000_000),
      bandwidthTxBps: asNumber(status?.bandwidthTxBps, 10_000_000_000),
      position: status?.position && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(status.position[axis])))
        ? { x: Number(status.position.x), y: Number(status.position.y), z: Number(status.position.z) } : null,
      dimension: String(status?.dimension || '').slice(0, 40),
      lastStateAt: status?.lastStateAt ? new Date(status.lastStateAt) : null,
      updatedAt: new Date(), source
    };
    const updated = await this.store.update(workerId, { status: safeStatus, lastHeartbeat: new Date(), enabled: true });

    // Only alert admin for host/process SYSTEM errors, NOT for in-game kicks or bans
    if (this.adminNotifier && updated && safeStatus.state === 'error') {
      const errText = safeStatus.lastError || '';
      const isGameEvent = /kick|banned|ban\b|ip_limited|quitting|lobby/i.test(errText) || /kick|banned|ban\b|ip_limited/i.test(safeStatus.lastKickReason || '');
      if (!isGameEvent && errText) {
        void this.adminNotifier.sendAlert({
          source: 'Worker System',
          event: 'worker_system_error',
          message: `Tiến trình Worker **${updated.name || workerId}** (#${updated.botNumber}) gặp lỗi hệ thống: ${errText}`,
          details: {
            workerId,
            botNumber: updated.botNumber,
            botName: updated.name,
            provider: updated.provider,
            error: errText,
            cpu: safeStatus.cpuPercent !== null ? `${safeStatus.cpuPercent}%` : '—',
            rssMb: safeStatus.rssMb !== null ? `${Math.round(safeStatus.rssMb)} MB` : '—'
          },
          level: 'error'
        });
      }
    }

    return updated;
  }

  async addEvent(workerId, event) {
    const safeEvent = {
      type: String(event?.type || 'worker_event').slice(0, 48),
      message: String(event?.message || event?.reason || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300),
      occurredAt: event?.occurredAt ? new Date(event.occurredAt) : new Date()
    };
    if (Number.isNaN(safeEvent.occurredAt.getTime())) safeEvent.occurredAt = new Date();
    await this.store.addEvent(workerId, safeEvent);

    // Only report true host system crashes, ignore in-game kicks/bans
    if (this.adminNotifier && ['crash', 'process_error', 'system_error'].includes(safeEvent.type)) {
      void this.adminNotifier.sendAlert({
        source: 'Worker System',
        event: `worker_${safeEvent.type}`,
        message: `Tiến trình Worker \`${workerId}\` gặp lỗi hệ thống: ${safeEvent.message}`,
        details: { workerId, eventType: safeEvent.type },
        level: 'error'
      });
    }

    return safeEvent;
  }

  publicView(record) {
    const { secretCiphertext, _id, ...safe } = record;
    const settings = record.settings || {};
    safe.settings = {
      afkMode: 'still',
      proxyEnabled: settings.proxyManaged ? Boolean(settings.proxyCiphertext) : Boolean(record.status?.proxyEnabled),
      credentialsConfigured: Boolean(settings.mcCredentialsCiphertext)
    };
    safe.reachable = Boolean(record.lastHeartbeat && Date.now() - new Date(record.lastHeartbeat).getTime() <= 120000);
    return safe;
  }

  async bootstrap(workerId) {
    const worker = await this.find(workerId);
    if (!worker || !worker.enabled) return null;
    const state = worker.status?.state || 'unknown';
    const restriction = worker.status?.restriction || (['ip_limited', 'banned'].includes(state) ? state : null);
    const settings = worker.settings || {};
    return {
      state, restriction, restricted: Boolean(restriction),
      settings: {
        afkMode: 'still',
        ...(settings.proxyManaged ? { proxyUrl: settings.proxyCiphertext ? decryptSecret(settings.proxyCiphertext, this.encryptionKey) : '' } : {})
      },
      credentials: settings.mcCredentialsCiphertext
        ? JSON.parse(decryptSecret(settings.mcCredentialsCiphertext, this.encryptionKey)) : null
    };
  }

  async privateSettings(workerId) {
    const worker = await this.find(workerId);
    if (!worker) return null;
    const settings = worker.settings || {};
    return {
      afkMode: 'still',
      afkManaged: settings.afkManaged === true,
      proxyUrl: settings.proxyCiphertext ? decryptSecret(settings.proxyCiphertext, this.encryptionKey) : '',
      proxyManaged: settings.proxyManaged === true,
      credentialsConfigured: Boolean(settings.mcCredentialsCiphertext),
      username: settings.mcCredentialsCiphertext
        ? JSON.parse(decryptSecret(settings.mcCredentialsCiphertext, this.encryptionKey)).username : ''
    };
  }

  async updateCredentials(workerId, { username, password }) {
    const worker = await this.find(workerId);
    if (!worker || !worker.enabled) throw new Error('Worker is not registered or is disabled.');
    const name = String(username || '').trim();
    const suppliedPassword = String(password ?? '');
    if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Minecraft username must contain 1–64 printable characters.');
    }
    if (suppliedPassword.length > 256 || /[\u0000-\u001f\u007f]/.test(suppliedPassword)) {
      throw new Error('Minecraft password is invalid or too long.');
    }
    const current = worker.settings || {};
    let passwordValue = suppliedPassword;
    if (!passwordValue && current.mcCredentialsCiphertext) {
      passwordValue = JSON.parse(decryptSecret(current.mcCredentialsCiphertext, this.encryptionKey)).password;
    }
    if (!passwordValue) throw new Error('Enter a Minecraft password before saving this account.');
    const mcCredentialsCiphertext = encryptSecret(JSON.stringify({ username: name, password: passwordValue }), this.encryptionKey);
    await this.store.patchSettings(worker.workerId, { mcCredentialsCiphertext });
    return { username: name, credentialsConfigured: true };
  }

  async updateSettings(workerId, patch = {}) {
    const worker = await this.find(workerId);
    if (!worker || !worker.enabled) throw new Error('Worker is not registered or is disabled.');
    const next = {};
    if (Object.hasOwn(patch, 'afkMode')) {
      next.afkMode = 'still';
      next.afkManaged = true;
    }
    if (Object.hasOwn(patch, 'afkManaged')) next.afkManaged = Boolean(patch.afkManaged);
    if (Object.hasOwn(patch, 'proxyUrl')) {
      const raw = String(patch.proxyUrl || '').trim();
      if (raw) {
        let url;
        try { url = new URL(raw); } catch { throw new Error('Proxy must be a valid SOCKS5 URL.'); }
        let port = Number(url.port);
        let username = '';
        let password = '';
        try { username = decodeURIComponent(url.username || ''); password = decodeURIComponent(url.password || ''); }
        catch { throw new Error('Proxy credentials are invalid.'); }
        if (url.protocol !== 'socks5:' || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535
          || (url.pathname && url.pathname !== '/') || url.search || url.hash
          || username.length > 255 || password.length > 255 || /[\u0000-\u001f\u007f]/.test(username + password)) {
          throw new Error('Proxy must use socks5://host:port with optional username and password.');
        }
        if (isLocalOrPrivateHost(url.hostname)) throw new Error('Proxy cannot target a local or private network address.');
        next.proxyCiphertext = encryptSecret(raw, this.encryptionKey);
      } else next.proxyCiphertext = null;
      next.proxyManaged = true;
    }
    if (Object.hasOwn(patch, 'proxyManaged')) next.proxyManaged = Boolean(patch.proxyManaged);
    const updated = await this.store.patchSettings(worker.workerId, next);
    return {
      afkMode: 'still',
      proxyEnabled: Boolean(updated.proxyCiphertext)
    };
  }

}

module.exports = { WorkerRegistry, ACTIONS };
