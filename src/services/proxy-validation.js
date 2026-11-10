'use strict';

const net = require('node:net');
const dns = require('node:dns');

function isPrivateOrBlockedIp(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return true;
  let ip = ipStr.trim().toLowerCase();

  // Strip square brackets [::1] -> ::1
  ip = ip.replace(/^\[|\]$/g, '');

  if (ip === 'localhost' || ip.endsWith('.localhost') || ip === 'metadata.google.internal') return true;

  // Handle IPv4-mapped IPv6 ::ffff:192.168.1.1
  if (ip.startsWith('::ffff:')) {
    const rest = ip.substring(7);
    if (rest.includes('.')) {
      ip = rest;
    } else if (rest.includes(':')) {
      const parts = rest.split(':');
      if (parts.length === 2) {
        const w1 = parseInt(parts[0], 16);
        const w2 = parseInt(parts[1], 16);
        if (!isNaN(w1) && !isNaN(w2)) {
          ip = [(w1 >> 8) & 0xff, w1 & 0xff, (w2 >> 8) & 0xff, w2 & 0xff].join('.');
        }
      }
    }
  }

  const ipType = net.isIP(ip);
  if (ipType === 0) return false;

  // IPv4 Checks
  if (ipType === 4) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;

    const [b0, b1] = parts;
    if (b0 === 0) return true; // 0.0.0.0/8
    if (b0 === 10) return true; // 10.0.0.0/8
    if (b0 === 100 && (b1 >= 64 && b1 <= 127)) return true; // 100.64.0.0/10 Carrier NAT
    if (b0 === 127) return true; // 127.0.0.0/8 Loopback
    if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 Link-local / Cloud metadata
    if (b0 === 172 && (b1 >= 16 && b1 <= 31)) return true; // 172.16.0.0/12 Private
    if (b0 === 192 && b1 === 0) return true; // 192.0.0.0/24
    if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16 Private
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true; // 198.18.0.0/15
    if (b0 === 198 && b1 === 51) return true; // 198.51.100.0/24 TEST-NET-2
    if (b0 === 203 && b1 === 0) return true; // 203.0.113.0/24 TEST-NET-3
    if (b0 >= 224) return true; // Multicast & Reserved
    if (parts.every((p) => p === 255)) return true; // Broadcast
    return false;
  }

  // IPv6 Checks
  if (ipType === 6) {
    if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // Unique local
    if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true; // Link-local
    if (ip.startsWith('ff')) return true; // Multicast
    return false;
  }

  return false;
}

function isLocalOrPrivateHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', 'localhost.localdomain', '127.0.0.1', '::1'].includes(host) || /\.(?:localhost|local|internal|lan)$/.test(host)) return true;
  return isPrivateOrBlockedIp(host);
}

async function validateSafeBotUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('URL bot không hợp lệ.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL bot phải dùng http:// hoặc https://.');
  }

  if (url.username || url.password) {
    throw new Error('URL bot không được chứa username/password.');
  }

  const hostname = url.hostname.toLowerCase();

  // Luôn chặn endpoint Cloud Metadata (AWS 169.254.169.254 / GCP metadata.google.internal)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname.endsWith('.metadata.google.internal')) {
    throw new Error(`Hostname '${hostname}' bị chặn do chính sách bảo mật đám mây.`);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedHosts = new Set(
    (process.env.ALLOWED_INTERNAL_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!isProduction) {
    allowedHosts.add('localhost');
    allowedHosts.add('127.0.0.1');
    allowedHosts.add('::1');
  }

  if (allowedHosts.has(hostname)) {
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrBlockedIp(hostname) && !allowedHosts.has(hostname)) {
      throw new Error(`Địa chỉ IP '${hostname}' là địa chỉ nội bộ bị chặn (SSRF).`);
    }
  } else {
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      for (const rec of records) {
        if (rec.address === '169.254.169.254' || rec.address.startsWith('169.254.')) {
          throw new Error(`Hostname '${hostname}' trỏ về Cloud Metadata IP '${rec.address}' bị chặn.`);
        }
        if (isPrivateOrBlockedIp(rec.address) && !allowedHosts.has(hostname)) {
          throw new Error(`Hostname '${hostname}' trỏ về IP nội bộ '${rec.address}' bị chặn (SSRF).`);
        }
      }
    } catch (e) {
      if (e.message.includes('SSRF') || e.message.includes('bị chặn')) throw e;
      if (!isProduction && (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN')) {
        // Cho phép hostname nội bộ trong môi trường dev / docker
      } else {
        throw new Error(`Lỗi phân giải DNS cho '${hostname}': ${e.message}`);
      }
    }
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function validateProxyUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('Proxy URL không hợp lệ.');
  }

  if (!['socks5:', 'http:', 'https:'].includes(url.protocol)) {
    throw new Error('Proxy URL phải bắt đầu bằng socks5://, http:// hoặc https://.');
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Proxy URL phải có cổng hợp lệ (1-65535).');
  }

  if (isLocalOrPrivateHost(url.hostname)) {
    throw new Error('Proxy không được trỏ về địa chỉ nội bộ hoặc loopback.');
  }

  let username = '';
  let password = '';
  try {
    username = decodeURIComponent(url.username || '');
    password = decodeURIComponent(url.password || '');
  } catch (_) {
    throw new Error('Thông tin tài khoản proxy không hợp lệ.');
  }

  if (username.length > 255 || password.length > 255 || /[\u0000-\u001f\u007f]/.test(username + password)) {
    throw new Error('Tài khoản hoặc mật khẩu proxy chứa ký tự không hợp lệ.');
  }

  return raw;
}

module.exports = {
  isPrivateOrBlockedIp,
  isLocalOrPrivateHost,
  validateSafeBotUrl,
  validateProxyUrl
};
