'use strict';

const express = require('express');
const helmet = require('helmet');
const { createWorkerApi } = require('./routes/worker-api');

function createApp({ registry, broker, config, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.get(['/', '/health'], (_req, res) => res.json({ ok: true, service: 'kingmc-worker-manager', time: new Date().toISOString() }));
  app.use('/api/v1/workers/:workerId', createWorkerApi({ registry, broker, config }));
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));
  app.use((error, _req, res, _next) => {
    logger.error('http_request_failed', { name: error.name, message: error.message });
    res.status(500).json({ ok: false, error: 'internal_error' });
  });
  return app;
}

module.exports = { createApp };
