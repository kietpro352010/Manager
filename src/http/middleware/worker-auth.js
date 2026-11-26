'use strict';

function extractWorkerSecret(req) {
  if (!req || typeof req.get !== 'function') return '';
  const headerSecret = req.get('x-worker-secret') || req.get('x-bot-secret');
  if (headerSecret && typeof headerSecret === 'string') {
    const trimmed = headerSecret.trim();
    if (trimmed) return trimmed;
  }
  const authHeader = req.get('authorization');
  if (authHeader && typeof authHeader === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return '';
}

function createWorkerAuth(registry) {
  return async function workerAuth(req, res, next) {
    try {
      const rawWorkerId = String(req.params?.workerId || req.get?.('x-manager-bot-id') || '').trim();
      if (!rawWorkerId) return res.status(400).json({ ok: false, error: 'missing_worker_id' });
      const secret = extractWorkerSecret(req);
      const accepted = await registry.authenticate(rawWorkerId, secret);
      if (!accepted) return res.status(401).json({ ok: false, error: 'unauthorized' });
      req.workerId = rawWorkerId.toLowerCase();
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { createWorkerAuth, extractWorkerSecret };
