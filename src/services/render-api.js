'use strict';

const { readJson } = require('../utils/http');

function assertValidServiceId(serviceId) {
  const clean = String(serviceId || '').trim();
  if (!clean || clean.includes('..') || !/^[a-zA-Z0-9_-]{1,128}$/.test(clean)) {
    throw new Error('Render serviceId không hợp lệ.');
  }
  return clean;
}

class RenderApi {
  constructor({ apiKey, baseUrl = 'https://api.render.com/v1', fetchImpl = global.fetch }) {
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl || 'https://api.render.com/v1').replace(/\/+$/, '');
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  async request(path, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Chưa cấu hình Render API Key.');
    }
    const cleanPath = String(path || '');
    if (!cleanPath.startsWith('/') || cleanPath.includes('..')) {
      throw new Error('Đường dẫn Render API không hợp lệ.');
    }

    const timeoutSignal = AbortSignal.timeout(15000);
    const combinedSignal = options.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([options.signal, timeoutSignal])
      : (options.signal || timeoutSignal);

    const response = await this.fetch(`${this.baseUrl}${cleanPath}`, {
      ...options,
      redirect: options.redirect || 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        ...(options.headers || {})
      },
      signal: combinedSignal
    });

    let body = null;
    try {
      body = await readJson(response);
    } catch (parseErr) {
      if (!response.ok) {
        const error = new Error(`Render API trả mã lỗi HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      throw parseErr;
    }

    if (!response.ok) {
      const msg = (body && typeof body === 'object') ? (body.message || body.error) : '';
      const error = new Error(msg || `Render API trả mã lỗi HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async listServices() {
    const services = [];
    const seenIds = new Set();
    const seenCursors = new Set();
    let cursor = '';
    const maxPages = 20;

    for (let page = 0; page < maxPages; page++) {
      const query = cursor ? `/services?limit=100&cursor=${encodeURIComponent(cursor)}` : '/services?limit=100';
      const body = await this.request(query);
      const entries = Array.isArray(body) ? body : [];
      if (entries.length === 0) break;

      for (const entry of entries) {
        const service = entry?.service || entry;
        if (!service || !service.id || seenIds.has(service.id)) continue;
        seenIds.add(service.id);
        services.push({
          id: service.id,
          name: service.name,
          type: service.type,
          suspended: service.suspended,
          updatedAt: service.updatedAt,
          dashboardUrl: service.dashboardUrl,
          url: service.serviceDetails?.url || service.url || ''
        });
      }

      const lastEntry = entries[entries.length - 1];
      const nextCursor = typeof lastEntry?.cursor === 'string' ? lastEntry.cursor.trim() : '';
      if (!nextCursor || entries.length < 100 || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return services;
  }

  async getService(serviceId) {
    const cleanId = assertValidServiceId(serviceId);
    const body = await this.request(`/services/${encodeURIComponent(cleanId)}`);
    const service = body?.service || body;
    return {
      id: service.id,
      name: service.name,
      type: service.type,
      suspended: service.suspended,
      updatedAt: service.updatedAt,
      dashboardUrl: service.dashboardUrl,
      url: service.serviceDetails?.url || service.url || ''
    };
  }

  async deploy(serviceId, { clearCache = 'do_not_clear' } = {}) {
    const cleanId = assertValidServiceId(serviceId);
    const body = await this.request(`/services/${encodeURIComponent(cleanId)}/deploys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clearCache })
    });
    const deploy = body?.deploy || body;
    return { id: deploy.id, status: deploy.status, createdAt: deploy.createdAt };
  }

  async restartServer(serviceId) {
    const cleanId = assertValidServiceId(serviceId);
    return this.request(`/services/${encodeURIComponent(cleanId)}/restart`, {
      method: 'POST'
    });
  }

  async suspendService(serviceId) {
    const cleanId = assertValidServiceId(serviceId);
    return this.request(`/services/${encodeURIComponent(cleanId)}/suspend`, {
      method: 'POST'
    });
  }

  async resumeService(serviceId) {
    const cleanId = assertValidServiceId(serviceId);
    return this.request(`/services/${encodeURIComponent(cleanId)}/resume`, {
      method: 'POST'
    });
  }
}

module.exports = RenderApi;
