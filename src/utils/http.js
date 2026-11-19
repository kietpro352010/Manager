'use strict';

const zlib = require('node:zlib');

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Remote server returned invalid JSON (${response.status}).`);
  }
}

function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || Object.assign(new Error('HTTP request aborted'), { name: 'AbortError' }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || Object.assign(new Error('HTTP request aborted'), { name: 'AbortError' }));
    };
    const timer = setTimeout(() => {
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    timer.unref?.();
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function fetchWithRetry(url, options = {}, { maxRetries = 3, initialDelayMs = 400, maxDelayMs = 3000, timeoutMs = 15000, logger = console } = {}) {
  const attemptsLimit = Math.max(1, Number(maxRetries) || 1);
  let attempt = 0;
  while (attempt < attemptsLimit) {
    if (options.signal?.aborted) {
      throw options.signal.reason || Object.assign(new Error('HTTP request aborted'), { name: 'AbortError' });
    }
    attempt++;
    const controller = new AbortController();
    let timeoutId = null;
    let onCallerAbort = null;
    try {
      let signal;
      const timeoutSignal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : null;
      if (options.signal && timeoutSignal && typeof AbortSignal.any === 'function') {
        signal = AbortSignal.any([options.signal, timeoutSignal]);
      } else if (options.signal) {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(`HTTP request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        timeoutId.unref?.();
        onCallerAbort = () => controller.abort(options.signal.reason || new Error('HTTP request aborted'));
        options.signal.addEventListener('abort', onCallerAbort, { once: true });
        signal = controller.signal;
      } else if (timeoutSignal) {
        signal = timeoutSignal;
      } else {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(`HTTP request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        timeoutId.unref?.();
        signal = controller.signal;
      }
      const res = await fetch(url, { ...options, signal });
      if (attempt < attemptsLimit && [408, 429, 500, 502, 503, 504].includes(res.status)) {
        if (options.signal?.aborted) return res;
        let delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
        if (res.status === 429) {
          const retryAfter = Number(res.headers?.get?.('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            delay = Math.min(maxDelayMs, Math.max(delay, Math.round(retryAfter * 1000)));
          }
        }
        await res.body?.cancel?.().catch(() => {});
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[HTTP RETRY] HTTP ${res.status} khi gọi ${String(url).split('?')[0]}. Thử lại lần ${attempt}/${attemptsLimit} sau ${delay}ms...`);
        }
        await sleepAbortable(delay, options.signal);
        continue;
      }
      return res;
    } catch (err) {
      if (options.signal?.aborted) {
        throw err;
      }
      const isAbort = err.name === 'AbortError' || err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message);
      const isConnError = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(err.message);
      if (attempt < attemptsLimit && (isAbort || isConnError)) {
        const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[HTTP RETRY] Lỗi mạng (${err.message}) khi gọi ${String(url).split('?')[0]}. Thử lại lần ${attempt}/${attemptsLimit} sau ${delay}ms...`);
        }
        await sleepAbortable(delay, options.signal);
        continue;
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (onCallerAbort && options.signal && typeof options.signal.removeEventListener === 'function') {
        options.signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }
}

function createGzipMiddleware({ minLength = 512, level = 5 } = {}) {
  return function gzipMiddleware(req, res, next) {
    const acceptEncoding = String(req.headers['accept-encoding'] || '').toLowerCase();
    if (!acceptEncoding.includes('gzip')) return next();

    const originalSend = res.send;
    res.send = function (body) {
      if (!body || res.headersSent || req.method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304) {
        return originalSend.call(this, body);
      }
      if (res.getHeader('Content-Encoding')) {
        return originalSend.call(this, body);
      }
      const ct = String(res.getHeader('Content-Type') || '').toLowerCase();
      if (ct && /^(?:image\/(?!svg\+xml)|video\/|audio\/|font\/|application\/(?:octet-stream|zip|gzip|pdf))/i.test(ct)) {
        return originalSend.call(this, body);
      }
      let buffer;
      if (Buffer.isBuffer(body)) {
        buffer = body;
      } else if (typeof body === 'string') {
        buffer = Buffer.from(body, 'utf8');
      } else if (typeof body === 'object') {
        try {
          buffer = Buffer.from(JSON.stringify(body), 'utf8');
          if (!res.getHeader('Content-Type')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
        } catch (_) {
          return originalSend.call(this, body);
        }
      } else {
        return originalSend.call(this, body);
      }

      if (typeof res.vary === 'function') res.vary('Accept-Encoding');
      else if (!String(res.getHeader('Vary') || '').toLowerCase().includes('accept-encoding')) {
        const curVary = res.getHeader('Vary');
        res.setHeader('Vary', curVary ? `${curVary}, Accept-Encoding` : 'Accept-Encoding');
      }

      if (buffer.length >= minLength) {
        try {
          const gzipped = zlib.gzipSync(buffer, { level });
          res.setHeader('Content-Encoding', 'gzip');
          res.removeHeader('Content-Length');
          return originalSend.call(this, gzipped);
        } catch (_) {
          return originalSend.call(this, buffer);
        }
      }
      return originalSend.call(this, buffer);
    };
    next();
  };
}

module.exports = {
  readJson,
  fetchWithRetry,
  createGzipMiddleware
};
