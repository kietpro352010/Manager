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

// In-memory set for replay protection
const usedNonces = new Set();
// Periodic cleanup of old nonces (every 5 minutes)
setInterval(() => {
  if (usedNonces.size > 10000) {
    usedNonces.clear();
  }
}, 5 * 60 * 1000).unref();

function isPrivateOrLoopbackIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (clean === '127.0.0.1' || clean === '::1') return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
  return false;
}

function resolveClientIp(req) {
  if (req?.ip && typeof req.ip === 'string') {
    const clean = req.ip.replace(/^::ffff:/, '').trim();
    if (net.isIP(clean)) return clean;
  }
  const socketIpRaw = req?.socket?.remoteAddress;
  const socketIp = typeof socketIpRaw === 'string' ? socketIpRaw.replace(/^::ffff:/, '').trim() : '';
  const isTrustedProxy = isPrivateOrLoopbackIp(socketIp);

  if (isTrustedProxy) {
    const rawHeader = req?.headers?.['cf-connecting-ip'] ||
      req?.headers?.['x-real-ip'] ||
      (req?.headers?.['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : '');
    if (rawHeader) {
      const cleanHeaderIp = String(rawHeader).replace(/^::ffff:/, '').trim();
      if (net.isIP(cleanHeaderIp)) return cleanHeaderIp;
    }
  }

  if (socketIp && net.isIP(socketIp)) return socketIp;
  return '127.0.0.1';
}

function createCaptchaToken(answer, secret, ttlSec = DEFAULT_TTL_SEC) {
  const activeSecret = resolveCaptchaSecret(secret);
  const ts = Date.now();
  const nonce = crypto.randomBytes(8).toString('hex');
  const normalizedAnswer = String(answer).trim().toLowerCase();
  const sig = crypto.createHmac('sha256', activeSecret).update(`${normalizedAnswer}:${ts}:${nonce}`).digest('hex');
  const payload = JSON.stringify({ ts, nonce, sig });
  return Buffer.from(payload).toString('base64url');
}

function verifyCaptchaToken(token, answer, secret, nonceSet = usedNonces) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token Captcha không được để trống' };
  }
  if (!answer || typeof answer !== 'string') {
    return { valid: false, error: 'Câu trả lời Captcha không được để trống' };
  }
  const activeSecret = resolveCaptchaSecret(secret);
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const { ts, nonce, sig } = JSON.parse(raw);
    if (!ts || !nonce || !sig) {
      return { valid: false, error: 'Token Captcha không hợp lệ' };
    }
    if (Date.now() - ts > DEFAULT_TTL_SEC * 1000) {
      return { valid: false, error: 'Mã Captcha đã hết hạn' };
    }
    if (nonceSet.has(nonce)) {
      return { valid: false, error: 'Mã Captcha đã được sử dụng' };
    }
    const normalizedAnswer = String(answer).trim().toLowerCase();
    const expectedSig = crypto.createHmac('sha256', activeSecret).update(`${normalizedAnswer}:${ts}:${nonce}`).digest('hex');
    if (sig !== expectedSig) {
      return { valid: false, error: 'Mã Captcha không chính xác' };
    }
    nonceSet.add(nonce);
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
  // Math challenge
  const isPlus = Math.random() < 0.65;
  let text = '';
  let answer = '';

  if (isPlus) {
    const n1 = Math.floor(Math.random() * 15) + 3;
    const n2 = Math.floor(Math.random() * 12) + 2;
    text = `${n1} + ${n2} = ?`;
    answer = String(n1 + n2);
  } else {
    const n1 = Math.floor(Math.random() * 12) + 8;
    const n2 = Math.floor(Math.random() * 7) + 1;
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
