'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const DEFAULT_TTL_SEC = 180; // 3 minutes
const MAX_NONCES = 10000;

// Official Cloudflare IPv4 & IPv6 edge ranges
const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22'
];

const CLOUDFLARE_IPV6_CIDRS = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32'
];

function parseIpv4ToUint32(ip) {
  if (net.isIPv4(ip) !== true) return null;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function parseIpv6ToBigInt(rawIp) {
  let ip = String(rawIp || '').trim().toLowerCase();
  if (!ip || ip.includes('%') || net.isIPv6(ip) !== true) return null;

  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4ToUint32(tail);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (parts.length === 1 && left.length !== 8) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;
  const groups = parts.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function parseCidr(entry) {
  const trimmed = String(entry || '').trim();
  if (!trimmed) return null;
  const slashIdx = trimmed.indexOf('/');
  const ipPart = slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx).trim();
  const prefixPart = slashIdx === -1 ? null : trimmed.slice(slashIdx + 1).trim();

  const v4 = parseIpv4ToUint32(ipPart);
  if (v4 !== null) {
    const prefix = prefixPart === null ? 32 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    return { family: 4, network: (v4 & mask) >>> 0, mask };
  }

  const v6 = parseIpv6ToBigInt(ipPart);
  if (v6 !== null) {
    const prefix = prefixPart === null ? 128 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    const fullMask = (1n << 128n) - 1n;
    const mask = prefix === 0 ? 0n : ((fullMask << BigInt(128 - prefix)) & fullMask);
    return { family: 6, network: v6 & mask, mask };
  }
  return null;
}

const PARSED_CLOUDFLARE_V4 = CLOUDFLARE_IPV4_CIDRS.map(parseCidr).filter(Boolean);
const PARSED_CLOUDFLARE_V6 = CLOUDFLARE_IPV6_CIDRS.map(parseCidr).filter(Boolean);

let cachedTrustedEnvRaw = null;
let cachedTrustedEnvCidrs = { v4: [], v6: [] };

function getExplicitTrustedProxyCidrs() {
  const raw = String(process.env.TRUSTED_PROXY_IPS || '').trim();
  if (raw === cachedTrustedEnvRaw) return cachedTrustedEnvCidrs;
  const v4 = [];
  const v6 = [];
  for (const token of raw.split(',')) {
    const parsed = parseCidr(token);
    if (!parsed) continue;
    if (parsed.family === 4) v4.push(parsed);
    else v6.push(parsed);
  }
  cachedTrustedEnvRaw = raw;
  cachedTrustedEnvCidrs = { v4, v6 };
  return cachedTrustedEnvCidrs;
}

function cleanIpToken(raw) {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string') return '';
  let s = candidate.trim();
  if (!s) return '';
  s = s.replace(/^::ffff:/i, '');
  if (net.isIPv4(s)) return s;
  if (net.isIPv6(s)) {
    const v6 = parseIpv6ToBigInt(s);
    if (v6 !== null && (v6 >> 32n) === 0xffffn) {
      const n = Number(v6 & 0xffffffffn);
      return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
    }
    return s.toLowerCase();
  }
  return '';
}

function matchCidrs(ip, v4Cidrs, v6Cidrs) {
  const clean = cleanIpToken(ip);
  if (!clean) return false;
  const v4 = parseIpv4ToUint32(clean);
  if (v4 !== null) {
    return v4Cidrs.some((c) => ((v4 & c.mask) >>> 0) === c.network);
  }
  const v6 = parseIpv6ToBigInt(clean);
  if (v6 !== null) {
    return v6Cidrs.some((c) => (v6 & c.mask) === c.network);
  }
  return false;
}

function isCloudflareIp(ip) {
  return matchCidrs(ip, PARSED_CLOUDFLARE_V4, PARSED_CLOUDFLARE_V6);
}

function isExplicitTrustedProxyIp(ip) {
  const { v4, v6 } = getExplicitTrustedProxyCidrs();
  if (v4.length === 0 && v6.length === 0) return false;
  return matchCidrs(ip, v4, v6);
}

function isPrivateOrLoopbackIp(ip) {
  const clean = cleanIpToken(ip);
  if (!clean) return false;

  const v4 = parseIpv4ToUint32(clean);
  if (v4 !== null) {
    const b0 = (v4 >>> 24) & 0xff;
    const b1 = (v4 >>> 16) & 0xff;
    if (b0 === 0 || b0 === 10 || b0 === 127) return true;
    if (b0 === 169 && b1 === 254) return true;
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    if (b0 === 192 && b1 === 168) return true;
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // Carrier-grade NAT 100.64.0.0/10
    return false;
  }

  const v6 = parseIpv6ToBigInt(clean);
  if (v6 !== null) {
    if (v6 === 0n || v6 === 1n) return true; // :: or ::1
    const top16 = Number((v6 >> 112n) & 0xffffn);
    if ((top16 & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
    if ((top16 & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
    if ((top16 & 0xffc0) === 0xfec0) return true; // Site-local fec0::/10
    return false;
  }
  return false;
}

function isTrustedProxyIp(ip) {
  return isPrivateOrLoopbackIp(ip) || isCloudflareIp(ip) || isExplicitTrustedProxyIp(ip);
}

function isTrustedProxyRequest(req) {
  const socketIp = cleanIpToken(req?.socket?.remoteAddress || req?.connection?.remoteAddress);
  return Boolean(socketIp && isTrustedProxyIp(socketIp));
}

function resolveClientIp(req) {
  const socketIp = cleanIpToken(req?.socket?.remoteAddress || req?.connection?.remoteAddress);

  // Never trust proxy headers when socket peer IP is missing (mock/unknown transport)
  if (!socketIp) {
    const reqIp = cleanIpToken(req?.ip);
    return reqIp || '0.0.0.0';
  }

  // Untrusted direct peer: ignore all forwarded headers to prevent IP spoofing
  if (!isTrustedProxyIp(socketIp)) {
    return socketIp;
  }

  const headers = req?.headers || {};
  const cfIp = cleanIpToken(headers['cf-connecting-ip']);
  const realIp = cleanIpToken(headers['x-real-ip']);
  const rawXff = Array.isArray(headers['x-forwarded-for'])
    ? headers['x-forwarded-for'].join(',')
    : (typeof headers['x-forwarded-for'] === 'string' ? headers['x-forwarded-for'] : '');

  if (rawXff.trim()) {
    const rawParts = rawXff.split(',').map((s) => s.trim()).filter(Boolean);
    const xffHops = [];
    let sawInvalidFromRight = false;
    for (let i = rawParts.length - 1; i >= 0; i--) {
      const cleaned = cleanIpToken(rawParts[i]);
      if (!cleaned) {
        sawInvalidFromRight = true;
        break;
      }
      xffHops.unshift(cleaned);
    }

    if (xffHops.length > 0) {
      let sawCloudflare = isCloudflareIp(socketIp);
      for (let i = xffHops.length - 1; i >= 0; i--) {
        const hop = xffHops[i];
        if (isCloudflareIp(hop)) {
          sawCloudflare = true;
          continue;
        }
        if (isPrivateOrLoopbackIp(hop) || isExplicitTrustedProxyIp(hop)) {
          continue;
        }
        // Found the rightmost untrusted client hop
        if (sawCloudflare && cfIp && !isPrivateOrLoopbackIp(cfIp)) {
          return cfIp;
        }
        return hop;
      }

      // Every hop from the right was a trusted proxy / private IP
      if (!sawInvalidFromRight) {
        if (sawCloudflare && cfIp) return cfIp;
        if (realIp) return realIp;
        return xffHops[0];
      }
    }
  } else {
    // Trusted proxy without X-Forwarded-For (e.g., local nginx/tunnel forwarding CF-Connecting-IP or X-Real-IP)
    if (cfIp) return cfIp;
    if (realIp) return realIp;
  }

  const reqIp = cleanIpToken(req?.ip);
  if (reqIp && !isTrustedProxyIp(reqIp)) return reqIp;
  return socketIp;
}

function resolveCaptchaSecret(secret) {
  const explicit = String(secret || '').trim();
  if (explicit) {
    if (explicit.length < 16) {
      throw new Error('CAPTCHA secret must be configured with at least 16 characters.');
    }
    return explicit;
  }
  const envCaptcha = String(process.env.CAPTCHA_SECRET || '').trim();
  if (envCaptcha) {
    if (envCaptcha.length < 16) {
      throw new Error('CAPTCHA secret must be configured with at least 16 characters.');
    }
    return envCaptcha;
  }
  const envSession = String(process.env.MANAGER_SESSION_SECRET || '').trim();
  if (envSession.length >= 16) {
    return crypto.createHash('sha256').update(`${envSession}:kbot_captcha_v1`).digest('hex');
  }
  throw new Error('CAPTCHA secret must be configured with at least 16 characters.');
}

// In-memory replay protection: nonce -> { exp, ts } (plus FIFO eviction issued-at watermark)
const usedNonces = new Map();
const evictedWatermarkByStore = new WeakMap();

function extractEntryExp(entry) {
  if (typeof entry === 'number') return entry;
  if (entry && typeof entry === 'object' && Number.isFinite(entry.exp)) return entry.exp;
  return 0;
}

function extractEntryTs(entry) {
  if (entry && typeof entry === 'object' && Number.isFinite(entry.ts)) return entry.ts;
  return 0;
}

function pruneUsedNonces(store = usedNonces, now = Date.now()) {
  if (!(store instanceof Map)) return;
  for (const [nonce, entry] of store.entries()) {
    const exp = extractEntryExp(entry);
    if (!Number.isFinite(exp) || exp <= now) {
      store.delete(nonce);
    }
  }
  while (store.size > MAX_NONCES) {
    const first = store.entries().next();
    if (first.done) break;
    const [oldestNonce, oldestEntry] = first.value;
    const exp = extractEntryExp(oldestEntry);
    const ts = extractEntryTs(oldestEntry);
    if (exp > now && ts > 0) {
      const prev = evictedWatermarkByStore.get(store) || 0;
      if (ts > prev) evictedWatermarkByStore.set(store, ts);
    }
    store.delete(oldestNonce);
  }
}

setInterval(() => {
  pruneUsedNonces(usedNonces, Date.now());
}, 5 * 60 * 1000).unref();

function timingSafeHexEquals(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  const hashA = crypto.createHash('sha256').update(strA).digest();
  const hashB = crypto.createHash('sha256').update(strB).digest();
  return crypto.timingSafeEqual(hashA, hashB) && strA.length === strB.length;
}

function createCaptchaToken(answer, secret, ttlSec = DEFAULT_TTL_SEC) {
  const activeSecret = resolveCaptchaSecret(secret);
  const ts = Date.now();
  const parsedTtl = Number(ttlSec);
  const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? Math.min(3600, parsedTtl) : DEFAULT_TTL_SEC;
  const nonce = crypto.randomBytes(16).toString('hex');
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
    if (
      typeof ts !== 'number' || !Number.isFinite(ts) ||
      typeof nonce !== 'string' || !/^[a-f0-9]{16,64}$/i.test(nonce) ||
      typeof sig !== 'string' || !/^[a-f0-9]{64}$/i.test(sig)
    ) {
      return { valid: false, error: 'Token Captcha không hợp lệ' };
    }
    if (ttl !== undefined && (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0 || ttl > 3600)) {
      return { valid: false, error: 'Token Captcha không hợp lệ' };
    }
    const effectiveTtlSec = ttl !== undefined ? ttl : DEFAULT_TTL_SEC;
    const now = Date.now();
    if (ts > now + 10000 || now - ts > effectiveTtlSec * 1000) {
      return { valid: false, error: 'Mã Captcha đã hết hạn' };
    }
    if (nonceStore instanceof Map) {
      const watermark = evictedWatermarkByStore.get(nonceStore) || 0;
      if (watermark > 0 && ts <= watermark) {
        return { valid: false, error: 'Mã Captcha đã hết hạn hoặc bị thu hồi' };
      }
      const prevEntry = nonceStore.get(nonce);
      const prevExp = extractEntryExp(prevEntry);
      if (prevEntry !== undefined && prevExp > now) {
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
      if (nonceStore.size >= MAX_NONCES) {
        pruneUsedNonces(nonceStore, now);
        while (nonceStore.size >= MAX_NONCES) {
          const first = nonceStore.entries().next();
          if (first.done) break;
          const [oldestNonce, oldestEntry] = first.value;
          const oldestExp = extractEntryExp(oldestEntry);
          const oldestTs = extractEntryTs(oldestEntry);
          if (oldestExp > now && oldestTs > 0) {
            const prev = evictedWatermarkByStore.get(nonceStore) || 0;
            if (oldestTs > prev) evictedWatermarkByStore.set(nonceStore, oldestTs);
          }
          nonceStore.delete(oldestNonce);
        }
      }
      nonceStore.set(nonce, { exp: ts + effectiveTtlSec * 1000, ts });
    } else if (nonceStore && typeof nonceStore.add === 'function') {
      if (nonceStore.size >= MAX_NONCES) {
        const oldest = nonceStore.values().next().value;
        if (oldest !== undefined) nonceStore.delete(oldest);
      }
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

  const width = 148;
  const height = 46;

  const lines = [];
  for (let i = 0; i < 4; i++) {
    const y1 = crypto.randomInt(4, height - 4);
    const cy = crypto.randomInt(4, height - 4);
    const y2 = crypto.randomInt(4, height - 4);
    const color = i % 2 === 0 ? 'rgba(56,189,248,0.35)' : 'rgba(167,139,250,0.35)';
    lines.push(`<path d="M0 ${y1} Q ${Math.floor(width / 2)} ${cy}, ${width} ${y2}" fill="none" stroke="${color}" stroke-width="1.5" />`);
  }

  const dots = [];
  for (let d = 0; d < 20; d++) {
    const cx = crypto.randomInt(2, width - 2);
    const cy = crypto.randomInt(2, height - 2);
    const r = (crypto.randomInt(6, 20) / 10).toFixed(1);
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(148,163,184,0.4)" />`);
  }

  // Render individual glyphs with subtle jittered rotation/vertical offsets so naive regex scraping fails
  const chars = text.replace(/\s+/g, '').split('');
  const stepX = Math.floor((width - 24) / Math.max(1, chars.length));
  const glyphNodes = chars.map((ch, idx) => {
    const gx = 16 + idx * stepX + crypto.randomInt(-1, 2);
    const gy = 28 + crypto.randomInt(-3, 4);
    const rot = crypto.randomInt(-10, 11);
    const safeChar = ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
    return `<text x="${gx}" y="${gy}" transform="rotate(${rot} ${gx} ${gy})" font-family="'JetBrains Mono', Courier, monospace" font-size="18" font-weight="bold" fill="#38bdf8">${safeChar}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="6" fill="#0f172a" stroke="#334155" stroke-width="1"/>
    ${dots.join('')}
    ${lines.join('')}
    ${glyphNodes}
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
  DEFAULT_TTL_SEC,
  isPrivateOrLoopbackIp,
  isCloudflareIp,
  isTrustedProxyIp,
  isTrustedProxyRequest
};
