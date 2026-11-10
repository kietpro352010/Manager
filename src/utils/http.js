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

async function fetchWithRetry(url, options = {}, { maxRetries = 3, initialDelayMs = 400, maxDelayMs = 3000, timeoutMs = 15000, logger = console } = {}) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const controller = new AbortController();
    let timeoutId = null;
    try {
      let signal = options.signal;
      if (!signal) {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(`HTTP request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        timeoutId.unref?.();
        signal = controller.signal;
      }
      const res = await fetch(url, { ...options, signal });
      if (attempt < maxRetries && [408, 429, 500, 502, 503, 504].includes(res.status)) {
        const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[HTTP RETRY] HTTP ${res.status} khi gọi ${String(url).split('?')[0]}. Thử lại lần ${attempt}/${maxRetries} sau ${delay}ms...`);
        }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      const isAbort = err.name === 'AbortError' || err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message);
      const isConnError = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(err.message);
      if (attempt < maxRetries && (isAbort || isConnError)) {
        const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[HTTP RETRY] Lỗi mạng (${err.message}) khi gọi ${String(url).split('?')[0]}. Thử lại lần ${attempt}/${maxRetries} sau ${delay}ms...`);
        }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

function createGzipMiddleware({ minLength = 512, level = 5 } = {}) {
  return function gzipMiddleware(req, res, next) {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (!acceptEncoding.includes('gzip')) return next();

    const originalSend = res.send;
    res.send = function (body) {
      if (!body) return originalSend.call(this, body);
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
