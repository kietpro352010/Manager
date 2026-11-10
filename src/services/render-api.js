'use strict';

const { readJson } = require('../utils/http');

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
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(15000)
    });
    const body = await readJson(response);
    if (!response.ok) {
      const error = new Error(body.message || body.error || `Render API trả mã lỗi HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async listServices() {
    const body = await this.request('/services?limit=100');
    return (Array.isArray(body) ? body : []).map((entry) => entry.service || entry).map((service) => ({
      id: service.id,
      name: service.name,
      type: service.type,
      suspended: service.suspended,
      updatedAt: service.updatedAt,
      dashboardUrl: service.dashboardUrl,
      url: service.serviceDetails?.url || service.url || ''
    }));
  }

  async getService(serviceId) {
    const body = await this.request(`/services/${encodeURIComponent(serviceId)}`);
    const service = body.service || body;
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
    const body = await this.request(`/services/${encodeURIComponent(serviceId)}/deploys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clearCache })
    });
    const deploy = body.deploy || body;
    return { id: deploy.id, status: deploy.status, createdAt: deploy.createdAt };
  }

  async restartServer(serviceId) {
    return this.request(`/services/${encodeURIComponent(serviceId)}/restart`, {
      method: 'POST'
    });
  }

  async suspendService(serviceId) {
    return this.request(`/services/${encodeURIComponent(serviceId)}/suspend`, {
      method: 'POST'
    });
  }

  async resumeService(serviceId) {
    return this.request(`/services/${encodeURIComponent(serviceId)}/resume`, {
      method: 'POST'
    });
  }
}

module.exports = RenderApi;
