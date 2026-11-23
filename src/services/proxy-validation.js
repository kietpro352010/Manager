'use strict';

const net = require('node:net');
const dns = require('node:dns');

function stripHostAndPort(rawHost) {
  let text = String(rawHost || '').trim();
  if (!text) return '';
  if (text.includes('://')) {
    try {
      return new URL(text).hostname;
    } catch (_) {}
  }
  if (text.startsWith('[')) {
    const closeIdx = text.indexOf(']');
    if (closeIdx !== -1) {
      return text.slice(1, closeIdx);
    }
  }
  const firstColon = text.indexOf(':');
  if (firstColon !== -1 && text.indexOf(':', firstColon + 1) === -1) {
    return text.slice(0, firstColon);
  }
  return text;
}

function normalizeHostToken(rawHost) {
  return stripHostAndPort(rawHost).replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
}

function isNonCanonicalIpv4Token(host) {
  if (!host || typeof host !== 'string') return false;
  if (net.isIP(host) !== 0) return false;
  const parts = host.split('.');
  if (parts.length >= 1 && parts.length <= 4 && parts.every((p) => /^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(p))) {
    return true;
  }
  return false;
}

function expandIpv6Groups(rawIp) {
  let ip = String(rawIp || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!ip || ip.includes('%')) return null;
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
  const [b0, b1, b2] = parts;
  if (b0 === 0) return true; // 0.0.0.0/8
  if (b0 === 10) return true; // 10.0.0.0/8
  if (b0 === 100 && (b1 >= 64 && b1 <= 127)) return true; // 100.64.0.0/10 Carrier NAT
  if (b0 === 127) return true; // 127.0.0.0/8 Loopback
  if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 Link-local / Cloud metadata
  if (b0 === 172 && (b1 >= 16 && b1 <= 31)) return true; // 172.16.0.0/12 Private
  if (b0 === 192 && b1 === 0 && (b2 === 0 || b2 === 2)) return true; // 192.0.0.0/24 & 192.0.2.0/24
  if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16 Private
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true; // 198.18.0.0/15
  if (b0 === 198 && b1 === 51 && b2 === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (b0 === 203 && b1 === 0 && b2 === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (b0 >= 224) return true; // Multicast & Reserved
  if (parts.every((p) => p === 255)) return true; // Broadcast
  return false;
}

function isPrivateOrBlockedIp(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return true;
  if (ipStr.includes('%')) return true;
  const ip = normalizeHostToken(ipStr);

  if (!ip || ip === 'localhost' || ip.endsWith('.localhost') || ip === 'metadata.google.internal' || ip.endsWith('.metadata.google.internal')) return true;
  if (isNonCanonicalIpv4Token(ip)) return true;

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
  const raw = String(hostname || '').trim();
  if (!raw || raw.includes('%')) return true;
  const host = normalizeHostToken(raw);
  if (!host) return true;
  if (['localhost', 'localhost.localdomain', '127.0.0.1', '::1', '0.0.0.0', 'instance-data'].includes(host) ||
      /\.(?:localhost|local|internal|lan)$/.test(host) ||
      host === 'metadata.google.internal' ||
      host.endsWith('.metadata.google.internal') ||
      host.endsWith('.instance-data')) return true;
  if (isNonCanonicalIpv4Token(host)) return true;
  return isPrivateOrBlockedIp(host);
}

function isMetadataHost(hostname) {
  return hostname === '169.254.169.254' ||
    hostname.startsWith('169.254.') ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.metadata.google.internal') ||
    hostname === 'instance-data' ||
    hostname.endsWith('.instance-data');
}

function getAllowedInternalHosts() {
  return new Set(
    (process.env.ALLOWED_INTERNAL_HOSTS || '')
      .split(',')
      .map((s) => normalizeHostToken(s))
      .filter(Boolean)
  );
}

async function resolveAndValidateHost(rawHostname, { allowLocal = false } = {}) {
  const raw = String(rawHostname || '').trim();
  if (!raw || raw.includes('%') || /[\s/?#@\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('Hostname không hợp lệ hoặc chứa ký tự bị cấm.');
  }

  const hostname = normalizeHostToken(raw);
  if (!hostname) {
    throw new Error('Hostname không được để trống.');
  }

  if (isMetadataHost(hostname)) {
    throw new Error(`Hostname '${hostname}' bị chặn do chính sách bảo mật đám mây.`);
  }

  if (isNonCanonicalIpv4Token(hostname)) {
    throw new Error(`Địa chỉ IP không hợp lệ hoặc dạng không chuẩn '${hostname}' bị chặn (SSRF).`);
  }

  const allowedHosts = getAllowedInternalHosts();
  if (allowLocal) {
    allowedHosts.add('localhost');
    allowedHosts.add('127.0.0.1');
    allowedHosts.add('::1');
  }

  const isExplicitlyAllowed = allowedHosts.has(hostname);
  const ipType = net.isIP(hostname);

  if (ipType !== 0) {
    if (isPrivateOrBlockedIp(hostname) && !isExplicitlyAllowed) {
      throw new Error(`Địa chỉ IP '${hostname}' là địa chỉ nội bộ bị chặn (SSRF).`);
    }
    return { ip: hostname, family: ipType, hostname };
  }

  if (isLocalOrPrivateHost(hostname) && !isExplicitlyAllowed) {
    throw new Error(`Hostname '${hostname}' là địa chỉ nội bộ bị chặn (SSRF).`);
  }

  if (allowLocal && hostname === 'localhost') {
    return { ip: '127.0.0.1', family: 4, hostname };
  }

  let records;
  try {
    records = await dns.promises.lookup(hostname, { all: true });
  } catch (e) {
    throw new Error(`Lỗi phân giải DNS cho '${hostname}': ${e.message}`);
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`Không thể phân giải DNS cho '${hostname}' (SSRF blocked).`);
  }

  for (const rec of records) {
    const addr = String(rec?.address || '').trim();
    if (!addr || addr.includes('%')) {
      throw new Error(`Hostname '${hostname}' phân giải ra địa chỉ không hợp lệ (SSRF blocked).`);
    }
    if (addr === '169.254.169.254' || addr.startsWith('169.254.')) {
      throw new Error(`Hostname '${hostname}' trỏ về Cloud Metadata IP '${addr}' bị chặn.`);
    }
    if (isPrivateOrBlockedIp(addr) && !isExplicitlyAllowed) {
      throw new Error(`Hostname '${hostname}' trỏ về IP nội bộ '${addr}' bị chặn (SSRF).`);
    }
  }

  const preferred = records.find((r) => r.family === 4 || net.isIPv4(r.address)) || records[0];
  return {
    ip: preferred.address,
    family: preferred.family || net.isIP(preferred.address),
    hostname
  };
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

  if (url.hostname.includes('%') || decodeURIComponentSafe(url.hostname).includes('%')) {
    throw new Error('Hostname URL bot chứa ký tự zone ID không hợp lệ.');
  }

  const allowLocal = process.env.ALLOW_LOCAL_BOT_URLS === 'true' || process.env.NODE_ENV === 'test';
  await resolveAndValidateHost(url.hostname, { allowLocal });

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_) {
    return String(value || '');
  }
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

  if (url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Proxy URL không được chứa đường dẫn hoặc tham số truy vấn.');
  }

  const effectivePortStr = url.port || (url.protocol === 'http:' ? '80' : (url.protocol === 'https:' ? '443' : ''));
  const port = Number(effectivePortStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Proxy URL phải có cổng hợp lệ (1-65535).');
  }

  if (url.hostname.includes('%') || decodeURIComponentSafe(url.hostname).includes('%')) {
    throw new Error('Proxy không được chứa zone ID trong hostname.');
  }

  const hostname = normalizeHostToken(url.hostname);

  if (isLocalOrPrivateHost(hostname)) {
    throw new Error('Proxy không được trỏ về địa chỉ nội bộ hoặc loopback.');
  }

  try {
    await resolveAndValidateHost(hostname, { allowLocal: false });
  } catch (err) {
    if (/nội bộ|SSRF|bị chặn|non-canonical/i.test(err.message)) {
      throw new Error('Proxy không được trỏ về địa chỉ nội bộ hoặc loopback.');
    }
    throw new Error(`Lỗi phân giải DNS cho proxy '${hostname}': ${err.message}`);
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
  resolveAndValidateHost,
  validateSafeBotUrl,
  validateProxyUrl
};
