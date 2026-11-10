'use strict';

function cleanText(input) {
  return String(input || '')
    .replace(/§x(§[0-9a-f]){6}/gi, '')
    .replace(/&x(&[0-9a-f]){6}/gi, '')
    .replace(/&#[0-9a-f]{6}/gi, '')
    .replace(/§#[0-9a-f]{6}/gi, '')
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/&[0-9a-fk-or]/gi, '')
    .replace(/§./g, '')
    .replace(/[\u00a0\u200b\ufeff]/g, ' ')
    .normalize('NFC')
    .trim();
}

function extractChatMessage(raw) {
  if (!raw) return '';
  if (typeof raw === 'object' && typeof raw.toPlainText === 'function') {
    return cleanText(raw.toPlainText());
  }
  let str = typeof raw === 'string' ? raw : '';
  if (!str && typeof raw === 'object') {
    try {
      str = JSON.stringify(raw);
    } catch (_) {
      str = String(raw);
    }
  }
  if (typeof str === 'string' && (str.startsWith('{') || str.startsWith('['))) {
    try {
      const parsed = JSON.parse(str);
      const parts = [];
      const walk = (node) => {
        if (!node) return;
        if (typeof node === 'string') { parts.push(node); return; }
        if (typeof node.text === 'string') parts.push(node.text);
        if (Array.isArray(node.extra)) {
          for (const item of node.extra) walk(item);
        }
      };
      walk(parsed);
      const combined = cleanText(parts.join(''));
      if (combined.length > 0) return combined;
    } catch (_) {}
  }
  return cleanText(str);
}

function diagnoseErrorMessage(rawError) {
  if (!rawError) return 'Không có lỗi ghi nhận.';
  const raw = String(rawError?.message || rawError || '').trim();
  const lower = raw.toLowerCase();

  // 1. Lỗi mạng / Proxy phản hồi quá hạn / Từ chối kết nối
  if (lower.includes('econnrefused') || lower.includes('etimedout') || lower.includes('connect etimedout')) {
    return 'Không thể kết nối tới máy chủ hoặc Proxy bị phản hồi quá hạn (Kiểm tra lại IP/Port Proxy).';
  }
  if (lower.includes('socks5 authentication') || lower.includes('407 proxy') || lower.includes('authentication failed')) {
    return 'Sai tài khoản hoặc mật khẩu Proxy (Vui lòng cập nhật lại thông tin xác thực Proxy).';
  }
  if (lower.includes('socks connection failed') || lower.includes('socks5') || lower.includes('proxy connection error')) {
    return 'Kết nối qua máy chủ Proxy thất bại (Proxy có thể đã chết hoặc nghẽn mạng).';
  }

  // 2. Kẹt phiên / Trùng tài khoản trên KingMC
  if (lower.includes('already logged in') || lower.includes('you are already connected') || lower.includes('đang đăng nhập ở nơi khác')) {
    return 'Tài khoản đang online ở nơi khác hoặc kẹt phiên trên sảnh KingMC (Chờ 15s hoặc bấm Đồng bộ lại).';
  }

  // 3. Lệch phiên bản giao thức
  if (lower.includes('outdated client') || lower.includes('outdated server') || lower.includes('incompatible version')) {
    return 'Lệch phiên bản giao thức máy chủ (Cần đồng bộ cấu hình phiên bản Minecraft 1.20.2).';
  }

  // 4. Sai thông tin đăng nhập Minecraft / Auth
  if (lower.includes('invalid password') || lower.includes('sai mật khẩu') || lower.includes('password incorrect')) {
    return 'Sai mật khẩu đăng nhập tài khoản Minecraft trong game (Vui lòng cấu hình lại mật khẩu).';
  }
  if (lower.includes('not registered') || lower.includes('chưa đăng ký') || lower.includes('/register')) {
    return 'Tài khoản chưa được đăng ký trong game (Cần dùng lệnh /register trước).';
  }

  // 5. Giới hạn IP / Banned / Server Hold
  if (lower.includes('ip_limited') || lower.includes('quá nhiều tài khoản') || lower.includes('limit reached')) {
    return 'IP đã chạm giới hạn kết nối của máy chủ KingMC (Nên bật Proxy SOCKS5 để đổi IP).';
  }
  if (lower.includes('banned') || lower.includes('bị khóa') || lower.includes('tài khoản đã bị cấm')) {
    return 'Tài khoản hoặc IP đã bị máy chủ KingMC xử phạt/cấm kết nối.';
  }

  // 6. Rớt mạng đột ngột / Kicked
  if (lower.includes('disconnect.quitting') || lower.includes('quitting') || lower.includes('client quit')) {
    return 'Bot đã ngắt kết nối theo yêu cầu của hệ thống điều phối.';
  }
  if (lower.includes('kicked') || lower.includes('bị kick') || lower.includes('timed out')) {
    return `Bot bị đẩy khỏi server: ${cleanText(raw).slice(0, 140)}`;
  }

  return cleanText(raw).slice(0, 200);
}

function formatRelativeTime(dateOrMs) {
  if (!dateOrMs) return '—';
  const time = typeof dateOrMs === 'number' ? dateOrMs : Date.parse(dateOrMs);
  if (!Number.isFinite(time)) return '—';
  const diffSec = Math.floor((Date.now() - time) / 1000);
  if (diffSec < 5) return 'Vừa xong';
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} ngày trước`;
  return new Date(time).toLocaleDateString('vi-VN');
}

function formatDuration(secondsOrMs, isMs = false) {
  const totalSeconds = Math.max(0, Math.floor(isMs ? Number(secondsOrMs) / 1000 : Number(secondsOrMs) || 0));
  if (!totalSeconds) return '0s';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

module.exports = {
  cleanText,
  extractChatMessage,
  diagnoseErrorMessage,
  formatRelativeTime,
  formatDuration,
  formatBytes
};

