'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const DEFAULT_TTL_SEC = 180; // 3 minutes

function resolveCaptchaSecret(secret) {
  const s = String(secret || process.env.CAPTCHA_SECRET || process.env.MANAGER_SESSION_SECRET || '').trim();
  if (!s || s.length < 16) {
    throw new Error('CAPTCHA secret must be configured with at least 16 characters.');
  }
  return s;
}

// In-memory map for replay protection: nonce -> expiresAtMs (never clears active nonces)
const usedNonces = new Map();
const MAX_NONCES = 10000;

function pruneUsedNonces(store = usedNonces, now = Date.now()) {
  if (!(store instanceof Map)) return;
  for (const [nonce, exp] of store.entries()) {
    if (!Number.isFinite(exp) || exp <= now) {
      store.delete(nonce);
    }
  }
  while (store.size > MAX_NONCES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

// Periodic selective cleanup of expired nonces (every 5 minutes)
setInterval(() => {
  pruneUsedNonces(usedNonces, Date.now());
}, 5 * 60 * 1000).unref();

function timingSafeHexEquals(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a || '')).digest();
  const hashB = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(hashA, hashB) && String(a || '').length === String(b || '').length;
}

function isPrivateOrLoopbackIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (clean === '127.0.0.1' || clean === '::1') return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
  return false;
}

function resolveClientIp(req) {
  // 1. Cloudflare connecting IP is the highest fidelity when present behind Cloudflare
  const cfIp = req?.headers?.['cf-connecting-ip'];
  if (cfIp) {
    const clean = String(cfIp).replace(/^::ffff:/, '').trim();
    if (net.isIP(clean)) return clean;
  }

  // 2. X-Real-IP (standard reverse proxy)
  const realIp = req?.headers?.['x-real-ip'];
  if (realIp) {
    const clean = String(realIp).replace(/^::ffff:/, '').trim();
    if (net.isIP(clean)) return clean;
  }

  // 3. X-Forwarded-For (client is first in comma-separated chain)
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].replace(/^::ffff:/, '').trim();
    if (net.isIP(first)) return first;
  }

  // 4. Express req.ip
  if (req?.ip && typeof req.ip === 'string') {
    const clean = req.ip.replace(/^::ffff:/, '').trim();
    if (net.isIP(clean)) return clean;
  }

  // 5. Socket remoteAddress
  const socketIpRaw = req?.socket?.remoteAddress;
  if (typeof socketIpRaw === 'string') {
    const clean = socketIpRaw.replace(/^::ffff:/, '').trim();
    if (net.isIP(clean)) return clean;
  }

  return '127.0.0.1';
}

function createCaptchaToken(answer, secret, ttlSec = DEFAULT_TTL_SEC) {
  const activeSecret = resolveCaptchaSecret(secret);
  const ts = Date.now();
  const parsedTtl = Number(ttlSec);
  const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? Math.min(3600, parsedTtl) : DEFAULT_TTL_SEC;
  const nonce = crypto.randomBytes(8).toString('hex');
  const normalizedAnswer = String(answer).trim().toLowerCase();
  const sig = crypto.createHmac('sha256', activeSecret).update(`${normalizedAnswer}:${ts}:${ttl}:${nonce}`).digest('hex');
  const payload = JSON.stringify({ ts, ttl, nonce, sig });
  return Buffer.from(payload).toString('base64url');
}

function verifyCaptchaToken(token, answer, secret, nonceStore = usedNonces) {
  if (!token || typeof token !== 'string' || token.length > 2048) {
    return { valid: false, error: 'Token Captcha không được để trống hoặc không hợp lệ' };
  }
  if (!answer || typeof answer !== 'string' || answer.length > 64) {
    return { valid: false, error: 'Câu trả lời Captcha không được để trống hoặc không hợp lệ' };
  }
  const activeSecret = resolveCaptchaSecret(secret);
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const { ts, ttl, nonce, sig } = JSON.parse(raw);
    if (!ts || typeof ts !== 'number' || !Number.isFinite(ts) || !nonce || !sig) {
      return { valid: false, error: 'Token Captcha không hợp lệ' };
    }
    const effectiveTtlSec = (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 && ttl <= 3600)
      ? ttl
      : DEFAULT_TTL_SEC;
    const now = Date.now();
    if (ts > now + 60000 || now - ts > effectiveTtlSec * 1000) {
      return { valid: false, error: 'Mã Captcha đã hết hạn' };
    }
    if (nonceStore instanceof Map) {
      const prevExp = nonceStore.get(nonce);
      if (prevExp !== undefined && prevExp > now) {
        return { valid: false, error: 'Mã Captcha đã được sử dụng' };
      }
    } else if (nonceStore && typeof nonceStore.has === 'function' && nonceStore.has(nonce)) {
      return { valid: false, error: 'Mã Captcha đã được sử dụng' };
    }
    const normalizedAnswer = String(answer).trim().toLowerCase();
    const expectedPayload = ttl !== undefined
      ? `${normalizedAnswer}:${ts}:${ttl}:${nonce}`
      : `${normalizedAnswer}:${ts}:${nonce}`;
    const expectedSig = crypto.createHmac('sha256', activeSecret).update(expectedPayload).digest('hex');
    if (!timingSafeHexEquals(sig, expectedSig)) {
      return { valid: false, error: 'Mã Captcha không chính xác' };
    }
    if (nonceStore instanceof Map) {
      if (nonceStore.size >= MAX_NONCES) pruneUsedNonces(nonceStore, now);
      nonceStore.set(nonce, ts + effectiveTtlSec * 1000);
    } else if (nonceStore && typeof nonceStore.add === 'function') {
      nonceStore.add(nonce);
    }
    return { valid: true };
  } catch (err) {
    if (err.message && err.message.includes('CAPTCHA secret must be configured')) {
      throw err;
    }
    return { valid: false, error: 'Token Captcha không hợp lệ' };
  }
}

function generateCaptcha(secret, ttlSec = DEFAULT_TTL_SEC) {
  const activeSecret = resolveCaptchaSecret(secret);
  // Math challenge (using crypto.randomInt for unbiased challenge generation)
  const isPlus = crypto.randomInt(0, 100) < 65;
  let text = '';
  let answer = '';

  if (isPlus) {
    const n1 = crypto.randomInt(3, 18);
    const n2 = crypto.randomInt(2, 14);
    text = `${n1} + ${n2} = ?`;
    answer = String(n1 + n2);
  } else {
    const n1 = crypto.randomInt(8, 20);
    const n2 = crypto.randomInt(1, 8);
    text = `${n1} - ${n2} = ?`;
    answer = String(n1 - n2);
  }

  const token = createCaptchaToken(answer, activeSecret, ttlSec);

  // Generate lightweight SVG
  const width = 140;
  const height = 44;

  // Add random wave lines and dots for anti-OCR
  const lines = [];
  for (let i = 0; i < 3; i++) {
    const y1 = Math.floor(Math.random() * height);
    const y2 = Math.floor(Math.random() * height);
    const color = i % 2 === 0 ? 'rgba(56,189,248,0.35)' : 'rgba(167,139,250,0.35)';
    lines.push(`<line x1="0" y1="${y1}" x2="${width}" y2="${y2}" stroke="${color}" stroke-width="1.5" />`);
  }

  const dots = [];
  for (let d = 0; d < 18; d++) {
    const cx = Math.floor(Math.random() * width);
    const cy = Math.floor(Math.random() * height);
    const r = (Math.random() * 1.5 + 0.5).toFixed(1);
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(148,163,184,0.4)" />`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="6" fill="#0f172a" stroke="#334155" stroke-width="1"/>
    ${dots.join('')}
    ${lines.join('')}
    <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" font-family="'JetBrains Mono', Courier, monospace" font-size="20" font-weight="bold" fill="#38bdf8" letter-spacing="2">
      ${text}
    </text>
  </svg>`.replace(/\s+/g, ' ').trim();

  return {
    ok: true,
    token,
    svg,
    ttlSeconds: ttlSec
  };
}

module.exports = {
  resolveClientIp,
  createCaptchaToken,
  verifyCaptchaToken,
  generateCaptcha,
  DEFAULT_TTL_SEC
};
