'use strict';

const express = require('express');
const helmet = require('helmet');
const { createWorkerApi } = require('./routes/worker-api');

function createApp({ registry, broker, config, logger, link4m }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.get(['/', '/health'], (_req, res) => res.json({ ok: true, service: 'kingmc-worker-manager', time: new Date().toISOString() }));
  app.get('/api/rewards/link4m/return', async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    try {
      const result = await link4m.completeReturn(String(req.query.attempt || req.query.attempt_id || ''), String(req.query.token || ''));
      if (result.processing) return res.status(202).type('text/plain').send('Reward is processing. Check /code status in Discord shortly.');
      const prefix = result.replayed ? 'This Link4M attempt was already credited.' : `Reward credited: ${result.rewardHours} hour(s).`;
      return res.type('text/plain').send(`${prefix} Return to Discord and use /code status.`);
    } catch (error) {
      logger.warn('link4m_return_rejected', { name: error.name || 'Error' });
      return res.status(400).type('text/plain').send('Link4M attempt could not be verified. Return to Discord and check /code status.');
    }
  });
  app.all('/api/rewards/link4m/webhook', async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    try {
      const result = await link4m.completeWebhook(req);
      return res.json({ ok: true, replayed: Boolean(result.replayed), rewarded: !result.replayed, processing: Boolean(result.processing), rewardHours: result.rewardHours || null });
    } catch (error) {
      logger.warn('link4m_webhook_rejected', { name: error.name || 'Error' });
      return res.status(403).json({ ok: false, error: 'webhook_rejected' });
    }
  });
  app.use('/api/v1/workers/:workerId', createWorkerApi({ registry, broker, config }));
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));
  app.use((error, _req, res, _next) => {
    logger.error('http_request_failed', { name: error.name, message: error.message });
    res.status(500).json({ ok: false, error: 'internal_error' });
  });
  return app;
}

module.exports = { createApp };
