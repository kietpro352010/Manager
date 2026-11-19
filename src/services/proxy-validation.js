'use strict';

const net = require('node:net');
const dns = require('node:dns');

function normalizeHostToken(rawHost) {
  return String(rawHost || '').trim().replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
}

function expandIpv6Groups(rawIp) {
  let ip = String(rawIp || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  if (!ip.includes(':')) return null;

  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (net.isIP(tail) !== 4) return null;
    const octets = tail.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (parts.length === 1 && left.length !== 8) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;
  const full = parts.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (full.length !== 8) return null;
  const groups = full.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (groups.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return groups;
}

function isPrivateIpv4Parts(parts) {
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
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

function isPrivateOrBlockedIp(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return true;
  const ip = normalizeHostToken(ipStr);

  if (!ip || ip === 'localhost' || ip.endsWith('.localhost') || ip === 'metadata.google.internal' || ip.endsWith('.metadata.google.internal')) return true;

  const ipType = net.isIP(ip);
  if (ipType === 0 && !ip.includes(':')) return false;

  // IPv4 Checks
  if (ipType === 4) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    return isPrivateIpv4Parts(parts);
  }

  // Canonical 128-bit IPv6 Checks (covers ::1, expanded ::ffff:*, ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo, ULA, link-local, site-local, multicast)
  const groups = expandIpv6Groups(ip);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const allZeroPrefix5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (allZeroPrefix5 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
  if ((allZeroPrefix5 && (g5 === 0xffff || g5 === 0)) || (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0)) {
    return isPrivateIpv4Parts([(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff]);
  }
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIpv4Parts([(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff]);
  }
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0x0001) return true;
  if (g0 === 0x2002) {
    return isPrivateIpv4Parts([(g1 >> 8) & 0xff, g1 & 0xff, (g2 >> 8) & 0xff, g2 & 0xff]);
  }
  if (g0 === 0x2001 && (g1 === 0x0000 || g1 === 0x0db8 || (g1 === 0x0002 && g2 === 0))) return true;
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xffc0) === 0xfec0) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  return false;
}

function isLocalOrPrivateHost(hostname) {
  let host = normalizeHostToken(hostname);
  try {
    if (host.includes('://')) {
      host = normalizeHostToken(new URL(host).hostname);
    } else if (host.includes(':') && !host.includes('.')) {
      // not IPv4 with port, might be IPv6
    } else if (host.includes(':') && host.includes('.')) {
      // IPv4:port
      host = normalizeHostToken(host.split(':')[0]);
    }
  } catch (_) {}
  if (['localhost', 'localhost.localdomain', '127.0.0.1', '::1', '0.0.0.0', 'instance-data'].includes(host) ||
      /\.(?:localhost|local|internal|lan)$/.test(host) ||
      host === 'metadata.google.internal' ||
      host.endsWith('.metadata.google.internal') ||
      host.endsWith('.instance-data')) return true;
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

  const hostname = normalizeHostToken(url.hostname);

  // Luôn chặn endpoint Cloud Metadata (AWS 169.254.169.254 / GCP metadata.google.internal)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname.endsWith('.metadata.google.internal')) {
    throw new Error(`Hostname '${hostname}' bị chặn do chính sách bảo mật đám mây.`);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedHosts = new Set(
    (process.env.ALLOWED_INTERNAL_HOSTS || '')
      .split(',')
      .map((s) => normalizeHostToken(s))
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
      if (!Array.isArray(records) || records.length === 0) {
        if (isProduction) {
          throw new Error(`Không thể phân giải DNS cho '${hostname}' (SSRF blocked).`);
        }
      }
      for (const rec of (records || [])) {
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

async function validateProxyUrl(rawUrl) {
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

  const hostname = normalizeHostToken(url.hostname);

  if (isLocalOrPrivateHost(hostname)) {
    throw new Error('Proxy không được trỏ về địa chỉ nội bộ hoặc loopback.');
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrBlockedIp(hostname)) {
      throw new Error('Proxy không được trỏ về địa chỉ nội bộ hoặc loopback.');
    }
  } else {
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        throw new Error(`Không thể phân giải DNS cho hostname '${hostname}'.`);
      }
      for (const rec of records) {
        if (isPrivateOrBlockedIp(rec.address)) {
          throw new Error('Proxy không được trỏ về địa chỉ nội bộ hoặc loopback.');
        }
      }
    } catch (e) {
      if (e.message.includes('Proxy không được trỏ')) throw e;
      throw new Error(`Lỗi phân giải DNS cho proxy '${hostname}': ${e.message}`);
    }
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
