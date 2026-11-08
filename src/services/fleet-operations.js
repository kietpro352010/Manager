'use strict';

class FleetOperations {
  constructor({ registry, broker, renderApi, logger }) {
    this.registry = registry;
    this.broker = broker;
    this.renderApi = renderApi;
    this.logger = logger;
    this.running = false;
  }

  async runExclusive(operation) {
    if (this.running) throw new Error('A fleet operation is already running. Try again shortly.');
    this.running = true;
    try { return await operation(); }
    finally { this.running = false; }
  }

  async stopAll() {
    return this.runExclusive(async () => {
      const workers = (await this.registry.list()).filter((worker) => worker.enabled);
      const results = [];
      for (const worker of workers) {
        try {
          const result = await this.broker.dispatch(worker.workerId, 'stop');
          const detail = result.result?.detail || result.result || {};
          results.push({ workerId: worker.workerId, ok: !result.timedOut && result.result?.ok !== false && detail.ok !== false, pending: Boolean(result.timedOut) });
        } catch (error) {
          this.logger.warn('fleet_stop_failed', { workerId: worker.workerId, name: error.name || 'Error' });
          results.push({ workerId: worker.workerId, ok: false, error: error.message });
        }
      }
      return { total: workers.length, results };
    });
  }

  async reconnectErrors() {
    return this.runExclusive(async () => {
      const workers = (await this.registry.list()).filter((worker) => worker.enabled
        && worker.reachable && worker.status?.state === 'error' && !worker.status?.restriction);
      const results = [];
      for (const worker of workers) {
        try {
          const result = await this.broker.dispatch(worker.workerId, 'restart');
          const detail = result.result?.detail || result.result || {};
          results.push({ workerId: worker.workerId, ok: !result.timedOut && result.result?.ok !== false && detail.ok !== false, pending: Boolean(result.timedOut) });
        } catch (error) {
          this.logger.warn('fleet_reconnect_error_failed', { workerId: worker.workerId, name: error.name || 'Error' });
          results.push({ workerId: worker.workerId, ok: false, error: error.message });
        }
      }
      return { total: workers.length, results };
    });
  }

  async cleanDead() {
    return this.runExclusive(async () => {
      const workers = (await this.registry.list()).filter((worker) => worker.enabled && worker.provider === 'render' && worker.renderServiceId);
      const removed = [];
      const retained = [];
      for (const worker of workers) {
        try {
          await this.renderApi.getService(worker.renderServiceId);
          retained.push(worker.workerId);
        } catch (error) {
          if (Number(error.status) === 404) {
            this.broker.cancelWorker(worker.workerId);
            await this.registry.remove(worker.workerId);
            removed.push(worker.workerId);
          } else {
            this.logger.warn('fleet_clean_dead_lookup_failed', { workerId: worker.workerId, status: Number(error.status) || null, name: error.name || 'Error' });
            retained.push(worker.workerId);
          }
        }
      }
      return { checked: workers.length, removed, retained };
    });
  }
}

module.exports = FleetOperations;
