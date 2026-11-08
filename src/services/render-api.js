'use strict';

const { readJson } = require('../utils/http');

class RenderApi {
  constructor({ apiKey, baseUrl, fetchImpl = global.fetch }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    if (!this.apiKey) throw new Error('Render API key is not configured. Use /setup → Integration secrets.');
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}`, ...(options.headers || {}) },
      signal: AbortSignal.timeout(15000)
    });
    const body = await readJson(response);
    if (!response.ok) {
      const error = new Error(body.message || body.error || `Render API returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async listServices() {
    const body = await this.request('/services?limit=100');
    return (Array.isArray(body) ? body : []).map((entry) => entry.service || entry).map((service) => ({
      id: service.id, name: service.name, type: service.type, suspended: service.suspended,
      updatedAt: service.updatedAt, dashboardUrl: service.dashboardUrl
    }));
  }

  async getService(serviceId) {
    const body = await this.request(`/services/${encodeURIComponent(serviceId)}`);
    const service = body.service || body;
    return { id: service.id, name: service.name, type: service.type, suspended: service.suspended, updatedAt: service.updatedAt, dashboardUrl: service.dashboardUrl, url: service.serviceDetails?.url || service.url || '' };
  }

  async deploy(serviceId) {
    const body = await this.request(`/services/${encodeURIComponent(serviceId)}/deploys`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clearCache: 'do_not_clear' })
    });
    const deploy = body.deploy || body;
    return { id: deploy.id, status: deploy.status, createdAt: deploy.createdAt };
  }
}

module.exports = RenderApi;
