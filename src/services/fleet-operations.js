'use strict';

const BOT_MAX_PARALLEL_REQUESTS = 8;

class FleetOperations {
  constructor({ registry, broker, renderApi, logger }) {
    this.registry = registry;
    this.broker = broker;
    this.renderApi = renderApi;
    this.logger = logger;
    this.running = false;
  }

  async runExclusive(operation) {
    if (this.running) throw new Error('Một tác vụ fleet khác đang chạy. Vui lòng thử lại sau vài giây.');
    this.running = true;
    try {
      return await operation();
    } finally {
      this.running = false;
    }
  }

  async runInParallel(items, handler, limit = BOT_MAX_PARALLEL_REQUESTS) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
      const chunk = items.slice(i, i + limit);
      const chunkResults = await Promise.all(chunk.map((item) => handler(item)));
      results.push(...chunkResults);
    }
    return results;
  }

  async stopAll() {
    return this.runExclusive(async () => {
      const workers = (await this.registry.list()).filter((w) => w.enabled);
      const results = await this.runInParallel(workers, async (worker) => {
        try {
          const result = await this.broker.dispatch(worker.workerId, 'stop');
          const detail = result.result?.detail || result.result || {};
          return {
            workerId: worker.workerId,
            ok: !result.timedOut && result.result?.ok !== false && detail.ok !== false,
            pending: Boolean(result.timedOut)
          };
        } catch (error) {
          this.logger.warn('fleet_stop_failed', { workerId: worker.workerId, error: error.message });
          return { workerId: worker.workerId, ok: false, error: error.message };
        }
      });
      return { total: workers.length, results };
    });
  }

  async startAll({ respectManuallyStopped = true } = {}) {
    return this.runExclusive(async () => {
      const workers = (await this.registry.list()).filter((w) => w.enabled);
      const eligible = workers.filter((w) => {
        if (!respectManuallyStopped) return true;
        return w.status?.manuallyStopped !== true;
      });

      const results = await this.runInParallel(eligible, async (worker) => {
        try {
          const result = await this.broker.dispatch(worker.workerId, 'start');
          const detail = result.result?.detail || result.result || {};
          return {
            workerId: worker.workerId,
            ok: !result.timedOut && result.result?.ok !== false && detail.ok !== false,
            pending: Boolean(result.timedOut)
          };
        } catch (error) {
          this.logger.warn('fleet_start_failed', { workerId: worker.workerId, error: error.message });
          return { workerId: worker.workerId, ok: false, error: error.message };
        }
      });
      return { total: eligible.length, skipped: workers.length - eligible.length, results };
    });
  }

  async reconnectErrors() {
    return this.runExclusive(async () => {
      const workers = (await this.registry.list()).filter(
        (worker) => worker.enabled && worker.reachable && worker.status?.state === 'error' && !worker.status?.restriction
      );

      const results = await this.runInParallel(workers, async (worker) => {
        try {
          const result = await this.broker.dispatch(worker.workerId, 'restart');
          const detail = result.result?.detail || result.result || {};
          return {
            workerId: worker.workerId,
            ok: !result.timedOut && result.result?.ok !== false && detail.ok !== false,
            pending: Boolean(result.timedOut)
          };
        } catch (error) {
          this.logger.warn('fleet_reconnect_error_failed', { workerId: worker.workerId, error: error.message });
          return { workerId: worker.workerId, ok: false, error: error.message };
        }
      });
      return { total: workers.length, results };
    });
  }

  async cleanDead() {
    return this.runExclusive(async () => {
      const workers = (await this.registry.list()).filter((w) => w.enabled && w.provider === 'render' && w.renderServiceId);
      const removed = [];
      const retained = [];
      for (const worker of workers) {
        try {
          await this.renderApi.getService(worker.renderServiceId);
          retained.push(worker.workerId);
        } catch (error) {
          if (Number(error.status) === 404) {
            await this.registry.remove(worker.workerId);
            removed.push(worker.workerId);
          } else {
            this.logger.warn('fleet_clean_dead_lookup_failed', { workerId: worker.workerId, status: Number(error.status) || null });
            retained.push(worker.workerId);
          }
        }
      }
      return { checked: workers.length, removed, retained };
    });
  }

  async stopWorker(workerId, reason) {
    return this.broker.dispatch(workerId, 'stop', { reason });
  }
}

module.exports = FleetOperations;
