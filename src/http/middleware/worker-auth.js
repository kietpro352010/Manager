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
      const secret = extractWorkerSecret(req);
      if (!secret) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const accepted = await registry.authenticate(req.params.workerId, secret);
      if (!accepted) return res.status(401).json({ ok: false, error: 'unauthorized' });
      req.workerId = String(req.params.workerId).toLowerCase();
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { createWorkerAuth, extractWorkerSecret };
