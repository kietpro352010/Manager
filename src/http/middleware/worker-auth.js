'use strict';

function createWorkerAuth(registry) {
  return async function workerAuth(req, res, next) {
    try {
      const accepted = await registry.authenticate(req.params.workerId, req.get('x-worker-secret'));
      if (!accepted) return res.status(401).json({ ok: false, error: 'unauthorized' });
      req.workerId = String(req.params.workerId).toLowerCase();
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { createWorkerAuth };
