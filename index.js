const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const dns = require('dns');
const net = require('net');

// ============================================================================
// CẤU HÌNH TỔNG BỘ ĐIỀU KHIỂN MANAGER (COMMERCIAL ENTERPRISE EDITION V11.6)
//
// Triển khai file này lên Render Web Service hoặc VPS dưới dạng index.js / manager.js.
// Tự động nhận diện Render Cloud Native (PORT 10000) và khởi chạy Web UI tức thì!
// Chỉnh sửa các trường cấu hình trực tiếp ngay bên dưới:
// ============================================================================
const MANAGER_CONFIG = {
    // --- 0. KHÓA BẢO MẬT NỘI BỘ MANAGER <-> BOT CON ---
    BOT_SECRET_KEY: '',                   // Khóa bảo mật nội bộ kết nối Bot con
    // --- 1. MẬT KHẨU QUẢN TRỊ ADMIN (ĐỂ TRỐNG ĐỂ TỰ ĐIỀN) ---
    ADMIN_PASSWORD: 'admin123',           // Mật khẩu quản trị Manager (Mặc định: 'admin123' hoặc đặt qua biến môi trường ADMIN_PASSWORD)

    // --- 2. THÔNG BÁO WEBHOOK DISCORD & TELEGRAM (ĐỂ TRỐNG NẾU CHƯA DÙNG) ---
    DISCORD_WEBHOOK_URL: '',              // Webhook Discord nhận cảnh báo khi bot offline > 5p, low totem
    TELEGRAM_BOT_TOKEN: '',               // Token Bot Telegram (VD: '123456789:ABCdefGhI...')
    TELEGRAM_CHAT_ID: '',                 // ID cuộc trò chuyện Telegram nhận thông báo

    // --- 3. CỔNG MÁY CHỦ WEB & NỀN TẢNG HOSTING (THUẦN RENDER CLOUD) ---
    PLATFORM: 'auto',                     // 'auto' (Tự nhận diện Render Cloud Web Service / Local PC)
    WEB_PORT: 10000,                      // Cổng Web mặc định trên Render (Render tự gán PORT=10000; test Local dự phòng 3000)

    // --- 4. DANH SÁCH BOT KHỞI TẠO SẴN (NẾU CÓ) ---
    // Ví dụ: 'https://bot-a.onrender.com,https://bot-b.onrender.com'
    BOT_URLS: '',                         // Danh sách URL các bot con
    BOT_LABELS: '',                       // Tên nhãn tương ứng các bot (phân tách bởi dấu phẩy)

    // --- 5. CẤU HÌNH THEO DÕI & WATCHDOG ---
    FLEET_AUTO_HEAL: false,               // Đã TẮT: Không tự động gửi start từ Manager, kết nối lại 100% dựa vào setting autoReconnect trong bot
    WATCHDOG_INTERVAL_MS: 60000,          // Chu kỳ quét sức khỏe định kỳ (60 giây)
    OFFLINE_ALERT_THRESHOLD_MS: 300000,   // Gửi cảnh báo khi bot offline quá 5 phút (300000 ms)
    LOW_TOTEM_THRESHOLD: 1,               // Gửi cảnh báo khi số Totem <= 1
    MAX_SPARKLINE_POINTS: 20              // Số điểm lưu trữ vẽ đồ thị SVG Sparkline thời gian thực
};

function getAdminPassword() {
    if (typeof registry !== 'undefined' && registry && registry.adminPassword) {
        return String(registry.adminPassword).trim();
    }
    const envPass = process.env.ADMIN_PASSWORD || process.env.MANAGER_ADMIN_PASSWORD || process.env.MANAGER_PASSWORD || MANAGER_CONFIG.ADMIN_PASSWORD;
    if (envPass) return String(envPass).trim();
    return '';
}

const app = express();

function readPositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function escapeHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// ============================================================================
// HỆ THỐNG TỰ ĐỘNG NHẬN DIỆN NỀN TẢNG THUẦN RENDER CLOUD & TỐI ƯU CỔNG WEB
// ============================================================================

function extractCliArgs() {
    let port = null;
    let platform = null;
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--port=')) {
            const p = parseInt(arg.split('=')[1], 10);
            if (Number.isFinite(p) && p > 0 && p <= 65535) port = p;
        } else if (arg === '--port' || arg === '-p') {
            if (i + 1 < argv.length) {
                const p = parseInt(argv[i + 1], 10);
                if (Number.isFinite(p) && p > 0 && p <= 65535) {
                    port = p;
                    i++;
                }
            }
        } else if (arg.startsWith('-p=')) {
            const p = parseInt(arg.split('=')[1], 10);
            if (Number.isFinite(p) && p > 0 && p <= 65535) port = p;
        } else if (arg.startsWith('--platform=')) {
            platform = arg.split('=')[1].trim().toLowerCase();
        } else if (arg === '--platform') {
            if (i + 1 < argv.length) {
                platform = argv[i + 1].trim().toLowerCase();
                i++;
            }
        } else if (/^\d{2,5}$/.test(arg) && !port) {
            const p = parseInt(arg, 10);
            if (Number.isFinite(p) && p > 0 && p <= 65535) port = p;
        }
    }
    return { port, platform };
}

function detectHostPlatformAndPort(config, fallbackPort, role = 'manager') {
    const cli = extractCliArgs();

    // 1. Dấu hiệu Render Cloud Web Service chính thức (https://render.com/docs/environment-variables)
    const isRender = !!(
        (process.env.RENDER && String(process.env.RENDER).toLowerCase() === 'true') ||
        process.env.RENDER_SERVICE_ID ||
        process.env.RENDER_INSTANCE_ID ||
        process.env.RENDER_SERVICE_NAME ||
        process.env.RENDER_EXTERNAL_HOSTNAME
    );

    let platform = isRender ? 'render' : 'local';
    let detectionSource = isRender
        ? 'Biến môi trường Render chính thức (process.env.RENDER / RENDER_SERVICE_ID)'
        : 'Môi trường Local PC / VPS độc lập (Render Compatible Mode)';

    const configuredPlatform = String(config.PLATFORM || 'auto').trim().toLowerCase();
    if (cli.platform === 'render' || cli.platform === 'local') {
        platform = cli.platform;
        detectionSource = `Tham số dòng lệnh CLI (--platform=${cli.platform})`;
    } else if (configuredPlatform === 'render' || configuredPlatform === 'local') {
        platform = configuredPlatform;
        detectionSource = `Cấu hình ép buộc config.PLATFORM = '${configuredPlatform}'`;
    }

    // 2. Phân giải Cổng (Port) theo chuẩn Render Cloud (PORT=10000)
    let port = fallbackPort;
    let portSource = 'mặc định';

    if (cli.port) {
        port = cli.port;
        portSource = `Tham số dòng lệnh CLI (--port = ${cli.port})`;
    } else if (process.env.PORT) {
        const envPort = Number(process.env.PORT);
        if (Number.isFinite(envPort) && envPort > 0 && envPort <= 65535) {
            port = envPort;
            portSource = `Render cấp tự động (process.env.PORT = ${envPort})`;
        }
    } else if (platform === 'render') {
        port = 10000;
        portSource = 'Render Web Service mặc định (10000)';
    } else {
        const cfgPort = Number(config.WEB_PORT);
        if (Number.isFinite(cfgPort) && cfgPort > 0 && cfgPort <= 65535) {
            port = cfgPort;
            portSource = `Cấu hình config.WEB_PORT = ${cfgPort}`;
        } else {
            port = fallbackPort;
            portSource = `Cổng dự phòng fallback (${fallbackPort})`;
        }
    }

    return { platform, detectionSource, port, portSource };
}

function listenHttpServer(app, initialPort, platform, onListening) {
    const fixedPort = initialPort;
    const maxRetries = 5;
    let attempt = 0;

    function tryListen() {
        const srv = app.listen(fixedPort, '0.0.0.0');

        srv.on('listening', () => {
            onListening(srv, fixedPort);
        });

        srv.on('error', (err) => {
            if (err.code === 'EADDRINUSE' && attempt < maxRetries) {
                attempt++;
                console.warn(`[HTTP] ⚠️ Cổng ${fixedPort} đang tạm thời bận (EADDRINUSE). Đang chờ giải phóng socket và thử lại lần ${attempt}/${maxRetries} sau 1 giây...`);
                setTimeout(tryListen, 1000);
            } else {
                console.error(`[HTTP] ❌ Lỗi khởi động máy chủ web trên cổng cố định ${fixedPort}:`, err.message);
                if (err.code === 'EADDRINUSE') {
                    console.error(`[HTTP] 💡 Khắc phục: Cổng ${fixedPort} đang bị chiếm bởi tiến trình khác. Hãy kiểm tra các bot/tiến trình Node.js đang chạy ngầm hoặc khởi động lại dịch vụ trên Render.`);
                }
                process.exit(1);
            }
        });
    }

    tryListen();
}


const hostInfo = detectHostPlatformAndPort(MANAGER_CONFIG, Number(MANAGER_CONFIG.WEB_PORT) || 3000, 'manager');
const MANAGER_PLATFORM = hostInfo.platform;
let HTTP_PORT = hostInfo.port;

console.log(`[HOST] 🌐 Nền tảng Manager: ${MANAGER_PLATFORM.toUpperCase()} (${hostInfo.detectionSource})`);
console.log(`[HTTP] 🔌 Cổng Web Manager: ${HTTP_PORT} (${hostInfo.portSource})`);

const isRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY : (isRender || process.env.PORT || process.env.NODE_ENV === 'production' ? 1 : 'loopback'));

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
    console.error('[STORAGE] Không thể tạo DATA_DIR:', e.message);
}

// Tự động di chuyển dữ liệu cũ từ __dirname sang DATA_DIR nếu DATA_DIR được cấu hình riêng
if (DATA_DIR !== __dirname) {
    const dataFilesToMigrate = [
        'bot_registry.json',
        'manager_users.json',
        'manager_sessions.json',
        'manager_keys.json',
        'manager_audit.jsonl',
        '.manager_master_key',
        '.bot_secret_key',
        '.supabase_secret'
    ];
    for (const f of dataFilesToMigrate) {
        const src = path.join(__dirname, f);
        const dst = path.join(DATA_DIR, f);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
            try {
                fs.copyFileSync(src, dst);
                console.log(`[DATA_MIGRATION] Đã sao chép ${f} sang ${DATA_DIR}`);
            } catch (err) {
                console.error(`[DATA_MIGRATION] Lỗi sao chép ${f}:`, err.message);
            }
        }
    }
    const srcBackups = path.join(__dirname, 'backups');
    const dstBackups = path.join(DATA_DIR, 'backups');
    if (fs.existsSync(srcBackups) && !fs.existsSync(dstBackups)) {
        try {
            fs.mkdirSync(dstBackups, { recursive: true });
            for (const bf of fs.readdirSync(srcBackups)) {
                fs.copyFileSync(path.join(srcBackups, bf), path.join(dstBackups, bf));
            }
            console.log(`[DATA_MIGRATION] Đã sao chép backups sang ${DATA_DIR}`);
        } catch (_) {}
    }
}

if (isRender && !process.env.DATA_DIR) {
    console.warn('\n====================================================================');
    console.warn('[STORAGE WARNING] ⚠️ Manager đang chạy trên Render mà chưa cấu hình DATA_DIR!');
    console.warn('Filesystem mặc định của Render là ephemeral (sẽ mất dữ liệu khi restart/deploy).');
    console.warn('Khuyến nghị: Thêm Render Persistent Disk mount tại /data và đặt DATA_DIR=/data.');
    console.warn('====================================================================\n');
}

const POLL_TIMEOUT_MS = readPositiveInt(process.env.BOT_FETCH_TIMEOUT_MS, 5000, 1000, 30000);
const BOT_POLL_MS = readPositiveInt(process.env.BOT_POLL_MS, 1500, 200, 10000);
const BOT_SUMMARY_CACHE_MS = readPositiveInt(process.env.BOT_SUMMARY_CACHE_MS, 500, 100, 60000);
const BOT_MAX_PARALLEL_REQUESTS = readPositiveInt(process.env.BOT_MAX_PARALLEL_REQUESTS, 8, 1, 64);
const ADMIN_FETCH_TIMEOUT_MS = readPositiveInt(process.env.ADMIN_FETCH_TIMEOUT_MS, 8000, 1000, 30000);
const REGISTRY_FILE_FROM_ENV = String(process.env.BOT_REGISTRY_FILE || '').trim();
const REGISTRY_CANDIDATES = [
    REGISTRY_FILE_FROM_ENV ? path.resolve(REGISTRY_FILE_FROM_ENV) : null,
    path.join(DATA_DIR, 'bot_registry.json'),
    path.join(__dirname, 'bot_registry.json'),
    path.join(process.cwd(), 'bot_registry.json')
].filter((value, index, arr) => value && arr.indexOf(value) === index);

let REGISTRY_FILE = REGISTRY_CANDIDATES[0] || path.join(DATA_DIR, 'bot_registry.json');
let USERS_FILE = path.join(DATA_DIR, 'manager_users.json');
let SESSIONS_FILE = path.join(DATA_DIR, 'manager_sessions.json');
let BACKUP_DIR = path.join(DATA_DIR, 'backups');
let AUDIT_LOG_FILE = path.join(DATA_DIR, 'manager_audit.jsonl');
let KEYS_FILE = path.join(DATA_DIR, 'manager_keys.json');
let MASTER_KEY_FILE = path.join(DATA_DIR, '.manager_master_key');
let SUPABASE_SECRET_FILE = path.join(DATA_DIR, '.supabase_secret');

function loadSupabaseSecretKey() {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY) {
        return String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY).trim();
    }
    try {
        if (fs.existsSync(SUPABASE_SECRET_FILE)) {
            return fs.readFileSync(SUPABASE_SECRET_FILE, 'utf8').trim();
        }
    } catch (_) {}
    return '';
}

function saveSupabaseSecretKey(key) {
    if (!key) return;
    try {
        fs.writeFileSync(SUPABASE_SECRET_FILE, String(key).trim(), { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
        console.error('[SUPABASE] Lỗi ghi .supabase_secret:', e.message);
    }
}

try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
} catch (e) {
    console.error('[BACKUP] Không thể khởi tạo thư mục backups:', e.message);
}


// ----------------------------------------------------------------------------
// SUPABASE CLOUD DATABASE ADAPTER (ENTERPRISE PERSISTENCE ENGINE)
// ----------------------------------------------------------------------------
const SUPABASE_REQUIRED_TABLES = Object.freeze([
    'manager_users',
    'manager_keys',
    'bot_registry',
    'manager_sessions',
    'bot_settings',
    'audit_logs'
]);

// Run this once in Supabase SQL Editor before connecting a new project. The
// service-role key bypasses RLS; browser clients never receive this key.
const SUPABASE_SCHEMA_SQL = `
create table if not exists public.manager_users (
  id text primary key, username text not null unique, password text not null,
  role text not null default 'user', status text not null default 'active',
  assigned_bot_ids jsonb not null default '[]'::jsonb, expires_at timestamptz,
  plan_name text not null default 'Gói mặc định', bot_aliases jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.manager_keys (
  id text primary key, code text not null unique, days integer not null default 1,
  plan_name text not null default 'Gói mặc định', bot_ids jsonb not null default '[]'::jsonb,
  used boolean not null default false, used_by text, used_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.bot_registry (
  id text primary key, data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.manager_sessions (
  token_hash text primary key, user_id text not null, username text not null,
  role text not null default 'user', assigned_bot_ids jsonb not null default '[]'::jsonb,
  expires_at bigint not null, plan_name text not null default 'Gói thường',
  allow_account_change boolean not null default true, status text not null default 'active',
  updated_at timestamptz not null default now()
);
create table if not exists public.bot_settings (
  bot_id text primary key, username text not null default '', password text not null default '',
  settings jsonb not null default '{}'::jsonb, proxy jsonb not null default '{}'::jsonb,
  schedules jsonb not null default '[]'::jsonb, auto_chat jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id text primary key, log_type text not null default 'SYSTEM', category text not null default 'SYSTEM',
  action text not null, action_label text not null default '', actor_username text not null default 'system',
  actor_role text not null default 'system', actor_ip text not null default '', target jsonb not null default '{}'::jsonb,
  details text not null default '', status text not null default 'SUCCESS', timestamp timestamptz not null default now()
);
create index if not exists audit_logs_timestamp_idx on public.audit_logs (timestamp desc);
create index if not exists audit_logs_type_category_idx on public.audit_logs (log_type, category);
create index if not exists manager_sessions_expires_at_idx on public.manager_sessions (expires_at);
alter table public.manager_users enable row level security;
alter table public.manager_keys enable row level security;
alter table public.bot_registry enable row level security;
alter table public.manager_sessions enable row level security;
alter table public.bot_settings enable row level security;
alter table public.audit_logs enable row level security;
`;

function getSupabaseKeyRole(key) {
    const raw = String(key || '').trim();
    if (raw.startsWith('sb_secret_')) return 'service_role';
    if (raw.startsWith('sb_publishable_')) return 'anon';
    const parts = raw.split('.');
    if (parts.length !== 3) return 'unknown';
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return String(payload?.role || 'unknown');
    } catch (_) {
        return 'unknown';
    }
}

class SupabaseAdapter {
    constructor(config = {}) {
        this.url = (config.url || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
        this.key = (config.key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
        this.enabled = !!(this.url && this.key);
        this.lastPingOk = false;
        this.lastPingError = '';
        this.lastMissingTables = [];
    }

    updateConfig(url, key) {
        this.url = (url || '').trim().replace(/\/+$/, '');
        this.key = (key || '').trim();
        this.enabled = !!(this.url && this.key);
        this.lastMissingTables = [];
    }

    isEnabled() {
        return !!(this.url && this.key);
    }

    getHeaders(extra = {}) {
        return {
            'apikey': this.key,
            'Authorization': `Bearer ${this.key}`,
            'Content-Type': 'application/json',
            ...extra
        };
    }

    async testConnection() {
        if (!this.isEnabled()) return { ok: false, error: 'Chưa cấu hình Supabase URL hoặc API Key' };
        if (getSupabaseKeyRole(this.key) === 'anon') {
            const error = 'Cần dùng SUPABASE_SERVICE_ROLE_KEY (không dùng anon/publishable key) để lưu dữ liệu an toàn.';
            this.lastPingOk = false;
            this.lastPingError = error;
            return { ok: false, error };
        }
        try {
            const checks = await Promise.all(SUPABASE_REQUIRED_TABLES.map(async table => {
                const res = await fetch(`${this.url}/rest/v1/${table}?select=*&limit=1`, {
                    headers: this.getHeaders(),
                    signal: AbortSignal.timeout(6000)
                });
                return { table, ok: res.ok, status: res.status, text: res.ok ? '' : await res.text().catch(() => '') };
            }));
            const failed = checks.filter(item => !item.ok);
            const missingTables = failed
                .filter(item => item.status === 404 || /relation|schema cache|does not exist/i.test(item.text))
                .map(item => item.table);
            this.lastMissingTables = missingTables;
            if (failed.length === 0) {
                this.lastPingOk = true;
                this.lastPingError = '';
                return { ok: true, message: 'Kết nối Supabase Cloud thành công!' };
            }
            this.lastPingOk = false;
            const error = missingTables.length
                ? `Thiếu bảng Supabase: ${missingTables.join(', ')}. Hãy chạy SQL schema trong mục Supabase Cloud.`
                : `Supabase từ chối truy cập bảng ${failed[0].table} (HTTP ${failed[0].status}). Kiểm tra Service Role Key và RLS.`;
            this.lastPingError = error;
            return { ok: false, error, missingTables };
        } catch (err) {
            this.lastPingOk = false;
            this.lastMissingTables = [];
            this.lastPingError = err.message;
            return { ok: false, error: `Lỗi kết nối Supabase: ${err.message}` };
        }
    }

    // --- USERS ---
    async fetchUsers() {
        if (!this.isEnabled()) return null;
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_users?select=*`, {
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.map(u => {
                const encryptedPassword = String(u.password || '');
                const password = decryptUserPassword(encryptedPassword);
                if (encryptedPassword.startsWith('aes256$gcm$') && !password) {
                    throw new Error('Không thể giải mã mật khẩu cloud. Hãy giữ nguyên MANAGER_MASTER_KEY khi deploy.');
                }
                return {
                    id: u.id,
                    username: u.username,
                    password,
                    role: u.role || 'user',
                    status: u.status || 'active',
                    assignedBotIds: Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids : [],
                    expiresAt: u.expires_at || null,
                    planName: u.plan_name || 'Gói mặc định',
                    botAliases: (u.bot_aliases && typeof u.bot_aliases === 'object') ? u.bot_aliases : {},
                    createdAt: u.created_at,
                    updatedAt: u.updated_at
                };
            });
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải users:', err.message);
            return null;
        }
    }

    async syncAllUsers(users) {
        if (!this.isEnabled() || !Array.isArray(users)) return false;
        try {
            const rows = users.map(u => ({
                id: String(u.id || ('usr_' + u.username)),
                username: String(u.username),
                password: encryptUserPassword(String(u.password)),
                role: String(u.role || 'user'),
                status: String(u.status || 'active'),
                assigned_bot_ids: Array.isArray(u.assignedBotIds) ? u.assignedBotIds : [],
                expires_at: u.expiresAt ? String(u.expiresAt) : null,
                plan_name: String(u.planName || 'Gói mặc định'),
                bot_aliases: (u.botAliases && typeof u.botAliases === 'object') ? u.botAliases : {},
                updated_at: new Date().toISOString()
            }));
            const res = await fetch(`${this.url}/rest/v1/manager_users`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify(rows),
                signal: AbortSignal.timeout(10000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi đồng bộ users:', err.message);
            return false;
        }
    }

    async deleteUser(userId) {
        if (!this.isEnabled()) return false;
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_users?id=eq.${encodeURIComponent(userId)}`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa user:', err.message);
            return false;
        }
    }

    // --- KEYS ---
    async fetchKeys() {
        if (!this.isEnabled()) return null;
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_keys?select=*`, {
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.map(k => ({
                id: k.id,
                key: k.code || k.key,
                code: k.code || k.key,
                days: k.days,
                planName: k.plan_name,
                botIds: Array.isArray(k.bot_ids) ? k.bot_ids : [],
                used: !!k.used,
                usedBy: k.used_by || null,
                usedAt: k.used_at || null,
                createdAt: k.created_at
            }));
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải keys:', err.message);
            return null;
        }
    }

    async syncAllKeys(keys) {
        if (!this.isEnabled() || !Array.isArray(keys)) return false;
        try {
            const rows = keys.map(k => {
                const code = String(k.key || k.code || '');
                return {
                    id: String(k.id || ('key_' + code)),
                    code,
                    days: Number(k.days || 1),
                    plan_name: String(k.planName || 'Gói mặc định'),
                    bot_ids: Array.isArray(k.botIds) ? k.botIds : [],
                    used: Boolean(k.used),
                    used_by: k.usedBy ? String(k.usedBy) : null,
                    used_at: k.usedAt ? String(k.usedAt) : null
                };
            });
            const res = await fetch(`${this.url}/rest/v1/manager_keys`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify(rows),
                signal: AbortSignal.timeout(10000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi đồng bộ keys:', err.message);
            return false;
        }
    }

    async deleteKey(keyId) {
        if (!this.isEnabled() || !keyId) return false;
        try {
            const raw = String(keyId).trim();
            const id = raw.startsWith('key_') ? raw : ('key_' + raw);
            const res = await fetch(`${this.url}/rest/v1/manager_keys?or=(id.eq.${encodeURIComponent(id)},code.eq.${encodeURIComponent(raw)})`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa key:', err.message);
            return false;
        }
    }

    // --- REGISTRY ---
    async fetchRegistry() {
        if (!this.isEnabled()) return null;
        try {
            const res = await fetch(`${this.url}/rest/v1/bot_registry?id=eq.default&select=*`, {
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const registryData = data[0].data;
                if (!registryData || typeof registryData !== 'object') return null;
                const restored = { ...registryData };
                if (registryData.webhook && typeof registryData.webhook === 'object') {
                    const webhook = { ...registryData.webhook };
                    let legacyMaskedSecret = false;
                    for (const field of ['discordUrl', 'telegramToken']) {
                        const stored = String(webhook[field] || '');
                        if (stored === '[CONFIGURED]') {
                            legacyMaskedSecret = true;
                            delete webhook[field];
                            continue;
                        }
                        if (stored.startsWith('aes256$gcm$')) {
                            const plain = decryptUserPassword(stored);
                            if (!plain) {
                                throw new Error('Không thể giải mã webhook cloud. Hãy giữ nguyên MANAGER_MASTER_KEY khi deploy.');
                            }
                            webhook[field] = plain;
                        }
                    }
                    if (legacyMaskedSecret) webhook._legacyMaskedSecrets = true;
                    restored.webhook = webhook;
                }
                return restored;
            }
            return null;
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải registry:', err.message);
            return null;
        }
    }

    async saveRegistry(payload) {
        if (!this.isEnabled()) return false;
        try {
            const dataToSave = {
                adminPassword: payload.adminPassword,
                dynamicBots: payload.dynamicBots || [],
                disabledEnvUrls: payload.disabledEnvUrls || [],
                disabledEnvIds: payload.disabledEnvIds || [],
                overrides: payload.overrides || [],
                orderUrls: payload.orderUrls || [],
                order: payload.order || [],
                botIdMap: payload.botIdMap || {},
                botAliases: payload.botAliases || {},
                systemSettings: payload.systemSettings || {},
                lastBotId: payload.lastBotId || 0,
                mustChangePassword: payload.mustChangePassword === true,
                supabase: payload.supabase ? {
                    url: payload.supabase.url || '',
                    enabled: !!payload.supabase.enabled
                } : null,
                webhook: payload.webhook ? {
                    enabled: !!payload.webhook.enabled,
                    discordUrl: payload.webhook.discordUrl ? encryptUserPassword(String(payload.webhook.discordUrl)) : '',
                    telegramToken: payload.webhook.telegramToken ? encryptUserPassword(String(payload.webhook.telegramToken)) : '',
                    telegramChatId: String(payload.webhook.telegramChatId || ''),
                    notifyOnOffline: payload.webhook.notifyOnOffline !== false,
                    notifyOnLowTotem: payload.webhook.notifyOnLowTotem !== false,
                    notifyOnLowHealth: payload.webhook.notifyOnLowHealth !== false,
                    notifyOnDeath: payload.webhook.notifyOnDeath !== false,
                    notifyOnRecover: payload.webhook.notifyOnRecover !== false,
                    offlineThresholdMinutes: payload.webhook.offlineThresholdMinutes || 5
                } : {},
                announcement: payload.announcement || {}
            };
            const res = await fetch(`${this.url}/rest/v1/bot_registry`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify([{ id: 'default', data: dataToSave, updated_at: new Date().toISOString() }]),
                signal: AbortSignal.timeout(10000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi lưu registry:', err.message);
            return false;
        }
    }

    // --- SESSIONS ---
    async fetchSessions() {
        if (!this.isEnabled()) return null;
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_sessions?select=*`, {
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (!Array.isArray(data)) return null;
            return data.map(r => ({
                tokenHash: r.token_hash,
                userId: r.user_id,
                username: r.username,
                role: r.role || 'user',
                assignedBotIds: Array.isArray(r.assigned_bot_ids) ? r.assigned_bot_ids : [],
                expiresAt: Number(r.expires_at) || 0,
                planName: r.plan_name || 'Gói thường',
                allowAccountChange: r.allow_account_change !== false,
                status: r.status || 'active'
            }));
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải sessions:', err.message);
            return null;
        }
    }

    async syncAllSessions(sessionsMap) {
        if (!this.isEnabled()) return false;
        try {
            const now = Date.now();
            const rows = [];
            const entries = sessionsMap instanceof Map ? sessionsMap.entries() : Object.entries(sessionsMap || {});
            for (const [tokenHash, s] of entries) {
                if (s && s.expiresAt > now) {
                    rows.push({
                        token_hash: s.tokenHash || tokenHash,
                        user_id: s.userId || '',
                        username: s.username || '',
                        role: s.role || 'user',
                        assigned_bot_ids: Array.isArray(s.assignedBotIds) ? s.assignedBotIds : [],
                        expires_at: Number(s.expiresAt),
                        plan_name: s.planName || 'Gói thường',
                        allow_account_change: s.allowAccountChange !== false,
                        status: s.status || 'active',
                        updated_at: new Date().toISOString()
                    });
                }
            }
            if (rows.length === 0) return true;
            const res = await fetch(`${this.url}/rest/v1/manager_sessions`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify(rows),
                signal: AbortSignal.timeout(8000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi đồng bộ sessions:', err.message);
            return false;
        }
    }

    async deleteSession(tokenHash) {
        if (!this.isEnabled() || !tokenHash) return false;
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(4000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa session trên cloud:', err.message);
            return false;
        }
    }

    // --- BOT SETTINGS ---
    async fetchBotSettings(botId) {
        if (!this.isEnabled() || !botId) return null;
        try {
            const res = await fetch(`${this.url}/rest/v1/bot_settings?bot_id=eq.${encodeURIComponent(String(botId))}&select=*`, {
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(6000)
            });
            if (!res.ok) return null;
            const data = await res.json();
            return Array.isArray(data) && data.length > 0 ? data[0] : null;
        } catch (_) {
            return null;
        }
    }

    async saveBotSettings(botId, payload) {
        if (!this.isEnabled() || !botId) return false;
        try {
            const row = {
                bot_id: String(botId),
                username: String(payload.username || ''),
                password: String(payload.password || ''),
                settings: payload.settings || {},
                proxy: payload.proxy || payload.settings?.proxy || {},
                schedules: payload.botSchedules || payload.schedules || [],
                auto_chat: payload.autoChatSchedules || payload.auto_chat || [],
                updated_at: new Date().toISOString()
            };
            const res = await fetch(`${this.url}/rest/v1/bot_settings`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify([row]),
                signal: AbortSignal.timeout(8000)
            });
            return res.ok;
        } catch (_) {
            return false;
        }
    }

    // --- AUDIT LOGS ---
    async insertAuditLog(entry) {
        if (!this.isEnabled()) return false;
        try {
            const row = {
                id: String(entry.id),
                log_type: String(entry.logType || 'SYSTEM'),
                category: String(entry.category || 'SYSTEM'),
                action: String(entry.action || 'UNKNOWN'),
                action_label: String(entry.actionLabel || entry.action || ''),
                actor_username: String(entry.actor?.username || 'system'),
                actor_role: String(entry.actor?.role || 'system'),
                actor_ip: String(entry.actor?.ip || '127.0.0.1'),
                target: entry.target || {},
                details: String(entry.details || ''),
                status: String(entry.status || 'SUCCESS'),
                timestamp: entry.timestamp || new Date().toISOString()
            };
            const res = await fetch(`${this.url}/rest/v1/audit_logs`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'return=minimal' }),
                body: JSON.stringify([row]),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (_) {
            return false;
        }
    }

    async syncAuditLogs(entries) {
        if (!this.isEnabled() || !Array.isArray(entries)) return false;
        try {
            const rows = entries
                .filter(entry => entry && entry.id)
                .map(entry => ({
                    id: String(entry.id),
                    log_type: String(entry.logType || 'SYSTEM'),
                    category: String(entry.category || 'SYSTEM'),
                    action: String(entry.action || 'UNKNOWN'),
                    action_label: String(entry.actionLabel || entry.action || ''),
                    actor_username: String(entry.actor?.username || 'system'),
                    actor_role: String(entry.actor?.role || 'system'),
                    actor_ip: String(entry.actor?.ip || '127.0.0.1'),
                    target: entry.target || {},
                    details: String(entry.details || ''),
                    status: String(entry.status || 'SUCCESS'),
                    timestamp: entry.timestamp || new Date().toISOString()
                }));
            for (let offset = 0; offset < rows.length; offset += 200) {
                const res = await fetch(`${this.url}/rest/v1/audit_logs`, {
                    method: 'POST',
                    headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                    body: JSON.stringify(rows.slice(offset, offset + 200)),
                    signal: AbortSignal.timeout(12000)
                });
                if (!res.ok) return false;
            }
            return true;
        } catch (err) {
            console.error('[SUPABASE] Lỗi đồng bộ audit logs:', err.message);
            return false;
        }
    }

    async fetchAuditLogs({ logType = '', category = '', status = '', q = '', limit = 50, page = 1 } = {}) {
        if (!this.isEnabled()) return null;
        try {
            const offset = (page - 1) * limit;
            let query = `select=*&order=timestamp.desc&limit=${limit}&offset=${offset}`;
            if (logType) query += `&log_type=eq.${encodeURIComponent(logType)}`;
            if (category) query += `&category=eq.${encodeURIComponent(category)}`;
            if (status) query += `&status=eq.${encodeURIComponent(status)}`;
            if (q) query += `&or=(action.ilike.*${encodeURIComponent(q)}*,details.ilike.*${encodeURIComponent(q)}*,actor_username.ilike.*${encodeURIComponent(q)}*)`;

            const res = await fetch(`${this.url}/rest/v1/audit_logs?${query}`, {
                headers: this.getHeaders({ 'Prefer': 'count=exact' }),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const contentRange = res.headers.get('content-range');
            let total = 0;
            if (contentRange) {
                const parts = contentRange.split('/');
                if (parts[1]) total = parseInt(parts[1], 10) || 0;
            }
            
            const data = await res.json();
            const logs = data.map(r => ({
                id: r.id,
                logType: r.log_type,
                timestamp: r.timestamp,
                actor: {
                    username: r.actor_username,
                    role: r.actor_role,
                    ip: r.actor_ip
                },
                category: r.category,
                action: r.action,
                actionLabel: r.action_label,
                target: r.target,
                details: r.details,
                status: r.status
            }));

            const totalPages = Math.max(1, Math.ceil(total / limit));
            return { logs, total, page, limit, totalPages };
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải audit logs:', err.message);
            return null;
        }
    }

    async clearAuditLogs() {
        if (!this.isEnabled()) return false;
        try {
            const res = await fetch(`${this.url}/rest/v1/audit_logs?id=neq.placeholder_none`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(8000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa audit logs:', err.message);
            return false;
        }
    }
}

const SUPABASE_CONFIG = {
    url: String(process.env.SUPABASE_URL || '').trim(),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim()
};
const supabaseAdapter = new SupabaseAdapter(SUPABASE_CONFIG);

const KEYS_CANDIDATES = [
    path.join(DATA_DIR, 'manager_keys.json'),
    path.join(__dirname, 'manager_keys.json'),
    path.join(process.cwd(), 'manager_keys.json')
].filter((val, idx, arr) => val && arr.indexOf(val) === idx);

function resolveKeysFile() {
    let bestFile = null;
    let maxCount = -1;
    for (const f of KEYS_CANDIDATES) {
        if (fs.existsSync(f)) {
            try {
                const data = JSON.parse(fs.readFileSync(f, 'utf8'));
                if (Array.isArray(data) && data.length > maxCount) {
                    maxCount = data.length;
                    bestFile = f;
                }
            } catch (_) {}
        }
    }
    return bestFile || KEYS_FILE;
}

function loadKeysFile() {
    const file = resolveKeysFile();
    try {
        if (!fs.existsSync(file)) {
            const initial = [];
            fs.writeFileSync(KEYS_FILE, JSON.stringify(initial, null, 2), 'utf8');
            return initial;
        }
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error('[KEYS] Lỗi đọc manager_keys.json:', e.message);
        return [];
    }
}

function saveKeysFile(keysList) {
    try {
        const content = JSON.stringify(keysList, null, 2);
        const tmp = `${KEYS_FILE}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, content, 'utf8');
        try {
            fs.renameSync(tmp, KEYS_FILE);
        } catch (renameErr) {
            fs.copyFileSync(tmp, KEYS_FILE);
            try { fs.unlinkSync(tmp); } catch (_) {}
        }
        for (const candidate of KEYS_CANDIDATES) {
            if (candidate && candidate !== KEYS_FILE) {
                try { fs.writeFileSync(candidate, content, 'utf8'); } catch (_) {}
            }
        }
        if (supabaseAdapter && supabaseAdapter.isEnabled()) {
            void supabaseAdapter.syncAllKeys(keysList);
        }
        return true;
    } catch (e) {
        console.error('[KEYS] Lỗi lưu manager_keys.json:', e.message);
        return false;
    }
}

// ----------------------------------------------------------------------------
// ENTERPRISE SECURITY: MASTER KEY & BOT SECRET CONFIGURATION
// ----------------------------------------------------------------------------
let fileMasterKey = '';
try {
    if (fs.existsSync(MASTER_KEY_FILE)) {
        fileMasterKey = fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
    }
    if (!fileMasterKey) {
        fileMasterKey = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(MASTER_KEY_FILE, fileMasterKey, { encoding: 'utf8', mode: 0o600 });
    }
} catch (e) {
    console.error('[SECURITY] Lỗi đọc/ghi MASTER_KEY_FILE:', e.message);
}

let botSecretKeySource = String(process.env.BOT_SECRET_KEY || MANAGER_CONFIG.BOT_SECRET_KEY || '').trim();
const botSecretKeyFile = path.join(DATA_DIR, '.bot_secret_key');
if (!botSecretKeySource) {
    try {
        if (fs.existsSync(botSecretKeyFile)) {
            botSecretKeySource = fs.readFileSync(botSecretKeyFile, 'utf8').trim();
        }
    } catch (_) {}
}
if (!botSecretKeySource) {
    botSecretKeySource = crypto.randomBytes(32).toString('hex');
    try {
        fs.writeFileSync(botSecretKeyFile, botSecretKeySource, { encoding: 'utf8', mode: 0o600 });
        console.log(`[SECURITY] 🔑 Đã tự động tạo BOT_SECRET_KEY ngẫu nhiên an toàn và lưu vào ${botSecretKeyFile}`);
    } catch (e) {
        console.warn(`[SECURITY] Không thể lưu .bot_secret_key: ${e.message}`);
    }
}
const BOT_SECRET_KEY = botSecretKeySource;

function timingSafeStringEquals(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isBotSecretRequest(req) {
    if (!BOT_SECRET_KEY) return false;
    const incoming = String(req.headers['x-bot-secret'] || '');
    return timingSafeStringEquals(incoming, BOT_SECRET_KEY);
}

const activeMasterSecretSource = String(
    process.env.MANAGER_MASTER_KEY ||
    process.env.BOT_CREDENTIALS_ENCRYPTION_KEY ||
    process.env.BOT_SECRET_KEY ||
    MANAGER_CONFIG.MASTER_KEY ||
    fileMasterKey || ''
);
const SYSTEM_MASTER_SECRET = crypto.createHash('sha256')
    .update(activeMasterSecretSource || crypto.randomBytes(32))
    .digest();

// Danh sách khóa giải mã dự phòng tương thích ngược (để decrypt dữ liệu cũ khi đổi key)
const FALLBACK_SECRETS = [
    SYSTEM_MASTER_SECRET,
    fileMasterKey ? crypto.createHash('sha256').update(fileMasterKey).digest() : null
].filter(Boolean);

function hashAdminPassword(plain) {
    if (!plain) return '';
    if (plain.startsWith('scrypt$')) return plain;
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt$N=16384,r=8,p=1$${salt}$${derivedKey.toString('hex')}`;
}

function verifyAdminPassword(supplied, stored) {
    if (!supplied || !stored) return false;
    if (!stored.startsWith('scrypt$')) {
        const bufA = Buffer.from(supplied);
        const bufB = Buffer.from(stored);
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }
    const parts = stored.split('$');
    let salt = '';
    let originalHash = '';
    if (parts.length === 4) {
        salt = parts[2];
        originalHash = parts[3];
    } else if (parts.length === 6) {
        salt = parts[4];
        originalHash = parts[5];
    } else {
        return false;
    }
    try {
        const derivedKey = crypto.scryptSync(supplied, salt, 64, { N: 16384, r: 8, p: 1 });
        const originalBuffer = Buffer.from(originalHash, 'hex');
        if (originalBuffer.length !== derivedKey.length) return false;
        return crypto.timingSafeEqual(originalBuffer, derivedKey);
    } catch (_) {
        return false;
    }
}

function encryptUserPassword(plain) {
    if (!plain) return '';
    if (plain.startsWith('aes256$gcm$')) return plain;
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', SYSTEM_MASTER_SECRET, iv);
        let encrypted = cipher.update(plain, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `aes256$gcm$${iv.toString('hex')}$${authTag}$${encrypted}`;
    } catch (err) {
        console.error('[SECURITY] Lỗi mã hóa mật khẩu người dùng:', err.message);
        throw new Error('Không thể mã hóa mật khẩu người dùng. Thao tác bị từ chối vì lý do an toàn.');
    }
}

function decryptUserPassword(stored) {
    if (!stored) return '';
    if (!stored.startsWith('aes256$gcm$')) return stored;
    const parts = stored.split('$');
    if (parts.length !== 5) return stored;
    try {
        const [, , ivHex, tagHex, encryptedHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        for (const secretKey of FALLBACK_SECRETS) {
            try {
                const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, iv);
                decipher.setAuthTag(tag);
                let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            } catch (_) {}
        }
        console.error('[SECURITY] Không thể giải mã mật khẩu người dùng với bất kỳ khóa nào.');
        return '';
    } catch (_) {
        return '';
    }
}

function verifyUserPassword(supplied, stored) {
    if (!supplied || !stored) return false;
    const plainStored = decryptUserPassword(stored);
    const bufA = Buffer.from(supplied);
    const bufB = Buffer.from(plainStored);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// ----------------------------------------------------------------------------
// ENTERPRISE BRUTE-FORCE RATE LIMITER
// ----------------------------------------------------------------------------
class MemoryRateLimiter {
    constructor({ maxFailures = 5, ipMaxFailures = 15, windowMs = 15 * 60 * 1000, maxEntries = 5000, message = 'Quá nhiều lần thử thất bại. Vui lòng thử lại sau.' } = {}) {
        this.maxFailures = maxFailures;
        this.ipMaxFailures = ipMaxFailures;
        this.windowMs = windowMs;
        this.maxEntries = maxEntries;
        this.message = message;
        this.attempts = new Map();
        this._lastCleanup = Date.now();
    }

    _clean() {
        const now = Date.now();
        if (now - this._lastCleanup > 60000 || this.attempts.size > this.maxEntries) {
            this._lastCleanup = now;
            for (const [key, val] of this.attempts.entries()) {
                if (now - val.lastAttempt > this.windowMs && (!val.lockedUntil || now > val.lockedUntil)) {
                    this.attempts.delete(key);
                }
            }
            if (this.attempts.size > this.maxEntries) {
                for (const [key, val] of this.attempts.entries()) {
                    if (this.attempts.size <= this.maxEntries) break;
                    if (!val.lockedUntil || now >= val.lockedUntil) {
                        this.attempts.delete(key);
                    }
                }
            }
        }
    }

    _getKeys(ip, identifier = '') {
        const normIp = String(ip || 'unknown').trim().toLowerCase() || 'unknown';
        const normId = String(identifier || '').trim().toLowerCase();
        const keys = [{ key: `ip:${normIp}`, max: this.ipMaxFailures, isIp: true }];
        if (normId) {
            keys.push({ key: `combo:${normIp}:${normId}`, max: this.maxFailures, isIp: false });
            keys.push({ key: `user:${normId}`, max: this.maxFailures, isIp: false });
        }
        return keys;
    }

    check(ip, identifier = '') {
        this._clean();
        const now = Date.now();
        let lockedUntil = 0;
        for (const { key } of this._getKeys(ip, identifier)) {
            const record = this.attempts.get(key);
            if (record?.lockedUntil && now < record.lockedUntil) {
                lockedUntil = Math.max(lockedUntil, record.lockedUntil);
            }
        }
        if (lockedUntil) {
            const remainingSec = Math.ceil((lockedUntil - now) / 1000);
            const remainingMin = Math.ceil(remainingSec / 60);
            return {
                allowed: false,
                error: `${this.message} (Chờ ${remainingMin} phút / ${remainingSec}s)`
            };
        }
        return { allowed: true };
    }

    record(ip, identifier = '', success = false) {
        this._clean();
        const now = Date.now();
        const keys = this._getKeys(ip, identifier);
        for (const { key, max, isIp } of keys) {
            if (success) {
                if (!isIp) {
                    this.attempts.delete(key);
                }
                continue;
            }
            const record = this.attempts.get(key) || { count: 0, lockedUntil: 0, lastAttempt: now };
            record.count += 1;
            record.lastAttempt = now;
            if (record.count >= max) {
                record.lockedUntil = now + this.windowMs;
            }
            this.attempts.set(key, record);
        }
    }
}

const loginLimiter = new MemoryRateLimiter({
    maxFailures: 5,
    ipMaxFailures: 15,
    windowMs: 15 * 60 * 1000,
    message: 'Cổng đăng nhập tạm khóa do nhập sai quá nhiều lần.'
});

const renewLimiter = new MemoryRateLimiter({
    maxFailures: 5,
    ipMaxFailures: 15,
    windowMs: 15 * 60 * 1000,
    message: 'Đã nhập sai mã Key quá nhiều lần.'
});

const changePassLimiter = new MemoryRateLimiter({
    maxFailures: 5,
    ipMaxFailures: 15,
    windowMs: 15 * 60 * 1000,
    message: 'Nhập sai mật khẩu hiện tại quá nhiều lần.'
});

const adminCredsLimiter = new MemoryRateLimiter({
    maxFailures: 5,
    ipMaxFailures: 15,
    windowMs: 15 * 60 * 1000,
    message: 'Sai mật khẩu xác thực cấp 2 quá nhiều lần.'
});

const verifyBotLimiter = new MemoryRateLimiter({
    maxFailures: 10,
    ipMaxFailures: 30,
    windowMs: 5 * 60 * 1000,
    message: 'Quá nhiều yêu cầu xác thực bot không hợp lệ.'
});

const registerLimiter = new MemoryRateLimiter({
    maxFailures: 5,
    ipMaxFailures: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Bạn đã đăng ký quá nhiều tài khoản từ IP này. Vui lòng thử lại sau 15 phút.'
});

function checkRegisterRateLimit(ip, username = '') {
    return registerLimiter.check(ip, username);
}

function recordRegisterAttempt(ip, username = '', success = false) {
    return registerLimiter.record(ip, username, success);
}

const RESTRICTED_MINECRAFT_ACCOUNT_COMMANDS = new Set([
    '/register',
    '/reg',
    '/changepassword',
    '/changepass',
    '/cp',
    '/unregister',
    '/unreg',
    '/authme',
    '/user'
]);

function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

function checkLoginRateLimit(ip, username = '') {
    return loginLimiter.check(ip, username);
}

function recordLoginAttempt(ip, username = '', success = false) {
    return loginLimiter.record(ip, username, success);
}

function checkRenewRateLimit(req, username = '') {
    return renewLimiter.check(getClientIp(req), username);
}

function recordRenewAttempt(req, username = '', success = false) {
    return renewLimiter.record(getClientIp(req), username, success);
}

function isRestrictedMinecraftAccountCommand(value) {
    const command = String(value || '').trim().toLowerCase().split(/\s+/, 1)[0];
    return RESTRICTED_MINECRAFT_ACCOUNT_COMMANDS.has(command);
}

function hasRestrictedMinecraftAccountCommand(schedules) {
    return Array.isArray(schedules) && schedules.some(schedule =>
        Array.isArray(schedule?.messages) && schedule.messages.some(isRestrictedMinecraftAccountCommand)
    );
}

function parseSafeIsoDate(val) {
    if (val === undefined || val === null || String(val).trim() === '') {
        return { valid: true, value: null };
    }
    const parsed = Date.parse(val);
    if (Number.isNaN(parsed)) {
        return { valid: false, error: 'Định dạng ngày hết hạn không hợp lệ.' };
    }
    return { valid: true, value: new Date(parsed).toISOString() };
}

function assignBotsExclusively(allUsers, targetUserIdOrUsername, botIdsToAssign) {
    const cleanBotIds = (Array.isArray(botIdsToAssign) ? botIdsToAssign : []).map(Number).filter(n => Number.isFinite(n));
    if (cleanBotIds.length === 0) return;
    const targetKey = String(targetUserIdOrUsername || '').toLowerCase();
    for (const u of allUsers) {
        const uId = String(u.id || '').toLowerCase();
        const uName = String(u.username || '').toLowerCase();
        if (uId === targetKey || uName === targetKey) {
            continue;
        }
        if (Array.isArray(u.assignedBotIds) && u.assignedBotIds.length > 0) {
            u.assignedBotIds = u.assignedBotIds.map(Number).filter(id => !cleanBotIds.includes(id));
        }
    }
}

function canChangeMinecraftAccount(session) {
    if (!session) return false;
    if (session.role === 'admin') return true;
    return session.allowAccountChange !== false;
}

// ----------------------------------------------------------------------------
// ENTERPRISE AUDIT TRAIL (ACTIVITY LOGS & HISTORY ENGINE)
// ----------------------------------------------------------------------------

const AUDIT_ACTION_METADATA = {
    // AUTHENTICATION & SECURITY
    AUTH_LOGIN_SUCCESS: { category: 'AUTH', label: '🔑 Đăng nhập thành công', icon: '🔑', color: 'var(--green)' },
    AUTH_ADMIN_LOGIN_SUCCESS: { category: 'AUTH', label: '👑 Admin đăng nhập', icon: '👑', color: 'var(--cyan)' },
    AUTH_USER_LOGIN_SUCCESS: { category: 'AUTH', label: '👤 Khách thuê đăng nhập', icon: '👤', color: 'var(--green)' },
    AUTH_LOGIN_FAILED: { category: 'AUTH', label: '❌ Đăng nhập thất bại (Sai pass)', icon: '❌', color: 'var(--red)' },
    AUTH_LOGIN_BLOCKED: { category: 'AUTH', label: '🛡️ Khóa IP chống Brute-Force', icon: '🛡️', color: 'var(--red)' },
    AUTH_USER_LOGIN_DISABLED: { category: 'AUTH', label: '🚫 Tài khoản bị vô hiệu hóa', icon: '🚫', color: 'var(--yellow)' },
    AUTH_USER_LOGIN_EXPIRED: { category: 'AUTH', label: '⏳ Tài khoản đã hết hạn thuê', icon: '⏳', color: 'var(--yellow)' },
    AUTH_LOGOUT: { category: 'AUTH', label: '🚪 Đăng xuất hệ thống', icon: '🚪', color: 'var(--muted)' },
    AUTH_ADMIN_CHANGE_PASS_SUCCESS: { category: 'AUTH', label: '🔒 Admin đổi mật khẩu', icon: '🔒', color: 'var(--cyan)' },
    AUTH_ADMIN_CHANGE_PASS_FAILED: { category: 'AUTH', label: '⚠️ Admin đổi mật khẩu lỗi', icon: '⚠️', color: 'var(--red)' },
    AUTH_USER_CHANGE_PASS_SUCCESS: { category: 'AUTH', label: '🔒 Khách đổi mật khẩu', icon: '🔒', color: 'var(--green)' },
    AUTH_USER_CHANGE_PASS_FAILED: { category: 'AUTH', label: '⚠️ Khách đổi mật khẩu lỗi', icon: '⚠️', color: 'var(--red)' },
    ADMIN_CREDENTIALS_ACCESS: { category: 'AUTH', label: '👁️ Xác thực xem mật khẩu Bot', icon: '👁️', color: 'var(--yellow)' },
    AUTH_VERIFY_BOT_ACCESS: { category: 'AUTH', label: '🚪 Kiểm tra Gate vào Dashboard Bot', icon: '🚪', color: 'var(--cyan)' },

    // BOT CONTROL
    BOT_START: { category: 'BOT_CONTROL', label: '▶ Khởi động Bot', icon: '▶', color: 'var(--green)' },
    BOT_STOP: { category: 'BOT_CONTROL', label: '■ Dừng Bot', icon: '■', color: 'var(--red)' },
    BOT_RESTART: { category: 'BOT_CONTROL', label: '🔄 Khởi động lại Bot', icon: '🔄', color: 'var(--cyan)' },
    BOT_CHAT_SEND: { category: 'BOT_CONTROL', label: '💬 Gửi tin nhắn / Lệnh chat', icon: '💬', color: 'var(--cyan)' },
    BOT_LOGS_CLEAR: { category: 'BOT_CONTROL', label: '🧹 Xóa Event Logs Bot', icon: '🧹', color: 'var(--muted)' },
    BOT_CHAT_LOGS_CLEAR: { category: 'BOT_CONTROL', label: '🧹 Xóa Chat Logs Bot', icon: '🧹', color: 'var(--muted)' },
    BOT_WINDOW_CLICK: { category: 'BOT_CONTROL', label: '🖱️ Tương tác GUI / Click Slot', icon: '🖱️', color: 'var(--purple)' },

    // BOT ACCOUNT
    BOT_ACCOUNT_CHANGE: { category: 'BOT_ACCOUNT', label: '👤 Đổi tài khoản Minecraft Bot', icon: '👤', color: 'var(--yellow)' },
    BOT_COORDS: { category: 'BOT_COORDS', label: '📍 Tọa độ Bot sinh tồn', icon: '📍', color: 'var(--cyan)' },
    BOT_POSITION_UPDATE: { category: 'BOT_COORDS', label: '📍 Tọa độ Bot sinh tồn', icon: '📍', color: 'var(--cyan)' },
    BOT_PROXY_UPDATE: { category: 'BOT_SETTINGS', label: '🌐 Cập nhật Proxy Bot', icon: '🌐', color: 'var(--yellow)' },
    BOT_DEATH: { category: 'BOT_CONTROL', label: '💀 Bot tử vong', icon: '💀', color: 'var(--red)' },
    SUPABASE_SYNC: { category: 'SYSTEM', label: '☁️ Đồng bộ Supabase Cloud', icon: '☁️', color: 'var(--cyan)' },

    // BOT SETTINGS
    BOT_SETTINGS_UPDATE: { category: 'BOT_SETTINGS', label: '⚙️ Cập nhật Cài đặt Bot', icon: '⚙️', color: 'var(--cyan)' },
    BOT_AUTOCHAT_UPDATE: { category: 'BOT_SETTINGS', label: '📢 Cập nhật Tự Động Chat', icon: '📢', color: 'var(--cyan)' },
    BOT_SCHEDULES_UPDATE: { category: 'BOT_SETTINGS', label: '⏰ Cập nhật Lịch trình Bot', icon: '⏰', color: 'var(--cyan)' },

    // BOT INVENTORY
    BOT_INVENTORY_DROP: { category: 'BOT_INVENTORY', label: '📦 Thả vật phẩm (Drop Item)', icon: '📦', color: 'var(--yellow)' },
    BOT_INVENTORY_MOVE: { category: 'BOT_INVENTORY', label: '🔄 Chuyển ô đồ (Move Item)', icon: '🔄', color: 'var(--cyan)' },
    BOT_INVENTORY_EQUIP: { category: 'BOT_INVENTORY', label: '🛡️ Trang bị vật phẩm (Equip)', icon: '🛡️', color: 'var(--green)' },

    // FLEET MANAGEMENT
    BOT_CREATE: { category: 'FLEET', label: '➕ Thêm Bot mới vào Hạm đội', icon: '➕', color: 'var(--green)' },
    BOT_UPDATE: { category: 'FLEET', label: '✏️ Chỉnh sửa thông tin Bot', icon: '✏️', color: 'var(--yellow)' },
    BOT_DELETE: { category: 'FLEET', label: '🗑 Xóa Bot khỏi Hạm đội', icon: '🗑', color: 'var(--red)' },
    BOT_REORDER: { category: 'FLEET', label: '📑 Sắp xếp lại thứ tự Bot', icon: '📑', color: 'var(--cyan)' },
    FLEET_START: { category: 'FLEET', label: '▶ Khởi động toàn bộ Bot', icon: '▶', color: 'var(--green)' },
    FLEET_STOP: { category: 'FLEET', label: '■ Dừng toàn bộ Bot', icon: '■', color: 'var(--red)' },
    FLEET_RESTART: { category: 'FLEET', label: '🔄 Khởi động lại toàn bộ Bot', icon: '🔄', color: 'var(--cyan)' },
    FLEET_BROADCAST_CHAT: { category: 'FLEET', label: '📢 Broadcast lệnh tới Hạm đội', icon: '📢', color: 'var(--purple)' },
    BROADCAST_COMMAND: { category: 'FLEET', label: '📢 Broadcast lệnh tới Hạm đội', icon: '📢', color: 'var(--purple)' },
    FLEET_SETTINGS_UPDATE: { category: 'FLEET', label: '⚙️ Đồng bộ Cài đặt toàn Hạm đội', icon: '⚙️', color: 'var(--cyan)' },
    BOT_RESET_CUSTOMER: { category: 'FLEET', label: '✨ Bàn giao Bot cho khách mới', icon: '✨', color: 'var(--purple)' },

    // USER & SUBSCRIPTION MANAGEMENT
    USER_CREATE: { category: 'USER_MGMT', label: '👤 Tạo tài khoản Khách thuê mới', icon: '👤', color: 'var(--green)' },
    USER_UPDATE: { category: 'USER_MGMT', label: '✏️ Cập nhật thông tin Khách thuê', icon: '✏️', color: 'var(--yellow)' },
    USER_DELETE: { category: 'USER_MGMT', label: '🗑 Xóa tài khoản Khách thuê', icon: '🗑', color: 'var(--red)' },
    ADMIN_EXTEND_RENTAL: { category: 'USER_MGMT', label: '⏳ Admin gia hạn gói thuê', icon: '⏳', color: 'var(--green)' },
    USER_RENTAL_EXPIRED: { category: 'USER_MGMT', label: '⏰ Gói thuê hết hạn - Thu hồi Bot', icon: '⏰', color: 'var(--red)' },

    // LICENSE KEYS
    LICENSE_KEYS_CREATE: { category: 'LICENSE_KEY', label: '🔑 Tạo mã kích hoạt (Giftcode)', icon: '🔑', color: 'var(--green)' },
    LICENSE_KEY_DELETE: { category: 'LICENSE_KEY', label: '🗑 Xóa mã kích hoạt (Giftcode)', icon: '🗑', color: 'var(--red)' },
    RENTAL_RENEW_KEY: { category: 'LICENSE_KEY', label: '⚡ Kích hoạt gia hạn bằng Giftcode', icon: '⚡', color: 'var(--green)' },

    // SYSTEM & NOTIFICATIONS
    ANNOUNCEMENT_UPDATE: { category: 'SYSTEM', label: '📢 Cập nhật Thông báo Toàn hệ thống', icon: '📢', color: 'var(--cyan)' },
    WEBHOOK_CONFIG_UPDATE: { category: 'SYSTEM', label: '🔔 Cập nhật Cấu hình Webhook', icon: '🔔', color: 'var(--cyan)' },
    WEBHOOK_TEST_SEND: { category: 'SYSTEM', label: '🧪 Gửi thử nghiệm Webhook', icon: '🧪', color: 'var(--cyan)' },
    BACKUP_CREATED: { category: 'SYSTEM', label: '💾 Tạo bản sao lưu hệ thống', icon: '💾', color: 'var(--green)' },
    SELF_HEAL_USERS: { category: 'SYSTEM', label: '🛡️ Tự phục hồi dữ liệu Users', icon: '🛡️', color: 'var(--red)' },
    SELF_HEAL_REGISTRY: { category: 'SYSTEM', label: '🛡️ Tự phục hồi dữ liệu Registry', icon: '🛡️', color: 'var(--red)' },
    FLEET_AUTO_HEAL: { category: 'SYSTEM', label: '⚡ Tự động kết nối lại Bot rớt mạng', icon: '⚡', color: 'var(--yellow)' },
    LOG_ROTATED: { category: 'SYSTEM', label: '♻️ Xoay vòng file Audit Log', icon: '♻️', color: 'var(--muted)' },
    AUDIT_LOGS_CLEAR: { category: 'SYSTEM', label: '🗑 Xóa sạch Lịch sử Nhật ký', icon: '🗑', color: 'var(--red)' }
};

let auditLogWriteCount = 0;
function checkRotateAuditLogFile() {
    try {
        if (!fs.existsSync(AUDIT_LOG_FILE)) return;
        const stats = fs.statSync(AUDIT_LOG_FILE);
        if (stats.size > 2 * 1024 * 1024) {
            const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
            const lines = raw.trim().split('\n').filter(Boolean);
            if (lines.length > 2000) {
                const kept = lines.slice(-1000);
                fs.writeFileSync(AUDIT_LOG_FILE, kept.join('\n') + '\n', 'utf8');
            }
        }
    } catch (_) {}
}

function redactSensitiveAuditData(data, depth = 0) {
    if (depth > 6 || data === null || data === undefined) return data;
    if (typeof data === 'string') {
        return data
            .replace(/(password["':\s=]+)([^"',\s}]+)/gi, '$1********')
            .replace(/(bot_?secret["':\s=]+)([^"',\s}]+)/gi, '$1********')
            .replace(/(telegramToken["':\s=]+)([^"',\s}]+)/gi, '$1********');
    }
    if (Array.isArray(data)) {
        return data.map(item => redactSensitiveAuditData(item, depth + 1));
    }
    if (typeof data === 'object') {
        const sensitiveRegex = /^(password|pass|secret|bot_secret|token|apikey|credential|proxy_pass)$/i;
        const out = {};
        for (const [k, v] of Object.entries(data)) {
            if (sensitiveRegex.test(k)) {
                out[k] = '********';
            } else if (typeof v === 'object' && v !== null) {
                out[k] = redactSensitiveAuditData(v, depth + 1);
            } else if (typeof v === 'string') {
                out[k] = redactSensitiveAuditData(v, depth + 1);
            } else {
                out[k] = v;
            }
        }
        return out;
    }
    return data;
}

function logAuditEvent({ req, action, target, details, status = 'SUCCESS', durationMs = 0, category = null, actionLabel = null }) {
    try {
        const session = req ? getSessionUser(req) : null;
        const ip = req ? getClientIp(req) : '127.0.0.1';
        const actionStr = String(action || 'UNKNOWN');
        const meta = AUDIT_ACTION_METADATA[actionStr] || {};
        const cat = category || meta.category || 'SYSTEM';
        const lbl = actionLabel || meta.label || actionStr;

        const sanitizedDetails = redactSensitiveAuditData(details);
        let detailsStr = '';
        if (typeof sanitizedDetails === 'string') {
            detailsStr = sanitizedDetails;
        } else if (sanitizedDetails && typeof sanitizedDetails === 'object') {
            try {
                detailsStr = Object.entries(sanitizedDetails).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' | ');
            } catch (_) {
                detailsStr = JSON.stringify(sanitizedDetails);
            }
        }

        // Phân loại Log rõ ràng: 'BOT' (Tài khoản Minecraft, mật khẩu, proxy, tọa độ) vs 'SYSTEM' (Người dùng bấm nút, login, logout, gia hạn key, v.v.)
        let logType = 'SYSTEM';
        if (
            cat === 'BOT_ACCOUNT' ||
            cat === 'BOT_SETTINGS' ||
            cat === 'BOT_COORDS' ||
            cat === 'BOT_INVENTORY' ||
            actionStr.startsWith('BOT_ACCOUNT') ||
            actionStr.startsWith('BOT_PROXY') ||
            actionStr === 'BOT_POSITION_UPDATE' ||
            actionStr === 'BOT_DEATH'
        ) {
            logType = 'BOT';
        }

        const entry = {
            id: 'aud_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
            logType,
            timestamp: new Date().toISOString(),
            actor: {
                userId: session ? session.userId : (req ? 'anonymous' : 'system'),
                username: session ? session.username : 'system',
                role: session ? session.role : 'system',
                ip
            },
            category: cat,
            action: actionStr,
            actionLabel: lbl,
            target: target || null,
            details: detailsStr || null,
            status,
            durationMs: Number(durationMs || 0)
        };

        if (supabaseAdapter && supabaseAdapter.isEnabled()) {
            void supabaseAdapter.insertAuditLog(entry);
        }
        fs.appendFile(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8', (err) => {
            if (err) console.error('[AUDIT] Lỗi ghi file audit log:', err.message);
        });
        auditLogWriteCount = (auditLogWriteCount || 0) + 1;
        if (auditLogWriteCount >= 100) {
            auditLogWriteCount = 0;
            checkRotateAuditLogFile();
        }
        return entry;
    } catch (err) {
        console.error('[AUDIT] Lỗi ghi audit log:', err.message);
    }
}

function readAuditLogs({ limit = 50, page = 1, q = '', category = '', status = '', actor = '', botId = '', logType = '' } = {}) {
    try {
        if (!fs.existsSync(AUDIT_LOG_FILE)) return { logs: [], total: 0, page: 1, limit, totalPages: 1 };
        const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
        const lines = raw.trim().split('\n').filter(Boolean);
        const entries = [];
        const searchKeyword = q ? String(q).toLowerCase() : '';
        const catFilter = category ? String(category).toUpperCase() : '';
        const statusFilter = status ? String(status).toUpperCase() : '';
        const actorFilter = actor ? String(actor).toLowerCase() : '';
        const botIdFilter = botId ? String(botId) : '';

        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const parsed = JSON.parse(lines[i]);
                const entryLogType = parsed.logType || ((parsed.category === 'BOT_ACCOUNT' || parsed.category === 'BOT_SETTINGS' || parsed.category === 'BOT_COORDS' || parsed.category === 'BOT_INVENTORY') ? 'BOT' : 'SYSTEM');
                if (logType && entryLogType !== logType) continue;
                if (catFilter && parsed.category !== catFilter) continue;
                if (statusFilter && parsed.status !== statusFilter) continue;
                if (actorFilter && (!parsed.actor?.username || !parsed.actor.username.toLowerCase().includes(actorFilter))) continue;
                if (botIdFilter && String(parsed.target?.botId || parsed.target?.id || '') !== botIdFilter) continue;
                if (searchKeyword) {
                    const match = (parsed.action && parsed.action.toLowerCase().includes(searchKeyword)) ||
                                  (parsed.actionLabel && parsed.actionLabel.toLowerCase().includes(searchKeyword)) ||
                                  (parsed.actor?.username && parsed.actor.username.toLowerCase().includes(searchKeyword)) ||
                                  (parsed.actor?.ip && parsed.actor.ip.toLowerCase().includes(searchKeyword)) ||
                                  (parsed.details && parsed.details.toLowerCase().includes(searchKeyword)) ||
                                  (parsed.target && JSON.stringify(parsed.target).toLowerCase().includes(searchKeyword));
                    if (!match) continue;
                }
                entries.push(parsed);
            } catch (_) {}
        }

        const total = entries.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.max(1, Math.min(page, totalPages));
        const offset = (safePage - 1) * limit;
        const paged = entries.slice(offset, offset + limit);

        return { logs: paged, total, page: safePage, limit, totalPages };
    } catch (err) {
        console.error('[AUDIT] Lỗi đọc audit logs:', err.message);
        return { logs: [], total: 0, page: 1, limit, totalPages: 1 };
    }
}

function exportAuditLogsFile(format = 'csv') {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return '';
    const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
    if (format === 'jsonl') return raw;

    const lines = raw.trim().split('\n').filter(Boolean);
    const headers = ['Thời Gian', 'Người Thực Hiện', 'Vai Trò', 'IP', 'Danh Mục', 'Hành Động', 'Mục Tiêu', 'Chi Tiết Thao Tác', 'Trạng Thái'];
    const rows = [headers.join(',')];

    function escapeCsv(val) {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
    }

    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            const e = JSON.parse(lines[i]);
            const timeStr = e.timestamp ? new Date(e.timestamp).toLocaleString('vi-VN') : '';
            const actor = e.actor?.username || 'system';
            const role = e.actor?.role === 'admin' ? 'Quản trị viên' : (e.actor?.role === 'user' ? 'Khách thuê' : 'Hệ thống');
            const ip = e.actor?.ip || '';
            const cat = e.category || 'SYSTEM';
            const action = e.actionLabel || e.action || '';
            let target = '';
            if (e.target) {
                if (typeof e.target === 'object') {
                    target = e.target.label || e.target.username || e.target.key || JSON.stringify(e.target);
                } else target = String(e.target);
            }
            const details = e.details || '';
            const status = e.status || 'SUCCESS';

            rows.push([
                escapeCsv(timeStr),
                escapeCsv(actor),
                escapeCsv(role),
                escapeCsv(ip),
                escapeCsv(cat),
                escapeCsv(action),
                escapeCsv(target),
                escapeCsv(details),
                escapeCsv(status)
            ].join(','));
        } catch (_) {}
    }

    return '\uFEFF' + rows.join('\r\n');
}

function clearAuditLogsFile(session, req) {
    try {
        const adminName = session ? session.username : 'admin';
        const clientIp = req ? getClientIp(req) : '127.0.0.1';
        const entry = {
            id: 'aud_' + Date.now() + '_clear',
            timestamp: new Date().toISOString(),
            actor: {
                userId: session ? session.userId : 'admin',
                username: adminName,
                role: 'admin',
                ip: clientIp
            },
            category: 'SYSTEM',
            action: 'AUDIT_LOGS_CLEAR',
            actionLabel: '🗑 Xóa sạch Lịch sử Nhật ký',
            target: { scope: 'all' },
            details: `Quản trị viên "${adminName}" đã xóa sạch toàn bộ lịch sử nhật ký hoạt động trước đó.`,
            status: 'SUCCESS',
            durationMs: 0
        };
        fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
        return { ok: true, message: 'Đã xóa toàn bộ nhật ký cũ thành công.', entry };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}


// ----------------------------------------------------------------------------
// ENTERPRISE DISASTER RECOVERY: BACKUP ENGINE & SELF-HEALING
// ----------------------------------------------------------------------------
function pruneOldBackups(maxKeep = 30) {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return;
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(BACKUP_DIR, f);
                return { name: f, fullPath, time: fs.statSync(fullPath).mtimeMs };
            })
            .sort((a, b) => b.time - a.time);
        if (files.length > maxKeep) {
            files.slice(maxKeep).forEach(item => {
                try { fs.unlinkSync(item.fullPath); } catch (_) {}
            });
        }
    } catch (_) {}
}

function deleteSystemBackupFile(filename) {
    if (!filename || typeof filename !== 'string' || !/^backup-[A-Za-z0-9._-]+\.json$/.test(filename)) {
        return { ok: false, error: 'Tên file bản sao lưu không hợp lệ.' };
    }
    const resolvedPath = path.resolve(BACKUP_DIR, filename);
    const resolvedDir = path.resolve(BACKUP_DIR);
    if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
        return { ok: false, error: 'Đường dẫn file bản sao lưu không an toàn.' };
    }
    if (!fs.existsSync(resolvedPath)) {
        return { ok: false, error: 'File bản sao lưu không tồn tại.' };
    }
    try {
        fs.unlinkSync(resolvedPath);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}
function listSystemBackups() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return [];
        return fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(BACKUP_DIR, f);
                const stat = fs.statSync(fullPath);
                return {
                    filename: f,
                    sizeBytes: stat.size,
                    createdAt: stat.mtime.toISOString(),
                    mtimeMs: stat.mtimeMs
                };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch (_) {
        return [];
    }
}

function loadUsersRaw() {
    try {
        const f = resolveUsersFile();
        if (fs.existsSync(f)) {
            const raw = fs.readFileSync(f, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
            if (Array.isArray(data.users)) return data.users;
        }
    } catch (_) {}
    return [];
}

function tryRestoreFromBackup(targetType) {
    try {
        const backups = listSystemBackups();
        for (const b of backups) {
            try {
                const raw = fs.readFileSync(path.join(BACKUP_DIR, b.filename), 'utf8');
                const parsed = JSON.parse(raw);
                if (targetType === 'users' && Array.isArray(parsed.users) && parsed.users.length > 0) {
                    if (cachedUsers && cachedUsers.length >= parsed.users.length) {
                        return cachedUsers;
                    }
                    const decrypted = parsed.users.map(u => ({
                        ...u,
                        password: decryptUserPassword(u.password)
                    }));
                    saveUsers(decrypted);
                    console.log(`[SELF-HEAL] 🛡️ Đã tự động phục hồi USERS từ bản backup: ${b.filename}`);
                    logAuditEvent({ action: 'SELF_HEAL_USERS', details: { restoredFrom: b.filename } });
                    return decrypted;
                }
                if (targetType === 'registry' && parsed.registry && typeof parsed.registry === 'object') {
                    console.log(`[SELF-HEAL] 🛡️ Đã tự động phục hồi REGISTRY từ bản backup: ${b.filename}`);
                    logAuditEvent({ action: 'SELF_HEAL_REGISTRY', details: { restoredFrom: b.filename } });
                    return parsed.registry;
                }
            } catch (_) {}
        }
    } catch (e) {
        console.error('[SELF-HEAL] Lỗi trong quá trình quét backup:', e.message);
    }
    return null;
}

function createSystemBackup(reason = 'scheduled') {
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const now = new Date();
        const dateStr = now.toISOString().replace(/[:.]/g, '-');
        const filename = `backup-${dateStr}-${reason}.json`;
        const filePath = path.join(BACKUP_DIR, filename);

        const currentUsers = loadUsersRaw();
        const currentRegistry = (typeof registry !== 'undefined' && registry) ? registry : null;
        let sanitizedRegistry = null;
        if (currentRegistry && typeof currentRegistry === 'object') {
            sanitizedRegistry = JSON.parse(JSON.stringify(currentRegistry));
            if (sanitizedRegistry.supabase) {
                delete sanitizedRegistry.supabase.key;
            }
            if (sanitizedRegistry.webhook) {
                delete sanitizedRegistry.webhook.telegramToken;
                if (sanitizedRegistry.webhook.discordUrl) {
                    sanitizedRegistry.webhook.discordUrl = '[CONFIGURED]';
                }
            }
        }

        const snapshot = {
            version: 2,
            createdAt: now.toISOString(),
            reason,
            registry: sanitizedRegistry,
            users: currentUsers,
            activeSessionsCount: activeSessions.size
        };

        const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
        try {
            fs.renameSync(tmp, filePath);
        } catch (_) {
            fs.copyFileSync(tmp, filePath);
            try { fs.unlinkSync(tmp); } catch (_) {}
        }
        pruneOldBackups(30);

        logAuditEvent({
            action: 'BACKUP_CREATED',
            details: { filename, reason, userCount: currentUsers.length }
        });
        console.log(`[BACKUP] ✅ Đã tạo bản sao lưu an toàn: ${filename} (Lý do: ${reason})`);
        return { ok: true, filename };
    } catch (err) {
        console.error('[BACKUP] ❌ Lỗi sao lưu hệ thống:', err.message);
        return { ok: false, error: err.message };
    }
}

let cachedUsers = null;
let cachedUsersTime = 0;
let cachedUsersMtime = 0;
const USERS_CACHE_TTL_MS = 5000;

const USERS_CANDIDATES = [
    path.join(DATA_DIR, 'manager_users.json'),
    path.join(__dirname, 'manager_users.json'),
    path.join(process.cwd(), 'manager_users.json')
].filter((val, idx, arr) => val && arr.indexOf(val) === idx);

function resolveUsersFile() {
    let bestFile = null;
    let maxUserCount = -1;

    for (const f of USERS_CANDIDATES) {
        if (fs.existsSync(f)) {
            try {
                const raw = fs.readFileSync(f, 'utf8');
                const data = JSON.parse(raw);
                const list = Array.isArray(data) ? data : (Array.isArray(data.users) ? data.users : []);
                if (list.length > maxUserCount) {
                    maxUserCount = list.length;
                    bestFile = f;
                }
            } catch (_) {}
        }
    }

    if (bestFile) return bestFile;
    return USERS_FILE;
}

function loadUsers(forceReload = false) {
    const now = Date.now();
    const resolvedPath = resolveUsersFile();
    let currentMtime = 0;
    try {
        if (fs.existsSync(resolvedPath)) {
            currentMtime = fs.statSync(resolvedPath).mtimeMs;
        }
    } catch (_) {}

    if (!forceReload && cachedUsers && (now - cachedUsersTime < USERS_CACHE_TTL_MS) && currentMtime > 0 && currentMtime === cachedUsersMtime) {
        return cachedUsers;
    }
    try {
        if (!fs.existsSync(resolvedPath)) {
            const restored = tryRestoreFromBackup('users');
            if (restored && Array.isArray(restored) && restored.length > 0) {
                cachedUsers = restored;
                cachedUsersTime = now;
                cachedUsersMtime = 0;
                return restored;
            }
            const initial = { version: 2, users: [], updatedAt: new Date().toISOString() };
            fs.writeFileSync(USERS_FILE, JSON.stringify(initial, null, 2), 'utf8');
            cachedUsers = [];
            cachedUsersTime = now;
            try { cachedUsersMtime = fs.statSync(USERS_FILE).mtimeMs; } catch (_) {}
            return cachedUsers;
        }
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const data = JSON.parse(raw);
        const rawList = Array.isArray(data) ? data : (Array.isArray(data.users) ? data.users : []);
        cachedUsers = rawList.map(u => {
            let pass = u.password;
            try { pass = decryptUserPassword(u.password); } catch (_) {}
            return {
                ...u,
                password: pass
            };
        });
        cachedUsersTime = now;
        cachedUsersMtime = currentMtime;
        return cachedUsers;
    } catch (e) {
        console.error('[USERS] Lỗi đọc manager_users.json:', e.message);
        // Giữ vững bộ nhớ người dùng hiện tại nếu có, không để glitch đọc file làm mất danh sách user
        if (cachedUsers && cachedUsers.length > 0) {
            return cachedUsers;
        }
        const restored = tryRestoreFromBackup('users');
        if (restored) {
            cachedUsers = restored;
            cachedUsersTime = now;
            return restored;
        }
    }
    if (cachedUsers && cachedUsers.length > 0) return cachedUsers;
    return [];
}

function saveUsers(users) {
    if (!Array.isArray(users)) {
        console.error('[USERS] saveUsers: Tham số users không phải mảng!');
        return false;
    }
    try {
        const encryptedUsers = users.map(u => ({
            ...u,
            password: encryptUserPassword(u.password)
        }));
        const content = JSON.stringify({ version: 2, users: encryptedUsers, updatedAt: new Date().toISOString() }, null, 2);
        const tmp = `${USERS_FILE}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, content, 'utf8');
        try {
            fs.renameSync(tmp, USERS_FILE);
        } catch (renameErr) {
            try {
                fs.copyFileSync(tmp, USERS_FILE);
                fs.unlinkSync(tmp);
            } catch (copyErr) {
                console.error('[USERS] Lỗi ghi đè USERS_FILE:', copyErr.message);
                throw copyErr;
            }
        }
        cachedUsers = users.map(u => ({ ...u }));
        cachedUsersTime = Date.now();
        try { cachedUsersMtime = fs.statSync(USERS_FILE).mtimeMs; } catch (_) {}
        if (supabaseAdapter && supabaseAdapter.isEnabled()) {
            void supabaseAdapter.syncAllUsers(users);
        }
        return true;
    } catch (e) {
        console.error('[USERS] Lỗi ghi manager_users.json:', e.message);
        return false;
    }
}

const activeSessions = new Map();

function hashSessionToken(token) {
    if (!token || typeof token !== 'string') return '';
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.sessions)) {
                const now = Date.now();
                activeSessions.clear();
                for (const s of data.sessions) {
                    if (!s || s.expiresAt <= now) continue;
                    const tokenHash = s.tokenHash || (s.token ? hashSessionToken(s.token) : null);
                    if (tokenHash) {
                        activeSessions.set(tokenHash, {
                            ...s,
                            tokenHash,
                            token: undefined
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error('[SESSIONS] Lỗi đọc manager_sessions.json:', e.message);
    }
}

function saveSessions() {
    try {
        const sessions = [];
        const now = Date.now();
        for (const [tokenHash, session] of activeSessions.entries()) {
            if (session.expiresAt > now) {
                // Không bao giờ lưu token thô xuống đĩa, chỉ lưu giá trị băm tokenHash
                sessions.push({
                    tokenHash: session.tokenHash || tokenHash,
                    userId: session.userId,
                    username: session.username,
                    role: session.role,
                    assignedBotIds: session.assignedBotIds,
                    expiresAt: session.expiresAt,
                    expiresAtRental: session.expiresAtRental || null,
                    planName: session.planName || 'Gói thường',
                    allowAccountChange: session.allowAccountChange !== false,
                    status: session.status || 'active'
                });
            }
        }
        const tmp = `${SESSIONS_FILE}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify({ version: 2, sessions, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
        try {
            fs.renameSync(tmp, SESSIONS_FILE);
        } catch (renameErr) {
            fs.copyFileSync(tmp, SESSIONS_FILE);
            try { fs.unlinkSync(tmp); } catch (_) {}
        }
        if (typeof supabaseAdapter !== 'undefined' && supabaseAdapter && supabaseAdapter.isEnabled()) {
            void supabaseAdapter.syncAllSessions(activeSessions);
        }
        return true;
    } catch (e) {
        console.error('[SESSIONS] Lỗi ghi manager_sessions.json:', e.message);
        return false;
    }
}

const saveSessionsFile = saveSessions;
const saveUsersFile = (u = loadUsers()) => saveUsers(u);

loadSessions();

setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [tokenHash, session] of activeSessions.entries()) {
        if (session.expiresAt <= now) {
            activeSessions.delete(tokenHash);
            changed = true;
        }
    }
    if (changed) saveSessions();
}, 600000);

// Khởi tạo bản sao lưu đầu tiên nếu chưa có bản nào
setTimeout(() => {
    try {
        if (listSystemBackups().length === 0) {
            createSystemBackup('initial-startup');
        }
    } catch (_) {}
}, 1000);

// Tự động tạo bản sao lưu an toàn mỗi 6 giờ
setInterval(() => {
    try {
        createSystemBackup('scheduled-interval-6h');
    } catch (e) {
        console.error('[BACKUP] Lỗi tạo backup định kỳ 6h:', e.message);
    }
}, 6 * 3600 * 1000);

function parseCookies(req) {
    const list = {};
    const rc = req.headers?.cookie;
    if (!rc) return list;
    rc.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        const key = parts.shift().trim();
        const rawValue = parts.join('=');
        let value = rawValue;
        try {
            value = decodeURIComponent(rawValue);
        } catch (_) {
            // An invalid percent escape in an unrelated cookie must not break the request.
        }
        if (key) list[key] = value;
    });
    return list;
}

function getSessionForToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const tokenHash = hashSessionToken(rawToken);
    const session = activeSessions.get(tokenHash);
    if (!session) return null;
    const sessionExpiresAt = Number(session.expiresAt);
    if (!Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= Date.now()) {
        activeSessions.delete(tokenHash);
        saveSessions();
        return null;
    }
    if (session.role === 'user') {
        const users = loadUsers();
        if (!users || users.length === 0) {
            // Fail-closed: Nếu không thể xác minh danh sách người dùng, từ chối quyền khách thuê
            return null;
        }
        const found = users.find(u => u.id === session.userId || u.username.toLowerCase() === session.username.toLowerCase());
        if (!found) {
            activeSessions.delete(tokenHash);
            saveSessions();
            return null;
        }
        const userStatus = found.status || 'active';
        const rentalExpiresAt = found.expiresAt ? Date.parse(found.expiresAt) : NaN;
        const isRentalExpired = Number.isFinite(rentalExpiresAt) && Date.now() > rentalExpiresAt;
        if (userStatus === 'expired' || isRentalExpired) {
            session.status = 'expired';
        } else if (userStatus === 'disabled') {
            session.status = 'disabled';
        } else {
            session.status = 'active';
        }
        session.assignedBotIds = Array.isArray(found.assignedBotIds) ? found.assignedBotIds.map(Number) : [];
        session.planName = found.planName || 'Gói thường';
        session.expiresAtRental = found.expiresAt || null;
        session.allowAccountChange = found.allowAccountChange !== false;
    }
    return session;
}

function getAuthToken(req) {
    const authHeader = req.headers?.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        const candidate = authHeader.slice(7).trim();
        if (candidate && getSessionForToken(candidate)) {
            return candidate;
        }
    }
    const cookies = parseCookies(req);
    if (cookies.kingmc_mgr_session && getSessionForToken(cookies.kingmc_mgr_session)) {
        return cookies.kingmc_mgr_session;
    }
    return null;
}

function getSessionUser(req) {
    const authHeader = req.headers?.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        const candidate = authHeader.slice(7).trim();
        if (candidate) {
            const session = getSessionForToken(candidate);
            if (session) return session;
        }
    }
    const cookies = parseCookies(req);
    if (cookies.kingmc_mgr_session) {
        const session = getSessionForToken(cookies.kingmc_mgr_session);
        if (session) return session;
    }
    return null;
}

function checkBotPermission(req, botId) {
    const session = getSessionUser(req);
    if (!session) return { allowed: false, status: 401, error: 'Chưa đăng nhập hệ thống.' };
    if (session.role === 'admin') return { allowed: true, user: session };

    // Kiểm tra trạng thái tài khoản User: Nếu bị tạm khóa hoặc hết hạn thuê thì chặn các thao tác bot
    const users = loadUsers();
    const liveUser = users.find(u => u.username.toLowerCase() === session.username.toLowerCase());
    const userStatus = liveUser ? liveUser.status : session.status;
    const isExpired = userStatus === 'expired' || session.status === 'expired' || (liveUser?.expiresAt && Date.now() > Date.parse(liveUser.expiresAt)) || (session?.expiresAtRental && Date.now() > Date.parse(session.expiresAtRental));
    if (userStatus === 'disabled' || session.status === 'disabled') {
        return { allowed: false, status: 403, error: 'Tài khoản của bạn đang bị tạm khóa bởi Quản trị viên.' };
    }
    if (isExpired) {
        return { allowed: false, status: 403, error: 'Tài khoản của bạn đã hết hạn thuê bot. Vui lòng gia hạn để tiếp tục sử dụng.' };
    }

    const id = Number(botId);
    if (Array.isArray(session.assignedBotIds) && session.assignedBotIds.includes(id)) {
        return { allowed: true, user: session };
    }
    return { allowed: false, status: 403, error: 'Bạn không có quyền quản lý bot này.' };
}

const summaryCache = new Map();
const summaryRefreshInFlight = new Map();
const summaryRequestSeq = new Map();
const summaryLastAppliedSeq = new Map();
const pendingBotUrls = new Set();

function isPrivateOrBlockedIp(ipStr) {
    if (!ipStr || typeof ipStr !== 'string') return true;
    let ip = ipStr.trim().toLowerCase();

    // Strip square brackets [::1] -> ::1
    ip = ip.replace(/^\[|\]$/g, '');

    if (ip === 'localhost' || ip.endsWith('.localhost') || ip === 'metadata.google.internal') return true;

    // Handle IPv4-mapped IPv6 ::ffff:192.168.1.1 or in hex ::ffff:7f00:1
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
    if (ipType === 0) {
        // Domain name or invalid IP string (e.g. bot-1.onrender.com)
        return false;
    }

    // IPv4 Checks
    if (ipType === 4) {
        const parts = ip.split('.').map(p => parseInt(p, 10));
        if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;

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
        if (b0 >= 224 && b0 <= 239) return true; // Multicast
        if (b0 >= 240) return true; // Reserved
        if (parts.every(p => p === 255)) return true; // Broadcast

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

const ALLOWED_INTERNAL_HOSTS = new Set(
    (process.env.ALLOWED_INTERNAL_HOSTS || (MANAGER_PLATFORM === 'local' ? 'localhost,127.0.0.1' : ''))
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
);

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
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
        if (!ALLOWED_INTERNAL_HOSTS.has(hostname)) {
            throw new Error(`Hostname '${hostname}' bị chặn do chính sách bảo mật SSRF.`);
        }
    }

    if (net.isIP(hostname) !== 0) {
        if (isPrivateOrBlockedIp(hostname)) {
            if (!ALLOWED_INTERNAL_HOSTS.has(hostname)) {
                throw new Error(`Địa chỉ IP '${hostname}' là địa chỉ nội bộ bị chặn (SSRF).`);
            }
        }
    } else if (!ALLOWED_INTERNAL_HOSTS.has(hostname)) {
        try {
            const records = await dns.promises.lookup(hostname, { all: true });
            for (const rec of records) {
                if (isPrivateOrBlockedIp(rec.address)) {
                    throw new Error(`Hostname '${hostname}' trỏ về IP nội bộ '${rec.address}' bị chặn (SSRF).`);
                }
            }
        } catch (e) {
            if (e.message.includes('SSRF') || e.message.includes('bị chặn')) throw e;
            throw new Error(`Lỗi phân giải DNS cho '${hostname}': ${e.message}`);
        }
    }

    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
}

function normalizeBotUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    let url;
    try {
        url = new URL(raw);
    } catch (_) {
        throw new Error('URL không hợp lệ.');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('URL bot phải dùng http:// hoặc https://.');
    }

    if (url.username || url.password) {
        throw new Error('URL bot không được chứa username/password.');
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
        if (!ALLOWED_INTERNAL_HOSTS.has(hostname)) {
            throw new Error(`Hostname '${hostname}' bị chặn do chính sách bảo mật SSRF.`);
        }
    }
    if (net.isIP(hostname) !== 0 && isPrivateOrBlockedIp(hostname)) {
        if (!ALLOWED_INTERNAL_HOSTS.has(hostname)) {
            throw new Error(`Địa chỉ IP '${hostname}' là địa chỉ nội bộ bị chặn (SSRF).`);
        }
    }

    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
}

function envBotConfig() {
    const result = [];
    const seenUrls = new Set();

    const labels = String(process.env.BOT_LABELS || MANAGER_CONFIG.BOT_LABELS || '')
        .split(/[,\n]+/)
        .map(value => value.trim());

    function addEntry(rawUrl, rawLabel = '', meta = {}) {
        const value = String(rawUrl || '').trim();
        if (!value) return;

        try {
            const url = normalizeBotUrl(value);
            if (!url || seenUrls.has(url)) return;

            seenUrls.add(url);

            result.push({
                label: String(rawLabel || '').trim() || `Bot ${result.length + 1}`,
                url,
                source: 'env',
                sourceUrl: url,
                legacyNumber: Number.isSafeInteger(meta.legacyNumber)
                    ? meta.legacyNumber
                    : null
            });
        } catch (err) {
            console.error(`[CONFIG] URL bot không hợp lệ: ${value} | ${err.message}`);
        }
    }

    const newUrls = String(process.env.BOT_URLS || MANAGER_CONFIG.BOT_URLS || '')
        .split(/[,\n]+/)
        .map(value => value.trim())
        .filter(Boolean);

    if (newUrls.length) {
        newUrls.forEach((url, index) => addEntry(
            url,
            labels[index] || '',
            {}
        ));
        return result;
    }

    // Legacy compatibility: BOT1_URL/BOT2_URL/... only used when BOT_URLS is empty.
    const legacy = Object.keys(process.env)
        .map(key => {
            const match = key.match(/^BOT(\d+)_URL$/i);
            if (!match) return null;

            return {
                number: Number(match[1]),
                url: process.env[key],
                label: process.env[`BOT${match[1]}_LABEL`] || ''
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.number - b.number);

    for (const item of legacy) {
        addEntry(
            item.url,
            item.label,
            { legacyNumber: item.number }
        );
    }

    return result;
}

function normalizeRegistryUrl(value) {
    try {
        return normalizeBotUrl(value);
    } catch (_) {
        return '';
    }
}

function loadRegistry() {
    const defaultWebhook = {
        enabled: !!(
            MANAGER_CONFIG.DISCORD_WEBHOOK_URL ||
            MANAGER_CONFIG.TELEGRAM_BOT_TOKEN ||
            process.env.DISCORD_WEBHOOK_URL ||
            process.env.TELEGRAM_BOT_TOKEN
        ),
        discordUrl: String(MANAGER_CONFIG.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '').trim(),
        telegramToken: String(MANAGER_CONFIG.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim(),
        telegramChatId: String(MANAGER_CONFIG.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim(),
        notifyOnOffline: true,
        notifyOnLowTotem: true,
        notifyOnLowHealth: true,
        notifyOnDeath: true,
        notifyOnRecover: true,
        offlineThresholdMinutes: 5
    };

    const defaultAnnouncement = {
        enabled: true,
        id: 'ann_v11_6_customer',
        title: '📢 THÔNG BÁO NÂNG CẤP HỆ THỐNG (V11.6 PRO)',
        content: '🎉 Chào mừng bạn đến với KingMC Bot Manager V11.6 Enterprise (19.10.2026)!\n\n🚀 CÁC CẢI TIẾN & NÂNG CẤP DÀNH CHO BẠN:\n• ⚡ Tối Ưu Tốc Độ & Kết Nối: Tăng tốc độ phản hồi bảng điều khiển, dữ liệu bot cập nhật theo thời gian thực (Real-Time) không giật lag.\n• 🛡️ Nâng Cao Ổn Định AFK: Cải thiện cơ chế tự động kết nối lại (Auto-Reconnect) khi máy chủ bảo trì, đảm bảo bot cày cuốc liên tục 24/7 với Uptime 99.9%.\n• ⏱️ Hiển Thị Thời Hạn Chuẩn Xác: Hệ thống tính và hiển thị ngày hết hạn thuê bot minh bạch, chuẩn xác đến từng phút.\n• 📱 Trải Nghiệm Giao Diện Mượt Mà: Tối ưu hiển thị sắc nét trên cả điện thoại và máy tính, thao tác điều khiển bot nhanh chóng và tiện lợi.\n\nChúc quý khách có trải nghiệm AFK mượt mà và hiệu quả tại server KingMC!',
        mode: 'daily',
        startDate: '',
        endDate: '',
        updatedAt: new Date().toISOString()
    };

    const emptyRegistry = {
        version: 3,
        dynamicBots: [],
        disabledEnvUrls: [],
        disabledEnvIds: [],
        overrides: [],
        orderUrls: [],
        order: [],
        botIdMap: {},
        botAliases: {},
        botTags: {},
        systemSettings: { trialGiftEnabled: true, trialDays: 1 },
        lastBotId: 0,
        supabase: null,
        webhook: { ...defaultWebhook },
        announcement: { ...defaultAnnouncement }
    };

    for (const candidate of REGISTRY_CANDIDATES) {
        try {
            if (!fs.existsSync(candidate)) continue;

            const raw = fs.readFileSync(candidate, 'utf8');
            const parsed = JSON.parse(raw);

            REGISTRY_FILE = candidate;

            const dynamicRaw = Array.isArray(parsed.dynamicBots)
                ? parsed.dynamicBots
                : (Array.isArray(parsed.bots) ? parsed.bots : []);

            const dynamicBots = [];
            const dynamicSeen = new Set();

            for (const item of dynamicRaw) {
                const url = normalizeRegistryUrl(item?.url);

                if (!url || dynamicSeen.has(url)) continue;

                dynamicSeen.add(url);
                dynamicBots.push({
                    label: String(item?.label || `Bot ${dynamicBots.length + 1}`).trim(),
                    url
                });
            }

            const disabledEnvUrls = Array.isArray(parsed.disabledEnvUrls)
                ? parsed.disabledEnvUrls
                    .map(normalizeRegistryUrl)
                    .filter(Boolean)
                : [];

            const disabledEnvIds = Array.isArray(parsed.disabledEnvIds)
                ? parsed.disabledEnvIds
                    .map(Number)
                    .filter(Number.isInteger)
                : [];

            const overrides = [];

            if (Array.isArray(parsed.overrides)) {
                for (const item of parsed.overrides) {
                    const sourceUrl = normalizeRegistryUrl(
                        item?.sourceUrl ||
                        item?.keyUrl ||
                        item?.originalUrl ||
                        ''
                    );

                    const url = normalizeRegistryUrl(item?.url);

                    if (
                        !sourceUrl &&
                        !url &&
                        !Number.isInteger(Number(item?.id))
                    ) {
                        continue;
                    }

                    overrides.push({
                        sourceUrl,
                        legacyId: Number.isInteger(Number(item?.id))
                            ? Number(item.id)
                            : null,
                        url,
                        label: String(item?.label || '').trim()
                    });
                }
            }

            const orderUrls = Array.isArray(parsed.orderUrls)
                ? parsed.orderUrls
                    .map(normalizeRegistryUrl)
                    .filter(Boolean)
                : [];

            const order = Array.isArray(parsed.order)
                ? parsed.order
                    .map(Number)
                    .filter(Number.isInteger)
                : [];

            const webhook = {
                enabled: typeof parsed.webhook?.enabled === 'boolean' ? parsed.webhook.enabled : defaultWebhook.enabled,
                discordUrl: String(parsed.webhook?.discordUrl || defaultWebhook.discordUrl).trim(),
                telegramToken: String(parsed.webhook?.telegramToken || defaultWebhook.telegramToken).trim(),
                telegramChatId: String(parsed.webhook?.telegramChatId || defaultWebhook.telegramChatId).trim(),
                notifyOnOffline: parsed.webhook?.notifyOnOffline !== false,
                notifyOnLowTotem: parsed.webhook?.notifyOnLowTotem !== false,
                notifyOnLowHealth: parsed.webhook?.notifyOnLowHealth !== false,
                notifyOnDeath: parsed.webhook?.notifyOnDeath !== false,
                notifyOnRecover: parsed.webhook?.notifyOnRecover !== false,
                offlineThresholdMinutes: Math.max(1, Math.min(60, Number(parsed.webhook?.offlineThresholdMinutes || 5)))
            };

            const announcement = parsed.announcement && typeof parsed.announcement === 'object'
                ? {
                    enabled: parsed.announcement.enabled !== false,
                    id: String(parsed.announcement.id || defaultAnnouncement.id),
                    title: String(parsed.announcement.title || defaultAnnouncement.title).trim(),
                    content: String(parsed.announcement.content || defaultAnnouncement.content).trim(),
                    mode: ['daily', 'every_login', 'time_range'].includes(parsed.announcement.mode) ? parsed.announcement.mode : 'daily',
                    startDate: String(parsed.announcement.startDate || '').trim(),
                    endDate: String(parsed.announcement.endDate || '').trim(),
                    updatedAt: String(parsed.announcement.updatedAt || new Date().toISOString())
                }
                : { ...defaultAnnouncement };

            const adminPassword = parsed.adminPassword ? String(parsed.adminPassword).trim() : undefined;

            const botIdMap = (parsed.botIdMap && typeof parsed.botIdMap === 'object' && !Array.isArray(parsed.botIdMap))
                ? { ...parsed.botIdMap }
                : {};

            const botAliases = (parsed.botAliases && typeof parsed.botAliases === 'object' && !Array.isArray(parsed.botAliases))
                ? { ...parsed.botAliases }
                : {};

            const botTags = (parsed.botTags && typeof parsed.botTags === 'object' && !Array.isArray(parsed.botTags))
                ? { ...parsed.botTags }
                : {};

            const systemSettings = (parsed.systemSettings && typeof parsed.systemSettings === 'object')
                ? {
                    trialGiftEnabled: parsed.systemSettings.trialGiftEnabled !== false,
                    trialDays: Math.max(1, Math.min(365, parseInt(parsed.systemSettings.trialDays, 10) || 1))
                }
                : { trialGiftEnabled: true, trialDays: 1 };

            const lastBotId = Number(parsed.lastBotId) || 0;

            let supabaseKey = loadSupabaseSecretKey();
            if (!supabaseKey && parsed.supabase && parsed.supabase.key) {
                supabaseKey = String(parsed.supabase.key).trim();
                saveSupabaseSecretKey(supabaseKey);
            }
            const supabaseConfig = (parsed.supabase && typeof parsed.supabase === 'object')
                ? {
                    url: String(parsed.supabase.url || '').trim(),
                    key: supabaseKey,
                    enabled: !!(parsed.supabase.url && supabaseKey)
                }
                : null;

            const loaded = {
                version: 3,
                adminPassword,
                dynamicBots,
                disabledEnvUrls: [...new Set(disabledEnvUrls)],
                disabledEnvIds: [...new Set(disabledEnvIds)],
                overrides,
                orderUrls: [...new Set(orderUrls)],
                order,
                botIdMap,
                botAliases,
                botTags,
                systemSettings,
                lastBotId,
                supabase: supabaseConfig,
                webhook,
                announcement,
                mustChangePassword: parsed.mustChangePassword === true
            };

            console.log(
                `[REGISTRY] Loaded ${loaded.dynamicBots.length} dynamic bot(s) from ${REGISTRY_FILE}`
            );

            return loaded;
        } catch (err) {
            console.error(
                `[REGISTRY] Không đọc được ${candidate}: ${err.message}`
            );
            const restored = tryRestoreFromBackup('registry');
            if (restored) return restored;
        }
    }

    console.log(
        '[REGISTRY] Không tìm thấy registry hợp lệ; bắt đầu với cấu hình ENV/dynamic rỗng.'
    );

    return emptyRegistry;
}

const LOCAL_REGISTRY_EXISTED_AT_BOOT = fs.existsSync(REGISTRY_FILE);
const LOCAL_USERS_EXISTED_AT_BOOT = fs.existsSync(USERS_FILE);
const LOCAL_KEYS_EXISTED_AT_BOOT = fs.existsSync(KEYS_FILE);
const LOCAL_SESSIONS_EXISTED_AT_BOOT = fs.existsSync(SESSIONS_FILE);
const registry = loadRegistry();
if (registry.supabase && registry.supabase.url && registry.supabase.key && !supabaseAdapter.isEnabled()) {
    supabaseAdapter.updateConfig(registry.supabase.url, registry.supabase.key);
}
let BOT_CONFIG = [];

function initializeAdminPassword() {
    const envPass = String(process.env.ADMIN_PASSWORD || process.env.MANAGER_ADMIN_PASSWORD || process.env.MANAGER_PASSWORD || '').trim();
    const configPass = String(MANAGER_CONFIG.ADMIN_PASSWORD || '').trim();

    if (envPass) {
        if (!verifyAdminPassword(envPass, registry.adminPassword)) {
            registry.adminPassword = hashAdminPassword(envPass);
            saveRegistry();
            console.log('[SECURITY] 🔑 Mật khẩu Admin đã được cập nhật từ biến môi trường ADMIN_PASSWORD.');
        }
    } else if (configPass) {
        if (!verifyAdminPassword(configPass, registry.adminPassword)) {
            registry.adminPassword = hashAdminPassword(configPass);
            saveRegistry();
            console.log('[SECURITY] 🔑 Mật khẩu Admin đã được cập nhật từ MANAGER_CONFIG.ADMIN_PASSWORD.');
        }
    } else if (registry.adminPassword) {
        // Đã có mật khẩu Admin hợp lệ
    } else {
        // Khởi tạo ban đầu: Mặc định là 'admin123'
        const defaultPass = 'admin123';
        registry.adminPassword = hashAdminPassword(defaultPass);
        registry.mustChangePassword = true;
        saveRegistry();
        console.log('================================================================================');
        console.log('[SECURITY BOOTSTRAP] 🔑 KHỞI TẠO TÀI KHOẢN QUẢN TRỊ VIÊN (ADMIN) LẦN ĐẦU:');
        console.log('  Tài khoản: admin');
        console.log('  Mật khẩu mặc định: admin123');
        console.log('  ⚠️ Vui lòng đổi mật khẩu quản trị ngay sau khi đăng nhập để đảm bảo an toàn!');
        console.log('================================================================================');
    }
}
initializeAdminPassword();

function saveRegistry() {
    try {
        let dynamicBotsToSave = [];
        if (typeof BOT_CONFIG !== 'undefined' && Array.isArray(BOT_CONFIG) && BOT_CONFIG.length > 0) {
            dynamicBotsToSave = BOT_CONFIG
                .filter(bot => bot.source === 'dynamic')
                .map(bot => ({
                    label: bot.label,
                    url: bot.url
                }));
        } else if (Array.isArray(registry.dynamicBots)) {
            dynamicBotsToSave = registry.dynamicBots.map(bot => ({
                label: bot.label,
                url: bot.url
            }));
        }

        const currentBots = (typeof BOT_CONFIG !== 'undefined' && Array.isArray(BOT_CONFIG) && BOT_CONFIG.length > 0)
            ? BOT_CONFIG
            : (registry.dynamicBots || []);

        const payload = {
            version: 3,
            dynamicBots: dynamicBotsToSave,
            disabledEnvUrls: [...new Set(
                registry.disabledEnvUrls
                    .map(normalizeRegistryUrl)
                    .filter(Boolean)
            )],
            disabledEnvIds: Array.isArray(registry.disabledEnvIds) ? [...new Set(registry.disabledEnvIds.map(Number).filter(Number.isInteger))] : [],
            overrides: registry.overrides
                .map(item => ({
                    sourceUrl: normalizeRegistryUrl(item.sourceUrl),
                    url: normalizeRegistryUrl(item.url),
                    label: String(item.label || '').trim()
                }))
                .filter(item => item.sourceUrl || item.url || item.label),
            orderUrls: currentBots.map(bot => bot.url),
            order: Array.isArray(registry.order) ? registry.order : [],
            botIdMap: registry.botIdMap || {},
            botAliases: registry.botAliases || {},
            botTags: registry.botTags || {},
            systemSettings: {
                trialGiftEnabled: registry.systemSettings?.trialGiftEnabled !== false,
                trialDays: Math.max(1, Math.min(365, parseInt(registry.systemSettings?.trialDays, 10) || 1))
            },
            lastBotId: Number(registry.lastBotId) || 0,
            supabase: registry.supabase ? {
                url: registry.supabase.url,
                enabled: !!registry.supabase.enabled
            } : null,
            webhook: {
                enabled: !!registry.webhook?.enabled,
                discordUrl: String(registry.webhook?.discordUrl || '').trim(),
                telegramToken: String(registry.webhook?.telegramToken || '').trim(),
                telegramChatId: String(registry.webhook?.telegramChatId || '').trim(),
                notifyOnOffline: registry.webhook?.notifyOnOffline !== false,
                notifyOnLowTotem: registry.webhook?.notifyOnLowTotem !== false,
                notifyOnLowHealth: registry.webhook?.notifyOnLowHealth !== false,
                notifyOnDeath: registry.webhook?.notifyOnDeath !== false,
                notifyOnRecover: registry.webhook?.notifyOnRecover !== false,
                offlineThresholdMinutes: Math.max(1, Math.min(60, Number(registry.webhook?.offlineThresholdMinutes || 5)))
            },
            announcement: registry.announcement || {
                enabled: true,
                id: 'ann_v11_6_customer',
                title: '📢 THÔNG BÁO NÂNG CẤP HỆ THỐNG (V11.6 PRO)',
                content: '🎉 Chào mừng bạn đến với KingMC Bot Manager V11.6 Enterprise (19.10.2026)!\n\n🚀 CÁC CẢI TIẾN & NÂNG CẤP DÀNH CHO BẠN:\n• ⚡ Tối Ưu Tốc Độ & Kết Nối: Tăng tốc độ phản hồi bảng điều khiển, dữ liệu bot cập nhật theo thời gian thực (Real-Time) không giật lag.\n• 🛡️ Nâng Cao Ổn Định AFK: Cải thiện cơ chế tự động kết nối lại (Auto-Reconnect) khi máy chủ bảo trì, đảm bảo bot cày cuốc liên tục 24/7 với Uptime 99.9%.\n• ⏱️ Hiển Thị Thời Hạn Chuẩn Xác: Hệ thống tính và hiển thị ngày hết hạn thuê bot minh bạch, chuẩn xác đến từng phút.\n• 📱 Trải Nghiệm Giao Diện Mượt Mà: Tối ưu hiển thị sắc nét trên cả điện thoại và máy tính, thao tác điều khiển bot nhanh chóng và tiện lợi.\n\nChúc quý khách có trải nghiệm AFK mượt mà và hiệu quả tại server KingMC!',
                mode: 'daily',
                startDate: '',
                endDate: '',
                updatedAt: new Date().toISOString()
            },
            adminPassword: registry.adminPassword ? (registry.adminPassword.startsWith('scrypt$') ? registry.adminPassword : hashAdminPassword(registry.adminPassword)) : undefined,
            mustChangePassword: registry.mustChangePassword === true
        };

        const tmpFile = `${REGISTRY_FILE}.tmp-${process.pid}-${Date.now()}`;

        try {
            fs.writeFileSync(
                tmpFile,
                JSON.stringify(payload, null, 2),
                'utf8'
            );
            fs.renameSync(tmpFile, REGISTRY_FILE);
        } catch (writeErr) {
            try {
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
            } catch (_) {}
            throw writeErr;
        }

        if (supabaseAdapter && supabaseAdapter.isEnabled()) {
            void supabaseAdapter.saveRegistry(payload);
        }
        return true;
    } catch (err) {
        console.error(
            `[REGISTRY] Không lưu được ${REGISTRY_FILE}: ${err.message}`
        );
        return false;
    }
}

const saveRegistryFile = saveRegistry;

BOT_CONFIG = [];

function buildManagerBotConfig() {
    const envBots = envBotConfig()
        .filter(bot => {
            const sourceUrl = normalizeRegistryUrl(bot.sourceUrl || bot.url);

            if (registry.disabledEnvUrls.includes(sourceUrl)) {
                return false;
            }

            if (
                bot.legacyNumber &&
                registry.disabledEnvIds.includes(bot.legacyNumber)
            ) {
                return false;
            }

            return true;
        });

    const dynamicBots = registry.dynamicBots.map(bot => ({
        label: bot.label,
        url: bot.url,
        source: 'dynamic',
        sourceUrl: bot.url,
        legacyNumber: null
    }));

    const combined = [
        ...envBots,
        ...dynamicBots
    ];

    const overrideApplied = combined.map(bot => ({
        ...bot
    }));

    for (const override of registry.overrides) {
        let target = null;

        if (override.sourceUrl) {
            target = overrideApplied.find(item =>
                item.sourceUrl === override.sourceUrl ||
                item.url === override.sourceUrl
            );
        }

        if (!target && override.legacyId) {
            target = overrideApplied.find(item =>
                item.legacyNumber === override.legacyId
            );
        }

        if (!target) continue;

        if (override.url) {
            target.url = override.url;
        }

        if (override.label) {
            target.label = override.label;
        }
    }

    const seenUrls = new Set();
    const finalBots = [];

    for (const bot of overrideApplied) {
        const url = normalizeRegistryUrl(bot.url);

        if (!url || seenUrls.has(url)) continue;

        seenUrls.add(url);
        finalBots.push({
            label: bot.label || `Bot ${finalBots.length + 1}`,
            url,
            source: bot.source,
            sourceUrl: normalizeRegistryUrl(bot.sourceUrl || url),
            legacyNumber: bot.legacyNumber || null
        });
    }

    // Plug-and-play: Tự động khởi tạo Bot 1 (Local) nếu registry hoàn toàn rỗng trên môi trường mới
    if (finalBots.length === 0 && Number(registry.lastBotId || 0) === 0 && !LOCAL_REGISTRY_EXISTED_AT_BOOT) {
        const defaultLocalUrl = String(process.env.BOT_URL || process.env.DEFAULT_BOT_URL || 'http://localhost:3001').trim();
        finalBots.push({
            label: 'Bot 1 (Local)',
            url: normalizeRegistryUrl(defaultLocalUrl),
            source: 'dynamic',
            sourceUrl: normalizeRegistryUrl(defaultLocalUrl),
            legacyNumber: 1
        });
    }

    const orderUrls = registry.orderUrls || [];

    if (orderUrls.length) {
        const orderIndex = new Map(
            orderUrls.map((url, index) => [url, index])
        );

        finalBots.sort((a, b) => {
            const ai = orderIndex.has(a.url)
                ? orderIndex.get(a.url)
                : Number.MAX_SAFE_INTEGER;

            const bi = orderIndex.has(b.url)
                ? orderIndex.get(b.url)
                : Number.MAX_SAFE_INTEGER;

            if (ai !== bi) return ai - bi;
            return a.url.localeCompare(b.url);
        });
    }

    if (!registry.botIdMap) registry.botIdMap = {};
    let maxId = 0;
    Object.values(registry.botIdMap).forEach(val => {
        const num = Number(val);
        if (num > maxId) maxId = num;
    });

    let mapModified = false;
    const mapped = finalBots.map((bot, index) => {
        let assignedId = registry.botIdMap[bot.url];
        if (!assignedId) {
            maxId++;
            assignedId = maxId;
            registry.botIdMap[bot.url] = assignedId;
            mapModified = true;
        }
        return {
            ...bot,
            id: Number(assignedId),
            tags: (registry.botTags && registry.botTags[assignedId]) || []
        };
    });

    if (mapModified) {
        BOT_CONFIG = mapped;
        saveRegistry();
    }
    return mapped;
}

BOT_CONFIG = buildManagerBotConfig();

function applyRegistryOverridesAndOrder() {
    // BOT_CONFIG is already assembled, normalized, deduplicated and ordered.
    return BOT_CONFIG;
}

applyRegistryOverridesAndOrder();


function sanitizeBotForSession(botData, session) {
    if (!botData) return botData;
    if (session && session.role === 'admin') return botData;
    const copy = { ...botData };
    copy.url = '';
    delete copy.sourceUrl;
    delete copy.registryFile;
    return copy;
}

function buildUnavailableSummary(botConfig, error = 'Chưa kết nối được tới bot.') {
    return {
        id: botConfig.id,
        url: botConfig.url || '',
        source: botConfig.source || 'unknown',
        botId: String(botConfig.id),
        label: botConfig.label,
        configured: !!botConfig.url,
        available: false,
        username: '',
        status: 'offline',
        ready: false,
        ping: null,
        uptime: '0h 0m 0s',
        uptimeSeconds: 0,
        reconnectCount: 0,
        host: '',
        port: null,
        position: null,
        dimension: null,
        ipAddress: '',
        locationState: 'unknown',
        roundedLocation: null,
        settings: null,
        totemCount: 0,
        foodCount: 0,
        health: 20,
        food: 20,
        goldenAppleCount: 0,
        isDead: false,
        deathCount: 0,
        lastDeathCoords: '',
        manuallyStopped: false,
        lastKickReason: '',
        currentWindow: null,
        memory: null,
        rssMb: 0,
        heapMb: 0,
        error
    };
}

// Numeric IDs are sequential positive integers (+1 based on addition order)
function nextBotId() {
    let maxId = 0;
    if (registry.lastBotId && Number(registry.lastBotId) > 0) {
        maxId = Number(registry.lastBotId);
    }
    for (const b of BOT_CONFIG) {
        const num = Number(b.id);
        if (num > maxId) maxId = num;
    }
    if (registry.botIdMap) {
        for (const val of Object.values(registry.botIdMap)) {
            const num = Number(val);
            if (num > maxId) maxId = num;
        }
    }
    const nextId = maxId + 1;
    registry.lastBotId = nextId;
    return nextId;
}

for (const config of BOT_CONFIG) {
    summaryCache.set(config.id, {
        at: 0,
        data: config.url
            ? buildUnavailableSummary(config, 'Đang kiểm tra bot...')
            : buildUnavailableSummary(config, 'Chưa cấu hình URL cho bot.')
    });
}

function isHttps(req) {
    return !!(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

function serializeCookie(name, value, options = {}) {
    let cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
    if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
    if (options.secure) cookie += `; Secure`;
    return cookie;
}

function clearCookieHeader(name, secure = false) {
    let cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0`;
    if (secure) cookie += `; Secure`;
    return cookie;
}

app.use(express.json({ limit: '512kb', strict: true }));

app.use((req, res, next) => {
    // Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'; object-src 'none';");
    if (isHttps(req)) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (req.path.startsWith('/api/') || req.path === '/health') {
        res.setHeader(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate'
        );
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// CSRF Protection Middleware for Browser state-changing requests
app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        // Allow verified service-to-service requests
        if (isBotSecretRequest(req)) {
            return next();
        }
        if (req.path === '/api/auth/login' || req.path === '/api/auth/register' || req.path === '/api/auth/verify-bot-access') {
            return next();
        }
        const cookies = parseCookies(req);
        const hasSessionCookie = !!cookies.kingmc_mgr_session;
        const origin = req.headers['origin'];
        const host = req.headers['host'];

        if (hasSessionCookie && !origin && !req.headers['referer']) {
            return res.status(403).json({ ok: false, error: 'Yêu cầu từ trình duyệt thiếu header xác thực nguồn (Origin/Referer).' });
        }

        if (origin && host) {
            try {
                const originHost = new URL(origin).host;
                if (originHost !== host) {
                    return res.status(403).json({ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (Origin mismatch).' });
                }
            } catch (_) {
                return res.status(403).json({ ok: false, error: 'Origin header không hợp lệ.' });
            }
        } else if (!origin && req.headers['referer'] && host) {
            try {
                const refererHost = new URL(req.headers['referer']).host;
                if (refererHost !== host) {
                    return res.status(403).json({ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (Referer mismatch).' });
                }
            } catch (_) {
                return res.status(403).json({ ok: false, error: 'Referer header không hợp lệ.' });
            }
        }
    }
    next();
});

app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({ ok: false, error: 'JSON request không hợp lệ.' });
    }
    return next(err);
});

function getBotConfig(id) {
    const numericId = Number(id);
    return BOT_CONFIG.find(bot => bot.id === numericId) || null;
}

function isValidBotId(id) {
    return !!getBotConfig(id);
}

// ============================================================================
// HỆ THỐNG GHI NHẬN METRICS VÀ VẼ SPARKLINE LỊCH SỬ (RAM & PING)
// ============================================================================
const botMetricsHistory = new Map(); // id -> { ram: [], ping: [] }

function recordBotMetrics(id, data) {
    if (!id || !data) return;
    let hist = botMetricsHistory.get(id);
    if (!hist) {
        hist = { ram: [], ping: [] };
        botMetricsHistory.set(id, hist);
    }
    const ram = Number(data.ramRss || data.rssMb || data.memory?.rssMb || 0);
    if (ram > 0) {
        hist.ram.push(ram);
        if (hist.ram.length > 12) hist.ram.shift();
    }
    const ping = Number(data.ping || 0);
    if (ping > 0) {
        hist.ping.push(ping);
        if (hist.ping.length > 12) hist.ping.shift();
    }
    data.history = { ram: [...hist.ram], ping: [...hist.ping] };
}

// ============================================================================
// HỆ THỐNG CẢNH BÁO WEBHOOK DISCORD & TELEGRAM (WIZARD & HEALTH REPORTER)
// ============================================================================
const webhookAlertState = new Map();
const botWebhookState = new Map(); // botId -> { offlineSince, offlineAlertSent, lastLowTotemAlertAt }

function validateSafeDiscordWebhook(url) {
    if (!url) return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return false;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'discord.com' && host !== 'discordapp.com') return false;
    if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) return false;
    return true;
}

async function sendDiscordWebhook(url, payload) {
    if (!url) return false;
    if (!validateSafeDiscordWebhook(url)) {
        const safeMasked = String(url).replace(/webhooks\/(\d+)\/[^/?#\s]+/i, 'webhooks/$1/****');
        console.error('[WEBHOOK] URL Discord không hợp lệ hoặc vi phạm chính sách SSRF:', safeMasked);
        return false;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok;
    } catch (err) {
        console.error('[WEBHOOK] Lỗi gửi Discord:', err.message);
        return false;
    }
}

async function sendTelegramMessage(token, chatId, text) {
    if (!token || !chatId) return false;
    try {
        const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'HTML'
            })
        });
        return response.ok;
    } catch (err) {
        console.error('[WEBHOOK] Lỗi gửi Telegram:', err.message);
        return false;
    }
}

async function dispatchManagerWebhookAlert({ type, bot, message, details = {} }) {
    const config = registry.webhook;
    if (!config || !config.enabled) return;
    const hasDiscord = !!config.discordUrl;
    const hasTelegram = !!(config.telegramToken && config.telegramChatId);
    if (!hasDiscord && !hasTelegram) return;

    let color = 0x3498DB;
    let emoji = 'ℹ️';
    if (type === 'offline') { color = 0xE74C3C; emoji = '🚨'; }
    else if (type === 'recover') { color = 0x2ECC71; emoji = '✅'; }
    else if (type === 'low_totem') { color = 0xF1C40F; emoji = '🪙'; }
    else if (type === 'low_health') { color = 0xE67E22; emoji = '⚠️'; }
    else if (type === 'death') { color = 0xC0392B; emoji = '💀'; }

    const title = `${emoji} [${type.toUpperCase()}] ${bot ? bot.label : 'KingMC Bot Manager'}`;
    const desc = message || 'Thông báo trạng thái từ KingMC Bot Manager.';

    if (hasDiscord) {
        const fields = [];
        if (bot) {
            fields.push({ name: '👤 Username', value: bot.username || 'Chưa đặt', inline: true });
            fields.push({ name: '🌐 Trạng thái', value: bot.status || 'offline', inline: true });
            if (bot.totemCount !== undefined) {
                fields.push({ name: '🪙 Totem', value: String(bot.totemCount), inline: true });
            }
            if (bot.url) {
                fields.push({ name: '🔗 Host / URL', value: bot.url, inline: false });
            }
        }
        for (const [k, v] of Object.entries(details)) {
            fields.push({ name: k, value: String(v), inline: true });
        }
        sendDiscordWebhook(config.discordUrl, {
            username: 'KingMC Bot Sentinel',
            avatar_url: 'https://cdn.iconscout.com/icon/free/png-256/free-minecraft-logo-icon-download-in-svg-png-gif-file-formats--logos-pack-games-icons-722650.png',
            embeds: [{
                title,
                description: desc,
                color,
                fields,
                footer: { text: `KingMC Manager • ${new Date().toLocaleTimeString('vi-VN')}` },
                timestamp: new Date().toISOString()
            }]
        }).catch(() => {});
    }

    if (hasTelegram) {
        let tgText = `<b>${title}</b>\n${desc}\n`;
        if (bot) {
            tgText += `\n• <b>Bot:</b> ${bot.label} (${bot.username || 'Chưa đặt'})`;
            tgText += `\n• <b>Trạng thái:</b> ${bot.status || 'offline'}`;
            if (bot.totemCount !== undefined) tgText += `\n• <b>Totem:</b> ${bot.totemCount}`;
        }
        for (const [k, v] of Object.entries(details)) {
            tgText += `\n• <b>${k}:</b> ${v}`;
        }
        tgText += `\n\n<i>Thời gian: ${new Date().toLocaleTimeString('vi-VN')}</i>`;
        sendTelegramMessage(config.telegramToken, config.telegramChatId, tgText).catch(() => {});
    }
}

function checkBotWebhookAlert(botConfig, summary) {
    const config = registry.webhook;
    if (!config || !config.enabled || !botConfig) return;

    const botId = botConfig.id;
    let state = webhookAlertState.get(botId);
    if (!state) {
        state = { offlineSince: null, offlineAlertSent: false, lastLowTotemAlertAt: 0, lastLowHealthAlertAt: 0, lastDeathAlertAt: 0, lastStatus: 'unknown' };
        webhookAlertState.set(botId, state);
    }

    if (summary.manuallyStopped) {
        state.offlineSince = null;
        state.offlineAlertSent = false;
        return;
    }
    const isAvailable = !!summary.available;
    const isOnline = isAvailable && (summary.status === 'afk' || summary.status === 'online');
    const isOffline = !isAvailable || ['offline', 'error', 'disconnected', 'kicked', 'stopped'].includes(summary.status);

    const now = Date.now();

    if (isOffline) {
        if (!state.offlineSince) {
            state.offlineSince = now;
        }
        const offlineMinutes = (now - state.offlineSince) / 60000;
        const threshold = Number(config.offlineThresholdMinutes || 5);

        if (offlineMinutes >= threshold && !state.offlineAlertSent && config.notifyOnOffline) {
            state.offlineAlertSent = true;
            dispatchManagerWebhookAlert({
                type: 'offline',
                bot: { label: botConfig.label, username: summary.username, status: summary.status || 'offline', url: botConfig.url, totemCount: summary.totemCount },
                message: `Bot đã mất kết nối hoặc offline hơn ${Math.round(offlineMinutes)} phút liên tục.`,
                details: { '⚠️ Lỗi': summary.error || 'Mất tín hiệu kết nối bot.' }
            });
        }
    } else {
        if (state.offlineAlertSent && isOnline && config.notifyOnRecover) {
            dispatchManagerWebhookAlert({
                type: 'recover',
                bot: { label: botConfig.label, username: summary.username, status: summary.status, url: botConfig.url, totemCount: summary.totemCount },
                message: 'Bot đã trực tuyến trở lại và đang chạy ổn định.',
                details: { '⏱ Uptime': summary.uptime || '0m', '📶 Ping': `${summary.ping || 0} ms` }
            });
        }
        state.offlineSince = null;
        state.offlineAlertSent = false;

        // Cảnh báo sắp hết Totem (<= 1 totem)
        if (config.notifyOnLowTotem && isOnline && typeof summary.totemCount === 'number' && summary.totemCount <= 1) {
            if (now - state.lastLowTotemAlertAt > 30 * 60000) {
                state.lastLowTotemAlertAt = now;
                dispatchManagerWebhookAlert({
                    type: 'low_totem',
                    bot: { label: botConfig.label, username: summary.username, status: summary.status, url: botConfig.url, totemCount: summary.totemCount },
                    message: `Số lượng Totem nguy hiểm: còn **${summary.totemCount}** cái! Cần tiếp tế gấp.`
                });
            }
        }

        // Cảnh báo Máu yếu khẩn cấp (< 5 tim / <= 10 HP)
        if (config.notifyOnLowHealth !== false && isOnline && typeof summary.health === 'number' && summary.health <= 10 && summary.health > 0) {
            if (!state.lastLowHealthAlertAt || (now - state.lastLowHealthAlertAt > 10 * 60000)) {
                state.lastLowHealthAlertAt = now;
                dispatchManagerWebhookAlert({
                    type: 'low_health',
                    bot: { label: botConfig.label, username: summary.username, status: summary.status, url: botConfig.url, totemCount: summary.totemCount },
                    message: `Cảnh báo Máu yếu khẩn cấp: còn **${summary.health}/20 HP** (< 5 tim)! Cần kiểm tra khu vực AFK.`,
                    details: { '🩸 Máu': `${summary.health} / 20 HP`, '🪙 Totem': String(summary.totemCount ?? 0) }
                });
            }
        } else if (typeof summary.health === 'number' && summary.health > 14) {
            state.lastLowHealthAlertAt = 0;
        }

        // Cảnh báo Bot tử vong (chết)
        const isDead = summary.isDead || summary.health === 0 || summary.status === 'death';
        if (config.notifyOnDeath !== false && isDead) {
            if (!state.lastDeathAlertAt || (now - state.lastDeathAlertAt > 5 * 60000)) {
                state.lastDeathAlertAt = now;
                dispatchManagerWebhookAlert({
                    type: 'death',
                    bot: { label: botConfig.label, username: summary.username, status: 'DEATH', url: botConfig.url, totemCount: summary.totemCount },
                    message: 'Bot đã tử vong (chết) trong game! Hệ thống đang chờ tự động hồi sinh...',
                    details: { '💀 Số lần chết': String(summary.deathCount || 1), '📍 Tọa độ': summary.lastDeathCoords || summary.roundedLocation || 'Không xác định' }
                });
            }
        }
    }
    state.lastStatus = summary.status;
}

// Background Watchdog kiểm tra bot định kỳ mỗi 60s để kích hoạt webhook & Tự động phục hồi fleet lệch pha
setInterval(async () => {
    try {
        const now = Date.now();
        let offlineIndex = 0;
        for (const bot of BOT_CONFIG) {
            if (!bot.url) continue;
            const summary = await getBotSummary(bot, { force: false }).catch(() => null);
            // Tự động phục hồi Bot bị Offline / Kicked (Đã tắt theo cấu hình FLEET_AUTO_HEAL: false)
            if (MANAGER_CONFIG.FLEET_AUTO_HEAL === true && summary.available && (summary.status === 'offline' || summary.status === 'kicked')) {
                if (summary.manuallyStopped) continue;
                const state = botWebhookState.get(bot.id || bot.url) || {};
                const lastRecovery = state.lastAutoRecoveryAt || 0;
                // Nếu bot offline và đã qua ít nhất 2 phút kể từ lần thử tự phục hồi trước
                if (now - lastRecovery >= 120000) {
                    state.lastAutoRecoveryAt = now;
                    botWebhookState.set(bot.id || bot.url, state);
                    const staggerDelay = (offlineIndex++) * 2500;
                    setTimeout(() => {
                        console.log(`[FLEET AUTO-HEALING] ⚡ Tự động gửi lệnh kết nối lại cho ${bot.label || bot.url} sau ${staggerDelay / 1000}s lệch pha...`);
                        fetchChild(bot, '/api/bot/start', { method: 'POST' }).catch(() => {});
                        logAuditEvent({
                            action: 'FLEET_AUTO_HEAL',
                            target: { botId: bot.id, label: bot.label },
                            details: `Tự động kết nối lại bot sau khi bị ${summary.status}`,
                            status: 'SUCCESS'
                        });
                    }, staggerDelay);
                }
            }
        }
    } catch (_) {}
}, Number(MANAGER_CONFIG.WATCHDOG_INTERVAL_MS || 60000));

// Auto-Expiry Watchdog (Quét hạn thuê tài khoản mỗi 10 giây)
setInterval(async () => {
    try {
        const now = Date.now();
        let changed = false;
        const expiredUsers = [];
        const users = loadUsers();

        for (const user of users) {
            if (user.role === 'admin') continue;
            if (user.status === 'active' && user.expiresAt) {
                const expTime = Date.parse(user.expiresAt);
                if (!isNaN(expTime) && now > expTime) {
                    user.status = 'expired';
                    changed = true;
                    expiredUsers.push(user);
                }
            }
        }

        if (changed) {
            saveUsers(users);
            void syncAuthToAllBots(true);
            for (const u of expiredUsers) {
                // Đánh dấu phiên đăng nhập của user hết hạn để UI hiển thị overlay gia hạn
                for (const [token, sess] of activeSessions.entries()) {
                    if (sess.username?.toLowerCase() === u.username?.toLowerCase()) {
                        sess.status = 'expired';
                    }
                }
                saveSessions();

                // Dừng bot và tắt hẹn giờ bot nếu không còn ai active dùng chung
                const userBots = u.assignedBotIds || [];
                const otherActiveUsers = users.filter(o => o.username?.toLowerCase() !== u.username?.toLowerCase() && o.status === 'active');
                for (const botId of userBots) {
                    const isShared = otherActiveUsers.some(o => (o.assignedBotIds || []).includes(botId));
                    if (!isShared) {
                        const botConfig = getBotConfig(botId);
                        if (botConfig && botConfig.url) {
                            fetchChild(botConfig, '/api/bot/stop', { method: 'POST', body: { reason: 'Hết hạn gói thuê' } }).catch(() => {});
                            fetchChild(botConfig, '/api/bot-schedules', {
                                method: 'POST',
                                body: { enabled: false }
                            }).catch(() => {});
                        }
                    }
                }

                // Ghi Audit Log & bắn Webhook
                logAuditEvent({
                    action: 'USER_RENTAL_EXPIRED',
                    target: { username: u.username, assignedBots: u.assignedBotIds },
                    details: `Gói thuê [${u.planName || 'Thuê bot'}] của khách đã hết hạn. Đã thu hồi bot.`,
                    status: 'SUCCESS'
                });

                if (registry.webhook?.enabled) {
                    dispatchManagerWebhookAlert({
                        type: 'rental_expired',
                        bot: { label: `Khách: ${u.username}`, username: u.username, status: 'EXPIRED' },
                        message: `⏳ Gói thuê của khách **${u.username}** (${u.planName || 'Gói thường'}) đã hết hạn lúc ${new Date().toLocaleString('vi-VN')}. Hệ thống đã tự động dừng các bot liên quan.`
                    });
                }
            }
        }
    } catch (e) {
        console.error('[AUTO-EXPIRY] Lỗi quét hạn thuê:', e.message);
    }
}, 10000);

// ----------------------------------------------------------------------------
// ENTERPRISE SERVICE-TO-SERVICE AUTH SYNC (MANAGER -> BOT CON)
// ----------------------------------------------------------------------------
const userSyncHashCache = new Map();
let adminSyncHashCache = { pass: '', hash: '' };

function hashSyncUserPassword(userId, plainPassword) {
    if (!plainPassword) return '';
    const cacheKey = String(userId) + ':' + String(plainPassword);
    if (userSyncHashCache.has(cacheKey)) {
        return userSyncHashCache.get(cacheKey);
    }
    const salt = crypto.createHmac('sha256', SYSTEM_MASTER_SECRET)
        .update('bot-sync-salt:' + userId + ':' + plainPassword)
        .digest('hex').slice(0, 32);
    const derivedKey = crypto.scryptSync(plainPassword, salt, 64, { N: 16384, r: 8, p: 1 });
    const hash = 'scrypt$N=16384,r=8,p=1$' + salt + '$' + derivedKey.toString('hex');
    if (userSyncHashCache.size > 2000) userSyncHashCache.clear();
    userSyncHashCache.set(cacheKey, hash);
    return hash;
}

function getSyncAdminPasswordHash() {
    const adminPass = getAdminPassword();
    if (adminPass.startsWith('scrypt$')) return adminPass;
    if (adminSyncHashCache.pass === adminPass && adminSyncHashCache.hash) {
        return adminSyncHashCache.hash;
    }
    const salt = crypto.createHmac('sha256', SYSTEM_MASTER_SECRET)
        .update('bot-sync-admin-salt:' + adminPass)
        .digest('hex').slice(0, 32);
    const derivedKey = crypto.scryptSync(adminPass, salt, 64, { N: 16384, r: 8, p: 1 });
    const hash = 'scrypt$N=16384,r=8,p=1$' + salt + '$' + derivedKey.toString('hex');
    adminSyncHashCache = { pass: adminPass, hash };
    return hash;
}

function buildBotAuthSyncPayload(botConfig) {
    const botId = Number(botConfig.id);
    const users = loadUsers();
    const syncedUsers = [];
    for (const u of users) {
        const assigned = Array.isArray(u.assignedBotIds) ? u.assignedBotIds.map(Number) : [];
        if (assigned.includes(botId)) {
            const plainPass = decryptUserPassword(u.password);
            syncedUsers.push({
                username: u.username,
                passwordHash: hashSyncUserPassword(u.id || u.username, plainPass),
                status: u.status || 'active',
                expiresAt: u.expiresAt || null,
                allowAccountChange: u.allowAccountChange !== false,
                assignedBotIds: assigned
            });
        }
    }
    return {
        managerBotId: botId,
        authRevision: Date.now(),
        adminPasswordHash: getSyncAdminPasswordHash(),
        users: syncedUsers,
        updatedAt: new Date().toISOString()
    };
}

const lastAuthSyncSignatures = new Map();
const syncInFlight = new Set();

async function syncAuthToBot(botConfig, force = false) {
    if (!botConfig || !botConfig.url) return false;
    const botId = Number(botConfig.id);
    if (syncInFlight.has(botId)) return false;
    try {
        syncInFlight.add(botId);
        const payload = buildBotAuthSyncPayload(botConfig);
        const sigData = JSON.stringify({
            managerBotId: payload.managerBotId,
            adminPasswordHash: payload.adminPasswordHash,
            users: payload.users
        });
        const sig = crypto.createHash('sha256').update(sigData).digest('hex');
        if (!force && lastAuthSyncSignatures.get(botId) === sig) {
            return true;
        }
        const res = await fetchChild(botConfig, '/api/bot/auth-sync', {
            method: 'POST',
            body: payload,
            timeoutMs: 5000
        });
        if (res.ok) {
            lastAuthSyncSignatures.set(botId, sig);
            return true;
        }
        return false;
    } catch (_) {
        return false;
    } finally {
        syncInFlight.delete(botId);
    }
}

async function syncAuthToAllBots(force = false) {
    const bots = Array.isArray(BOT_CONFIG) ? BOT_CONFIG : [];
    const promises = bots.map(b => syncAuthToBot(b, force).catch(() => false));
    await Promise.all(promises);
}

setInterval(() => {
    syncAuthToAllBots(false).catch(() => {});
}, 15000);
const safeHostDnsCache = new Map();

async function assertSafeChildUrl(childUrl) {
    if (!childUrl) throw new Error('URL bot rỗng.');
    const parsed = new URL(childUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (ALLOWED_INTERNAL_HOSTS.has(hostname)) return;
    if (net.isIP(hostname) !== 0 && isPrivateOrBlockedIp(hostname)) {
        throw new Error(`Địa chỉ IP đích '${hostname}' là địa chỉ nội bộ bị chặn (SSRF).`);
    }
    const now = Date.now();
    const cached = safeHostDnsCache.get(hostname);
    if (cached && (now - cached.timestamp < 30000)) {
        if (!cached.safe) throw new Error(cached.error);
        return;
    }
    try {
        const records = await dns.promises.lookup(hostname, { all: true });
        for (const rec of records) {
            if (isPrivateOrBlockedIp(rec.address)) {
                const errStr = `Hostname '${hostname}' trỏ về IP nội bộ '${rec.address}' bị chặn (SSRF DNS rebinding).`;
                safeHostDnsCache.set(hostname, { safe: false, error: errStr, timestamp: now });
                throw new Error(errStr);
            }
        }
        safeHostDnsCache.set(hostname, { safe: true, timestamp: now });
    } catch (e) {
        if (e.message.includes('SSRF') || e.message.includes('bị chặn')) {
            safeHostDnsCache.set(hostname, { safe: false, error: e.message, timestamp: now });
            throw e;
        }
        throw new Error(`Lỗi phân giải DNS cho '${hostname}': ${e.message}`);
    }
}

async function fetchChild(botConfig, path, options = {}) {
    if (!botConfig || !botConfig.url) {
        throw new Error('Chưa cấu hình URL cho bot.');
    }

    await assertSafeChildUrl(botConfig.url);

    const controller = new AbortController();
    const timeoutMs = readPositiveInt(
        options.timeoutMs,
        POLL_TIMEOUT_MS,
        1000,
        60000
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const botSecret = String(botConfig.secretKey || BOT_SECRET_KEY || '').trim();
    const headers = {
        'Accept': 'application/json',
        ...(options.headers || {}),
        'X-Bot-Secret': botSecret,
        'X-Manager-Bot-Id': String(botConfig.id || '')
    };

    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(
            `${botConfig.url}${path}`,
            {
                method: options.method || 'GET',
                headers,
                body:
                    options.body !== undefined
                        ? JSON.stringify(options.body)
                        : undefined,
                cache: 'no-store',
                redirect: 'error',
                signal: controller.signal
            }
        );

        const text = await response.text();
        let data = null;

        if (text) {
            try {
                data = JSON.parse(text);
            } catch (_) {
                data = { raw: text };
            }
        }

        return {
            ok: response.ok,
            status: response.status,
            data
        };
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new Error('Timeout khi kết nối tới bot.');
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeSnapshotToSummary(botConfig, snapshotData) {
    const data = snapshotData?.bot || snapshotData || {};
    const inv = snapshotData?.inventory || {};
    return {
        id: botConfig.id,
        url: botConfig.url || '',
        source: botConfig.source || 'unknown',
        botId: String(data.botId ?? botConfig.id),
        label: String(botConfig.label || data.label || ('Bot ' + botConfig.id)),
        configured: true,
        available: true,
        username: String(data.username || ''),
        status: String(data.status || 'offline'),
        ready: !!data.ready,
        ping: data.ping == null ? null : Number(data.ping),
        uptime: String(data.uptime || '0h 0m 0s'),
        uptimeSeconds: Number(data.uptimeSeconds || 0),
        reconnectCount: Number(data.reconnectCount || 0),
        host: String(data.host || ''),
        port: data.port == null ? null : Number(data.port),
        position: data.position || null,
        dimension: data.dimension || null,
        ipAddress: String(data.ipAddress || ''),
        locationState: String(data.locationState || 'unknown'),
        roundedLocation: data.roundedLocation || null,
        settings: data.settings || null,
        totemCount: Number(inv.totemCount || data.totemCount || 0),
        foodCount: Number(inv.foodCount || data.foodCount || 0),
        health: Number(data.health ?? 20),
        food: Number(data.food ?? 20),
        goldenAppleCount: Number(inv.goldenAppleCount || data.goldenAppleCount || 0),
        isDead: !!data.isDead,
        deathCount: Number(data.deathCount || 0),
        lastDeathCoords: data.lastDeathCoords || '',
        manuallyStopped: !!data.manuallyStopped,
        lastKickReason: data.lastKickReason || '',
        currentWindow: data.currentWindow || null,
        memory: data.memory || null,
        rssMb: Number(data.rssMb || data.memory?.rssMb || 0),
        heapMb: Number(data.heapMb || data.memory?.heapMb || 0),
        hostHardware: data.hostHardware || data.system || null,
        error: null
    };
}

// ----------------------------------------------------------------------------
// BOT COORDINATE TRACKING & LOBBY/LOGIN FILTER ENGINE
// ----------------------------------------------------------------------------
const lastLoggedBotCoords = new Map(); // botId -> { x, y, z, at, dimension }
const AUTH_COORDS_CONST = { x: 5, y: 119, z: 4 };
const LOBBY_COORDS_CONST = { x: 1, y: 41, z: 1 };

function isLobbyOrAuthCoordinate(pos) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return true;
    const rx = Math.round(pos.x);
    const ry = Math.round(pos.y);
    const rz = Math.round(pos.z);
    if (rx === AUTH_COORDS_CONST.x && ry === AUTH_COORDS_CONST.y && rz === AUTH_COORDS_CONST.z) return true;
    if (rx === LOBBY_COORDS_CONST.x && ry === LOBBY_COORDS_CONST.y && rz === LOBBY_COORDS_CONST.z) return true;
    return false;
}

function checkAndRecordBotCoordinates(botConfig, data) {
    if (!botConfig || !data || !data.available) return;
    
    const status = String(data.status || '').toLowerCase();
    const locState = String(data.locationState || '').toLowerCase();
    
    // BỎ QUA HOÀN TOÀN TỌA ĐỘ LÚC LOGIN VÀ Ở SẢNH (LOBBY/SPAWN) THEO YÊU CẦU NGƯỜI DÙNG
    if (
        locState === 'login' ||
        locState === 'lobby' ||
        status === 'connecting' ||
        status === 'authenticating' ||
        status === 'logging_in' ||
        status === 'entering'
    ) {
        return; // BỎ QUA KHÔNG GHI LOG
    }
    
    const pos = data.position || data.roundedLocation;
    if (!pos || isLobbyOrAuthCoordinate(pos)) {
        return; // BỎ QUA KHÔNG GHI LOG NẾU TRÙNG TỌA ĐỘ SẢNH/LOGIN
    }
    
    const rx = Math.round(pos.x);
    const ry = Math.round(pos.y);
    const rz = Math.round(pos.z);
    const dim = data.dimension || 'overworld';
    const botId = String(botConfig.id);
    const prev = lastLoggedBotCoords.get(botId);
    const now = Date.now();
    
    let shouldLog = false;
    if (!prev) {
        shouldLog = true;
    } else {
        const distSq = Math.pow(rx - prev.x, 2) + Math.pow(ry - prev.y, 2) + Math.pow(rz - prev.z, 2);
        // Ghi nhận khi bot di chuyển cách xa > 5 blocks hoặc sau 5 phút nếu có thay đổi tọa độ
        if (distSq >= 25 || (distSq > 0 && now - prev.at >= 300000)) {
            shouldLog = true;
        }
    }
    
    if (shouldLog) {
        lastLoggedBotCoords.set(botId, { x: rx, y: ry, z: rz, at: now, dimension: dim });
        logAuditEvent({
            action: 'BOT_POSITION_UPDATE',
            category: 'BOT_COORDS',
            actionLabel: '📍 Tọa độ Bot sinh tồn',
            target: { botId: botConfig.id, label: botConfig.label },
            details: `Tọa độ bot "${botConfig.label || 'Bot ' + botConfig.id}": X=${rx}, Y=${ry}, Z=${rz} (Thế giới: ${dim})`,
            status: 'SUCCESS'
        });
    }
}

async function fetchBotSummary(botConfig) {
    if (!botConfig.url) {
        return buildUnavailableSummary(
            botConfig,
            'Chưa cấu hình URL cho bot.'
        );
    }

    try {
        const snapshotRes = await fetchChild(botConfig, '/api/snapshot', { timeoutMs: 3500 });
        if (snapshotRes.ok && snapshotRes.data?.bot) {
            const data = snapshotRes.data.bot;
            const inv = snapshotRes.data.inventory || {};
            return {
                id: botConfig.id,
                url: botConfig.url || '',
                source: botConfig.source || 'unknown',
                botId: String(data.botId ?? botConfig.id),
                label: String(botConfig.label || data.label || `Bot ${botConfig.id}`),
                configured: true,
                available: true,
                username: String(data.username || ''),
                status: String(data.status || 'offline'),
                ready: !!data.ready,
                ping: data.ping == null ? null : Number(data.ping),
                uptime: String(data.uptime || '0h 0m 0s'),
                uptimeSeconds: Number(data.uptimeSeconds || 0),
                reconnectCount: Number(data.reconnectCount || 0),
                host: String(data.host || ''),
                port: data.port == null ? null : Number(data.port),
                position: data.position || null,
                dimension: data.dimension || null,
                ipAddress: String(data.ipAddress || ''),
                locationState: String(data.locationState || 'unknown'),
                roundedLocation: data.roundedLocation || null,
                settings: data.settings || null,
                totemCount: Number(inv.totemCount || data.totemCount || 0),
                foodCount: Number(inv.foodCount || data.foodCount || 0),
                health: Number(data.health ?? 20),
                food: Number(data.food ?? 20),
                goldenAppleCount: Number(inv.goldenAppleCount || data.goldenAppleCount || 0),
                isDead: !!data.isDead,
                deathCount: Number(data.deathCount || 0),
                lastDeathCoords: data.lastDeathCoords || '',
                manuallyStopped: !!data.manuallyStopped,
                lastKickReason: data.lastKickReason || '',
                currentWindow: data.currentWindow || null,
                memory: data.memory || null,
                rssMb: Number(data.rssMb || data.memory?.rssMb || 0),
                heapMb: Number(data.heapMb || data.memory?.heapMb || 0),
                hostHardware: data.hostHardware || data.system || null,
                error: null
            };
        }

        const result = await fetchChild(botConfig, '/api/bot', { timeoutMs: 3000 });

        if (!result.ok || !result.data) {
            return {
                id: botConfig.id,
                url: botConfig.url || '',
                source: botConfig.source || 'unknown',
                botId: String(botConfig.id),
                label: botConfig.label,
                configured: true,
                available: false,
                username: '',
                status: 'offline',
                ready: false,
                ping: null,
                uptime: '0h 0m 0s',
                uptimeSeconds: 0,
                reconnectCount: 0,
                host: '',
                port: null,
                position: null,
                dimension: null,
                ipAddress: '',
                locationState: 'unknown',
                roundedLocation: null,
                settings: null,
                totemCount: 0,
                foodCount: 0,
                memory: null,
                rssMb: 0,
                heapMb: 0,
                error: result.data?.error || `Bot trả HTTP ${result.status}.`
            };
        }

        const data = result.data;

        return {
            id: botConfig.id,
            url: botConfig.url || '',
            source: botConfig.source || 'unknown',
            botId: String(data.botId ?? botConfig.id),
            label: String(botConfig.label || data.label || `Bot ${botConfig.id}`),
            configured: true,
            available: true,
            username: String(data.username || ''),
            status: String(data.status || 'offline'),
            ready: !!data.ready,
            ping: data.ping == null ? null : Number(data.ping),
            uptime: String(data.uptime || '0h 0m 0s'),
            uptimeSeconds: Number(data.uptimeSeconds || 0),
            reconnectCount: Number(data.reconnectCount || 0),
            host: String(data.host || ''),
            port: data.port == null ? null : Number(data.port),
            position: data.position || null,
            dimension: data.dimension || null,
            ipAddress: String(data.ipAddress || ''),
            locationState: String(data.locationState || 'unknown'),
            roundedLocation: data.roundedLocation || null,
            settings: data.settings || null,
            totemCount: Number(data.totemCount || 0),
            foodCount: Number(data.foodCount || 0),
            health: Number(data.health ?? 20),
            food: Number(data.food ?? 20),
            goldenAppleCount: Number(data.goldenAppleCount || 0),
            isDead: !!data.isDead,
            deathCount: Number(data.deathCount || 0),
            lastDeathCoords: data.lastDeathCoords || '',
            manuallyStopped: !!data.manuallyStopped,
            lastKickReason: data.lastKickReason || '',
            currentWindow: data.currentWindow || null,
            memory: data.memory || null,
            rssMb: Number(data.rssMb || data.memory?.rssMb || 0),
            heapMb: Number(data.heapMb || data.memory?.heapMb || 0),
            hostHardware: data.hostHardware || data.system || null,
            error: null
        };
    } catch (err) {
        return {
            id: botConfig.id,
            url: botConfig.url || '',
            source: botConfig.source || 'unknown',
            botId: String(botConfig.id),
            label: botConfig.label,
            configured: true,
            available: false,
            username: '',
            status: 'offline',
            ready: false,
            ping: null,
            uptime: '0h 0m 0s',
            uptimeSeconds: 0,
            reconnectCount: 0,
            host: '',
            port: null,
            position: null,
            dimension: null,
            ipAddress: '',
            locationState: 'unknown',
            roundedLocation: null,
            settings: null,
            totemCount: 0,
            foodCount: 0,
            error: err.message || 'Không thể kết nối tới bot.'
        };
    }
}

async function getBotSummary(botConfig, options = {}) {
    const id = Number(botConfig?.id);
    const now = Date.now();
    const cached = summaryCache.get(id);
    const force = !!options.force;

    if (
        !force &&
        cached &&
        now - cached.at < BOT_SUMMARY_CACHE_MS
    ) {
        return cached.data;
    }

    const existing = summaryRefreshInFlight.get(id);
    if (!force && existing) {
        return existing;
    }

    const seq = (summaryRequestSeq.get(id) || 0) + 1;
    summaryRequestSeq.set(id, seq);

    const requestUrl = botConfig?.url || '';
    let promise;
    promise = fetchBotSummary(botConfig)
        .then(data => {
            const current = BOT_CONFIG.find(config => config.id === id);
            if (!current || current.url !== requestUrl) {
                return data;
            }
            if (cached && !cached.data?.available && data.available) {
                lastAuthSyncSignatures.delete(id);
                void syncAuthToBot(current, true);
            }
            recordBotMetrics(id, data);
            checkBotWebhookAlert(current, data);
            checkAndRecordBotCoordinates(current, data);
            const lastApplied = summaryLastAppliedSeq.get(id) || 0;
            if (seq >= lastApplied) {
                summaryLastAppliedSeq.set(id, seq);
                summaryCache.set(id, { at: Date.now(), data });
            }
            return data;
        })
        .catch(err => {
            const current = BOT_CONFIG.find(config => config.id === id);
            const fallback = cached?.data || buildUnavailableSummary(
                botConfig,
                err.message || 'Không thể kết nối tới bot.'
            );
            if (cached?.data) {
                fallback.error = err.message || fallback.error;
                fallback.available = false;
            }
            recordBotMetrics(id, fallback);
            checkBotWebhookAlert(current, fallback);
            const lastApplied = summaryLastAppliedSeq.get(id) || 0;
            if (seq >= lastApplied && current && current.url === requestUrl) {
                summaryLastAppliedSeq.set(id, seq);
                summaryCache.set(id, { at: Date.now(), data: fallback });
            }
            return fallback;
        })
        .finally(() => {
            if (summaryRefreshInFlight.get(id) === promise) {
                summaryRefreshInFlight.delete(id);
            }
        });

    summaryRefreshInFlight.set(id, promise);
    return promise;
}

async function refreshSummary(config, force = false) {
    return getBotSummary(config, { force });
}

async function refreshAllSummaries() {
    const configs = BOT_CONFIG.slice();
    let cursor = 0;

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= configs.length) return;
            await refreshSummary(configs[index], false);
        }
    }

    const workers = Array.from(
        { length: Math.min(BOT_MAX_PARALLEL_REQUESTS, configs.length) },
        () => worker()
    );

    await Promise.all(workers);
}

async function runChildAction(id, path, body, extraHeaders = {}, method = 'POST') {
    const botConfig = getBotConfig(id);

    if (!botConfig) {
        return {
            status: 404,
            data: { error: 'Bot không tồn tại.' }
        };
    }

    if (!botConfig.url) {
        return {
            status: 503,
            data: { error: 'Chưa cấu hình URL cho bot.' }
        };
    }

    try {
        const fetchOpts = {
            method: method || 'POST',
            headers: extraHeaders
        };
        if (method !== 'GET' && method !== 'HEAD') {
            fetchOpts.body = body;
        }
        const result = await fetchChild(
            botConfig,
            path,
            fetchOpts
        );

        return {
            ok: result.ok,
            status: result.status,
            data:
                result.data ||
                {
                    ok: result.ok,
                    error: result.ok ? null : `HTTP ${result.status}`
                }
        };
    } catch (err) {
        return {
            status: 502,
            data: {
                error:
                    err.message ||
                    'Không thể kết nối tới bot.'
            }
        };
    }
}

function sendProxyResult(res, result) {
    let status = Number.isInteger(result.status)
        ? result.status
        : 500;
    // Chuyển 401/403 từ bot con thành 502 để Frontend không hiểu nhầm là hết hạn phiên Manager
    if (status === 401 || status === 403) {
        status = 502;
    }
    return res.status(status).json(
        result.data || { error: 'Không có dữ liệu trả về.' }
    );
}

const PUBLIC_LOGIN_HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KBOT — Cổng Đăng Nhập Hệ Thống AFK KingMC</title>
<style>
:root {
  color-scheme: dark;
  --bg: #070a12;
  --bg-gradient: radial-gradient(circle at 10% 15%, rgba(30, 58, 138, 0.5) 0%, transparent 45%),
                 radial-gradient(circle at 90% 85%, rgba(88, 28, 135, 0.45) 0%, transparent 50%),
                 radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.95) 0%, #070a12 100%);
  --card-bg: rgba(15, 23, 42, 0.88);
  --border: rgba(255, 255, 255, 0.08);
  --border-glow: rgba(56, 189, 248, 0.35);
  --text: #f8fafc;
  --muted: #94a3b8;
  --cyan: #38bdf8;
  --blue: #2563eb;
  --purple: #818cf8;
  --green: #34d399;
  --red: #f87171;
  --gold: #fbbf24;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  margin: 0; min-height: 100vh;
  background: var(--bg-gradient); background-attachment: fixed;
  color: var(--text); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex; align-items: center; justify-content: center; padding: 24px 16px;
}
.kbot-portal-container {
  width: 100%; max-width: 1120px;
  display: grid; grid-template-columns: 1.15fr 0.95fr; gap: 36px;
  align-items: stretch; margin: auto;
}
@media (max-width: 920px) {
  .kbot-portal-container { grid-template-columns: 1fr; gap: 24px; max-width: 500px; }
  .kbot-showcase-col { display: none !important; }
}

/* SHOWCASE COLUMN (LEFT) */
.kbot-showcase-col {
  display: flex; flex-direction: column; justify-content: center;
  padding: 20px 10px;
}
.brand-pill-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px;
}
.brand-tag {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 999px;
  background: rgba(56, 189, 248, 0.15); color: var(--cyan);
  border: 1px solid rgba(56, 189, 248, 0.35); letter-spacing: 0.5px;
}
.server-pulse-tag {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
  background: rgba(52, 211, 153, 0.12); color: var(--green);
  border: 1px solid rgba(52, 211, 153, 0.3);
}
.pulse-circle {
  width: 7px; height: 7px; border-radius: 50%; background: #10b981;
  box-shadow: 0 0 8px #10b981; animation: pulseGlow 2s infinite;
}
@keyframes pulseGlow {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
.showcase-headline {
  font-size: 32px; font-weight: 900; line-height: 1.25; margin-bottom: 12px;
  letter-spacing: -0.02em; color: #fff;
}
.gradient-headline {
  background: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.showcase-desc {
  font-size: 14px; color: var(--muted); line-height: 1.6; margin-bottom: 22px;
}

/* DISCORD BUTTON */
.discord-card-btn {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 18px; border-radius: 14px;
  background: rgba(88, 101, 242, 0.18); border: 1px solid rgba(88, 101, 242, 0.45);
  color: #fff; text-decoration: none; margin-bottom: 24px;
  transition: all 0.2s ease; box-shadow: 0 4px 16px rgba(88, 101, 242, 0.2);
}
.discord-card-btn:hover {
  background: rgba(88, 101, 242, 0.3); border-color: #5865F2;
  transform: translateY(-2px); box-shadow: 0 8px 24px rgba(88, 101, 242, 0.35);
}
.discord-icon { flex-shrink: 0; fill: #5865F2; }
.discord-text { flex: 1; display: flex; flex-direction: column; text-align: left; }
.discord-text strong { font-size: 13.5px; font-weight: 750; color: #fff; }
.discord-text small { font-size: 11px; color: #a5b4fc; }
.discord-online-badge {
  font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 999px;
  background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4);
}

/* SHOWCASE BENTO GRID */
.bento-features-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;
}
.bento-feature-item {
  background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px; padding: 12px 14px; display: flex; align-items: flex-start; gap: 10px;
  transition: all 0.2s;
}
.bento-feature-item:hover {
  background: rgba(255, 255, 255, 0.06); border-color: rgba(56, 189, 248, 0.3);
}
.bento-icon { font-size: 20px; flex-shrink: 0; line-height: 1; margin-top: 2px; }
.bento-text strong { display: block; font-size: 12.5px; font-weight: 750; color: #f1f5f9; margin-bottom: 2px; }
.bento-text p { font-size: 11px; color: var(--muted); line-height: 1.35; margin: 0; }

/* SLA ROW */
.sla-row {
  display: flex; gap: 16px; font-size: 11.5px; color: var(--muted); align-items: center;
  border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 14px;
}
.sla-item { display: flex; align-items: center; gap: 6px; }

/* LOGIN CARD (RIGHT) */
.login-card {
  background: var(--card-bg);
  border: 1px solid var(--border-glow);
  border-radius: 24px; padding: 36px 32px;
  box-shadow: 0 25px 60px rgba(0,0,0,0.8), 0 0 40px rgba(56, 189, 248, 0.12);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; flex-direction: column; justify-content: center;
  text-align: center; position: relative;
}
.login-card-header { margin-bottom: 22px; text-align: center; }
.login-logo { font-size: 38px; margin-bottom: 8px; }
.login-title {
  font-size: 22px; font-weight: 850; color: #fff; margin-bottom: 6px;
  letter-spacing: -0.02em;
}
.login-subtitle { font-size: 13px; color: var(--muted); line-height: 1.4; }

/* SEGMENTED TABS */
.auth-tabs {
  display: flex; gap: 6px; margin-bottom: 22px;
  background: rgba(0, 0, 0, 0.35); padding: 5px;
  border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.06);
}
.auth-tab-btn {
  flex: 1; padding: 10px 12px; background: transparent; border: none;
  color: var(--muted); font-size: 13px; font-weight: 750; border-radius: 8px;
  cursor: pointer; transition: all 0.18s ease;
}
.auth-tab-btn.active {
  background: rgba(56, 189, 248, 0.2); color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.4); box-shadow: 0 2px 10px rgba(0,0,0,0.3);
}

/* FORM FIELDS */
.form-row { text-align: left; margin-bottom: 15px; }
.form-row label {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; font-weight: 750; color: #94a3b8; margin-bottom: 6px; letter-spacing: 0.5px;
}
.input-wrap { position: relative; }
.input-wrap input {
  width: 100%; padding: 12px 14px 12px 38px;
  background: rgba(11, 17, 26, 0.9); border: 1px solid var(--border);
  border-radius: 10px; color: #fff; font-size: 13.5px; outline: none;
  transition: all 0.2s;
}
.input-wrap input:focus {
  border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
}
.input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  font-size: 15px; color: var(--muted); pointer-events: none;
}
.password-input-wrap input { padding-right: 42px; }
.password-toggle-btn {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--muted); cursor: pointer;
  font-size: 16px; padding: 4px; border-radius: 4px;
}
.password-toggle-btn:hover { color: #fff; }

.trial-callout-badge {
  background: linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(249, 115, 22, 0.15) 100%);
  border: 1px solid rgba(234, 179, 8, 0.35); border-radius: 10px;
  padding: 10px 12px; font-size: 12px; color: #fde047; text-align: left;
  margin-bottom: 16px; display: flex; align-items: center; gap: 8px; line-height: 1.35;
}

.check-row {
  display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted);
  cursor: pointer; margin: 12px 0 20px; user-select: none; text-align: left;
}
.check-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #0284c7; cursor: pointer; }

button.primary-cta {
  width: 100%; padding: 13px;
  background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%);
  border: 1px solid #38bdf8; border-radius: 11px; color: #fff;
  font-size: 14.5px; font-weight: 800; cursor: pointer;
  box-shadow: 0 4px 18px rgba(2, 132, 199, 0.45); transition: all 0.2s;
}
button.primary-cta:hover:not(:disabled) {
  transform: translateY(-1px); box-shadow: 0 6px 24px rgba(2, 132, 199, 0.65);
}
button.primary-cta:disabled { opacity: 0.6; cursor: not-allowed; }

.login-alert {
  padding: 11px 14px; border-radius: 10px; font-size: 13px;
  margin-bottom: 18px; text-align: left; line-height: 1.4;
}
.login-alert.hidden { display: none; }
.login-alert.error {
  background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.45); color: #fca5a5;
}
.login-alert.success {
  background: rgba(52, 211, 153, 0.15); border: 1px solid rgba(52, 211, 153, 0.45); color: #86efac;
}

.login-footer-info {
  margin-top: 20px; padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px; color: var(--muted); line-height: 1.5; text-align: left;
}
.login-footer-info code {
  background: rgba(255, 255, 255, 0.08); padding: 2px 6px; border-radius: 4px;
  color: var(--cyan); font-family: monospace; font-size: 11.5px;
}
.hidden { display: none !important; }
</style>
</head>
<body>
<div class="kbot-portal-container">
  <!-- CỘT TRÁI: SAAS & FLEET SHOWCASE -->
  <div class="kbot-showcase-col">
    <div class="brand-pill-row">
      <span class="brand-tag">👑 KBOT SENTINEL • ENTERPRISE</span>
      <span class="server-pulse-tag"><span class="pulse-circle"></span> Hệ Thống Trực Tuyến 24/7</span>
    </div>

    <h1 class="showcase-headline">
      Nền Tảng Thuê Bot AFK KingMC<br>
      <span class="gradient-headline">Tự Động &amp; Bất Tử Đám Mây</span>
    </h1>

    <p class="showcase-desc">
      Giải pháp cắm chuột AFK đám mây chuyên nghiệp số 1 dành riêng cho cụm máy chủ KingMC. Không cần mở máy tính, tự động thay totem, tự ăn, tự cất đồ và chống kick máy chủ tuyệt đối.
    </p>

    <!-- NÚT DISCORD HỖ TRỢ 24/7 -->
    <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="discord-card-btn" title="Tham gia Discord Hỗ TrỢ 24/7">
      <svg class="discord-icon" viewBox="0 0 24 24" width="28" height="28">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
      <div class="discord-text">
        <strong>Gia Nhập Cộng Đồng Discord Hỗ Trợ 24/7</strong>
        <small>Mua Key gia hạn, nhận Giftcode khuyến mãi &amp; trợ giúp kỹ thuật</small>
      </div>
      <span class="discord-online-badge">ONLINE</span>
    </a>

    <!-- 4 TÍNH NĂNG ĐỈNH CAO BENTO -->
    <div class="bento-features-grid">
      <div class="bento-feature-item">
        <span class="bento-icon">⚡</span>
        <div class="bento-text">
          <strong>Auto Totem Bất Tử</strong>
          <p>Tự động trang bị totem tay phụ khi máu &lt; 5 tim, chống quái cắn và rơi vực.</p>
        </div>
      </div>
      <div class="bento-feature-item">
        <span class="bento-icon">🍞</span>
        <div class="bento-text">
          <strong>Auto Ăn &amp; Chống Đói</strong>
          <p>Tự tìm bánh mì/thịt trong túi đồ ăn khi đói, đảm bảo hồi máu liên tục.</p>
        </div>
      </div>
      <div class="bento-feature-item">
        <span class="bento-icon">💬</span>
        <div class="bento-text">
          <strong>Auto Chat &amp; Anti-AFK</strong>
          <p>Lập lịch rao bán shop và vi chuyển động thông minh chống kick máy chủ.</p>
        </div>
      </div>
      <div class="bento-feature-item">
        <span class="bento-icon">⏰</span>
        <div class="bento-text">
          <strong>Hẹn Giờ Bật/Tắt</strong>
          <p>Cài đặt lịch bật tắt theo giờ cố định hoặc chu kỳ lặp như người chơi thật.</p>
        </div>
      </div>
    </div>

    <!-- CAM KẾT SLA -->
    <div class="sla-row">
      <div class="sla-item"><span>🛡️</span> <strong>99.9% Uptime Cloud</strong></div>
      <div class="sla-item"><span>🔒</span> <strong>Mã Hóa Chuẩn Scrypt Quân Sự</strong></div>
      <div class="sla-item"><span>🚀</span> <strong>Tự Reconnect Sau Bảo Trì</strong></div>
    </div>
  </div>

  <!-- CỘT PHẢI: CỔNG ĐĂNG NHẬP / ĐĂNG KÝ -->
  <div class="login-card">
    <div class="login-card-header">
      <div class="login-logo">🛡️</div>
      <h2 class="login-title">CỔNG BẢO MẬT KBOT</h2>
      <div class="login-subtitle">Hệ Thống Thuê Bot AFK KingMC Thương Mại Cao Cấp</div>
    </div>

    <!-- SEGMENTED TABS -->
    <div class="auth-tabs">
      <button type="button" class="auth-tab-btn active" id="tabPublicLoginBtn" onclick="switchPublicAuthTab('login')">🚀 Đăng Nhập</button>
      <button type="button" class="auth-tab-btn" id="tabPublicRegisterBtn" onclick="switchPublicAuthTab('register')">📝 Đăng Ký Tài Khoản</button>
    </div>

    <div id="publicLoginAlert" class="login-alert hidden"></div>

    <!-- FORM 1: ĐĂNG NHẬP -->
    <form id="publicLoginForm" onsubmit="handlePublicLoginSubmit(event)">
      <div class="form-row">
        <label for="publicUsername"><span>TÊN ĐĂNG NHẬP</span></label>
        <div class="input-wrap">
          <span class="input-icon">👤</span>
          <input id="publicUsername" type="text" autocomplete="username" placeholder="Nhập admin hoặc username thuê..." required autofocus>
        </div>
      </div>
      <div class="form-row">
        <label for="publicPassword"><span>MẬT KHẨU</span></label>
        <div class="input-wrap password-input-wrap">
          <span class="input-icon">🔒</span>
          <input id="publicPassword" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu truy cập..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePublicPass('publicPassword', this)">👁</button>
        </div>
      </div>
      <div class="form-row">
        <label for="publicLicenseKey">
          <span>MÃ KEY GIA HẠN</span>
          <span style="font-size:10.5px;color:var(--muted);font-weight:normal;">(Nếu có / Tùy chọn)</span>
        </label>
        <div class="input-wrap">
          <span class="input-icon">🔑</span>
          <input id="publicLicenseKey" type="text" placeholder="Nhập mã Key để tự mở khóa / cộng thêm ngày thuê..." style="text-transform:uppercase;">
        </div>
      </div>
      <label class="check-row">
        <input id="publicRememberMe" type="checkbox" checked>
        <span>Ghi nhớ phiên đăng nhập (30 ngày)</span>
      </label>
      <button id="publicSubmitBtn" type="submit" class="primary-cta">🚀 ĐĂNG NHẬP VÀO HỆ THỐNG</button>
    </form>

    <!-- FORM 2: ĐĂNG KÝ -->
    <form id="publicRegisterForm" class="hidden" onsubmit="handlePublicRegisterSubmit(event)">
      <div class="trial-callout-badge" id="publicTrialCalloutBadge">
        <span style="font-size:18px;">🎉</span>
        <div id="publicTrialCalloutText"><strong>ĐẶC QUYỀN MỚI:</strong> Nhận ngay <strong>1 NGÀY DÙNG THỬ MIỄN PHÍ</strong> sau khi tạo tài khoản thành công!</div>
      </div>
      <div class="form-row">
        <label for="regUsername"><span>TÊN ĐĂNG NHẬP MỚI</span></label>
        <div class="input-wrap">
          <span class="input-icon">👤</span>
          <input id="regUsername" type="text" autocomplete="username" placeholder="Tên tài khoản (3 - 32 ký tự)..." required>
        </div>
      </div>
      <div class="form-row">
        <label for="regPassword"><span>MẬT KHẨU MỚI</span></label>
        <div class="input-wrap password-input-wrap">
          <span class="input-icon">🔒</span>
          <input id="regPassword" type="password" autocomplete="new-password" placeholder="Tối thiểu 5 ký tự (chữ hoặc số, phân biệt hoa thường)..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePublicPass('regPassword', this)">👁</button>
        </div>
      </div>
      <div class="form-row">
        <label for="regPasswordConfirm"><span>XÁC NHẬN MẬT KHẨU</span></label>
        <div class="input-wrap password-input-wrap">
          <span class="input-icon">🔒</span>
          <input id="regPasswordConfirm" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePublicPass('regPasswordConfirm', this)">👁</button>
        </div>
      </div>
      <div class="form-row">
        <label for="regLicenseKey">
          <span>MÃ KEY KÍCH HOẠT GÓI THUÊ</span>
          <span id="regLicenseKeyHint" style="font-size:10.5px;color:var(--muted);font-weight:normal;">(Để trống nếu dùng thử)</span>
        </label>
        <div class="input-wrap">
          <span class="input-icon">🔑</span>
          <input id="regLicenseKey" type="text" placeholder="Để trống để nhận 1 ngày dùng thử miễn phí..." style="text-transform:uppercase;">
        </div>
      </div>
      <button id="publicRegSubmitBtn" type="submit" class="primary-cta">✨ HOÀN TẤT ĐĂNG KÝ VÀ BẮT ĐẦU</button>
    </form>

    <div class="login-footer-info">
      • Quản trị viên: Đăng nhập bằng tài khoản <code>admin</code>.<br>
      • Khách thuê: Sử dụng tài khoản cá nhân để xem bot và điều khiển.<br>
      • Cần trợ giúp? Liên hệ ngay qua <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline;">Discord Hỗ Trợ 24/7</a>.
    </div>
  </div>
</div>
<script>
function switchPublicAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabPublicLoginBtn').classList.toggle('active', isLogin);
  document.getElementById('tabPublicRegisterBtn').classList.toggle('active', !isLogin);
  document.getElementById('publicLoginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('publicRegisterForm').classList.toggle('hidden', isLogin);
  const alertEl = document.getElementById('publicLoginAlert');
  alertEl.className = 'login-alert hidden';
}
function togglePublicPass(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'password') { el.type = 'text'; btn.textContent = '🙈'; }
  else { el.type = 'password'; btn.textContent = '👁'; }
}
async function handlePublicLoginSubmit(e) {
  if (e) e.preventDefault();
  const u = document.getElementById('publicUsername').value.trim();
  const p = document.getElementById('publicPassword').value;
  const k = document.getElementById('publicLicenseKey').value.trim();
  const remember = document.getElementById('publicRememberMe').checked === true;
  const alertEl = document.getElementById('publicLoginAlert');
  const btn = document.getElementById('publicSubmitBtn');
  alertEl.className = 'login-alert hidden';
  btn.disabled = true;
  btn.textContent = '⏳ Đang xác thực...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: u, password: p, licenseKey: k, rememberMe: remember })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }
    alertEl.textContent = '✅ ' + (data.message || 'Đăng nhập thành công! Đang tải dashboard...');
    alertEl.className = 'login-alert success';
    setTimeout(() => { window.location.replace('/'); }, 300);
  } catch (err) {
    alertEl.textContent = '⚠️ ' + err.message;
    alertEl.className = 'login-alert error';
    btn.disabled = false;
    btn.textContent = '🚀 ĐĂNG NHẬP VÀO HỆ THỐNG';
  }
}
async function handlePublicRegisterSubmit(e) {
  if (e) e.preventDefault();
  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  const p2 = document.getElementById('regPasswordConfirm').value;
  const k = document.getElementById('regLicenseKey').value.trim();
  const alertEl = document.getElementById('publicLoginAlert');
  const btn = document.getElementById('publicRegSubmitBtn');

  if (p !== p2) {
    alertEl.textContent = '⚠️ Mật khẩu xác nhận không khớp!';
    alertEl.className = 'login-alert error';
    return;
  }

  alertEl.className = 'login-alert hidden';
  btn.disabled = true;
  btn.textContent = '⏳ Đang đăng ký...';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: u, password: p, licenseKey: k })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Không thể đăng ký tài khoản.');
    }
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }
    alertEl.textContent = '✅ ' + (data.message || 'Đăng ký thành công! Đang chuyển hướng...');
    alertEl.className = 'login-alert success';
    setTimeout(() => { window.location.replace('/'); }, 350);
  } catch (err) {
    alertEl.textContent = '⚠️ ' + err.message;
    alertEl.className = 'login-alert error';
    btn.disabled = false;
    btn.textContent = '✨ HOÀN TẤT ĐĂNG KÝ VÀ BẮT ĐẦU';
  }
}
async function loadPublicSystemInfo() {
  try {
    const res = await fetch('/api/public/system-info');
    if (!res.ok) return;
    const data = await res.json();
    const badge = document.getElementById('publicTrialCalloutBadge');
    const text = document.getElementById('publicTrialCalloutText');
    const keyHint = document.getElementById('regLicenseKeyHint');
    const keyInput = document.getElementById('regLicenseKey');
    if (!badge || !data || !data.ok) return;
    if (data.trialGiftEnabled === false) {
      badge.style.display = 'none';
      if (keyHint) keyHint.textContent = '(Cần nhập Key để kích hoạt)';
      if (keyInput) keyInput.placeholder = 'Nhập mã Key kích hoạt gói thuê (Bắt buộc)...';
    } else {
      badge.style.display = 'flex';
      const days = data.trialDays || 1;
      if (text) text.innerHTML = '<strong>ĐẶC QUYỀN MỚI:</strong> Nhận ngay <strong>' + days + ' NGÀY DÙNG THỬ MIỄN PHÍ</strong> sau khi tạo tài khoản thành công!';
      if (keyHint) keyHint.textContent = '(Để trống nếu dùng thử)';
      if (keyInput) keyInput.placeholder = 'Để trống để nhận ' + days + ' ngày dùng thử miễn phí...';
    }
  } catch (_) {}
}
loadPublicSystemInfo();
window.switchPublicAuthTab = switchPublicAuthTab;
window.togglePublicPass = togglePublicPass;
</script>
</body>
</html>`;

const HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KBOT — Hệ Thống Cho Thuê Bot AFK KingMC Thương Mại Cao Cấp</title>
<style>
:root {
  color-scheme: dark;
  --bg: #070a0f;
  --bg-gradient: radial-gradient(circle at 14% 16%, rgba(26, 42, 66, 0.75) 0%, transparent 45%),
                 radial-gradient(circle at 86% 84%, rgba(32, 22, 58, 0.65) 0%, transparent 50%),
                 radial-gradient(circle at 50% 50%, rgba(13, 21, 33, 0.9) 0%, #070a0f 100%);
  --card: rgba(15, 23, 34, 0.82);
  --card-hover: rgba(21, 33, 49, 0.92);
  --card2: rgba(11, 17, 26, 0.7);
  --border: rgba(255, 255, 255, 0.08);
  --border-glow: rgba(77, 163, 255, 0.45);
  --text: #f0f6fc;
  --muted: #8b9bb4;
  --green: #30d158;
  --green-glow: rgba(48, 209, 88, 0.35);
  --red: #ff453a;
  --red-glow: rgba(255, 69, 58, 0.35);
  --yellow: #ffd60a;
  --yellow-glow: rgba(255, 214, 10, 0.35);
  --blue: #4da3ff;
  --blue-glow: rgba(77, 163, 255, 0.35);
  --accent: #58a6ff;
  --gold: #f59e0b;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg-gradient);
  background-attachment: fixed;
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

h1, h2, h3, p, label {
  margin: 0;
}

button, input, select, textarea {
  font: inherit;
}

button {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(180deg, #1c2734 0%, #151e28 100%);
  color: var(--text);
  padding: 9px 14px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25);
  user-select: none;
}

button:hover, button:hover:not(:disabled) {
  background: linear-gradient(180deg, #253444 0%, #1a2734 100%);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

button:active, button:active:not(:disabled) {
  transform: scale(0.97);
}

button:focus-visible, input:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}

button.primary {
  background: linear-gradient(180deg, #1f7ae0 0%, #1562b8 100%);
  border-color: #388bfd;
  box-shadow: 0 2px 8px rgba(31, 122, 224, 0.35);
}

button.primary:hover, button.primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #2b88f0 0%, #1a6fcf 100%);
  box-shadow: 0 4px 15px rgba(31, 122, 224, 0.5);
}

button.danger {
  background: linear-gradient(180deg, #a8282b 0%, #7d1b1d 100%);
  border-color: #da3633;
  box-shadow: 0 2px 8px rgba(218, 54, 51, 0.35);
}

button.danger:hover, button.danger:hover:not(:disabled) {
  background: linear-gradient(180deg, #c43236 0%, #912022 100%);
  box-shadow: 0 4px 15px rgba(218, 54, 51, 0.5);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
}

input, select, textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(10, 16, 24, 0.7);
  color: var(--text);
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

input:focus, select:focus, textarea:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(77, 163, 255, 0.2);
}

.app {
  width: min(1360px, calc(100% - 24px));
  margin: 0 auto;
  padding: 12px 0 48px;
}

.topbar, .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 850;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  background: linear-gradient(135deg, #ffffff 30%, #a5c2eb 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.page-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 16px;
}

/* Fleet Welcome Header */
.fleet-welcome-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 22px;
  padding: 16px 20px;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
}
.fleet-welcome-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.fleet-welcome-title {
  font-size: 22px;
  font-weight: 850;
  letter-spacing: -0.02em;
  margin: 0;
  background: linear-gradient(135deg, #ffffff 30%, #93c5fd 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.fleet-welcome-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
  line-height: 1.4;
}
.fleet-welcome-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

/* Bento KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}
.kpi-card {
  position: relative;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.kpi-card:hover {
  transform: translateY(-2px);
  border-color: rgba(56, 189, 248, 0.35);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35), 0 0 16px rgba(56, 189, 248, 0.1);
}
.kpi-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--blue), transparent);
}
.kpi-card.kpi-total::before { background: linear-gradient(90deg, #38bdf8, transparent); }
.kpi-card.kpi-afk::before { background: linear-gradient(90deg, var(--green), transparent); }
.kpi-card.kpi-online::before { background: linear-gradient(90deg, var(--blue), transparent); }
.kpi-card.kpi-offline::before { background: linear-gradient(90deg, var(--red), transparent); }
.kpi-card.kpi-totem::before { background: linear-gradient(90deg, var(--gold), transparent); }

.kpi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.kpi-title {
  font-size: 11px;
  font-weight: 750;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.kpi-icon {
  font-size: 18px;
  opacity: 0.85;
}
.kpi-value {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: -0.02em;
  margin: 2px 0;
  line-height: 1.1;
}
.kpi-sub {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

/* Fleet Command Center Toolbar */
.fleet-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 10px 14px;
}
.fleet-toolbar-primary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.fleet-toolbar-tools {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  align-items: center;
}
.warning-btn {
  background: rgba(234, 179, 8, 0.15) !important;
  border-color: rgba(234, 179, 8, 0.35) !important;
  color: #facc15 !important;
}
.warning-btn:hover {
  background: rgba(234, 179, 8, 0.25) !important;
  color: #fff !important;
}

.fleet-search-filter-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}
.fleet-search-sort-wrap {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
  justify-content: flex-end;
  min-width: 280px;
}
.sort-select {
  width: auto;
  min-width: 170px;
  cursor: pointer;
  background: rgba(14, 21, 31, 0.85);
}

.search-box {
  flex: 1;
  min-width: 230px;
}

/* Status Filter Tabs */
.filter-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 650;
  border: 1px solid var(--border);
  background: rgba(14, 21, 31, 0.65);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.tab-btn:hover {
  background: rgba(25, 36, 52, 0.85);
  color: var(--text);
  transform: translateY(-1px);
}

.tab-btn.active {
  background: linear-gradient(180deg, #1f7ae0 0%, #1562b8 100%);
  color: #fff;
  border-color: #388bfd;
  box-shadow: 0 2px 10px rgba(31, 122, 224, 0.4);
}

/* Grids & Panels */
.bot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 340px);
  gap: 18px;
  justify-content: start;
  align-items: start;
}

.bot-card, .panel {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  padding: 18px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.22s ease, box-shadow 0.22s ease;
}

.bot-card {
  position: relative;
  width: 340px;
  max-width: 340px;
  box-sizing: border-box;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.bot-card:hover {
  border-color: rgba(56, 189, 248, 0.45);
  transform: translateY(-3px);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 189, 248, 0.15);
}

.bot-card.status-afk { border-left: 3px solid #30d158; }
.bot-card.status-waiting { border-left: 3px solid #eab308; }
.bot-card.status-offline { border-left: 3px solid #ef4444; }

.bot-card-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.bot-card-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.bot-id-chip {
  font-size: 11px;
  font-weight: 800;
  font-family: monospace;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 6px;
  padding: 2px 7px;
  flex-shrink: 0;
}
.bot-card-name {
  font-size: 16px;
  font-weight: 800;
  color: #fff;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bot-card-admin-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.bot-mini-btn {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  cursor: pointer;
  transition: all 0.15s;
}
.bot-mini-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.bot-mini-btn.danger {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.bot-mini-btn.danger:hover {
  background: #ef4444;
  color: #fff;
}

.bot-status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.bot-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 750;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}
.bot-status-pill.green {
  background: rgba(48, 209, 88, 0.14);
  color: #4ade80;
  border: 1px solid rgba(48, 209, 88, 0.35);
}
.bot-status-pill.yellow {
  background: rgba(234, 179, 8, 0.14);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.35);
}
.bot-status-pill.red {
  background: rgba(239, 68, 68, 0.14);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.35);
}
.pulse-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.pulse-status-dot.green { background: #30d158; box-shadow: 0 0 8px #30d158; }
.pulse-status-dot.yellow { background: #eab308; box-shadow: 0 0 8px #eab308; }
.pulse-status-dot.red { background: #ef4444; box-shadow: 0 0 8px #ef4444; }

.eco-badge-glow {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.35);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.2);
}
.bot-owner-wrap {
  margin-left: auto;
  display: flex;
  align-items: center;
}
.bot-owner-pill {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.bot-owner-pill.rented {
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.32);
}
.bot-owner-pill.free {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.25);
}

.bot-ingame-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  background: rgba(0, 0, 0, 0.25);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 12px;
}
.bot-ingame-user {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bot-ip-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: monospace;
  font-size: 11px;
  color: #c084fc;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(192, 132, 252, 0.1);
  border: 1px solid rgba(192, 132, 252, 0.25);
  transition: all 0.15s;
}
.bot-ip-pill:hover {
  background: rgba(192, 132, 252, 0.22);
  border-color: #c084fc;
}

.bot-vitals-matrix {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}
.vital-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.vital-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  margin-bottom: 4px;
}
.vital-label {
  font-size: 10px;
  font-weight: 750;
  color: var(--muted);
  letter-spacing: 0.3px;
}
.vital-val {
  font-size: 12px;
  font-weight: 800;
}
.hp-bar-track {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 2px;
}
.hp-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}
.totem-warning-badge {
  font-size: 10px;
  font-weight: 800;
  color: #f87171;
  background: rgba(239, 68, 68, 0.15);
  border-radius: 4px;
  padding: 1px 5px;
  display: inline-block;
  width: fit-content;
  margin-top: 2px;
}
.totem-ok-badge {
  font-size: 10px;
  font-weight: 700;
  color: #4ade80;
  background: rgba(74, 222, 128, 0.12);
  border-radius: 4px;
  padding: 1px 5px;
  display: inline-block;
  width: fit-content;
  margin-top: 2px;
}
.sparkline-container {
  height: 14px;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.vital-sub-info {
  font-size: 9.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.bot-kick-notice {
  background: rgba(234, 179, 8, 0.12);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 11px;
  color: #facc15;
  margin-bottom: 8px;
}
.bot-ram-meter-box {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 10px;
  font-size: 10.5px;
}
.bot-ram-meter-labels {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  margin-bottom: 4px;
}
.ram-meter-track {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  overflow: hidden;
}
.ram-meter-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}
.card-quick-actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.card-btn {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 6px;
  border-radius: 7px;
  text-align: center;
}
.detail-link-btn {
  background: rgba(56, 189, 248, 0.12) !important;
  border-color: rgba(56, 189, 248, 0.3) !important;
  color: #38bdf8 !important;
}
.detail-link-btn:hover {
  background: #0284c7 !important;
  border-color: #38bdf8 !important;
  color: #fff !important;
}
.back-btn {
  background: rgba(56, 189, 248, 0.15) !important;
  border-color: rgba(56, 189, 248, 0.35) !important;
  color: #38bdf8 !important;
  font-weight: 750 !important;
}
.back-btn:hover {
  background: rgba(56, 189, 248, 0.3) !important;
  color: #fff !important;
}

.small {
  font-size: 11px;
  padding: 7px 10px;
}

/* Sound Alert Toggle Button */
.sound-btn {
  font-size: 11px;
  padding: 7px 12px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.sound-btn.active {
  border-color: var(--green);
  color: var(--green);
  background: rgba(48, 209, 88, 0.12);
  box-shadow: 0 0 8px var(--green-glow);
}

/* Capacity Badge */
.capacity-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 750;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
}

.capacity-badge.warning {
  border-color: var(--yellow);
  color: var(--yellow);
  background: rgba(255, 214, 10, 0.12);
}

.capacity-badge.danger {
  border-color: var(--red);
  color: var(--red);
  background: rgba(255, 69, 58, 0.14);
}

/* Modals */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 100;
}

@keyframes modalZoomIn {
  from { opacity: 0; transform: scale(0.93) translateY(12px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-card {
  width: min(520px, 100%);
  background: rgba(18, 27, 40, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  animation: modalZoomIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-card h3 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 750;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.modal-card.modal-lg {
  width: min(840px, 98vw);
  max-height: 88vh;
  overflow-y: auto;
}

/* User Mode restrictions */
.user-mode .admin-only {
  display: none !important;
}

/* Login Gate Styles */
.login-gate {
  position: fixed;
  inset: 0;
  background: var(--bg);
  background-image: var(--bg-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  padding: 18px;
}

.login-card {
  width: min(440px, 100%);
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 22px;
  padding: 34px 26px;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.8), 0 0 35px rgba(56, 189, 248, 0.15);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  animation: modalZoomIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.login-header {
  text-align: center;
  margin-bottom: 22px;
}

.login-icon {
  font-size: 38px;
  margin-bottom: 8px;
  display: inline-block;
  filter: drop-shadow(0 0 14px rgba(56, 189, 248, 0.5));
}

.login-title {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #fff;
  margin: 0 0 6px;
}

.login-subtitle {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.4;
}

.login-alert {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.login-alert.error {
  background: rgba(255, 69, 58, 0.15);
  border: 1px solid rgba(255, 69, 58, 0.4);
  color: #ff8580;
}
.login-alert.success {
  background: rgba(48, 209, 88, 0.15);
  border: 1px solid rgba(48, 209, 88, 0.4);
  color: #5be37f;
}

.password-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.password-input-wrap input {
  padding-right: 42px;
  width: 100%;
}
.password-toggle-btn {
  position: absolute;
  right: 8px;
  background: transparent !important;
  border: none !important;
  color: var(--muted) !important;
  padding: 4px 6px !important;
  cursor: pointer;
  box-shadow: none !important;
  font-size: 14px;
}

/* User Management Tables & Badges */
.user-table-wrap {
  margin: 14px 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(0,0,0,0.25);
}
.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}
.user-table th {
  background: rgba(255,255,255,0.05);
  padding: 10px 12px;
  color: var(--muted);
  font-weight: 700;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.user-table td {
  padding: 11px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  vertical-align: middle;
}
.user-table tr:last-child td {
  border-bottom: none;
}
.user-table tr:hover td {
  background: rgba(255,255,255,0.03);
}

.bot-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding: 10px;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin: 8px 0;
}
.bot-check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  cursor: pointer;
  font-size: 11.5px;
  transition: all 0.15s ease;
}
.bot-check-item:hover {
  background: rgba(56,189,248,0.1);
  border-color: rgba(56,189,248,0.3);
}
.bot-check-item input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--blue);
}

/* User Announcement Popup (Modal) */
.user-announcement-card {
  width: min(580px, 95vw);
  background: radial-gradient(circle at 10% 10%, rgba(26, 42, 66, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%);
  border: 1px solid rgba(56, 189, 248, 0.45);
  border-radius: 24px;
  box-shadow: 0 35px 90px rgba(0, 0, 0, 0.85), 0 0 50px rgba(56, 189, 248, 0.25);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  padding: 28px 24px 22px;
  animation: modalZoomIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.user-announcement-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 16px;
}
.announcement-bell-badge {
  font-size: 34px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  width: 56px;
  height: 56px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.5));
  flex-shrink: 0;
  animation: bellFloat 3s ease-in-out infinite;
}
@keyframes bellFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.announcement-badge-pill {
  font-size: 10px;
  font-weight: 850;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.18);
  border: 1px solid rgba(245, 158, 11, 0.38);
  padding: 3px 9px;
  border-radius: 999px;
  display: inline-block;
  margin-bottom: 6px;
  letter-spacing: 0.5px;
}
.announcement-main-title {
  font-size: 20px;
  font-weight: 850;
  color: #fff;
  margin: 0 0 4px;
  line-height: 1.3;
}
.announcement-sub-date {
  font-size: 11px;
  color: var(--muted);
}
.announcement-close-btn {
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: var(--muted) !important;
  width: 32px;
  height: 32px;
  padding: 0 !important;
  border-radius: 10px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}
.announcement-close-btn:hover {
  background: rgba(255, 69, 58, 0.2) !important;
  border-color: rgba(255, 69, 58, 0.4) !important;
  color: #ff8580 !important;
}
.user-announcement-body {
  max-height: 52vh;
  overflow-y: auto;
  padding: 16px 18px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.7;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 18px;
}
.user-announcement-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.announcement-freq-note {
  font-size: 11.5px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.announcement-ack-btn {
  padding: 12px 24px !important;
  font-size: 13.5px !important;
  font-weight: 800 !important;
  letter-spacing: 0.5px;
  border-radius: 12px !important;
  background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4f46e5 100%) !important;
  box-shadow: 0 0 20px rgba(37, 99, 235, 0.4) !important;
  transition: all 0.2s ease !important;
}
.announcement-ack-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 28px rgba(37, 99, 235, 0.6) !important;
}

/* User Profile Menu & Dropdown */
.user-profile-menu-wrap {
  position: relative;
  display: inline-block;
  margin-left: auto;
}

.user-profile-btn {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 6px 12px !important;
  border-radius: 999px !important;
  background: rgba(255, 255, 255, 0.06) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  color: #fff !important;
  font-size: 12.5px !important;
  font-weight: 750 !important;
  cursor: pointer !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
  user-select: none;
}

.user-profile-btn:hover {
  background: rgba(56, 189, 248, 0.15) !important;
  border-color: rgba(56, 189, 248, 0.45) !important;
  box-shadow: 0 0 14px rgba(56, 189, 248, 0.25) !important;
  transform: translateY(-1px);
}

.user-avatar-badge {
  font-size: 14px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
}

.user-profile-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-profile-arrow {
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.2s ease;
}

.user-profile-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  left: auto;
  transform-origin: top right;
  width: 250px;
  max-width: calc(100vw - 24px);
  background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 16px;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.7), 0 0 25px rgba(56, 189, 248, 0.15);
  padding: 12px;
  z-index: 150;
  animation: modalZoomIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.profile-dropdown-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 6px 10px;
}

.profile-dropdown-avatar {
  font-size: 24px;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.profile-dropdown-info {
  flex: 1;
  min-width: 0;
}

.profile-dropdown-user {
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-dropdown-role {
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  margin-top: 2px;
}

.profile-dropdown-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 6px 0;
}

.profile-dropdown-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-menu-item {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  padding: 9px 12px !important;
  border-radius: 10px !important;
  background: transparent !important;
  border: 1px solid transparent !important;
  color: #e2e8f0 !important;
  font-size: 12.5px !important;
  font-weight: 650 !important;
  text-align: left !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  box-shadow: none !important;
}

.profile-menu-item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  color: #fff !important;
}

.profile-menu-item.danger:hover {
  background: rgba(255, 69, 58, 0.18) !important;
  border-color: rgba(255, 69, 58, 0.35) !important;
  color: #ff8580 !important;
}

/* Pulsing Status Indicators */
@keyframes pulseGreen {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(48, 209, 88, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(48, 209, 88, 0.4); }
}

@keyframes pulseYellow {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 214, 10, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(255, 214, 10, 0.4); }
}

@keyframes pulseRed {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 69, 58, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(255, 69, 58, 0.4); }
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  margin-bottom: 12px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  background: #697582;
  transition: all 0.25s ease;
}

.dot.green {
  background: var(--green);
  animation: pulseGreen 2.2s infinite ease-in-out;
}

.dot.yellow {
  background: var(--yellow);
  animation: pulseYellow 2s infinite ease-in-out;
}

.dot.red {
  background: var(--red);
  animation: pulseRed 2.5s infinite ease-in-out;
}

.dot.blue {
  background: var(--blue);
}

.dot.gray {
  background: #94a3b8;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.summary-item {
  padding: 9px 10px;
  border-radius: 10px;
  background: var(--card2);
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.summary-label {
  color: var(--muted);
  font-size: 9px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.summary-value {
  font-size: 12px;
  font-weight: 700;
  word-break: break-word;
}

/* Detail Page Layout */
.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.detail-header .title-wrap {
  flex: 1;
}

.detail-title {
  font-size: 24px;
  font-weight: 850;
  margin: 0;
}

.detail-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 18px;
}

.panel h3 {
  font-size: 15px;
  font-weight: 750;
  margin: 0 0 14px;
  letter-spacing: -0.01em;
}

.big-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 800;
  margin-bottom: 14px;
}

.info {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.info-item {
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--card2);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.info-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.info-value {
  font-size: 14px;
  font-weight: 700;
  word-break: break-word;
}

.controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.chat-panel {
  display: flex;
  flex-direction: column;
}

.chat-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.chat-row {
  display: flex;
  gap: 8px;
}

.chat-form {
  margin-top: 10px;
}

.chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.chip {
  padding: 5px 11px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.chip:hover {
  background: rgba(77, 163, 255, 0.22);
  border-color: var(--blue);
  color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 0 10px var(--blue-glow);
}

.chip:active {
  transform: scale(0.95);
}

.copyable {
  cursor: pointer;
  transition: all 0.18s ease;
}

.copyable:hover {
  border-color: var(--blue);
  background: rgba(77, 163, 255, 0.08);
  box-shadow: 0 0 8px var(--blue-glow);
}

.log, .chat-log {
  height: 440px;
  overflow: auto;
  background: rgba(8, 12, 17, 0.95);
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 12px;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.5);
}

.line {
  padding: 2px 0;
}

.note {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

@keyframes toastSlideIn {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.toast {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: none;
  max-width: 380px;
  padding: 12px 16px;
  border: 1px solid var(--border-glow);
  border-radius: 12px;
  background: rgba(22, 33, 48, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  z-index: 200;
  font-size: 13px;
  font-weight: 600;
  animation: toastSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Inventory Styles */
.inventory-area {
  display: flex;
  flex-direction: column;
}

.inventory-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.inventory-stat {
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--card2);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.inventory-stat .info-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.inventory-stat .info-value {
  font-size: 14px;
  font-weight: 700;
}

.bar {
  width: 100%;
  height: 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  margin-top: 6px;
}

.bar > span, .bar>span {
  display: block;
  height: 100%;
  width: 0;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.health-bar > span, .health-bar>span {
  background: linear-gradient(90deg, #ff453a, #ff6961);
  box-shadow: 0 0 10px rgba(255, 69, 58, 0.5);
}

.hunger-bar > span, .hunger-bar>span {
  background: linear-gradient(90deg, #e69d00, #ffd60a);
  box-shadow: 0 0 10px rgba(255, 214, 10, 0.5);
}

.equipment-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(60px, 1fr));
  gap: 8px;
  margin: 8px 0 14px;
}

.equipment-slot {
  min-height: 64px;
  padding: 8px 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(11, 17, 24, 0.85);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
  text-align: center;
  font-size: 10px;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.equipment-slot .equip-label, .equip-label {
  font-size: 8px;
  color: var(--muted);
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 5px;
}

.equipment-slot.dragover {
  border-color: var(--green);
  background: rgba(16, 35, 24, 0.9);
  box-shadow: 0 0 12px var(--green-glow);
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}

.inventory-slot {
  min-width: 0;
  min-height: 60px;
  padding: 6px 4px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: rgba(11, 17, 24, 0.85);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.inventory-slot:hover {
  border-color: var(--blue);
  transform: translateY(-2px);
  box-shadow: 0 5px 12px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.08);
}

.inventory-slot:active, .inventory-slot.active {
  transform: scale(0.96);
}

.inventory-slot.empty {
  opacity: 0.6;
}

.inventory-slot.selected {
  border-color: var(--green);
  box-shadow: 0 0 12px var(--green-glow), inset 0 0 6px rgba(48, 209, 88, 0.3);
  background: rgba(16, 33, 23, 0.85);
}

.inventory-slot.dragover, .inventory-slot.selected.dragover {
  border-color: var(--blue);
  background: rgba(18, 38, 58, 0.85);
  box-shadow: 0 0 12px var(--blue-glow);
}

.slot-index {
  color: var(--muted);
  font-size: 8px;
  font-weight: 600;
  margin-bottom: 3px;
}

.slot-name {
  font-size: 8px;
  font-weight: 700;
  line-height: 1.2;
  word-break: break-word;
}

.slot-count {
  font-size: 10px;
  font-weight: 800;
  margin-top: 3px;
  color: #fff;
}

.drop-zone {
  margin-top: 14px;
  min-height: 50px;
  border: 2px dashed rgba(255, 255, 255, 0.15);
  border-radius: 11px;
  background: rgba(11, 17, 24, 0.5);
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.2s;
}

.drop-zone.dragover {
  border-color: var(--red);
  background: rgba(45, 18, 20, 0.8);
  color: var(--text);
  box-shadow: 0 0 14px var(--red-glow);
}

.position-value, .revision {
  font-variant-numeric: tabular-nums;
}

.inventory-list {
  display: grid;
  gap: 6px;
}

.inventory-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--card2);
}

.inventory-item-name {
  font-size: 12px;
  font-weight: 600;
}

/* Settings & Schedules */
.setting-list {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s;
}

.check-row:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.check-row input {
  width: auto;
  accent-color: var(--blue);
  cursor: pointer;
}

.schedule-list {
  display: grid;
  gap: 8px;
  margin: 10px 0;
}

.schedule-row {
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(21, 31, 41, 0.85) 0%, rgba(17, 26, 34, 0.85) 100%);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: border-color 0.18s, opacity 0.18s, transform 0.18s;
}

.schedule-row:hover {
  border-color: rgba(77, 163, 255, 0.45);
}

.schedule-row.dragging {
  opacity: 0.5;
  transform: scale(0.98);
}

.schedule-row-top {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.schedule-handle {
  width: 26px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  cursor: grab;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.03);
  user-select: none;
}

.schedule-handle:active {
  cursor: grabbing;
}

.schedule-row-title {
  font-size: 12px;
  font-weight: 800;
  min-width: 0;
}

.schedule-inline {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}

.schedule-inline input, .schedule-inline select {
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 11px;
  min-width: 0;
}

.schedule-inline .action-select { width: 94px; }
.schedule-inline .time-input { width: 90px; }
.schedule-inline .minutes-input { width: 106px; }

.schedule-row-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
  margin-top: 8px;
}

.schedule-row-main textarea {
  width: 100%;
  min-height: 52px;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 12px;
  resize: vertical;
}

.schedule-row-main .schedule-field, .schedule-field { display: grid; gap: 4px; }
.schedule-row-main .schedule-field > span, .schedule-row-main .schedule-field>span, .schedule-field > span, .schedule-field>span { color: var(--muted); font-size: 10px; font-weight: 600; }
.schedule-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 10px; }

.scheduler-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin: 10px 0 8px;
}

.scheduler-mode-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
}

.scheduler-mode-box > span, .scheduler-mode-box>span { color: var(--muted); font-size: 11px; font-weight: 600; }
.scheduler-mode-box select { padding: 8px 10px; border-radius: 9px; font-size: 12px; }
.scheduler-note { margin: 6px 0 10px; color: var(--muted); font-size: 10px; line-height: 1.5; }
.compact-save { margin-top: 8px; }
.hidden-field { display: none !important; }

.credential-list {
  display: grid;
  gap: 10px;
  max-height: 60vh;
  overflow: auto;
}

.credential-card {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card2);
}

.credential-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin-top: 8px;
}

.credential-value {
  padding: 10px;
  border-radius: 8px;
  background: rgba(10, 16, 24, 0.85);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  word-break: break-all;
  font-size: 12px;
}

.dragging { opacity: 0.55; }
.app-footer {
  margin-top: 36px;
  padding: 16px 20px;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  text-align: left;
  color: var(--muted);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.footer-recent-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.footer-recent-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.footer-recent-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  white-space: nowrap;
}
.footer-recent-desc {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}
.footer-changelog-btn {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: #cbd5e1 !important;
  font-size: 11.5px !important;
  font-weight: 650 !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
  cursor: pointer !important;
  transition: all 0.2s ease !important;
  white-space: nowrap;
  box-shadow: none !important;
}
.footer-changelog-btn:hover {
  background: rgba(56, 189, 248, 0.15) !important;
  border-color: rgba(56, 189, 248, 0.4) !important;
  color: #38bdf8 !important;
}
.footer-copy {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  opacity: 0.65;
}

/* Changelog Timeline Modal */
.changelog-card {
  width: min(720px, 96vw);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}
.changelog-body {
  overflow-y: auto;
  padding-right: 6px;
  margin: 12px 0;
  max-height: calc(85vh - 120px);
}
.timeline-item {
  position: relative;
  padding-left: 28px;
  padding-bottom: 22px;
  border-left: 2px solid rgba(56, 189, 248, 0.2);
}
.timeline-item:last-child {
  border-left: 2px solid transparent;
  padding-bottom: 6px;
}
.timeline-node {
  position: absolute;
  left: -7px;
  top: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #0284c7;
  border: 2px solid #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.8);
}
.timeline-item.latest .timeline-node {
  background: #10b981;
  border-color: #34d399;
  box-shadow: 0 0 12px rgba(52, 211, 153, 0.9);
}
.timeline-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.timeline-version {
  font-size: 14.5px;
  font-weight: 850;
  color: #fff;
}
.timeline-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
  letter-spacing: 0.4px;
}
.timeline-badge.current {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #34d399;
}
.timeline-badge.past {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #94a3b8;
}
.timeline-content {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.65;
}
.timeline-content ul {
  margin: 0;
  padding-left: 18px;
}
.timeline-content li {
  margin-bottom: 4px;
}
.timeline-content li strong {
  color: #38bdf8;
}

.hidden { display: none !important; }

/* Custom Scrollbars */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }

@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
}

@media (max-width: 520px) {
  .bot-grid { grid-template-columns: 1fr; }
  .bot-card { width: 100%; max-width: 100%; }
  .info, .inventory-grid { grid-template-columns: 1fr; }
  .equipment-row { grid-template-columns: repeat(5, minmax(48px, 1fr)); }
}

.vip-pill {
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(217, 119, 6, 0.3) 100%);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #fbbf24;
  letter-spacing: 0.05em;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.platform-pill {
  font-size: 11px;
  font-weight: 750;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  color: #38bdf8;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ram-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: #34d399;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.fleet-resource-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  background: linear-gradient(135deg, rgba(16, 24, 38, 0.75) 0%, rgba(10, 16, 26, 0.85) 100%);
  border: 1px solid rgba(77, 163, 255, 0.15);
  border-radius: 14px;
  padding: 14px 18px;
  margin-bottom: 18px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.fleet-res-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.2s ease;
}

.fleet-res-item:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(77, 163, 255, 0.25);
  transform: translateY(-1px);
}

.fleet-res-icon {
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}

.fleet-res-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.fleet-res-val {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.eco-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(16, 185, 129, 0.18);
  border: 1px solid rgba(16, 185, 129, 0.45);
  color: #34d399;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
}

.ram-meter-wrap {
  margin-top: 8px;
  padding: 6px 9px;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.ram-meter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
  font-weight: 700;
  margin-bottom: 5px;
}

.ram-meter-bar {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
}

.ram-meter-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.4s ease;
}

@media (max-width: 768px) {
  .fleet-resource-bar {
    grid-template-columns: repeat(2, 1fr);
    padding: 10px;
    gap: 8px;
  }
  .fleet-res-item {
    padding: 6px 8px;
  }
  .fleet-res-icon {
    width: 34px;
    height: 34px;
    font-size: 18px;
  }
  .fleet-res-val {
    font-size: 13px;
  }
  .card-quick-actions button {
    min-height: 44px;
  }
  .top-actions button {
    min-height: 44px;
  }
}

@media (max-width: 480px) {
  .fleet-resource-bar {
    grid-template-columns: 1fr;
  }
}

/* ========================================================================== */
/* KBOT COMMERCIAL SAAS PORTAL & LANDING STYLES (UI/UX PRO MAX)               */
/* ========================================================================== */
.kbot-portal-wrapper {
  display: flex;
  width: min(1080px, 96vw);
  max-height: 90vh;
  background: linear-gradient(145deg, rgba(11, 19, 38, 0.95) 0%, rgba(6, 15, 28, 0.97) 100%);
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 26px;
  box-shadow: 0 35px 80px rgba(0, 0, 0, 0.85), 0 0 50px rgba(16, 185, 129, 0.12);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  overflow: hidden;
  position: relative;
  animation: modalZoomIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

@media (max-width: 920px) {
  .kbot-portal-wrapper {
    flex-direction: column;
    max-height: 94vh;
    overflow-y: auto;
  }
}

.kbot-landing-col {
  flex: 1.25;
  padding: 32px 30px;
  overflow-y: auto;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  background: radial-gradient(circle at 10% 20%, rgba(16, 185, 129, 0.08) 0%, transparent 60%);
}

.kbot-landing-col::-webkit-scrollbar {
  width: 5px;
}
.kbot-landing-col::-webkit-scrollbar-thumb {
  background: rgba(56, 189, 248, 0.3);
  border-radius: 10px;
}

.kbot-login-col {
  flex: 0.95;
  padding: 32px 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
}

.kbot-brand-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.38);
  color: #34d399;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.8px;
  margin-bottom: 12px;
  box-shadow: 0 0 15px rgba(16, 185, 129, 0.2);
}

.kbot-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: pulseGreen 1.8s infinite;
}

.kbot-landing-title {
  font-size: 23px;
  font-weight: 850;
  line-height: 1.35;
  color: #fff;
  margin: 0 0 8px;
  letter-spacing: -0.02em;
}

.kbot-gradient-text {
  display: block;
  background: linear-gradient(135deg, #34d399 0%, #38bdf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.kbot-landing-desc {
  font-size: 13px;
  line-height: 1.6;
  color: #94a3b8;
  margin: 0 0 18px;
}

/* Discord CTA Button */
.kbot-discord-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(135deg, #5865F2 0%, #4752C4 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  padding: 12px 16px;
  color: #fff !important;
  text-decoration: none !important;
  box-shadow: 0 10px 24px rgba(88, 101, 242, 0.35);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  margin-bottom: 22px;
}
.kbot-discord-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 30px rgba(88, 101, 242, 0.55);
  filter: brightness(1.08);
}
.kbot-discord-icon {
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}
.kbot-discord-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.kbot-discord-text strong {
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.2px;
}
.kbot-discord-text small {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 2px;
}
.kbot-discord-badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.kbot-section-subtitle {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.8px;
  color: #38bdf8;
  margin-bottom: 10px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Benefits Grid */
.kbot-benefits-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 18px;
}
.kbot-benefit-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 8px 12px;
  transition: all 0.2s ease;
}
.kbot-benefit-card:hover {
  background: rgba(56, 189, 248, 0.06);
  border-color: rgba(56, 189, 248, 0.25);
  transform: translateX(3px);
}
.kbot-benefit-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}
.kbot-benefit-info strong {
  font-size: 12.5px;
  font-weight: 750;
  color: #f1f5f9;
  display: block;
  margin-bottom: 2px;
}
.kbot-benefit-info p {
  margin: 0;
  font-size: 11.5px;
  color: #94a3b8;
  line-height: 1.45;
}

/* 3-Steps Workflow */
.kbot-steps-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 18px;
  background: rgba(0, 0, 0, 0.25);
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}
@media (max-width: 600px) {
  .kbot-steps-row {
    flex-direction: column;
    align-items: stretch;
  }
}
.kbot-step-item {
  flex: 1;
  font-size: 11px;
  line-height: 1.4;
  color: #cbd5e1;
}
.kbot-step-num {
  font-weight: 850;
  color: #34d399;
  margin-bottom: 2px;
  text-transform: uppercase;
  font-size: 10.5px;
}
.kbot-step-arrow {
  color: var(--muted);
  font-weight: bold;
}

/* Commitments Box */
.kbot-commitments-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
@media (max-width: 600px) {
  .kbot-commitments-box {
    grid-template-columns: 1fr;
  }
}
.kbot-commit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.22);
  padding: 8px 10px;
  border-radius: 10px;
}
.kbot-commit-icon {
  font-size: 16px;
}
.kbot-commit-item strong {
  display: block;
  font-size: 11.5px;
  font-weight: 750;
  color: #34d399;
}
.kbot-commit-item small {
  display: block;
  font-size: 10px;
  color: #94a3b8;
  line-height: 1.35;
}

/* ==========================================================================
   V11.6 COMMERCIAL ENTERPRISE EDITION — GLOBAL NAV, OVERLAYS & FULL PAGE SECTIONS
   ========================================================================== */

/* Account Restriction Blur & Overlays */
.account-restricted-blur {
  filter: blur(8px) brightness(0.65) !important;
  pointer-events: none !important;
  user-select: none !important;
  transition: filter 0.3s ease;
}

.account-restriction-overlay {
  position: fixed;
  inset: 0;
  z-index: 999999;
  background: rgba(3, 7, 18, 0.82);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.account-restriction-overlay.hidden {
  display: none !important;
}
.restriction-card {
  width: 100%;
  max-width: 480px;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(239, 68, 68, 0.45);
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(239, 68, 68, 0.2);
  border-radius: 20px;
  padding: 30px 24px;
  text-align: center;
  animation: modalZoomIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.restriction-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.restriction-title {
  font-size: 20px;
  font-weight: 850;
  color: #ef4444;
  margin: 0 0 8px;
  letter-spacing: 0.5px;
}
.restriction-subtitle {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
  margin-bottom: 18px;
}
.restriction-reason-box {
  background: rgba(239, 68, 68, 0.1);
  border: 1px dashed rgba(239, 68, 68, 0.35);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 20px;
  text-align: left;
}
.restriction-reason-box .reason-label {
  font-size: 11px;
  font-weight: 800;
  color: #f87171;
  margin-bottom: 6px;
}
.restriction-reason-box .reason-content {
  font-size: 13.5px;
  color: #f1f5f9;
  font-weight: 600;
  line-height: 1.5;
  word-break: break-word;
}
.expired-redeem-box {
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 20px;
  text-align: left;
}
.expired-redeem-box label {
  font-size: 11.5px;
  font-weight: 800;
  color: #38bdf8;
  display: block;
}
.restriction-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.btn-discord {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 18px;
  background: #5865f2;
  color: #fff;
  border-radius: 10px;
  font-weight: 750;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.2s ease;
}
.btn-discord:hover {
  background: #4752c4;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(88, 101, 242, 0.4);
}
.btn-logout-overlay {
  padding: 11px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #cbd5e1;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-logout-overlay:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: #f87171;
}

/* Global Sticky Top Navigation Bar */
.global-header {
  position: sticky;
  top: 0;
  z-index: 1000;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: rgba(10, 15, 30, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(56, 189, 248, 0.2);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  box-sizing: border-box;
}
.global-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.global-header-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.global-logo {
  font-size: 20px;
}
.global-brand-text {
  font-weight: 850;
  font-size: 16px;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.vip-pill-mini {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
  border: 1px solid rgba(234, 179, 8, 0.35);
}
.global-nav-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
}
.nav-pill-btn {
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}
.nav-pill-btn:hover {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.4);
  color: #fff;
}
.nav-pill-btn.active {
  background: #0284c7;
  border-color: #38bdf8;
  color: #fff;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.4);
}
.global-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Dropdown Top Logout Button */
.dropdown-top-logout-wrap {
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.dropdown-top-logout-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.dropdown-top-logout-btn:hover {
  background: #ef4444;
  color: #fff;
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.5);
}
.profile-menu-section-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.6px;
  color: var(--muted);
  padding: 6px 8px 4px;
}
.big-tab-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.big-tab-item:hover {
  background: rgba(56, 189, 248, 0.12) !important;
  border-color: rgba(56, 189, 248, 0.3) !important;
}
.big-tab-item .menu-icon {
  font-size: 20px;
  flex-shrink: 0;
}
.big-tab-item .menu-text {
  display: flex;
  flex-direction: column;
}
.big-tab-item .menu-text strong {
  font-size: 13px;
  color: #f1f5f9;
}
.big-tab-item .menu-text small {
  font-size: 10.5px;
  color: #94a3b8;
}

/* Full Page Sections */
.full-page-section {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 24px;
  box-sizing: border-box;
  animation: fadeIn 0.2s ease;
}
.full-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.full-page-title {
  font-size: 22px;
  font-weight: 850;
  margin: 0 0 4px;
  color: #fff;
}
.full-page-subtitle {
  font-size: 13px;
  color: #94a3b8;
}
.sub-tab-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 12px;
}
.sub-tab-btn {
  padding: 8px 18px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  font-weight: 750;
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.sub-tab-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.sub-tab-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: #38bdf8;
  color: #38bdf8;
  box-shadow: 0 0 14px rgba(56, 189, 248, 0.25);
}
.mgmt-filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  background: rgba(255, 255, 255, 0.02);
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.filter-chip {
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.filter-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.filter-chip.active {
  background: #0284c7;
  border-color: #38bdf8;
  color: #fff;
}
.password-cell-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
}
.password-text.revealed {
  color: #38bdf8;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: rgba(56, 189, 248, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.password-text.masked {
  color: #64748b;
  letter-spacing: 2px;
}
.btn-peek {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 13px;
  cursor: pointer;
  color: #cbd5e1;
  transition: all 0.2s;
}
.btn-peek:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}
.quick-renew-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.quick-renew-btn {
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  color: #38bdf8;
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;
  transition: all 0.15s ease;
}
.quick-renew-btn:hover {
  background: #0284c7;
  color: #fff;
  border-color: #38bdf8;
}
.quick-renew-btn.minus {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.quick-renew-btn.minus:hover {
  background: #ef4444;
  color: #fff;
}
.quick-renew-btn.vip {
  background: rgba(234, 179, 8, 0.15);
  border-color: rgba(234, 179, 8, 0.4);
  color: #eab308;
}
.quick-renew-btn.vip:hover {
  background: #eab308;
  color: #000;
}
.quick-renew-btn.custom {
  background: rgba(148, 163, 184, 0.15);
  border-color: rgba(148, 163, 184, 0.3);
  color: #cbd5e1;
}
.quick-renew-btn.custom:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.bot-check-item.bot-occupied {
  opacity: 0.65;
  filter: grayscale(0.85);
  border-style: dashed;
  background: rgba(255, 255, 255, 0.02);
}
.badge-occupied {
  display: block;
  font-size: 10.5px;
  color: #eab308;
  font-weight: 700;
  margin-top: 2px;
}
.badge-lifetime {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
  border: 1px solid rgba(234, 179, 8, 0.4);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  display: inline-block;
}
.badge-expired {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  display: inline-block;
}
.badge-active {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  display: inline-block;
}
.create-key-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 16px;
}

@media (max-width: 768px) {
  .global-nav-pills {
    display: none !important;
  }
  .full-page-section {
    padding: 12px 10px;
  }
  .mgmt-filter-bar {
    flex-direction: column;
    align-items: stretch;
  }
}

</style>
</head>
<body>
<div id="loginGate" class="login-gate hidden">
  <div class="kbot-portal-wrapper">
    <!-- CỘT TRÁI: SAAS SHOWCASE GIỚI THIỆU SẢN PHẨM & QUYỀN LỢI & DISCORD -->
    <div class="kbot-landing-col">
      <div class="kbot-brand-badge">
        <span class="kbot-pulse-dot"></span>
        <span>KBOT • GIẢI PHÁP AFK KINGMC SỐ 1</span>
      </div>
      
      <h1 class="kbot-landing-title">
        Hệ Thống Cho Thuê Bot AFK KingMC
        <span class="kbot-gradient-text">Tự Động 24/7 Đám Mây</span>
      </h1>
      
      <p class="kbot-landing-desc">
        Treo Máy Thông Minh - Tự Động Thu Hoạch - Bất Tử 24/7 Không Cần Bật Máy Tính. Nền tảng chuyên nghiệp số 1 dành riêng cho người chơi máy chủ KingMC.
      </p>

      <!-- NÚT DISCORD CỘNG ĐỒNG HỖ TRỢ 24/7 -->
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="kbot-discord-btn" title="Tham gia Discord Hỗ Trợ 24/7">
        <svg class="kbot-discord-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
        <span class="kbot-discord-text">
          <strong>Gia Nhập Cộng Đồng Discord Hỗ Trợ 24/7</strong>
          <small>Giải đáp thắc mắc, mua Giftcode & hỗ trợ kỹ thuật tức thì</small>
        </span>
        <span class="kbot-discord-badge">ONLINE</span>
      </a>

      <!-- 5 QUYỀN LỢI KHÁCH THUÊ -->
      <div class="kbot-section-subtitle">💎 QUYỀN LỢI DÀNH CHO KHÁCH THUÊ BOT</div>
      <div class="kbot-benefits-grid">
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">⚡</div>
          <div class="kbot-benefit-info">
            <strong>Auto Totem Bất Tử</strong>
            <p>Tự động trang bị totem tay phụ khi máu thấp (&lt; 5 tim), chống té ngã &amp; quái cắn khi AFK.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">🍞</div>
          <div class="kbot-benefit-info">
            <strong>Auto Ăn &amp; Chống Đói</strong>
            <p>Tự tìm thức ăn trong túi đồ khi thanh đói giảm, đảm bảo không bao giờ chết đói.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">💬</div>
          <div class="kbot-benefit-info">
            <strong>Auto Chat &amp; Quảng Cáo</strong>
            <p>Lập lịch phát ngôn rao bán shop, lệnh chat định kỳ tự động và vi chuyển động chống kick AFK.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">⏰</div>
          <div class="kbot-benefit-info">
            <strong>Hẹn Giờ Thông Minh</strong>
            <p>Lập lịch bật/tắt theo giờ cố định hoặc chu kỳ lặp giúp bot hoạt động như người chơi thật.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">🔑</div>
          <div class="kbot-benefit-info">
            <strong>Tự Chủ Đổi Mật Khẩu</strong>
            <p>Tự do đổi mật khẩu /login hoặc tên nhân vật ingame trên Web bất cứ lúc nào, an toàn 100%.</p>
          </div>
        </div>
      </div>

      <!-- QUY TRÌNH 3 BƯỚC HOẠT ĐỘNG -->
      <div class="kbot-section-subtitle" style="margin-top:14px;">🚀 CÁCH THỨC HOẠT ĐỘNG (3 BƯỚC ĐƠN GIẢN)</div>
      <div class="kbot-steps-row">
        <div class="kbot-step-item">
          <div class="kbot-step-num">Bước 1: Kích Hoạt</div>
          <div>Đăng nhập tài khoản hoặc kích hoạt bằng <strong>Mã Key gia hạn</strong>.</div>
        </div>
        <div class="kbot-step-arrow">→</div>
        <div class="kbot-step-item">
          <div class="kbot-step-num">Bước 2: Cài Đặt</div>
          <div>Điền Username, Mật khẩu KingMC và bật các chế độ Auto mong muốn.</div>
        </div>
        <div class="kbot-step-arrow">→</div>
        <div class="kbot-step-item">
          <div class="kbot-step-num">Bước 3: Tận Hưởng</div>
          <div>Nhấn <strong>Bật Bot</strong> — Hệ thống đám mây sẽ tự động treo máy 24/7!</div>
        </div>
      </div>

      <!-- CAM KẾT DỊCH VỤ / SLA -->
      <div class="kbot-commitments-box">
        <div class="kbot-commit-item">
          <span class="kbot-commit-icon">🛡️</span>
          <div>
            <strong>Cam Kết 99.9% Uptime</strong>
            <small>Đám mây ổn định, tự động Reconnect sau khi cụm máy chủ KingMC bảo trì.</small>
          </div>
        </div>
        <div class="kbot-commit-item">
          <span class="kbot-commit-icon">🔒</span>
          <div>
            <strong>Bảo Mật Tuyệt Đối</strong>
            <small>Mã hóa chuẩn scrypt quân sự, không bao giờ lộ mật khẩu hay đồ đạc của khách.</small>
          </div>
        </div>
      </div>
    </div>

    <!-- CỘT PHẢI: FORM ĐĂNG NHẬP -->
    <div class="kbot-login-col">
      <div class="login-card" style="position:relative; width:100%; max-width:400px; box-shadow:none; padding:20px 10px; background:transparent; border:none;">
        <button type="button" onclick="hideLoginGate()" style="position:absolute;top:-10px;right:0;background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:4px 8px;" title="Đóng">✕</button>
        <div class="login-header" style="margin-bottom:14px;">
          <div class="login-icon" style="font-size:32px;">🛡️</div>
          <h2 class="login-title" style="font-size:19px;">CỔNG ĐIỀU KHIỂN KBOT</h2>
          <div class="login-subtitle">Hệ Thống Cho Thuê Bot AFK KingMC • Uptime 99.9%</div>
        </div>

        <!-- TAB SWITCHER: LOGIN vs REGISTER -->
        <div style="display:flex;gap:6px;margin-bottom:14px;background:rgba(255,255,255,0.04);padding:4px;border-radius:10px;">
          <button type="button" id="tabBtnLogin" onclick="switchLoginGateTab('login')" style="flex:1;padding:8px;border-radius:8px;font-size:13px;font-weight:750;background:rgba(56,189,248,0.2);color:#38bdf8;border:1px solid rgba(56,189,248,0.4);cursor:pointer;">
            🚀 Đăng Nhập
          </button>
          <button type="button" id="tabBtnRegister" onclick="switchLoginGateTab('register')" style="flex:1;padding:8px;border-radius:8px;font-size:13px;font-weight:750;background:transparent;color:#94a3b8;border:1px solid transparent;cursor:pointer;">
            📝 Đăng Ký Mới
          </button>
        </div>

        <div id="loginAlert" class="login-alert hidden"></div>

        <!-- FORM ĐĂNG NHẬP -->
        <form id="loginForm" onsubmit="handleLoginSubmit(event)" style="display:flex;flex-direction:column;gap:14px;text-align:left;">
          <div class="form-row" style="margin-bottom:0;">
            <label for="loginUsername">TÊN ĐĂNG NHẬP</label>
            <input id="loginUsername" type="text" autocomplete="username" placeholder="Nhập tên đăng nhập..." required autofocus>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="loginPassword">MẬT KHẨU TRUY CẬP</label>
            <div class="password-input-wrap">
              <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu..." required>
              <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('loginPassword', this)">👁</button>
            </div>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="loginLicenseKey" style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#38bdf8;">🎁 MÃ KEY GIA HẠN (NẾU CÓ)</span>
              <span style="font-size:11px;color:var(--muted);font-weight:normal;">Không bắt buộc</span>
            </label>
            <input id="loginLicenseKey" type="text" placeholder="Nhập mã Key để tự mở khóa & gia hạn ngay..." style="text-transform:uppercase;border-color:rgba(56,189,248,0.3);">
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin:2px 0 6px;">
            <label class="check-row" style="margin:0;font-size:12px;cursor:pointer;">
              <input id="loginRememberMe" type="checkbox" checked> <span>Ghi nhớ phiên đăng nhập (30 ngày)</span>
            </label>
          </div>
          <button id="loginSubmitBtn" type="submit" class="primary" style="padding:12px;font-size:14.5px;font-weight:750;letter-spacing:0.4px;">
            🚀 ĐĂNG NHẬP VÀO HỆ THỐNG
          </button>
        </form>

        <!-- FORM ĐĂNG KÝ -->
        <form id="registerForm" onsubmit="handleInAppRegisterSubmit(event)" style="display:none;flex-direction:column;gap:14px;text-align:left;">
          <div class="form-row" style="margin-bottom:0;">
            <label for="regUsername">TÊN ĐĂNG NHẬP MỚI</label>
            <input id="regUsername" type="text" autocomplete="username" placeholder="Chữ, số, gạch dưới (3-32 ký tự)..." required>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="regPassword">MẬT KHẨU (TỐI THIỂU 5 KÝ TỰ)</label>
            <div class="password-input-wrap">
              <input id="regPassword" type="password" autocomplete="new-password" placeholder="Tối thiểu 5 ký tự (chữ hoặc số, phân biệt hoa thường)..." required>
              <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('regPassword', this)">👁</button>
            </div>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="regConfirmPassword">XÁC NHẬN MẬT KHẨU</label>
            <div class="password-input-wrap">
              <input id="regConfirmPassword" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu..." required>
              <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('regConfirmPassword', this)">👁</button>
            </div>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="regLicenseKey" style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#38bdf8;">🎁 MÃ KEY GIA HẠN (NẾU CÓ)</span>
              <span style="font-size:11px;color:var(--muted);font-weight:normal;">Tùy chọn (Mặc định tặng 1 ngày)</span>
            </label>
            <input id="regLicenseKey" type="text" placeholder="Nhập mã Key để kích hoạt gói ngay..." style="text-transform:uppercase;border-color:rgba(56,189,248,0.3);">
          </div>
          <button id="regSubmitBtn" type="submit" class="primary" style="padding:12px;font-size:14.5px;font-weight:750;letter-spacing:0.4px;background:#059669;border-color:#10b981;">
            📝 TẠO TÀI KHOẢN &amp; VÀO HỆ THỐNG
          </button>
        </form>

        <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:11.5px;color:var(--muted);line-height:1.5;">
          • Quản trị viên: Đăng nhập tài khoản <code>admin</code>.<br/>
          • Khách mới: Tự đăng ký tài khoản (tặng 1 ngày dùng thử hoặc nhập Key).
        </div>
      </div>
    </div>
  </div>
</div>

<!-- OVERLAY TẠM KHÓA TÀI KHOẢN (BLUR BACKGROUND) -->
<div id="accountLockedOverlay" class="account-restriction-overlay hidden">
  <div class="restriction-card">
    <div class="restriction-icon">🔒</div>
    <h2 class="restriction-title">TÀI KHOẢN ĐANG BỊ TẠM KHÓA</h2>
    <div class="restriction-subtitle">Quyền truy cập bảng điều khiển của bạn đã bị Quản trị viên tạm dừng.</div>
    <div class="restriction-reason-box">
      <div class="reason-label">📢 LỜI NHẮN TỪ QUẢN TRỊ VIÊN:</div>
      <div id="lockedReasonMessage" class="reason-content">Tài khoản của bạn đang bị tạm khóa. Vui lòng liên hệ Admin để được hỗ trợ.</div>
    </div>
    <div class="restriction-actions">
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="btn-discord">
        💬 Liên Hệ Hỗ Trợ Discord
      </a>
      <button type="button" class="btn-logout-overlay" onclick="logout()">
        🚪 Đăng Xuất
      </button>
    </div>
  </div>
</div>

<!-- OVERLAY HẾT HẠN THUÊ BOT (BLUR BACKGROUND) -->
<div id="accountExpiredOverlay" class="account-restriction-overlay hidden">
  <div class="restriction-card">
    <div class="restriction-icon">⏳</div>
    <h2 class="restriction-title">GÓI THUÊ BOT ĐÃ HẾT HẠN</h2>
    <div class="restriction-subtitle">Thời hạn sử dụng dịch vụ bot AFK của bạn đã kết thúc. Vui lòng nạp Mã Key để mở khóa hoặc liên hệ Discord.</div>
    <div class="expired-redeem-box">
      <label>KÍCH HOẠT &amp; GIA HẠN NGAY BẰNG MÃ KEY</label>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <input type="text" id="expiredKeyInput" placeholder="Nhập mã Key gia hạn..." style="text-transform:uppercase;flex:1;">
        <button type="button" class="primary" onclick="redeemKeyFromExpiredOverlay()">🚀 Kích Hoạt</button>
      </div>
      <div id="expiredKeyAlert" class="login-alert hidden" style="margin-top:8px;"></div>
    </div>
    <div class="restriction-actions">
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="btn-discord">
        💬 Vào Discord KingMC Gia Hạn
      </a>
      <button type="button" class="btn-logout-overlay" onclick="logout()">
        🚪 Đăng Xuất
      </button>
    </div>
  </div>
</div>

<div id="mainApp" class="app">
  <!-- GLOBAL TOP-RIGHT PINNED NAVIGATION HEADER (PERSISTENT ON ALL TABS PC & MOBILE) -->
  <header id="globalHeader" class="global-header">
    <div class="global-header-left">
      <div class="global-header-brand" onclick="navigateTo('dashboard')">
        <span class="global-logo">👑</span>
        <span class="global-brand-text">KBOT</span>
        <span class="vip-pill-mini">V11.6 PRO</span>
      </div>
      <nav class="global-nav-pills">
        <button type="button" class="nav-pill-btn active" id="navPillHome" onclick="navigateTo('dashboard')">
          📊 Dashboard
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillUsers" onclick="navigateTo('users')">
          👥 Quản Lý User &amp; Key
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillAudit" onclick="navigateTo('audit')">
          📋 Nhật Ký (Audit)
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillBackup" onclick="navigateTo('backup')">
          💾 Sao Lưu
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillSupabase" onclick="openSupabaseModal()">
          ☁️ Supabase Cloud
        </button>
      </nav>
    </div>
    <div class="global-header-right">
      <span id="globalUserRoleBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">🔒 CHƯA ĐĂNG NHẬP</span>
      <span class="ram-pill">📊 <strong id="globalManagerRam">-- MB</strong></span>
      
      <!-- ACCOUNT MENU BUTTON - PINNED SAT GOC PHAI -->
      <div class="user-profile-menu-wrap" style="position:relative;">
        <button id="globalUserProfileBtn" class="user-profile-btn" onclick="toggleGlobalProfileDropdown(event)">
          <span class="user-avatar-badge" id="globalUserAvatarBadge">👑</span>
          <span class="user-profile-name" id="globalUserProfileName">admin</span>
          <span class="user-profile-arrow">▾</span>
        </button>
        
        <!-- DROPDOWN MENU (RIGHT: 0; EXPANDS SAFELY INWARD) -->
        <div id="globalUserProfileDropdown" class="user-profile-dropdown hidden" onclick="event.stopPropagation()">
          <!-- DANG XUAT O NGAY DAU TAB PHIA TREN -->
          <div class="dropdown-top-logout-wrap">
            <button type="button" class="dropdown-top-logout-btn" onclick="logout()">
              🚪 ĐĂNG XUẤT
            </button>
          </div>
          
          <div class="profile-dropdown-header">
            <div class="profile-dropdown-avatar" id="globalDropdownAvatar">👑</div>
            <div class="profile-dropdown-info">
              <div class="profile-dropdown-user" id="globalDropdownUsername">admin</div>
              <div class="profile-dropdown-role" id="globalDropdownRole">👑 Quản trị viên</div>
              <div class="profile-dropdown-expires" id="globalDropdownExpires" style="display:none;font-size:11px;color:#38bdf8;margin-top:2px;font-weight:700;"></div>
            </div>
          </div>
          <div class="profile-dropdown-divider"></div>
          
          <div class="profile-dropdown-menu">
            <div class="profile-menu-section-title">CHUYỂN TRANG NHANH</div>
            <div class="big-tab-item" onclick="navigateTo('dashboard'); closeGlobalProfileDropdown();">
              <span class="menu-icon">📊</span>
              <div class="menu-text">
                <strong>Dashboard</strong>
                <small>Xem và điều khiển danh sách bot</small>
              </div>
            </div>
            <div class="big-tab-item admin-only" onclick="navigateTo('users'); closeGlobalProfileDropdown();">
              <span class="menu-icon">👥</span>
              <div class="menu-text">
                <strong>Quản Lý User &amp; Key</strong>
                <small>Cấp quyền, gia hạn, xem pass, khóa</small>
              </div>
            </div>
            <div class="big-tab-item admin-only" onclick="navigateTo('audit'); closeGlobalProfileDropdown();">
              <span class="menu-icon">📋</span>
              <div class="menu-text">
                <strong>Nhật Ký Hoạt Động (Audit)</strong>
                <small>Lịch sử thao tác, lệnh và can thiệp</small>
              </div>
            </div>
            <div class="big-tab-item admin-only" onclick="openSupabaseModal(); closeGlobalProfileDropdown();">
              <span class="menu-icon">☁️</span>
              <div class="menu-text">
                <strong>Supabase Cloud Database</strong>
                <small>Lưu trữ vĩnh viễn, chống mất dữ liệu khi restart</small>
              </div>
            </div>
            
            <div class="profile-dropdown-divider admin-only"></div>
            <div class="profile-menu-section-title admin-only">TIỆN ÍCH QUẢN TRỊ</div>
            <button type="button" class="profile-menu-item admin-only" onclick="openAnnouncementAdminModal(); closeGlobalProfileDropdown();">
              <span>📢 Thông Báo Người Dùng</span>
            </button>
            <button type="button" class="profile-menu-item admin-only" onclick="openBatchSettingsModal(); closeGlobalProfileDropdown();">
              <span>⚙ Đồng Bộ Cài Đặt Fleet</span>
            </button>
            <button type="button" class="profile-menu-item admin-only" onclick="openAdminModal(); closeGlobalProfileDropdown();">
              <span>🔑 Mật Khẩu Minecraft Bot</span>
            </button>
            
            <div class="profile-dropdown-divider"></div>
            <button type="button" class="profile-menu-item" onclick="openChangePasswordModal(); closeGlobalProfileDropdown();">
              <span>🔐 Đổi Mật Khẩu</span>
            </button>
            <button id="globalRenewKeyBtn" type="button" class="profile-menu-item user-only" onclick="openRenewModal(); closeGlobalProfileDropdown();">
              <span>🎁 Gia Hạn Bằng Mã Key</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>

  <section id="homePage">
    <!-- FLEET HERO WELCOME HEADER -->
    <div class="fleet-welcome-header">
      <div class="fleet-welcome-text">
        <div class="fleet-welcome-title-wrap">
          <h1 class="fleet-welcome-title">👋 Bảng Điều Khiển Hạm Đội Bot</h1>
          <span class="vip-pill">👑 KBOT V11.6 PRO</span>
          <span id="userRoleBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">🔒 CHƯA ĐĂNG NHẬP</span>
          <span class="platform-pill">⚡ RENDER CLOUD</span>
          <span class="ram-pill">📊 RAM: <strong id="managerRamUsage">-- MB</strong></span>
        </div>
        <div id="homeSubtitle" class="fleet-welcome-subtitle">Hệ Thống Cho Thuê Bot AFK KingMC Tự Động • Giám Sát Đa Máy Chủ Real-Time • Uptime 99.9%</div>
      </div>
      <div class="fleet-welcome-actions">
        <button class="primary admin-only" onclick="openAddBotModal()">＋ Thêm Bot Mới</button>
        <button id="btnAnnouncementAdmin" class="admin-only" onclick="openAnnouncementAdminModal()">📢 Thông Báo User</button>
        <button class="admin-only" onclick="openBatchSettingsModal()">⚙ Đồng Bộ Setting</button>
        <button class="admin-only" onclick="openAdminModal()">🔑 Mật Khẩu Bot</button>
      </div>
    </div>

    <!-- User Rental Banner (Prominently displaying expiration date, hours, minutes and live countdown) -->
    <div id="userRentalDashboardBanner" class="user-rental-dashboard-banner" style="display:none;margin-bottom:16px;padding:14px 18px;border-radius:12px;background:rgba(30,41,59,0.7);border:1px solid rgba(59,130,246,0.35);backdrop-filter:blur(8px);align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="font-size:26px;" id="userRentalBannerIcon">⏳</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;">
            <span id="userRentalBannerTitle">Thông Tin Thuê Dịch Vụ Của Bạn:</span>
            <span id="userRentalBannerPlan" style="font-size:12px;padding:2px 8px;border-radius:6px;background:rgba(59,130,246,0.2);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);">Gói thường</span>
          </div>
          <div style="font-size:13px;color:var(--muted);margin-top:3px;">
            Hạn sử dụng: <b id="userRentalBannerExactTime" style="color:var(--text);font-family:monospace;">--:-- - --/--/----</b> 
            • Trạng thái: <span id="userRentalBannerCountdown" style="font-weight:700;color:var(--green);">Còn -- ngày -- giờ -- phút</span>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="small primary" onclick="openRenewModal()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font-weight:600;">
          <span>🎁</span> Nạp Key Gia Hạn
        </button>
      </div>
    </div>

    <!-- Fleet Resource Bar (Eco & RAM Watchdog) -->
    <div class="fleet-resource-bar" id="fleetResourceBar">
      <div class="fleet-res-item">
        <span class="fleet-res-icon">🌱</span>
        <div>
          <div class="fleet-res-label">Eco Mode Fleet</div>
          <div class="fleet-res-val"><span id="fleetEcoCount">0</span>/<span id="fleetEcoTotal">0</span> Active</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">🧠</span>
        <div>
          <div class="fleet-res-label">Tổng RAM Bot (Fleet)</div>
          <div class="fleet-res-val" id="fleetTotalRam">0 MB</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">⚡</span>
        <div>
          <div class="fleet-res-label">RAM TB / Bot</div>
          <div class="fleet-res-val" id="fleetAvgRam">0 MB</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">📉</span>
        <div>
          <div class="fleet-res-label">CPU Tiết Kiệm (AFK)</div>
          <div class="fleet-res-val" style="color:var(--green);" id="fleetCpuSaved">~80%</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">🛡️</span>
        <div>
          <div class="fleet-res-label">Watchdog Lock</div>
          <div class="fleet-res-val" style="color:#38bdf8;">220 MB RAM Limit</div>
        </div>
      </div>
    </div>

    <!-- BENTO KPI CARDS GRID -->
    <div class="kpi-grid">
      <div class="kpi-card kpi-total">
        <div class="kpi-header">
          <span class="kpi-title">Tổng Số Bot Hạm Đội</span>
          <span class="kpi-icon">🤖</span>
        </div>
        <div id="kpiTotal" class="kpi-value">0</div>
        <div class="kpi-sub">Sức chứa hạm đội đám mây</div>
      </div>
      <div class="kpi-card kpi-health">
        <div class="kpi-header">
          <span class="kpi-title">Sức Khỏe Hạm Đội</span>
          <span class="kpi-icon">❤️‍🔥</span>
        </div>
        <div id="kpiFleetHealth" class="kpi-value" style="color:var(--green)">100%</div>
        <div class="kpi-sub" id="kpiFleetHealthSub">Hệ thống tối ưu</div>
      </div>
      <div class="kpi-card kpi-afk">
        <div class="kpi-header">
          <span class="kpi-title">Đang AFK Ingame</span>
          <span class="kpi-icon pulse-icon">🟢</span>
        </div>
        <div id="kpiAfk" class="kpi-value" style="color:var(--green)">0</div>
        <div class="kpi-sub">Bot đang cắm chuột trực tiếp</div>
      </div>
      <div class="kpi-card kpi-online">
        <div class="kpi-header">
          <span class="kpi-title">Online / Chờ Vào</span>
          <span class="kpi-icon">🟡</span>
        </div>
        <div id="kpiOnline" class="kpi-value" style="color:var(--blue)">0</div>
        <div class="kpi-sub">Đang kết nối / sảnh chờ</div>
      </div>
      <div class="kpi-card kpi-offline">
        <div class="kpi-header">
          <span class="kpi-title">Offline / Lỗi / Kicked</span>
          <span class="kpi-icon">🔴</span>
        </div>
        <div id="kpiOffline" class="kpi-value" style="color:var(--red)">0</div>
        <div class="kpi-sub">Cần kết nối lại hoặc đang dừng</div>
      </div>
      <div class="kpi-card kpi-totem">
        <div class="kpi-header">
          <span class="kpi-title">Tổng Totem Cứu Sinh</span>
          <span class="kpi-icon">🪙</span>
        </div>
        <div id="kpiTotem" class="kpi-value" style="color:var(--gold)">0</div>
        <div class="kpi-sub">Bảo hiểm tính mạng toàn đội</div>
      </div>
    </div>

    <!-- FLEET COMMAND CENTER: ROW 1 (PRIMARY BATCH CONTROLS & UTILITIES) -->
    <div class="fleet-toolbar">
      <div class="fleet-toolbar-primary">
        <button id="allStartButton" class="primary" onclick="runAllAction('start')">▶ Chạy tất cả</button>
        <button id="allStopButton" class="danger" onclick="runAllAction('stop')">⏹ Dừng tất cả</button>
        <button id="allRestartButton" class="small" onclick="runAllAction('restart')">↻ Chạy lại tất cả</button>
        <button class="small warning-btn" onclick="reconnectOfflineBots()" title="Chỉ kết nối lại các bot đang Offline hoặc Kicked">⚡ Reconnect lỗi</button>
      </div>
      <div class="fleet-toolbar-tools">
        <button class="small" onclick="openBroadcastModal()" title="Bắn lệnh hàng loạt tới toàn bộ bot">📡 Broadcast</button>
        <button id="soundAlertBtn" class="small sound-btn" onclick="toggleSoundAlert()">🔕 Cảnh báo: TẮT</button>
        <button id="btnUserRenewKey" class="small user-only" onclick="openRenewModal()" title="Nhập mã key gia hạn hạn thuê">🎁 Nhập Key</button>
        <button class="small admin-only" onclick="openKeyManagementModal()" title="Quản lý mã key kích hoạt / gia hạn">🎟️ Quản Lý Key</button>
        <button class="small admin-only" onclick="openWebhookModal()" title="Cài đặt thông báo Discord / Telegram khi bot offline">🔔 Webhook</button>
        <button class="small admin-only" onclick="exportBotList()" title="Sao lưu danh sách bot ra file JSON">📥 Backup</button>
        <button class="small admin-only" onclick="triggerImport()" title="Khôi phục danh sách bot từ file JSON">📤 Restore</button>
        <input type="file" id="importFileInput" accept=".json" style="display:none" onchange="handleImportFile(event)">
      </div>
    </div>

    <!-- FLEET SEARCH & FILTER: ROW 2 -->
    <div class="fleet-search-filter-row">
      <div class="filter-tabs">
        <button class="tab-btn active" id="tabAll" onclick="setStatusFilter('all')">Tất cả (<span id="countAll">0</span>)</button>
        <button class="tab-btn" id="tabAfk" onclick="setStatusFilter('afk')">🟢 Đang AFK (<span id="countAfk">0</span>)</button>
        <button class="tab-btn" id="tabOnline" onclick="setStatusFilter('online')">🟡 Online/Chờ (<span id="countOnline">0</span>)</button>
        <button class="tab-btn" id="tabOffline" onclick="setStatusFilter('offline')">🔴 Offline/Lỗi (<span id="countOffline">0</span>)</button>
      </div>
      <div class="fleet-search-sort-wrap">
        <input id="searchInput" class="search-box" placeholder="🔍 Tìm bot (tên, user ingame, IP...)" oninput="filterBots()">
        <select id="sortBotsSelect" class="sort-select" onchange="changeBotSort(this.value)">
          <option value="default">Sắp xếp: Mặc định</option>
          <option value="status">Sắp xếp: Ưu tiên AFK</option>
          <option value="uptime">Sắp xếp: Uptime cao nhất</option>
          <option value="totem">Sắp xếp: Totem nhiều nhất</option>
          <option value="name">Sắp xếp: Tên A-Z</option>
        </select>
      </div>
    </div>

    <!-- FLEET TAG FILTER BAR -->
    <div id="fleetTagFilterRow" class="fleet-tag-filter-row" style="display:flex;gap:8px;align-items:center;margin-top:10px;margin-bottom:6px;flex-wrap:wrap;">
      <span style="font-size:12px;color:var(--muted);font-weight:700;">🏷️ TAGS:</span>
      <div id="tagPillsContainer" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
    </div>

    <div id="botGrid" class="bot-grid"></div>
  </section>

  <section id="detailPage" class="hidden">
    <div class="detail-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small back-btn" onclick="goHome()">← Quay về Dashboard</button>
        <div class="title-wrap">
          <div style="display:flex;align-items:center;gap:10px;">
            <div id="detailTitle" class="detail-title">Bot</div>
            <button type="button" class="small" onclick="renameDetailBotAlias()" title="Đổi tên hiển thị / Ghi chú cho bot này" style="padding:3px 10px;font-size:11px;font-weight:600;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:var(--text);cursor:pointer;">✏ Đổi tên / Ghi chú</button>
          </div>
          <div class="detail-subtitle">Quản lý, theo dõi và đồng bộ cấu hình bot</div>
        </div>
      </div>
      <div class="detail-hud" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span class="vip-pill">👑 KBOT V11.6 PRO</span>
        <span id="detailUserRoleBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">🔒 CHƯA ĐĂNG NHẬP</span>
        <span class="platform-pill">⚡ RENDER CLOUD</span>
        <span class="ram-pill">📊 RAM: <strong id="detailManagerRamUsage">-- MB</strong></span>
      </div>
    </div>

    <div class="grid">
      
      <!-- PANEL 1: BẢNG TRẠNG THÁI / THEO DÕI -->
      <div class="panel">
        <h3>Trạng thái</h3>
        <div id="detailStatus" class="big-status"></div>
        <div class="info">
          <div class="info-item copyable" onclick="copyToClipboard(document.getElementById('detailUsername')?.innerText, 'Username')" title="Click để copy Username"><div class="info-label">USERNAME 📋</div><div id="detailUsername" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">SERVER</div><div id="detailHost" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">PING</div><div id="detailPing" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">SERVER TPS ⚡</div><div id="detailTps" class="info-value" style="color:var(--green);font-weight:700;">20.0</div></div>
          <div class="info-item"><div class="info-label">RAM MÁY HOST 🧠</div><div id="detailHostRam" class="info-value" style="color:var(--green);font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">CPU MÁY HOST ⚡</div><div id="detailHostCpu" class="info-value" style="color:#38bdf8;font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">LƯU LƯỢNG MẠNG 📶</div><div id="detailHostNet" class="info-value" style="color:var(--yellow);font-weight:700;">-</div></div>
          <div class="info-item copyable" onclick="copyToClipboard(document.getElementById('detailPosition')?.innerText, 'Tọa độ')" title="Click để copy Tọa độ"><div class="info-label">COORDINATES 📋</div><div id="detailPosition" class="info-value position-value">-</div></div>
          <div class="info-item"><div class="info-label">DIMENSION / LOCATION</div><div id="detailDimension" class="info-value">-</div></div>
          <div class="info-item copyable" onclick="copyToClipboard(document.getElementById('detailIp')?.innerText, 'IP')" title="Click để copy IP"><div class="info-label">BOT IP 📋</div><div id="detailIp" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">RAM BOT CON 🤖</div><div id="detailRam" class="info-value" style="color:#38bdf8;font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">UPTIME ⏱</div><div id="detailUptime" class="info-value" style="color:#38bdf8;font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">RECONNECTS 🔄</div><div id="detailReconnects" class="info-value">-</div></div>
        </div>
        <div class="controls">
          <button id="detailStartButton" class="primary" onclick="detailAction('start')">▶ Chạy</button>
          <button id="detailStopButton" class="danger" onclick="detailAction('stop')">■ Dừng</button>
          <button id="detailRestartButton" onclick="detailAction('restart')">↻ Chạy lại</button>
          <button id="detailResetCustomerBtn" class="danger admin-only" onclick="resetCustomerBot()" style="margin-left:auto;background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.5);" title="Dừng bot, xóa trắng tài khoản và lịch sử để bàn giao khách mới">🧹 Reset Bàn Giao Khách Mới</button>
        </div>
      </div>

      <!-- PANEL 2: BẢNG GUI INGAME (HIỂN THỊ CỨNG CẠNH BẢNG THEO DÕI) -->
      <div class="panel" id="detailRemoteGuiCard">
        <div class="chat-title-row">
          <h3 id="detailRemoteGuiTitle">🖥️ Cửa Sổ GUI / Menu Ingame</h3>
          <span id="detailRemoteGuiBadge" class="capacity-badge" style="background:var(--accent);color:#fff;display:none;">Đang Mở</span>
          <button id="detailRemoteGuiCloseBtn" type="button" class="small" onclick="closeDetailGuiWindow()" style="display:none;">✕ Đóng GUI</button>
        </div>
        <div id="detailRemoteGuiPlaceholder" style="text-align:center;padding:55px 16px;color:var(--muted);">
          <div style="font-size:42px;margin-bottom:10px;opacity:0.75;">🖥️</div>
          <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">Hiện Chưa Có Cửa Sổ GUI Nào Đang Mở</div>
          <div style="font-size:12px;color:var(--muted);max-width:320px;margin:0 auto;line-height:1.5;">Khi bot mở Menu (<code>/menu</code>, <code>/warp</code> hoặc mở rương trong game), các ô vật phẩm sẽ xuất hiện tại đây để bạn bấm tương tác trực tiếp.</div>
        </div>
        <div id="detailRemoteGuiContent" style="display:none;">
          <p style="font-size:12px;color:var(--muted);margin:4px 0 10px 0;">Click trực tiếp vào ô vật phẩm bên dưới để chọn chức năng:</p>
          <div id="detailRemoteGuiSlots" style="display:grid;grid-template-columns:repeat(9, 1fr);gap:5px;max-width:540px;margin:0 auto;background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;border:1px solid var(--border);"></div>
        </div>
      </div>

      <!-- PANEL 3: BẢNG CHAT (BÊN CẠNH EVENT LOG) -->
      <div class="panel">
        <div class="chat-title-row"><h3>Chat</h3><button class="small danger" onclick="clearDetailChat()">Xóa lịch sử</button></div>
        <div id="detailChatLogs" class="log"></div>
        <form class="chat-row chat-form" onsubmit="sendDetailMessage(event)">
          <input id="detailMessageInput" autocomplete="off" placeholder="Nhập chat hoặc command... (↑↓ lịch sử)">
          <button class="primary" type="submit">Gửi</button>
        </form>
        <div class="chip-row">
          <button type="button" class="chip" onclick="quickDetailCommand('/menu')">⚡ /menu (Slot 24)</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/dn')">🔑 /dn [MK]</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/login')">🔓 /login [MK]</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/bal')">💵 /bal</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/team chat')">🛡️ /team chat</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/spawn')">🏠 /spawn</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/pay')">💰 /pay</button>
        </div>
        <div class="note">
          Bấm chip để gửi nhanh. Dùng phím ↑ ↓ trong ô nhập để xem lại các lệnh đã gửi.
        </div>
      </div>

      <!-- PANEL 4: BẢNG EVENT LOG (BÊN CẠNH CHAT) -->
      <div class="panel">
        <div class="chat-title-row"><h3>Event Log</h3><button class="small" onclick="exportBotLogs(event,selectedBotId)" style="margin-left:auto;margin-right:8px;">📥 Tải Log</button><button class="small danger" onclick="clearDetailLogs()">Xóa lịch sử</button></div>
        <div id="detailEventLogs" class="log"></div>
      </div>

      <!-- PANEL 5: INVENTORY MANAGER -->
      <div class="panel" style="grid-column: 1 / -1;">
        <div class="chat-title-row">
          <h3>Inventory Manager</h3>
          <span id="detailInventoryCapacity" class="capacity-badge">0/36 ô (0%)</span>
        </div>
        <div class="inventory-grid">
          <div class="inventory-stat"><div class="info-label">HEALTH</div><div id="detailHealth" class="info-value">20 / 20</div><div class="bar health-bar"><span id="detailHealthBar"></span></div></div>
          <div class="inventory-stat"><div class="info-label">HUNGER</div><div id="detailFood" class="info-value">20 / 20</div><div class="bar hunger-bar"><span id="detailFoodBar"></span></div></div>
          <div class="inventory-stat"><div class="info-label">GOLDEN APPLE</div><div id="detailGolden" class="info-value">0</div></div>
          <div class="inventory-stat"><div class="info-label">TOTEM</div><div id="detailTotem" class="info-value">0</div></div>
          <div class="inventory-stat"><div class="info-label">OFFHAND</div><div id="detailOffhand" class="info-value">-</div></div>
          <div class="inventory-stat"><div class="info-label">FOOD COUNT</div><div id="detailFoodCount" class="info-value">0</div></div>
        </div>

        <div class="info-label">EQUIPMENT / OFFHAND</div>
        <div class="equipment-row">
          <div id="equipHeadBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'head')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'head')" ondblclick="unequipDetail('head')"><div class="equip-label">HEAD</div><div id="equipHead">-</div></div>
          <div id="equipTorsoBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'torso')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'torso')" ondblclick="unequipDetail('torso')"><div class="equip-label">CHEST</div><div id="equipTorso">-</div></div>
          <div id="equipLegsBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'legs')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'legs')" ondblclick="unequipDetail('legs')"><div class="equip-label">LEGS</div><div id="equipLegs">-</div></div>
          <div id="equipFeetBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'feet')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'feet')" ondblclick="unequipDetail('feet')"><div class="equip-label">FEET</div><div id="equipFeet">-</div></div>
          <div id="equipOffhandBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'off-hand')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'off-hand')" ondblclick="unequipDetail('off-hand')"><div class="equip-label">OFFHAND</div><div id="equipOffhand">-</div></div>
        </div>

        <div class="info-label">INVENTORY 27 SLOTS</div>
        <div id="detailInventory" class="slot-grid"></div>
        <div class="info-label" style="margin-top:12px;">HOTBAR 9 SLOTS</div>
        <div id="detailHotbar" class="slot-grid"></div>
        <div id="detailDropZone" class="drop-zone" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropDetailItemToWorld(event)">Kéo item vào đây để vứt</div>
        <div id="detailInventoryRevision" class="note">revision 0</div>
      </div>

      <!-- PANEL 6: SETTINGS -->
      <div class="panel">
        <div class="chat-title-row"><h3>Settings</h3><div class="revision">đồng bộ từ bot con</div></div>
        <div class="setting-list">
          <label class="check-row"><input id="detailSettingEcoMode" type="checkbox"> <span>🌱 Eco Mode Siêu Tiết Kiệm (Giảm 80% CPU & giữ RAM &lt; 220MB)</span></label>
          <label class="check-row"><input id="detailSettingAutoTotem" type="checkbox"> <span>Auto Totem phản xạ tức thì (&lt; 50ms)</span></label>
          <label class="check-row"><input id="detailSettingAntiHungry" type="checkbox"> <span>Anti Hungry / Auto Eat</span></label>
          <label class="check-row"><input id="detailSettingAutoReconnect" type="checkbox"> <span>Auto Reconnect + LOGIN/DN/MENU</span></label>
          <label class="check-row"><input id="detailSettingAntiAfkKick" type="checkbox"> <span>Smart Anti-AFK Kick (Xoay đầu, vung tay nhẹ)</span></label>
        </div>
        <button id="saveDetailSettingsButton" class="primary" onclick="saveDetailSettings()">Lưu setting</button>
      </div>

      <div id="detailAutoChatPanel" class="panel">
        <div class="chat-title-row"><h3>Auto Chat</h3><button class="small primary" onclick="addDetailAutoChatSchedule()">＋ Thêm</button></div>
        <div id="detailAutoChatSchedules" class="schedule-list"></div>
        <div class="note">Mỗi dòng là một lịch riêng. Kéo ⋮⋮ để đổi thứ tự; sửa trực tiếp rồi bấm Lưu Auto Chat.</div>
        <button id="saveDetailAutoChatButton" class="primary compact-save" onclick="saveDetailAutoChat()">Lưu Auto Chat</button>
      </div>

      <div id="detailBotSchedulePanel" class="panel">
        <div class="chat-title-row"><h3>Hẹn giờ Bot</h3><button class="small primary" onclick="addDetailBotSchedule()">＋ Thêm</button></div>
        <div class="scheduler-toolbar">
          <label class="scheduler-mode-box"><span>Chế độ</span>
            <select id="detailBotScheduleMode" onchange="detailBotScheduleModeChanged(this)">
              <option value="fixed">Giờ cố định mỗi ngày</option>
              <option value="cycle">Chu kỳ theo thứ tự</option>
            </select>
          </label>
          <label class="check-row" style="margin:0;padding:7px 9px;"><input id="detailBotScheduleEnabled" type="checkbox" checked> <span>Kích hoạt lịch</span></label>
        </div>
        <div id="detailBotScheduleModeNote" class="scheduler-note"></div>
        <div id="detailBotSchedules" class="schedule-list"></div>
        <div class="note">Chỉ có một chế độ tại một thời điểm. Ở Chu kỳ, thời gian mỗi dòng tính từ dòng kề trên; kéo đổi thứ tự thì cách tính cũng đổi theo.</div>
        <button id="saveDetailBotSchedulesButton" class="primary compact-save" onclick="saveDetailBotSchedules()">Lưu hẹn giờ Bot</button>
      </div>

      <div class="panel" id="detailAccountPanel">
        <h3>Tài khoản Minecraft Bot</h3>
        <div class="form-row">
          <label>Username Ingame</label>
          <input id="detailUsernameInput" autocomplete="off" placeholder="Username Minecraft bot...">
        </div>
        <div class="form-row">
          <label>Mật khẩu /login</label>
          <div class="password-input-wrap">
            <input id="detailPasswordInput" type="password" autocomplete="new-password" placeholder="Mật khẩu /login bot...">
            <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('detailPasswordInput', this)">👁</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
          <button class="primary" onclick="saveDetailAccount()">Lưu thay đổi</button>
          <button class="small" onclick="saveAndRestartBot()" style="font-weight:700;">💾 Lưu & Chạy lại ngay</button>
        </div>
        <div class="note">Áp dụng ngay cho bot. Bấm "Lưu & Chạy lại ngay" để bot đăng nhập tài khoản mới lập tức.</div>
      </div>

      <!-- PANEL CẤU HÌNH PROXY RIÊNG CỦA TỪNG BOT -->
      <div class="panel" id="detailProxyPanel">
        <div class="chat-title-row">
          <h3>🌐 Cấu hình Proxy Riêng</h3>
          <span id="detailProxyBadge" class="capacity-badge" style="background:var(--border);color:var(--muted);">TẮT</span>
        </div>
        <div class="setting-list" style="margin-bottom:12px;">
          <label class="check-row">
            <input id="detailProxyEnabled" type="checkbox">
            <span>Kích hoạt Proxy khi kết nối Minecraft</span>
          </label>
        </div>
        <div class="form-row">
          <label>Giao thức (Protocol)</label>
          <select id="detailProxyProtocol" style="width:100%;box-sizing:border-box;">
            <option value="socks5">SOCKS5 (Khuyên dùng - Nhanh & Ẩn danh)</option>
            <option value="http">HTTP / HTTPS CONNECT Proxy</option>
            <option value="socks4">SOCKS4</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;">
          <div class="form-row">
            <label>Host / IP Proxy</label>
            <input id="detailProxyHost" placeholder="vd: 103.152.112.5" autocomplete="off">
          </div>
          <div class="form-row">
            <label>Port</label>
            <input id="detailProxyPort" type="number" placeholder="1080" min="1" max="65535">
          </div>
        </div>
        <div class="form-row">
          <label>Username (nếu có)</label>
          <input id="detailProxyUsername" placeholder="Để trống nếu không có auth" autocomplete="off">
        </div>
        <div class="form-row">
          <label>Password (nếu có)</label>
          <div class="password-input-wrap">
            <input id="detailProxyPassword" type="password" autocomplete="new-password" placeholder="Mật khẩu proxy...">
            <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('detailProxyPassword', this)">👁</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;">
          <button class="primary" onclick="saveDetailProxy()">💾 Lưu Proxy</button>
          <button class="small" onclick="testDetailProxy()" id="detailProxyTestBtn">🧪 Kiểm Tra Kết Nối</button>
          <button class="small danger" onclick="clearDetailProxy()" style="margin-left:auto;">✕ Xóa Proxy</button>
        </div>
        <div id="detailProxyTestResult" class="note" style="margin-top:8px;">
          Proxy có thể dùng chung giữa các bot. Hỗ trợ SOCKS5 & HTTP. Khi bật, bot sẽ định tuyến qua Proxy này để đổi IP an toàn.
        </div>
      </div>
    </div>
  </section>

  <!-- DEDICATED FULL-PAGE USER & KEY MANAGEMENT SECTION -->
  <section id="userManagementPage" class="full-page-section hidden">
    <div class="full-page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small" onclick="navigateTo('dashboard')">← Về Dashboard</button>
        <div>
          <h2 class="full-page-title">👥 Quản Lý Người Dùng &amp; Key Gia Hạn</h2>
          <div class="full-page-subtitle">Quản lý tài khoản khách thuê, phân quyền 1-Bot-1-User, gia hạn linh hoạt, xem mật khẩu và quản lý Key bản quyền.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <div class="admin-only" style="display:inline-flex;align-items:center;gap:6px;background:rgba(15,23,42,0.6);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:3px 8px;">
          <button id="trialGiftToggleBtn" class="small" onclick="toggleTrialGiftSetting()" title="Bật/Tắt chế độ tặng dùng thử kèm bot trống cho người mới" style="background:transparent;border:none;color:#38bdf8;font-weight:700;padding:2px 4px;cursor:pointer;">
            <span id="trialGiftBtnLabel">🎁 Tặng Dùng Thử:</span> <span id="trialGiftStatusBadge">BẬT</span>
          </button>
          <span style="color:var(--border);">|</span>
          <label style="font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;margin:0;">
            <span>Số ngày:</span>
            <input type="number" id="trialDaysInput" min="1" max="365" value="1" title="Số ngày dùng thử tặng khi đăng ký tài khoản mới" style="width:52px;padding:3px 6px;font-size:12px;border-radius:4px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);text-align:center;" onchange="saveTrialDaysSetting()">
            <span style="font-size:11px;">ngày</span>
          </label>
        </div>
        <button class="primary" onclick="openCreateUserModal()">＋ Thêm Người Dùng Mới</button>
        <button class="secondary" onclick="switchUserMgmtSubTab('keys')">🎟️ Quản Lý Key</button>
        <button class="small" onclick="refreshUserManagementPage()">↻ Làm mới</button>
      </div>
    </div>

    <!-- SUB TABS: USER LIST vs KEY LIST -->
    <div class="sub-tab-bar">
      <button class="sub-tab-btn active" id="subTabUsers" onclick="switchUserMgmtSubTab('users')">
        👥 Danh Sách Người Dùng (<span id="userMgmtTotalCount">0</span>)
      </button>
      <button class="sub-tab-btn" id="subTabKeys" onclick="switchUserMgmtSubTab('keys')">
        🎟️ Quản Lý Key Gia Hạn (<span id="keyMgmtTotalCount">0</span>)
      </button>
    </div>

    <!-- SUB-PANEL 1: DANH SÁCH USER -->
    <div id="subPanelUsers" class="sub-panel">
      <!-- FILTERS & STATS -->
      <div class="mgmt-filter-bar">
        <div style="flex:1;min-width:220px;">
          <input type="text" id="userFilterSearch" placeholder="🔍 Tìm theo username, ghi chú, gói..." class="search-box" style="margin:0;width:100%;box-sizing:border-box;" oninput="debounceUserFilter()">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="filter-chip active" id="userFilterAll" onclick="setUserStatusFilter('all')">Tất cả (<span id="statUserAll">0</span>)</button>
          <button class="filter-chip" id="userFilterActive" onclick="setUserStatusFilter('active')">🟢 Hoạt động (<span id="statUserActive">0</span>)</button>
          <button class="filter-chip" id="userFilterDisabled" onclick="setUserStatusFilter('disabled')">🔒 Tạm khóa (<span id="statUserDisabled">0</span>)</button>
          <button class="filter-chip" id="userFilterExpired" onclick="setUserStatusFilter('expired')">⏳ Hết hạn (<span id="statUserExpired">0</span>)</button>
          <button class="filter-chip" id="userFilterLifetime" onclick="setUserStatusFilter('lifetime')">👑 Vĩnh viễn (<span id="statUserLifetime">0</span>)</button>
        </div>
      </div>

      <!-- USER TABLE -->
      <div class="user-table-wrap">
        <table class="user-table">
          <thead>
            <tr>
              <th style="min-width:140px;">NGƯỜI DÙNG</th>
              <th style="min-width:140px;">MẬT KHẨU</th>
              <th style="min-width:280px;">HẠN THUÊ &amp; GIA HẠN NHANH</th>
              <th style="min-width:110px;">TRẠNG THÁI</th>
              <th style="min-width:180px;">BOT ĐƯỢC CẤP (1-USER-1-BOT)</th>
              <th style="min-width:140px;text-align:right;">THAO TÁC</th>
            </tr>
          </thead>
          <tbody id="userFullTableBody">
            <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Đang tải danh sách người dùng...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- SUB-PANEL 2: QUẢN LÝ KEY GIA HẠN -->
    <div id="subPanelKeys" class="sub-panel hidden">
      <div class="create-key-card">
        <h4 style="margin:0 0 10px 0;font-size:14.5px;color:#38bdf8;font-weight:750;">🎟️ Tạo Mã Key Gia Hạn Nhanh</h4>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">GÓI THUÊ:</label>
            <div style="display:flex;gap:4px;align-items:center;">
              <select id="mgmtKeyDays" onchange="onKeyDaysSelectChange('mgmt')" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;">
                <option value="1">1 Ngày (Dùng thử)</option>
                <option value="3">3 Ngày</option>
                <option value="7" selected>7 Ngày (1 Tuần)</option>
                <option value="15">15 Ngày (Nửa Tháng)</option>
                <option value="30">30 Ngày (1 Tháng)</option>
                <option value="90">90 Ngày (3 Tháng)</option>
                <option value="lifetime">👑 Vĩnh Viễn</option>
                <option value="custom">✏️ Tùy chỉnh ngày...</option>
              </select>
              <input type="number" id="mgmtKeyCustomDays" min="1" max="3650" placeholder="Số ngày" style="display:none;width:75px;background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px;border-radius:8px;font-size:13px;" />
            </div>
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">TÊN GÓI:</label>
            <input type="text" id="mgmtKeyPlan" placeholder="VD: Gói Tuần VIP" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;width:150px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">SỐ LƯỢNG KEY:</label>
            <input type="number" id="mgmtKeyCount" value="1" min="1" max="20" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;width:70px;" />
          </div>
          <button class="primary" onclick="submitCreateKeysFromMgmt()" style="padding:9px 18px;font-weight:750;">+ Phát Hành Key Ngay</button>
        </div>
      </div>

      <div class="user-table-wrap">
        <table class="user-table">
          <thead>
            <tr>
              <th>MÃ KEY GIA HẠN</th>
              <th>GÓI THUÊ</th>
              <th>TRẠNG THÁI</th>
              <th>NGƯỜI KÍCH HOẠT</th>
              <th>THỜI GIAN TẠO</th>
              <th style="text-align:right;">THAO TÁC</th>
            </tr>
          </thead>
          <tbody id="keysFullTableBody">
            <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Đang tải danh sách key...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- DEDICATED FULL-PAGE AUDIT TRAIL SECTION -->
  <section id="auditPage" class="full-page-section hidden">
    <div class="full-page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small" onclick="navigateTo('dashboard')">← Về Dashboard</button>
        <div>
          <h2 class="full-page-title">📋 Nhật Ký Hoạt Động (Audit Trail Enterprise)</h2>
          <div class="full-page-subtitle">Theo dõi thời gian thực 100% mọi hành vi vận hành bot, can thiệp cấu hình, tài khoản và cấp phát license key.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="small" onclick="exportAuditLogs('csv')">📥 Xuất CSV</button>
        <button class="small" onclick="exportAuditLogs('jsonl')">📥 Xuất JSONL</button>
        <button class="small danger" onclick="clearAllAuditLogs()">🗑 Xóa Nhật Ký</button>
        <button class="small" onclick="refreshAuditLogs(1)">↻ Làm mới</button>
      </div>
    </div>

    <!-- TABS PHÂN LOẠI NHẬT KÝ (HỆ THỐNG / USER vs BOT VẬN HÀNH / COORDS) -->
    <div class="audit-type-tabs" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <button type="button" id="auditTabSystem" class="audit-tab-btn active" onclick="switchAuditLogType('SYSTEM')">
        🌐 Nhật Ký Hệ Thống &amp; Thao Tác Người Dùng
      </button>
      <button type="button" id="auditTabBot" class="audit-tab-btn" onclick="switchAuditLogType('BOT')">
        🤖 Nhật Ký Vận Hành Bot &amp; Tài Khoản (Coords, Acc, Proxy)
      </button>
      <button type="button" id="auditTabAll" class="audit-tab-btn" onclick="switchAuditLogType('')">
        📋 Tất Cả Nhật Ký
      </button>
    </div>

    <!-- FILTER TOOLBAR -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);padding:8px 12px;border-radius:8px;">
      <div style="flex:1;min-width:180px;">
        <input id="auditLogSearchInput" placeholder="🔍 Tìm theo từ khóa, chi tiết, IP, user..." class="search-box" style="margin:0;padding:6px 12px;font-size:12px;width:100%;box-sizing:border-box;" oninput="debounceAuditFilter()">
      </div>
      <div style="min-width:160px;">
        <select id="auditLogCategoryFilter" style="margin:0;padding:6px 10px;font-size:12px;background:var(--card);border:1px solid var(--border);color:#fff;border-radius:6px;width:100%;" onchange="refreshAuditLogs(1)">
          <option value="">📂 Tất cả danh mục</option>
          <option value="AUTH">🔐 Xác thực &amp; Bảo mật (AUTH)</option>
          <option value="BOT_CONTROL">🎮 Điều khiển Bot (BOT)</option>
          <option value="BOT_ACCOUNT">👤 Tài khoản Minecraft</option>
          <option value="BOT_SETTINGS">⚙️ Cài đặt Bot</option>
          <option value="BOT_INVENTORY">🎒 Kho đồ &amp; Trang bị</option>
          <option value="FLEET">🚀 Quản lý Hạm đội (FLEET)</option>
          <option value="USER_MGMT">👥 Quản lý Khách thuê</option>
          <option value="LICENSE_KEY">🔑 Mã Bản quyền/Gói</option>
          <option value="SYSTEM">🤖 Hệ thống Tự động</option>
        </select>
      </div>
      <div style="min-width:140px;">
        <select id="auditLogStatusFilter" style="margin:0;padding:6px 10px;font-size:12px;background:var(--card);border:1px solid var(--border);color:#fff;border-radius:6px;width:100%;" onchange="refreshAuditLogs(1)">
          <option value="">⚡ Tất cả trạng thái</option>
          <option value="SUCCESS">🟢 Thành công (SUCCESS)</option>
          <option value="FAILED">🔴 Thất bại (FAILED)</option>
          <option value="BLOCKED">🟠 Bị chặn (BLOCKED)</option>
          <option value="PARTIAL">🟡 Một phần (PARTIAL)</option>
        </select>
      </div>
      <div style="min-width:110px;">
        <select id="auditLogLimitSelect" style="margin:0;padding:6px 10px;font-size:12px;background:var(--card);border:1px solid var(--border);color:#fff;border-radius:6px;width:100%;" onchange="refreshAuditLogs(1)">
          <option value="25">25 dòng/trang</option>
          <option value="50" selected>50 dòng/trang</option>
          <option value="100">100 dòng/trang</option>
          <option value="200">200 dòng/trang</option>
        </select>
      </div>
    </div>

    <!-- TABLE WRAP -->
    <div class="user-table-wrap" style="overflow-y:auto;max-height:65vh;">
      <table class="user-table" style="font-size:12px;">
        <thead>
          <tr>
            <th style="width:135px;">THỜI GIAN</th>
            <th style="width:145px;">NGƯỜI THỰC HIỆN</th>
            <th style="width:170px;">HÀNH ĐỘNG</th>
            <th style="width:135px;">MỤC TIÊU</th>
            <th>CHI TIẾT THAO TÁC</th>
            <th style="width:95px;text-align:right;">TRẠNG THÁI</th>
          </tr>
        </thead>
        <tbody id="auditLogTableBody">
          <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Đang tải nhật ký...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- PAGINATION FOOTER -->
    <div class="modal-actions" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div id="auditLogPaginationInfo" style="color:var(--muted);font-size:11.5px;">Tổng cộng: 0 bản ghi</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button id="auditLogPrevBtn" class="small" onclick="navigateAuditPage(-1)">‹ Trước</button>
        <span id="auditLogPageIndicator" style="font-size:11.5px;padding:0 6px;color:#fff;">Trang 1 / 1</span>
        <button id="auditLogNextBtn" class="small" onclick="navigateAuditPage(1)">Sau ›</button>
      </div>
    </div>
  </section>

  <!-- DEDICATED FULL-PAGE BACKUP MANAGEMENT SECTION -->
  <section id="backupPage" class="full-page-section hidden">
    <div class="full-page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small" onclick="navigateTo('dashboard')">← Về Dashboard</button>
        <div>
          <h2 class="full-page-title">💾 Quản Lý Bản Sao Lưu &amp; Phục Hồi (Disaster Recovery)</h2>
          <div class="full-page-subtitle">Tự động snapshot xoay vòng 30 bản định kỳ 6 tiếng và trước các thao tác quan trọng để bảo vệ dữ liệu.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="primary small" onclick="triggerCreateBackup()">⚡ Tạo Sao Lưu Ngay</button>
        <button class="small" onclick="refreshBackupList()">↻ Làm mới</button>
      </div>
    </div>

    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12.5px;color:var(--cyan);line-height:1.5;">
      🛡️ <strong>Cơ chế Tự Phục Hồi (Self-Healing) đang hoạt động:</strong> Nếu file registry hoặc user bị lỗi cú pháp / crash rỗng, hệ thống sẽ tự động khôi phục từ bản backup gần nhất mà không làm mất dữ liệu tài khoản khách.
    </div>

    <div class="user-table-wrap" style="overflow-y:auto;max-height:60vh;">
      <table class="user-table" style="font-size:12px;">
        <thead>
          <tr>
            <th>TÊN BẢN SAO LƯU</th>
            <th>THỜI GIAN TẠO</th>
            <th>DUNG LƯỢNG</th>
            <th style="text-align:right;">THAO TÁC / TÌNH TRẠNG</th>
          </tr>
        </thead>
        <tbody id="backupTableBody">
          <tr><td colspan="4" style="text-align:center;padding:28px;color:var(--muted);">Đang tải danh sách bản sao lưu...</td></tr>
        </tbody>
      </table>
    </div>

    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
      <div id="backupTotalCount" style="color:var(--muted);font-size:12px;">Tổng cộng: 0 bản sao lưu (Tối đa 30)</div>
    </div>
  </section>
</div>

<!-- MODAL TẠM KHÓA USER KÈM LỜI NHẮN (ADMIN) -->
<div id="userLockReasonModal" class="modal hidden">
  <div class="modal-card" style="max-width:440px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;color:#ef4444;display:flex;align-items:center;gap:8px;">🔒 Tạm Khóa Tài Khoản</h3>
      <button class="small" onclick="closeUserLockReasonModal()">✕</button>
    </div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
      Bạn đang chuẩn bị tạm khóa tài khoản <strong id="lockTargetUsername" style="color:#fff;"></strong>.
      Tài khoản này sẽ bị làm mờ màn hình khi đăng nhập và hiển thị lời nhắn bên dưới:
    </p>
    <input id="lockTargetUserId" type="hidden">
    <div class="form-row">
      <label>Lời nhắn gửi đến người dùng (Hiển thị khi đăng nhập)</label>
      <textarea id="lockReasonInput" rows="3" placeholder="Ví dụ: Tài khoản bị tạm khóa do vi phạm nội quy / Đang chờ xác minh thanh toán..."></textarea>
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeUserLockReasonModal()">Hủy</button>
      <button class="danger" onclick="submitLockUserWithReason()">🔒 Xác Nhận Khóa</button>
    </div>
  </div>
</div>

<!-- MODAL TÙY CHỈNH HẠN THUÊ USER (ADMIN) -->
<div id="customRenewModal" class="modal hidden">
  <div class="modal-card" style="max-width:440px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;color:#38bdf8;display:flex;align-items:center;gap:8px;">⏱ Tùy Chỉnh Hạn Thuê Bot</h3>
      <button class="small" onclick="closeCustomRenewModal()">✕</button>
    </div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
      Điều chỉnh thời hạn cho tài khoản <strong id="customRenewTargetUser" style="color:#fff;"></strong>:
    </p>
    <input id="customRenewTargetUserId" type="hidden">
    <div class="form-row">
      <label>Hình thức điều chỉnh</label>
      <select id="customRenewMode" onchange="handleCustomRenewModeChange()">
        <option value="add_days">Cộng thêm số ngày (+N ngày)</option>
        <option value="subtract_days">Trừ bớt số ngày (-N ngày)</option>
        <option value="set_date">Đặt mốc ngày giờ cụ thể</option>
        <option value="set_permanent">👑 Đặt VIP Vĩnh Viễn</option>
      </select>
    </div>
    <div id="customRenewDaysGroup" class="form-row">
      <label>Số ngày điều chỉnh</label>
      <input type="number" id="customRenewDaysInput" value="7" min="1" max="3650">
    </div>
    <div id="customRenewDateGroup" class="form-row" style="display:none;">
      <label>Mốc ngày giờ hết hạn mới</label>
      <input type="datetime-local" id="customRenewDateInput">
    </div>
    <div class="form-row">
      <label>Tên gói cước / Ghi chú hạn (Tùy chỉnh)</label>
      <input type="text" id="customRenewPlanNameInput" placeholder="Ví dụ: Gói Tuần VIP, 15 Ngày Khuyến Mãi...">
    </div>
    <div class="note" style="margin-top:10px;">
      * Lưu ý: Nếu tài khoản đang là Vĩnh viễn, khi cộng/trừ ngày hoặc đặt mốc mới, quyền Vĩnh viễn sẽ tự động hủy và chuyển sang mốc ngày giờ mới.
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeCustomRenewModal()">Hủy</button>
      <button class="primary" onclick="submitCustomRenew()">💾 Cập Nhật Hạn</button>
    </div>
  </div>
</div>

<!-- MODAL XÁC NHẬN CHUYỂN QUYỀN BOT 1-USER-1-BOT -->
<div id="reassignBotConfirmModal" class="modal hidden" style="z-index:9999999;">
  <div class="modal-card" style="max-width:460px;border-color:rgba(234,179,8,0.5);">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="font-size:28px;">⚠️</span>
      <div>
        <h3 style="margin:0;color:#eab308;font-size:17px;">Xác Nhận Chuyển Quyền Sở Hữu Bot</h3>
        <div style="font-size:12px;color:var(--muted);">Nguyên tắc 1-Bot-1-User độc quyền</div>
      </div>
    </div>
    <p id="reassignBotConfirmMsg" style="font-size:13px;line-height:1.5;color:#e2e8f0;margin-bottom:16px;background:rgba(234,179,8,0.1);padding:12px;border-radius:8px;border:1px dashed rgba(234,179,8,0.3);">
      Bot này hiện đang được cấp cho người dùng khác. Bạn có chắc chắn muốn hủy bot khỏi người dùng cũ để cấp cho người này không?
    </p>
    <div class="modal-actions">
      <button onclick="closeReassignBotConfirmModal(false)">Hủy (Giữ nguyên)</button>
      <button class="primary" style="background:#eab308;color:#000;font-weight:750;" onclick="closeReassignBotConfirmModal(true)">✓ Đồng Ý Chuyển Bot</button>
    </div>
  </div>
</div>
<div id="addBotModal" class="modal hidden">
  <div class="modal-card" style="max-width:520px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;color:#38bdf8;display:flex;align-items:center;gap:8px;">➕ Thêm Bot Con (Hỗ Trợ Thêm Hàng Loạt)</h3>
      <button class="small" onclick="closeAddBotModal()">✕</button>
    </div>
    <div class="form-row">
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>Web URL của bot con (1 hoặc nhiều link)</span>
        <span id="addBotUrlCountBadge" style="font-size:11.5px;color:#38bdf8;font-weight:700;">0 link</span>
      </label>
      <textarea id="addBotUrl" rows="5" autocomplete="off" oninput="updateAddBotUrlCounter()" placeholder="Dán 1 hoặc nhiều link bot tại đây, phân biệt bằng dấu cách hoặc xuống dòng:&#10;https://bot1.onrender.com&#10;https://bot2.onrender.com&#10;http://localhost:3002" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12.5px;padding:10px;resize:vertical;line-height:1.45;"></textarea>
    </div>
    <div class="form-row">
      <label>Tên hiển thị / Tiền tố đặt tên (Không bắt buộc)</label>
      <input id="addBotLabel" autocomplete="off" placeholder="Ví dụ: Bot (Để trống sẽ tự động lấy tên bot hoặc Bot #ID)">
    </div>
    <div class="note" style="line-height:1.5;">
      💡 <strong>Thêm hàng loạt:</strong> Bạn có thể dán 10+ link cùng lúc (ngăn cách bằng <strong>xuống dòng</strong> hoặc <strong>dấu cách</strong>). Hệ thống sẽ tự động lọc, kiểm tra tính hợp lệ và thêm tất cả các bot hợp lệ vào Manager.
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeAddBotModal()">Hủy</button>
      <button id="confirmAddBotButton" class="primary" onclick="addBotFromWeb()">➕ Thêm Bot</button>
    </div>
  </div>
</div>
<div id="editBotModal" class="modal hidden">
  <div class="modal-card" style="max-width:480px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">✏️ Chỉnh Sửa Thông Tin & Tag Bot</h3>
      <button class="small" onclick="closeEditBotModal()">✕</button>
    </div>
    <input id="editBotId" type="hidden">
    <div class="form-row" style="margin-bottom:10px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600;">Tên hiển thị / Ghi chú</label>
      <input id="editBotLabel" placeholder="Ví dụ: Bot Farm Lúa, Bot VIP..." autocomplete="off" style="width:100%;box-sizing:border-box;">
    </div>
    <div class="form-row admin-only" style="margin-bottom:10px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600;">Web URL bot con</label>
      <input id="editBotUrl" placeholder="http://localhost:3001" autocomplete="off" style="width:100%;box-sizing:border-box;">
    </div>
    <div class="form-row" style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600;">🏷️ Nhóm Tags (ngăn cách bởi dấu phẩy)</label>
      <input id="editBotTags" placeholder="farm, afk, lobby, vip..." autocomplete="off" oninput="renderEditBotTagPreviews(this.value)" style="width:100%;box-sizing:border-box;">
      <div id="editBotTagsPreview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;min-height:24px;"></div>
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeEditBotModal()">Hủy</button>
      <button class="primary" onclick="saveEditBot()">💾 Lưu Thay Đổi</button>
    </div>
  </div>
</div>
<div id="adminModal" class="modal hidden">
  <div class="modal-card modal-lg">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🔑 Mật Khẩu Tài Khoản Bot (Tất cả Bot)</h3>
      <button class="small" onclick="closeAdminModal()">✕</button>
    </div>
    <div id="adminCredentialStep">
      <div id="adminCredentialList" class="credential-list">
        <div style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang tải thông tin tài khoản bot...</div>
      </div>
      <div class="modal-actions" style="margin-top:16px;">
        <button class="small" onclick="loadAdminCredentials()">🔄 Tải lại</button>
        <button class="primary" onclick="closeAdminModal()">Đóng</button>
      </div>
    </div>
  </div>
</div>
<div id="announcementAdminModal" class="modal hidden">
  <div class="modal-card modal-lg">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">📢 Quản Trị Thông Báo Người Dùng</h3>
      <button class="small" onclick="closeAnnouncementAdminModal()">✕</button>
    </div>
    <div class="form-row">
      <label class="check-row" style="margin:0;padding:9px 12px;background:var(--card2);border:1px solid var(--border);border-radius:10px;cursor:pointer;">
        <input id="announcementEnabled" type="checkbox" checked>
        <span style="font-weight:750;color:#fff;">Kích hoạt hiển thị thông báo popup tới người dùng</span>
      </label>
    </div>
    <div class="form-row">
      <label>Tiêu đề thông báo</label>
      <input id="announcementTitle" autocomplete="off" placeholder="Ví dụ: 📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN">
    </div>
    <div class="form-row">
      <label>Nội dung thông báo (hỗ trợ xuống dòng, emoji, bullet points)</label>
      <textarea id="announcementContent" rows="6" placeholder="Nhập nội dung thông báo hàng ngày hoặc thông tin bảo trì..."></textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-row">
        <label>Chế độ hiển thị</label>
        <select id="announcementMode" onchange="handleAnnouncementModeChange()">
          <option value="daily">🗓️ Hằng ngày (Lần đầu vào trong ngày hiện 1 lần)</option>
          <option value="every_login">⚡ Mọi lần truy cập / đăng nhập</option>
          <option value="time_range">⏳ Khoảng thời gian cố định</option>
        </select>
      </div>
      <div id="announcementDateRangeGroup" class="form-row" style="display:none;">
        <label>Khoảng ngày hiển thị</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="announcementStartDate" type="date" style="padding:7px 9px;font-size:12px;">
          <span>đến</span>
          <input id="announcementEndDate" type="date" style="padding:7px 9px;font-size:12px;">
        </div>
      </div>
    </div>
    <div class="note" style="margin:8px 0 16px;">
      ℹ️ <strong>Cơ chế hiển thị:</strong> Khi chọn <em>Hằng ngày</em>, người dùng bấm "Đã hiểu & Đóng" thì trong ngày đó sẽ không hiện lại nữa; sang ngày hôm sau khi truy cập lại sẽ tự động xuất hiện.
    </div>
    <div class="modal-actions" style="display:flex;justify-content:space-between;align-items:center;">
      <button type="button" class="small" onclick="previewAnnouncementModal()">👁️ Xem trước (Preview)</button>
      <div style="display:flex;gap:8px;">
        <button onclick="closeAnnouncementAdminModal()">Hủy</button>
        <button class="primary" onclick="saveAnnouncementConfig()">💾 Lưu Thông Báo</button>
      </div>
    </div>
  </div>
</div>

<div id="userAnnouncementModal" class="modal hidden" style="z-index:999999;">
  <div class="modal-card user-announcement-card">
    <div class="user-announcement-header">
      <div class="announcement-bell-badge">📢</div>
      <div style="flex:1;">
        <div class="announcement-badge-pill">👑 THÔNG BÁO TỪ QUẢN TRỊ VIÊN</div>
        <h3 id="userAnnouncementTitle" class="announcement-main-title">THÔNG BÁO HỆ THỐNG</h3>
        <div id="userAnnouncementTime" class="announcement-sub-date">Cập nhật lúc --</div>
      </div>
      <button class="announcement-close-btn" onclick="dismissUserAnnouncement()" title="Đóng">✕</button>
    </div>
    <div id="userAnnouncementBody" class="user-announcement-body"></div>
    <div class="user-announcement-footer">
      <div id="userAnnouncementFreqNote" class="announcement-freq-note">
        🗓️ Thông báo này sẽ chỉ xuất hiện 1 lần trong ngày hôm nay.
      </div>
      <button class="primary announcement-ack-btn" onclick="dismissUserAnnouncement()">
        ✨ ĐÃ HIỂU & ĐÓNG
      </button>
    </div>
  </div>
</div>
<div id="batchSettingsModal" class="modal hidden">
  <div class="modal-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">⚙️ Đồng bộ Cài đặt Hàng loạt</h3>
      <button class="small" onclick="closeBatchSettingsModal()">✕</button>
    </div>
    <div style="margin-bottom:14px;">
      <label for="batchTargetTag" style="display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:600;">🎯 Đối tượng áp dụng:</label>
      <select id="batchTargetTag" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);font-size:13px;outline:none;">
        <option value="">🌐 Toàn bộ bot trong danh sách</option>
      </select>
    </div>
    <div class="setting-list" style="margin:14px 0;">
      <label class="check-row"><input id="batchEcoMode" type="checkbox" checked> <span>🌱 Eco Mode Siêu Tiết Kiệm (Giảm 80% CPU & giữ RAM &lt; 220MB)</span></label>
      <label class="check-row"><input id="batchAutoTotem" type="checkbox" checked> <span>Auto Totem phản xạ tức thì (&lt; 50ms)</span></label>
      <label class="check-row"><input id="batchAntiHungry" type="checkbox" checked> <span>Anti Hungry / Auto Eat</span></label>
      <label class="check-row"><input id="batchAutoReconnect" type="checkbox" checked> <span>Auto Reconnect + LOGIN/DN/MENU</span></label>
      <label class="check-row"><input id="batchAntiAfkKick" type="checkbox" checked> <span>Smart Anti-AFK Kick (Xoay đầu, vung tay nhẹ)</span></label>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
      <label class="check-row" style="margin-bottom:8px;">
        <input id="batchSyncSpawnCommandsEnabled" type="checkbox" onchange="document.getElementById('batchSpawnCommandsDetails').style.display = this.checked ? 'block' : 'none'">
        <span style="font-weight:700;color:var(--accent);">⚡ Đồng bộ Lệnh Tự Động (spawnCommands)</span>
      </label>
      <div id="batchSpawnCommandsDetails" style="display:none;padding:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;margin-top:6px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Mỗi dòng một lệnh (/warp afk, /fix all, /feed) — chạy tuần tự khi bot vào trạng thái AFK:</div>
        <textarea id="batchSpawnCommands" placeholder="/fix all&#10;/warp afk&#10;/feed" rows="2" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);border-radius:6px;font-family:monospace;resize:vertical;"></textarea>
      </div>
    </div>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
      <label class="check-row" style="margin-bottom:10px;">
        <input id="batchSyncScheduleEnabled" type="checkbox" onchange="document.getElementById('batchScheduleDetails').style.display = this.checked ? 'block' : 'none'">
        <span style="font-weight:700;color:var(--accent);">⏰ Đồng bộ Hẹn giờ Bật/Tắt Bot (On/Off)</span>
      </label>
      <div id="batchScheduleDetails" style="display:none;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;margin-top:8px;">
        <label class="check-row" style="margin-bottom:10px;">
          <input id="batchScheduleActive" type="checkbox" checked>
          <span>Kích hoạt lịch hẹn giờ</span>
        </label>
        <div class="form-row" style="margin-bottom:10px;">
          <label>Chế độ hẹn giờ</label>
          <select id="batchScheduleMode" onchange="handleBatchScheduleModeChange()">
            <option value="fixed">Giờ cố định mỗi ngày</option>
            <option value="cycle">Chu kỳ lặp lại</option>
          </select>
        </div>
        <div id="batchFixedSettings">
          <div style="display:flex;gap:10px;">
            <div class="form-row" style="flex:1;">
              <label>Giờ Tắt (VD: 03:00)</label>
              <input type="time" id="batchFixedStopTime" value="03:00">
            </div>
            <div class="form-row" style="flex:1;">
              <label>Giờ Bật (VD: 06:00)</label>
              <input type="time" id="batchFixedStartTime" value="06:00">
            </div>
          </div>
        </div>
        <div id="batchCycleSettings" style="display:none;">
          <div style="display:flex;gap:10px;">
            <div class="form-row" style="flex:1;">
              <label>Phút chạy trước khi Tắt</label>
              <input type="number" id="batchCycleStopMinutes" value="120" min="1" max="43200">
            </div>
            <div class="form-row" style="flex:1;">
              <label>Phút nghỉ trước khi Bật</label>
              <input type="number" id="batchCycleStartMinutes" value="300" min="1" max="43200">
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button onclick="closeBatchSettingsModal()">Hủy</button>
      <button class="primary" onclick="submitBatchSettings()">Áp dụng tất cả</button>
    </div>
  </div>
</div>
<div id="webhookModal" class="modal hidden">
  <div class="modal-card">
    <h3>🔔 Cài đặt Cảnh báo Webhook (Discord & Telegram)</h3>
    <div style="margin:12px 0 16px;">
      <label class="check-row"><input id="webhookEnabled" type="checkbox"> <span style="font-weight:700;color:var(--green);">Kích hoạt hệ thống Cảnh báo Webhook</span></label>
    </div>
    <div class="form-row">
      <label>Discord Webhook URL</label>
      <input id="webhookDiscordUrl" placeholder="https://discord.com/api/webhooks/...">
    </div>
    <div class="form-row">
      <label>Telegram Bot Token (Tùy chọn)</label>
      <input id="webhookTelegramToken" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11">
    </div>
    <div class="form-row">
      <label>Telegram Chat ID (Tùy chọn)</label>
      <input id="webhookTelegramChatId" placeholder="-100123456789 hoặc ID cá nhân">
    </div>
    <div class="setting-list" style="margin:14px 0;">
      <label class="check-row"><input id="webhookNotifyOffline" type="checkbox" checked> <span>🚨 Cảnh báo khi Bot Offline hoặc Kicked quá 5 phút</span></label>
      <label class="check-row"><input id="webhookNotifyRecover" type="checkbox" checked> <span>✅ Thông báo khi Bot Phục Hồi trực tuyến trở lại</span></label>
      <label class="check-row"><input id="webhookNotifyLowTotem" type="checkbox" checked> <span>🪙 Cảnh báo khẩn khi Bot sắp hết Totem (&le; 1 cái)</span></label>
      <label class="check-row"><input id="webhookNotifyLowHealth" type="checkbox" checked> <span>🩸 Cảnh báo khẩn khi Máu yếu (&le; 5 tim / 10 HP)</span></label>
      <label class="check-row"><input id="webhookNotifyDeath" type="checkbox" checked> <span>💀 Cảnh báo khi Bot tử vong (chết trong game)</span></label>
    </div>
    <div class="form-row">
      <label>Ngưỡng thời gian Offline để báo (Phút):</label>
      <input id="webhookOfflineThreshold" type="number" min="1" max="60" value="5" style="width:120px;">
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeWebhookModal()">Đóng</button>
      <button class="secondary" onclick="testWebhookSettings()">🧪 Gửi thử (Test)</button>
      <button class="primary" onclick="saveWebhookSettings()">💾 Lưu cài đặt</button>
    </div>
  </div>
</div>
<div id="userManagementModal" class="modal hidden">
  <div class="modal-card modal-lg">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
      <div>
        <h3 style="margin:0 0 4px;font-size:18.5px;">👥 Quản lý Người dùng & Phân quyền Bot (RBAC)</h3>
        <div style="color:var(--muted);font-size:12px;">Tạo tài khoản và phân quyền vận hành bot cho từng thành viên.</div>
      </div>
      <button class="primary" onclick="openCreateUserModal()">＋ Thêm Người Dùng Mới</button>
    </div>

    <div class="user-table-wrap">
      <table class="user-table">
        <thead>
          <tr>
            <th>TÊN ĐĂNG NHẬP</th>
            <th>GÓI & HẠN THUÊ</th>
            <th>GHI CHÚ</th>
            <th>TRẠNG THÁI</th>
            <th>BOT ĐƯỢC CẤP QUYỀN</th>
            <th style="text-align:right;">THAO TÁC</th>
          </tr>
        </thead>
        <tbody id="userTableBody">
          <tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">Đang tải danh sách người dùng...</td></tr>
        </tbody>
      </table>
    </div>

    <div class="modal-actions">
      <button onclick="closeUserManagementModal()">Đóng</button>
    </div>
  </div>
</div>

<div id="userEditModal" class="modal hidden">
  <div class="modal-card" style="width:min(580px, 98vw);">
    <h3 id="userEditModalTitle">Thêm Người Dùng Mới</h3>
    <input id="userFormId" type="hidden">
    <div class="form-row">
      <label>Tên đăng nhập (Username)</label>
      <input id="userFormUsername" autocomplete="off" placeholder="Ví dụ: operator1">
    </div>
    <div class="form-row">
      <label>Mật khẩu (Password)</label>
      <div class="password-input-wrap">
        <input id="userFormPassword" type="text" autocomplete="off" placeholder="Nhập mật khẩu (tối thiểu 8 ký tự, gồm chữ và số)...">
        <button type="button" class="password-toggle-btn" onclick="generateRandomUserPassword()" title="Tạo mật khẩu ngẫu nhiên">🎲</button>
      </div>
    </div>
    <div class="form-row">
      <label>Trạng thái tài khoản</label>
      <select id="userFormStatus" class="search-box" style="width:100%;">
        <option value="active">🟢 Đang hoạt động (Cho phép đăng nhập)</option>
        <option value="expired">⚠️ Hết hạn thuê</option>
        <option value="disabled">🔴 Tạm khóa (Không thể đăng nhập)</option>
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-row">
        <label>Tên gói cước</label>
        <input id="userFormPlanName" placeholder="Ví dụ: Gói Tuần, VIP Tháng...">
      </div>
      <div class="form-row">
        <label>Hạn thuê (Bỏ trống = Vĩnh viễn)</label>
        <input id="userFormExpiresAt" type="datetime-local">
      </div>
    </div>
    <div class="form-row">
      <label>Ghi chú liên hệ (Zalo / Facebook / SĐT)</label>
      <input id="userFormNote" placeholder="Ví dụ: Zalo: 0912345678 (Anh Nam)">
    </div>
    <div class="form-row" style="margin-top:6px;">
      <label class="check-row" style="cursor:pointer;font-size:12.5px;">
        <input id="userFormAllowAccountChange" type="checkbox" checked>
        <span>Cho phép khách tự đổi Username & Mật khẩu Minecraft của bot</span>
      </label>
    </div>

    <div style="margin-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <label style="color:var(--muted);font-size:11.5px;font-weight:700;">DANH SÁCH BOT CẤP QUYỀN VẬN HÀNH</label>
        <div style="display:flex;gap:8px;">
          <button type="button" class="small" onclick="toggleSelectAllUserBots(true)">Chọn hết</button>
          <button type="button" class="small" onclick="toggleSelectAllUserBots(false)">Bỏ hết</button>
        </div>
      </div>
      <div id="userFormBotsGrid" class="bot-checkbox-grid"></div>
    </div>

    <div class="modal-actions" style="margin-top:20px;">
      <button onclick="closeUserEditModal()">Hủy</button>
      <button id="userFormSubmitBtn" class="primary" onclick="saveUserForm()">Lưu Người Dùng</button>
    </div>
  </div>
</div>

<div id="changePasswordModal" class="modal hidden">
  <div class="modal-card" style="width:min(440px, 96vw);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🔑 Đổi Mật Khẩu Tài Khoản</h3>
      <button class="small" onclick="closeChangePasswordModal()">✕</button>
    </div>
    <form id="changePasswordForm" onsubmit="submitChangePassword(event)" style="display:flex;flex-direction:column;gap:12px;">
      <div class="form-row" style="margin-bottom:0;">
        <label>Tài khoản</label>
        <input id="changePassUsernameDisplay" type="text" disabled style="opacity:0.8;background:rgba(255,255,255,0.04);">
      </div>
      <div class="form-row" style="margin-bottom:0;">
        <label>Mật khẩu hiện tại</label>
        <div class="password-input-wrap">
          <input id="changePassOld" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu hiện tại..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('changePassOld', this)">👁</button>
        </div>
      </div>
      <div class="form-row" style="margin-bottom:0;">
        <label>Mật khẩu mới (tối thiểu 8 ký tự, gồm chữ và số)</label>
        <div class="password-input-wrap">
          <input id="changePassNew" type="password" autocomplete="new-password" placeholder="Nhập mật khẩu mới..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('changePassNew', this)">👁</button>
        </div>
      </div>
      <div class="form-row" style="margin-bottom:0;">
        <label>Xác nhận mật khẩu mới</label>
        <div class="password-input-wrap">
          <input id="changePassConfirm" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('changePassConfirm', this)">👁</button>
        </div>
      </div>
      <div id="changePassAlert" class="login-alert hidden" style="margin-top:4px;"></div>
      <div class="modal-actions" style="margin-top:12px;">
        <button type="button" onclick="closeChangePasswordModal()">Hủy</button>
        <button id="changePassSubmitBtn" type="submit" class="primary">💾 Cập Nhật Mật Khẩu</button>
      </div>
    </form>
  </div>
</div>
<div id="changelogModal" class="modal hidden">
  <div class="modal-card changelog-card">
    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <div>
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">📜 Nhật Ký Cập Nhật & Lịch Sử Phiên Bản</h3>
        <div style="color:var(--muted);font-size:11.5px;margin-top:2px;">Hành trình tối ưu và nâng cấp KingMC Sentinel (V1.0 - V11.3 Pure Render)</div>
      </div>
      <button class="small" onclick="closeChangelogModal()">✕</button>
    </div>

    <div class="changelog-body">
      <!-- V11.6 -->
      <div class="timeline-item latest">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">👑 KBOT Commercial Enterprise Edition V11.6 (Performance & Experience Evolution)</span>
          <span class="timeline-badge current">HIGH-SPEED REAL-TIME • 99.9% AFK UPTIME • SMART RECONNECT • SEAMLESS MOBILE UI</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Tối Ưu Tốc Độ Truyền Tải &amp; Độ Nhạy (High-Speed Real-Time):</strong> Nâng cấp cơ chế truyền dữ liệu telemetry, giảm độ trễ cập nhật trạng thái bot xuống mức tối thiểu, bảng điều khiển phản hồi mượt mà tức thì và tiết kiệm tối đa dữ liệu mạng.</li>
            <li><strong>Tăng Cường Độ Ổn Định AFK (Uptime 99.9%):</strong> Nâng cấp thuật toán tự động kết nối lại (Auto-Reconnect) thông minh khi máy chủ KingMC bảo trì hoặc gặp sự cố mạng, bảo đảm bot tự động vào lại, giữ vững vị trí và duy trì cày cuốc liên tục 24/7.</li>
            <li><strong>Giao Diện Trực Quan &amp; Tối Ưu Mobile:</strong> Hoàn thiện hiển thị chi tiết các chỉ số sinh tồn (máu, thanh đói, tọa độ, totem, giáp) sắc nét; hỗ trợ giao diện cảm ứng mượt mà và chuẩn xác trên mọi dòng điện thoại.</li>
            <li><strong>Chuẩn Hóa Thời Hạn Thuê Minh Bạch:</strong> Cải tiến hệ thống tính toán thời gian thuê bot chuẩn xác đến từng phút, hiển thị rõ ràng thời hạn sử dụng và hỗ trợ nhập mã Key bản quyền gia hạn trực tiếp mà không cần tải lại trang.</li>
            <li><strong>Bảo Mật Phiên Làm Việc &amp; Đăng Nhập Liền Mạch:</strong> Bảo vệ dữ liệu cá nhân an toàn tuyệt đối, duy trì phiên đăng nhập ổn định không bị đăng xuất bất ngờ khi đang theo dõi bot.</li>
          </ul>
        </div>
      </div>

      <!-- V11.5 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">👑 KBOT Commercial Enterprise Edition V11.5 (Full Enterprise SaaS)</span>
          <span class="timeline-badge">SELF-REGISTER • FULL-PAGE DEDICATED SECTIONS • RESTRICTED BLUR OVERLAYS • 1-BOT-1-USER</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Tự Đăng Ký Tài Khoản Khách Thuê:</strong> Khách hàng có thể tự đăng ký tài khoản trực tiếp trên Web với username độc nhất (không phân biệt hoa thường), xác thực chính sách mật khẩu và nhận ngay 1 ngày dùng thử hoặc kích hoạt mã Key bản quyền.</li>
            <li><strong>Thanh Điều Hướng Toàn Diện &amp; Nút Tài Khoản Góc Phải:</strong> Menu tài khoản được neo cố định góc trên bên phải trên mọi thiết bị (PC &amp; Mobile), tích hợp nút Đăng Xuất ở ngay đầu danh mục và mở các tab chuyển trang lớn trực quan.</li>
            <li><strong>Tách Biệt Toàn Trang (Full-Page Dedicated Sections):</strong> Chuyển đổi toàn bộ các trang Quản Lý User &amp; Key, Nhật Ký Hoạt Động (Audit Trail Enterprise) và Quản Lý Sao Lưu (Disaster Recovery) sang dạng toàn trang độc lập, tiện lợi hơn gấp 10 lần các modal pop-up cũ.</li>
            <li><strong>Màn Hình Khóa &amp; Hết Hạn Làm Mờ Nền (Blurred Restriction Overlays):</strong> Người dùng bị tạm khóa hoặc hết hạn vẫn có thể đăng nhập để xem thông báo/lời nhắn từ Admin hoặc kích hoạt Key gia hạn và chuyển hướng sang Discord hỗ trợ, trong khi toàn bộ nền Dashboard phía sau bị làm mờ và khóa tương tác tuyệt đối.</li>
            <li><strong>Phân Quyền Độc Quyền 1-Bot-1-User:</strong> Mỗi bot chỉ được cấp phát cho tối đa 1 khách thuê; bot đã có chủ sở hữu sẽ tự động hiển thị xám với nhãn người dùng đang giữ, yêu cầu xác nhận trước khi hủy quyền để chuyển giao cho người mới.</li>
            <li><strong>Cơ Chế Gia Hạn Linh Hoạt &amp; Thu Hồi Vĩnh Viễn:</strong> Thêm hệ thống nút gia hạn nhanh (+1N, +3N, +7N, +15N, +30N, -1N, 👑 Vĩnh viễn, ⏱ Tùy chỉnh). Nếu tài khoản VIP Vĩnh Viễn được điều chỉnh cộng/trừ ngày hoặc cố định ngày, quyền vĩnh viễn sẽ tự động hủy và tính từ thời điểm hiện tại; đồng thời giao diện người dùng vĩnh viễn được tối giản bỏ nút nhập Key.</li>
            <li><strong>Bảo Mật Cao Cấp &amp; Tự Phục Hồi Dữ Liệu:</strong> Mã hóa dữ liệu bảo mật chuẩn scrypt; cơ chế tự phục hồi đa đường dẫn giải quyết triệt để lỗi tài khoản biến mất sau chu kỳ Logout / Login.</li>
          </ul>
        </div>
      </div>

      <!-- V11.4 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KBOT Cloud Native Edition V11.4 (Persistence & UI Harmony)</span>
          <span class="timeline-badge">ROCK-SOLID PERSISTENCE • DOCKING UI • 100% FLEET SYNC</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Khắc Phục Triệt Để Mất Dữ Liệu Tài Khoản:</strong> Tái cấu trúc cơ chế tự phục hồi (Self-Healing) và quy trình sao lưu; bảo toàn tuyệt đối danh sách tài khoản khách thuê qua chu kỳ Logout / Login mà không bị ghi đè bởi bản backup cũ.</li>
            <li><strong>Bố Cục Menu Tài Khoản Chuẩn Mực:</strong> Nút người dùng được neo vững chắc ở phía bên phải thanh công cụ; menu dropdown mở rộng theo hướng bên trái (<code>right: 0; left: auto;</code>) hiển thị trọn vẹn không bao giờ tràn màn hình.</li>
            <li><strong>Đồng Bộ Dữ Liệu Hai Chiều Hoàn Hảo:</strong> Kết nối thông suốt giữa Manager và Bot Worker qua biến môi trường <code>BOT_SECRET_KEY</code> thống nhất trên bảng điều khiển hosting, bảo đảm 100% lệnh, mật khẩu, tài khoản và lịch trình đồng nhất giữa các hosting riêng biệt.</li>
            <li><strong>Tối Ưu Phần Cứng & Băng Thông:</strong> Giảm tải CPU idle với chu kỳ polling thông minh thích ứng (500ms khi hoạt động, 5000ms khi ẩn tab), khóa giới hạn mảng log tránh tràn RAM trên gói Render cơ bản.</li>
            <li><strong>Hiệu Ứng Hoạt Ảnh Mượt Mà:</strong> Thêm chuyển động nâng thẻ bot khi di chuột, highlight hàng bảng quản trị và chuyển đổi mượt mà các tab.</li>
          </ul>
        </div>
      </div>

      <!-- V11.3 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🛡️ KBOT Cloud Native Edition V11.3 (Pure Render Optimized)</span>
          <span class="timeline-badge">PURE RENDER • SESSION REVOCATION • ATOMIC ROLLBACK</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Triển Khai Độc Quyền Pure Render Cloud:</strong> Tối ưu hóa toàn diện cho Render Web Service, tự động nhận diện PORT 10000 fallback, thanh trừng triệt để toàn bộ mã nguồn và nền tảng cũ.</li>
            <li><strong>Thu Hồi Phiên Đăng Nhập Tức Thì Khi Đổi Mật Khẩu:</strong> Tự động vô hiệu hóa toàn bộ active session của tài khoản khi quản trị viên hoặc người dùng cập nhật mật khẩu mới, ép đăng nhập lại trên mọi thiết bị và bot con.</li>
            <li><strong>Lưu Trữ Nguyên Tử (Atomic Persistence & Rollback):</strong> Cơ chế hoàn tác in-memory an toàn 100% khi ghi dữ liệu tài khoản (users) hoặc mã key bản quyền thất bại, ngăn chặn mất đồng bộ trạng thái hệ thống.</li>
            <li><strong>Đồng Bộ Hash Mật Khẩu Login Gate:</strong> Cổng <code>/api/auth/verify-bot-access</code> truyền tải đầy đủ hash mật khẩu chuẩn scrypt để Bot Worker giám sát phiên đăng nhập theo thời gian thực.</li>
            <li><strong>Giao Diện Quản Trị Bảo Mật Cao:</strong> Loại bỏ triệt để nguy cơ chèn chuỗi HTML injection trong modal tài khoản quản trị và khắc phục race condition khi cập nhật thẻ tóm tắt bot.</li>
          </ul>
        </div>
      </div>

      <!-- V10.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KBOT Commercial Pro Edition V10.0 (16.10.2026)</span>
          <span class="timeline-badge current">SAAS COMMERCIAL & MULTI-HOST CLOUD</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Thương Hiệu & Trải Nghiệm Thương Mại KBOT:</strong> Chính thức ra mắt nền tảng thương mại KBOT hoàn chỉnh cho dịch vụ thuê bot AFK KingMC số 1.</li>
            <li><strong>SaaS Showcase & Landing Portal:</strong> Tích hợp giao diện giới thiệu sản phẩm trực quan, 5 quyền lợi khách thuê vượt trội, quy trình hoạt động 3 bước và cam kết SLA 99.9% Uptime.</li>
            <li><strong>Cổng Hỗ Trợ Cộng Đồng Discord 24/7:</strong> Tích hợp nút kết nối trực tiếp kênh Discord hỗ trợ kỹ thuật và mua key tự động (https://discord.gg/mJWX5Xp3z).</li>
            <li><strong>Tối Ưu Đồng Bộ Đa Máy Chủ (Multi-Host Sync):</strong> Hoạt động ổn định bất kể Manager và Bot Worker triển khai trên các hạ tầng khác nhau (Render Web Service, VPS Linux, Docker, máy chủ riêng).</li>
            <li><strong>Bảo Mật Quân Sự Scrypt & Zero Plaintext:</strong> Cơ chế mã hóa hai chiều và đồng bộ offline cache bảo vệ tuyệt đối thông tin khách hàng.</li>
          </ul>
        </div>
      </div>

      <!-- V9.3 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🛡️ KingMC Real-Time & Security V9.3</span>
          <span class="timeline-badge current">REAL-TIME 500MS & AUTH SYNC</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Polling Real-time 500ms mượt mà, chống nghẽn:</strong> Nâng cấp tần số polling lên 500ms với cơ chế gọi tuần tự async/await, loại bỏ triệt để xung đột race-condition khi nhiều tab cùng mở.</li>
            <li><strong>Khóa Bảo Mật Service-to-Service Nội Bộ:</strong> Sử dụng <code>BOT_SECRET_KEY</code> cấu hình qua biến môi trường giữa Manager và Bot con, khóa chặt 100% API riêng tư của Bot con trước mọi truy cập trái phép.</li>
            <li><strong>Đồng Bộ Tài Khoản Auth Sync (Scrypt Hash):</strong> Manager đồng bộ danh sách khách thuê và phân quyền xuống từng Bot con bằng chuẩn băm scrypt bảo mật, khách có thể đăng nhập trực tiếp trên Web Bot con mà không cần Manager online.</li>
            <li><strong>Bảo Vệ Giao Diện Bot Con Chống Lộ Dữ Liệu:</strong> Login Gate che kín UI mặc định ngay từ HTML, thêm nút Đăng xuất trên topbar và Modal lịch sử cập nhật riêng cho Bot con.</li>
            <li><strong>Nút Xem Mật Khẩu (👁 / 🙈) & Chip Lệnh Nhanh Chuẩn Hóa:</strong> Nút con mắt xem mật khẩu ở cả 2 file, chip lệnh nhanh (/dn, /login, /pay) tự điền tham số và không auto gửi.</li>
            <li><strong>Reset Bàn Giao Khách Mới Sạch 100%:</strong> Xóa trắng hoàn toàn trạng thái trong RAM, xóa sạch username không để lại dấu vết của khách cũ.</li>
            <li><strong>Quản Lý Bản Sao Lưu & Đồng Bộ Hẹn Giờ Bật/Tắt Hàng Loạt:</strong> Thêm nút xóa từng file Backup có kiểm tra bảo mật, bổ sung cấu hình hẹn giờ On/Off cố định và chu kỳ trong modal đồng bộ hàng loạt.</li>
          </ul>
        </div>
      </div>

      <!-- V9.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KingMC Commercial SaaS & Audit Trail Pro Max V9.0</span>
          <span class="timeline-badge current">SAAS COMMERCIAL & AUDIT TRAIL</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Nhật Ký Hoạt Động & Lịch Sử Cập Nhật Toàn Diện (Audit Trail Pro Max):</strong> Ghi nhận 100% thời gian thực mọi hành vi, thao tác người dùng và sự kiện tự động (Xác thực, Điều khiển bot, Tài khoản Minecraft, Cài đặt, Túi đồ, Hạm đội, Khách thuê, Giftcode, Watchdog, Auto-Healing).</li>
            <li><strong>Bộ Lọc Đa Năng & Xuất Dữ Liệu (Export CSV / JSONL):</strong> Hỗ trợ tìm kiếm từ khóa, phân loại theo danh mục (AUTH, BOT, FLEET, USER, LICENSE, SYSTEM), phân loại theo trạng thái (Thành công, Thất bại, Bị chặn), phân trang mượt mà và tải file báo cáo CSV/JSONL về máy tính với font tiếng Việt chuẩn UTF-8 BOM.</li>
            <li><strong>Xóa Lịch Sử Nhật Ký Có Kiểm Soát (Audit Retention & Clear):</strong> Admin có quyền xóa sạch nhật ký cũ, hệ thống tự động ghi nhận lại sự kiện xóa vào nhật ký mới để đảm bảo tính minh bạch và toàn vẹn dữ liệu.</li>
            <li><strong>Hệ Thống Thuê Bot & Gói Cước Tự Động (Subscription Engine):</strong> Quản lý thời hạn thuê chính xác từng giây, đồng hồ đếm ngược trực quan, cảnh báo sắp hết hạn và tự động thu hồi/tắt bot an toàn khi hết hạn.</li>
            <li><strong>Hệ Thống Mã Kích Hoạt (License Key / Giftcode):</strong> Tạo key gia hạn linh hoạt theo ngày/gói, tự động kích hoạt nạp ngày thuê qua Web Toolbar hoặc Login Gate.</li>
            <li><strong>Tự Đổi Tài Khoản Minecraft & Reset Bàn Giao:</strong> Khách thuê được chủ động đổi nick/pass bot của mình (kèm phân quyền Admin), tính năng 1-click Reset bàn giao bot sạch sẽ cho khách mới.</li>
            <li><strong>Broadcast Lệnh Hạm Đội & Remote GUI Inspector:</strong> Gửi lệnh hàng loạt cho toàn hạm đội bot, tương tác ảo click slot rương/kho đồ từ xa.</li>
            <li><strong>Xử Lý Triệt Để 24 Lỗi Kỹ Thuật (Bug Fixes):</strong> Khóa AES cố định không đổi khi restart container, log stream ổn định, phân quyền RBAC chặt chẽ, tối ưu DOM không giật lag.</li>
          </ul>
        </div>
      </div>

      <!-- V8.2 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🌱 KingMC Eco Sentinel & UI Evolution V8.2</span>
          <span class="timeline-badge past">ECO MODE & FLEET RESOURCE BAR</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Siêu Tối Ưu Eco Mode (Giảm 80% CPU & Lock RAM &lt; 220MB):</strong> Khi bot AFK tĩnh, tắt toàn bộ tính toán vật lý collision/raycasting (<code>physicsEnabled = false</code>), triệt tiêu gói tin hạt/ánh sáng/âm thanh không cần thiết và giới hạn buffer log 150 mục.</li>
            <li><strong>Fleet Resource Overview Bar:</strong> Bổ sung thanh thống kê tài nguyên hạm đội chuẩn Glassmorphism (Tổng RAM, RAM TB/bot, số bot đang kích hoạt Eco, mức CPU tiết kiệm ước tính ~80%).</li>
            <li><strong>Thanh Đo RAM Usage & Badge Eco Trên Thẻ Bot:</strong> Hiển thị badge <code>🌱 ECO ACTIVE</code> và thanh tiến trình RAM đổi màu trực quan theo ngưỡng dung lượng (&lt;200MB Xanh, 200-320MB Vàng/Lam, &gt;320MB Cam).</li>
            <li><strong>Đồng Bộ Cài Đặt Eco Toàn Hạm Đội:</strong> Hỗ trợ bật/tắt Eco Mode hàng loạt chỉ với 1 click trong modal Đồng bộ Cài đặt và từng bot riêng biệt.</li>
            <li><strong>Tối Ưu Giao Diện Di Động (Mobile UX):</strong> Chuẩn hóa touch targets &ge; 44px, grid co giãn thích ứng mượt mà trên mọi kích thước màn hình smartphone.</li>
          </ul>
        </div>
      </div>

      <!-- V8.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⚡ KingMC Telemetry Sentinel V8.1</span>
          <span class="timeline-badge past">SMART WATCHDOG & TELEMETRY</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Smart Watchdog Chống Kẹt Sảnh (&gt; 28s):</strong> Tự động phát hiện bot bị kẹt ở tọa độ đăng nhập hoặc sảnh quá 28 giây mà không vào được server AFK, tự động ngắt kết nối và đăng nhập lại từ đầu.</li>
            <li><strong>Ghost Freeze Watchdog (&gt; 35s):</strong> Lắng nghe luồng gói tin socket trực tiếp từ KingMC. Nếu quá 35s không nhận được packet (đứt kết nối ngầm), bot tự động Hard Reset kết nối.</li>
            <li><strong>Full Jitter Exponential Backoff:</strong> Thuật toán kết nối lại ngẫu nhiên đều kết hợp độ lệch pha theo ID bot (Fleet Phase Staggering), xóa bỏ nghẽn mạng Thundering Herd và chống ban IP hạm đội.</li>
            <li><strong>Cảnh Báo Telemetry Máu Yếu &amp; Tử Vong:</strong> Tích hợp webhook Discord Rich Embed và Telegram cảnh báo tức thì khi bot còn &le; 10 HP (&le; 5 tim) hoặc tử vong trong game (kèm tọa độ chi tiết).</li>
            <li><strong>Fleet Auto-Healing Lệch Pha:</strong> Cơ chế tự phục hồi bot offline của Manager giãn cách 2.5s mỗi bot, đảm bảo máy chủ không bị shock tải khi có nhiều bot cùng ngắt kết nối.</li>
          </ul>
        </div>
      </div>

      <!-- V8.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">👑 KingMC Enterprise Fleet V8.0</span>
          <span class="timeline-badge past">ENTERPRISE SECURITY</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Bảo Mật Scrypt & AES-256-GCM:</strong> Băm mật khẩu Admin bằng thuật toán <code>scrypt</code> có muối ngẫu nhiên; mã hóa mật khẩu User trên đĩa bằng <code>AES-256-GCM</code> chống lộ file an toàn tuyệt đối.</li>
            <li><strong>Chống Brute-Force Đăng Nhập:</strong> Giới hạn 5 lần thử trong 15 phút, khóa IP và độ trễ lũy thừa bảo vệ cổng đăng nhập.</li>
            <li><strong>Tự Động Sao Lưu (Auto-Backup) & Tự Phục Hồi (Self-Healing):</strong> Tự động snapshot xoay vòng 30 bản định kỳ 6 tiếng và trước các thao tác lớn; tự động khôi phục cấu hình nếu file JSON bị lỗi.</li>
            <li><strong>Nhật Ký Quản Trị Toàn Diện (Audit Trail):</strong> Ghi nhận mọi hành vi đăng nhập, điều khiển bot và can thiệp hệ thống vào file stream <code>manager_audit.jsonl</code> kèm giao diện tra cứu trên Web cho Admin.</li>
          </ul>
        </div>
      </div>

      <!-- V7.2 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Sentinel V7.2</span>
          <span class="timeline-badge past">ZERO-FLICKER & PROFILE</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Zero-Flicker Instant Loading:</strong> Tối ưu hóa render phân giải phiên đăng nhập phía máy chủ; triệt tiêu 100% hiện tượng chớp nhấp nháy màn hình khi vừa mở web.</li>
            <li><strong>Menu Hồ Sơ Dropdown Góc Phải:</strong> Tích hợp nút Avatar thông minh (👑 Admin / 👤 User), hiển thị thông tin tài khoản, cấp bậc và bảng điều khiển trực quan.</li>
            <li><strong>Tính Năng Tự Đổi Mật Khẩu (Self-Service):</strong> Cung cấp form đổi mật khẩu an toàn cho cả User lẫn Admin trực tiếp từ menu hồ sơ.</li>
            <li><strong>Tinh Giản Cổng Đăng Nhập:</strong> Chuẩn hóa ô nhập tài khoản ("Nhập tên đăng nhập..."), gỡ bỏ các văn bản hướng dẫn rườm rà.</li>
          </ul>
        </div>
      </div>

      <!-- V7.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Sentinel V7.1</span>
          <span class="timeline-badge past">MULTI-USER RBAC</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Phân Quyền Đa Người Dùng (RBAC):</strong> Tách biệt Quản trị viên (Admin) và Operator; phân quyền chỉ định bot con cho từng thành viên.</li>
            <li><strong>Hệ Thống Thông Báo Sentinel:</strong> Popup thông báo admin thông minh với 3 chế độ (Hằng ngày 1 lần/ngày, Mọi lần vào, Khung thời gian).</li>
            <li><strong>Bảo Mật Phiên 30 Ngày:</strong> Lưu trữ phiên bền vững qua cookie an toàn và file JSON trên đĩa; không bao giờ bị mất phiên khi F5 hoặc restart server.</li>
            <li><strong>Đồng Bộ HUD Toàn Diện:</strong> Huy hiệu PRO V7.1, Role badge, Platform và RAM Manager hiển thị sắc nét xuyên suốt từ Dashboard đến chi tiết bot con.</li>
            <li><strong>Bảo Mật Dữ Liệu Bot:</strong> Ẩn hoàn toàn form tài khoản/mật khẩu bot con đối với tài khoản User thường.</li>
          </ul>
        </div>
      </div>

      <!-- V7.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Commander V7.0</span>
          <span class="timeline-badge past">INTELLIGENT SCHEDULER</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Hẹn Giờ Bot Thông Minh:</strong> Hỗ trợ đặt lịch theo giờ cố định hằng ngày hoặc chạy theo chu kỳ tuần tự.</li>
            <li><strong>Auto Chat Đa Dòng:</strong> Lên lịch gửi tin nhắn lặp lại với độ trễ (delay) mượt mà chống spam block.</li>
            <li><strong>Kéo Thả Hòm Đồ:</strong> Tương tác trực tiếp kéo thả slot trang bị, chuyển đổi Hotbar và vứt item ra thế giới thực.</li>
            <li><strong>Smart Anti-AFK Kick:</strong> Mô phỏng hành vi di chuyển, vung tay nhẹ nhàng chống AFK kick.</li>
          </ul>
        </div>
      </div>

      <!-- V6.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Sentinel Guard V6.1 (V6.0)</span>
          <span class="timeline-badge past">WEBHOOK WATCHDOG</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Cảnh Báo Webhook:</strong> Tích hợp thông báo tức thời qua Discord & Telegram khi bot offline quá 5 phút hoặc sắp hết Totem.</li>
            <li><strong>Watchdog Tự Phục Hồi:</strong> Tự động phát hiện bot bị kẹt hoặc mất kết nối và kích hoạt tái kết nối thông minh.</li>
          </ul>
        </div>
      </div>

      <!-- V5.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Performance V5.0</span>
          <span class="timeline-badge past">REALTIME SPARKLINES</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Đồ Thị SVG Sparklines:</strong> Theo dõi biến thiên Ping và RAM RSS trực quan theo thời gian thực.</li>
            <li><strong>Tối Ưu Bộ Nhớ:</strong> Tinh chỉnh cân đối tài nguyên ổn định trong mức 300 - 500 MB RAM.</li>
          </ul>
        </div>
      </div>

      <!-- V4.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Dynamic Hub V4.0</span>
          <span class="timeline-badge past">REGISTRY & BACKUP</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Quản Lý Bot Trực Tuyến:</strong> Thêm, sửa URL, xóa bot trực tiếp từ giao diện không cần khởi động lại server.</li>
            <li><strong>Sao Lưu Danh Sách:</strong> Hỗ trợ Export và Import khôi phục danh sách bot bằng định dạng file JSON.</li>
          </ul>
        </div>
      </div>

      <!-- V3.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Inventory V3.0</span>
          <span class="timeline-badge past">WORLD INTERACTION</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Giao Diện Hòm Đồ 36 Ô:</strong> Giám sát slot trang bị, Hotbar, hiển thị thanh Máu (Health), Đói (Hunger) và số lượng Totem.</li>
          </ul>
        </div>
      </div>

      <!-- V2.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Core V2.0 (V2.1)</span>
          <span class="timeline-badge past">MULTI-BOT CONTROL</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Điều Khiển Hàng Loạt:</strong> Nút chạy, dừng, khởi động lại tất cả bot cùng lúc; bảng thống kê KPI tập trung.</li>
          </ul>
        </div>
      </div>

      <!-- V1.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Console V1.1</span>
          <span class="timeline-badge past">CHAT & QUICK COMMANDS</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Live Console:</strong> Theo dõi Event Log và Chat Log trực tiếp; chip gửi lệnh nhanh <code>/menu</code> (Slot 24), <code>/dn</code>, <code>/login</code>, <code>/bal</code>, <code>/team chat</code>.</li>
          </ul>
        </div>
      </div>

      <!-- V1.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KingMC Genesis V1.0</span>
          <span class="timeline-badge past">INITIAL RELEASE</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Khởi Tạo Nền Tảng:</strong> Hệ thống KingMC AFK Bot cơ bản và giao diện web giám sát độc lập.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
      <button onclick="closeChangelogModal()">Đóng</button>
    </div>
</div>
</div>

<div id="supabaseModal" class="modal hidden">
  <div class="modal-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <h3 style="margin:0;font-size:18px;display:flex;align-items:center;gap:8px;">
        <span>☁️</span> Cấu hình Supabase Cloud Database
      </h3>
      <span id="supabaseStatusBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">
        ⚪ Đang kiểm tra...
      </span>
    </div>
    
    <div id="supabaseAlertBox" class="login-alert hidden" style="margin-bottom:14px;"></div>

    <p style="font-size:12.5px;color:var(--muted);line-height:1.5;margin-bottom:16px;">
      Đồng bộ người dùng, License Key, hạm đội, phiên đăng nhập, cài đặt Bot và Audit Log lên Supabase PostgreSQL. Khi tạo project Supabase mới, sao chép SQL bên dưới và chạy một lần trong SQL Editor trước khi kết nối.
    </p>

    <div class="form-row">
      <label>Supabase Project URL</label>
      <input id="supabaseUrlInput" type="text" placeholder="https://xyzcompany.supabase.co" autocomplete="off" spellcheck="false">
    </div>

    <div class="form-row">
      <label>Supabase Service Role Key / API Key</label>
      <div class="password-input-wrap">
        <input id="supabaseKeyInput" type="password" placeholder="eyJh..." autocomplete="off">
        <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('supabaseKeyInput', this)">👁</button>
      </div>
      <small style="color:var(--muted);font-size:11px;margin-top:4px;display:block;">
        Khuyên dùng <strong>service_role secret</strong> từ Supabase Dashboard (Settings &gt; API) để có toàn quyền đồng bộ bảng.
      </small>
    </div>

    <div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.2);border-radius:10px;padding:12px;margin:16px 0;font-size:12px;color:#cbd5e1;line-height:1.5;">
      <div style="font-weight:700;color:#38bdf8;margin-bottom:4px;">💡 Trạng thái hiện tại:</div>
      <div id="supabaseStatusMsg">Chưa tải trạng thái kết nối.</div>
    </div>

    <div class="modal-actions" style="margin-top:16px;gap:8px;flex-wrap:wrap;">
      <button type="button" onclick="closeSupabaseModal()">Đóng</button>
      <button type="button" class="secondary" id="supabaseSchemaBtn" onclick="copySupabaseSchemaSql()">📋 Sao chép SQL tạo bảng</button>
      <button type="button" class="secondary" id="supabaseTestBtn" onclick="testSupabaseConnection()">🧪 Kiểm tra kết nối</button>
      <button type="button" class="secondary" id="supabaseSyncBtn" onclick="syncAllToSupabase()">🔄 Đồng bộ ngay (Sync Now)</button>
      <button type="button" class="primary" id="supabaseSaveBtn" onclick="saveSupabaseConfig()">💾 Lưu cấu hình</button>
    </div>
  </div>
</div>

<div class="app-footer">
  <div class="footer-recent-wrap">
    <div class="footer-recent-left">
      <span class="footer-recent-tag">🚀 KBOT V11.6 COMMERCIAL ENTERPRISE</span>
      <span class="footer-recent-desc">Nền Tảng Cho Thuê Bot AFK KingMC Thương Mại Số 1 • Pure Render Native • Session Revocation • Atomic Rollback.</span>
    </div>
    <button class="footer-changelog-btn" onclick="openChangelogModal()">📜 Xem Lịch Sử Cập Nhật (V1.0 - V11.6)</button>
  </div>
  <div class="footer-copy">© 2026 KBOT — Hệ Thống Cho Thuê Bot AFK KingMC Thương Mại Cao Cấp. All rights reserved.</div>
</div>
<div id="toast" class="toast"></div>
<script>
window.__INITIAL_USER__ = null;
let currentUser = window.__INITIAL_USER__ || null;
let userManagementList = [];
let userManagementAvailableBots = [];
let userPassPeekMap = {};
let bots = [];
let selectedBotId = null;
let detailBot = null;
let managerPollTimerId = null;
let detailInventory = null;
let detailDragged = null;
let detailInventoryBusy = false;
let homeRequestInFlight = false;
let routeResolving = false;
let detailRequestInFlight = false;
let lastEventRevision = -1;
let lastChatRevision = -1;
let eventLoading = false;
let chatLoading = false;
let uptimeSyncAt = Date.now();
let detailRefreshQueued = false;
let draggedBotId = null;
let detailAutoChatSchedules = [];
let detailBotSchedules = [];
let detailSettingsDirty = false;
let detailAutoChatDirty = false;
let detailBotScheduleDirty = false;
let detailSettingsSaveInFlight = false;
let detailAutoChatSaveInFlight = false;
let detailBotScheduleSaveInFlight = false;
let detailAccountSaveInFlight = false;
let detailLifecycleActionInFlight = false;
let allLifecycleActionInFlight = false;
let detailRefreshGeneration = 0;

function invalidateDetailReads() {
  detailRefreshGeneration++;
  return detailRefreshGeneration;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Math.min(30000, Number(options.timeoutMs)))
    : 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...(options.headers || {}) };
  try {
    const localToken = localStorage.getItem('kingmc_session');
    if (localToken && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = 'Bearer ' + localToken;
    }
  } catch (_) {}
  const requestOptions = { ...options, headers, cache: 'no-store', credentials: 'same-origin', signal: controller.signal };
  delete requestOptions.timeoutMs;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData) && !(options.body instanceof URLSearchParams) && !(typeof Blob !== 'undefined' && options.body instanceof Blob)) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    requestOptions.body = JSON.stringify(options.body);
  }
  try {
    const response = await fetch(url, requestOptions);
    if (response.status === 401) {
      return { ok: false, status: 401, data: { error: 'Phiên đăng nhập hết hạn hoặc chưa đăng nhập.' } };
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch (_) { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err && err.name === 'AbortError' ? 'Request web quá thời gian chờ.' : (err.message || 'Không thể kết nối web tổng.') } };
  } finally {
    clearTimeout(timer);
  }
}

function clampClientNumber(value, fallback, min, max) {
  const number = Number(value);
  if(!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeClientBotUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if(!['http:','https:'].includes(url.protocol)) return '';
    url.hash='';
    url.search='';
    return url.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function setDetailSettingsDisabled(disabled) {
  document.querySelectorAll('#detailSettingEcoMode, #detailSettingAutoTotem, #detailSettingAntiHungry, #detailSettingAutoReconnect, #detailSettingAntiAfkKick, #saveDetailSettingsButton')
    .forEach(el => { el.disabled = !!disabled; });
}

function setDetailAutoChatDisabled(disabled) {
  document.querySelectorAll('#detailAutoChatPanel button, #detailAutoChatPanel input, #detailAutoChatPanel select, #detailAutoChatPanel textarea')
    .forEach(el => { el.disabled = !!disabled; });
}

function setDetailBotScheduleDisabled(disabled) {
  document.querySelectorAll('#detailBotSchedulePanel button, #detailBotSchedulePanel input, #detailBotSchedulePanel select, #detailBotSchedulePanel textarea')
    .forEach(el => { el.disabled = !!disabled; });
}

document.addEventListener('click', event => {
  closeUserProfileDropdown();
  const copyIpBtn = event.target?.closest?.('.btn-copy-bot-ip');
  if (copyIpBtn && copyIpBtn.dataset.ip && copyIpBtn.dataset.ip !== '--') {
    event.stopPropagation();
    copyToClipboard(copyIpBtn.dataset.ip, 'IP Bot');
  }
});
document.addEventListener('input',event=>{
  if(event.target?.closest?.('#detailAutoChatSchedules')){
    detailAutoChatDirty=true;
    return;
  }
  if(event.target?.id==='detailBotScheduleEnabled' || event.target?.closest?.('#detailBotSchedules')){
    detailBotScheduleDirty=true;
    return;
  }
  if(['detailSettingEcoMode','detailSettingAutoTotem','detailSettingAntiHungry','detailSettingAutoReconnect','detailSettingAntiAfkKick'].includes(event.target?.id)){
    detailSettingsDirty=true;
  }
});
document.addEventListener('change',event=>{
  if(event.target?.closest?.('#detailAutoChatSchedules')){
    detailAutoChatDirty=true;
    return;
  }
  if(event.target?.id==='detailBotScheduleEnabled' || event.target?.closest?.('#detailBotSchedules')){
    detailBotScheduleDirty=true;
    return;
  }
  if(['detailSettingEcoMode','detailSettingAutoTotem','detailSettingAntiHungry','detailSettingAutoReconnect','detailSettingAntiAfkKick'].includes(event.target?.id)){
    detailSettingsDirty=true;
  }
});

function statusMeta(status, available=true, manuallyStopped=false) {
  if (!available) return ['red','UNREACHABLE'];
  if (manuallyStopped && (status === 'offline' || status === 'kicked' || status === 'stopped')) {
    return ['gray', 'STOPPED'];
  }
  const map={
    online:['green','ONLINE'],
    afk:['green','AFK'],
    connecting:['yellow','CONNECTING'],
    authenticating:['blue','AUTH'],
    entering:['blue','ENTERING SERVER'],
    kicked:['red','KICKED'],
    offline:['red','OFFLINE']
  };
  return map[status] || ['red','OFFLINE'];
}

function showToast(message) {
  const toast=document.getElementById('toast');
  toast.textContent=message||'';
  toast.style.display='block';
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>{toast.style.display='none'},2500);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function botCardHtml(bot) {
  if (!bot) return '';
  const [color, label] = statusMeta(bot.status, bot.available, !!bot.manuallyStopped);
  const username = bot.username || 'Chưa đặt';
  const pingVal = Number(bot.ping);
  const ping = Number.isFinite(pingVal) ? pingVal + ' ms' : '--';
  const tpsVal = Number(bot.tps ?? bot.serverTps ?? 20.0);
  const tpsColor = tpsVal >= 18.5 ? 'var(--green)' : (tpsVal >= 14.0 ? 'var(--yellow)' : 'var(--red)');
  const pos = bot.position && Number.isFinite(Number(bot.position.x)) && Number.isFinite(Number(bot.position.y)) && Number.isFinite(Number(bot.position.z))
    ? (Math.round(Number(bot.position.x)) + ' ' + Math.round(Number(bot.position.y)) + ' ' + Math.round(Number(bot.position.z)))
    : '-';
  const id = Number(bot.id);
  const totems = Number(bot.totemCount || 0);
  const isEco = bot.settings?.ecoMode !== false && bot.ecoMode !== false;
  const hw = bot.hostHardware;
  const botRamMb = Number(hw?.botRssMb || bot.ramRss || bot.rssMb || bot.memory?.rssMb || 0);
  const botHeapMb = Number(hw?.botHeapMb || bot.ramHeap || bot.heapMb || bot.memory?.heapMb || 0);

  // Host RAM
  const hostRamUsedMb = hw ? Number(hw.ramUsedMb) : botRamMb;
  const hostRamTotalMb = hw ? Number(hw.ramTotalMb) : (isEco ? 220 : 380);
  const hostRamPercent = hw ? Number(hw.ramPercent) : (hostRamTotalMb > 0 ? Math.min(100, Math.round((botRamMb / hostRamTotalMb) * 100)) : 0);
  const ramColor = hostRamPercent > 85 ? 'var(--red)' : hostRamPercent > 70 ? 'var(--yellow)' : 'var(--green)';

  // Host CPU & Net
  const hostCpuText = hw ? (hw.cpuPercent + '% / ' + hw.cpuCores + ' Cores') : '--';
  const cpuColor = hw && hw.cpuPercent > 85 ? 'var(--red)' : hw && hw.cpuPercent > 60 ? 'var(--yellow)' : '#38bdf8';
  const netText = hw ? ('↓ ' + hw.netDownKb + ' • ↑ ' + hw.netUpKb + ' KB/s') : '--';

  const pingSpark = generateSparklineSvg(bot.history?.ping, '#38bdf8');
  const ramSpark = generateSparklineSvg(bot.history?.ram, ramColor);
  const isOffline = !bot.available || ['offline', 'kicked', 'error', 'disconnected', 'stopped'].includes(String(bot.status || '').toLowerCase());
  const isAdmin = !currentUser || currentUser.role === 'admin';
  const sec = Number(bot.uptimeSeconds || 0);
  const uptimeText = sec > 0 ? (Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm') : '--';

  // HP Calculation & Bar
  const hpVal = Number.isFinite(Number(bot.health)) ? Number(bot.health) : null;
  const hpText = hpVal !== null ? (Math.round(hpVal) + ' / 20 HP') : '--';
  const hpPercent = hpVal !== null ? Math.max(0, Math.min(100, Math.round((hpVal / 20) * 100))) : 0;
  const hpColor = hpVal === null ? '#94a3b8' : (hpVal <= 6 ? 'var(--red)' : hpVal <= 14 ? 'var(--yellow)' : 'var(--green)');

  const kickWarning = bot.lastKickReason ? ('<div class="bot-kick-notice">⚠️ <strong>Bị kick:</strong> ' + escapeHtml(bot.lastKickReason) + '</div>') : '';
  const ipDisplay = bot.ipAddress || (bot.url ? (()=>{ try { const u = new URL(bot.url); return (u.hostname && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') ? u.hostname : ''; } catch(_) { return ''; } })() : '') || '--';

  // Ownership badge
  let ownerBadgeHtml = '';
  if (bot.assignedUsername) {
    ownerBadgeHtml = '<span class="bot-owner-pill rented" title="Bot được thuê bởi ' + escapeHtml(bot.assignedUsername) + '">' +
      '👤 Thuộc: <strong>' + escapeHtml(bot.assignedUsername) + '</strong>' +
      (bot.assignedPlan ? ' <small>(' + escapeHtml(bot.assignedPlan) + ')</small>' : '') +
      '</span>';
  } else {
    ownerBadgeHtml = '<span class="bot-owner-pill free" title="Bot đang trống, sẵn sàng cho thuê">' +
      '✨ Sẵn Sàng Cho Thuê' +
      '</span>';
  }

  const isAFK = bot.status === 'afk';
  const isOnlineWaiting = ['online', 'connecting', 'authenticating', 'entering'].includes(String(bot.status || '').toLowerCase());
  const statusGlowClass = isAFK ? 'status-afk' : (isOnlineWaiting ? 'status-waiting' : 'status-offline');
  const displayNum = bot.displayIndex !== undefined ? bot.displayIndex : id;
  const idStr = String(displayNum).padStart(2, '0');

  const botTags = Array.isArray(bot.tags) ? bot.tags : [];
  const tagsHtml = botTags.length > 0
    ? ('<div class="bot-tags-wrap" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">' +
        botTags.map(t => '<span class="bot-tag-chip" onclick="event.stopPropagation(); filterByTag(\'' + escapeHtml(t) + '\')" title="Lọc bot theo tag #' + escapeHtml(t) + '" style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.18);color:#c084fc;border:1px solid rgba(168,85,247,0.3);cursor:pointer;font-weight:600;">#' + escapeHtml(t) + '</span>').join('') +
        (isAdmin ? '<button type="button" class="bot-mini-btn" onclick="event.stopPropagation(); editBotTags(' + id + ')" title="Chỉnh sửa tags" style="padding:1px 5px;font-size:10px;">🏷️</button>' : '') +
      '</div>')
    : (isAdmin ? '<button type="button" class="bot-mini-btn" onclick="event.stopPropagation(); editBotTags(' + id + ')" title="Gắn tag phân loại bot (+tag)" style="padding:1px 5px;font-size:10px;opacity:0.6;">＋tag</button>' : '');

  return '<div class="bot-card ' + statusGlowClass + '" data-bot-id="' + id + '" draggable="' + (isAdmin ? 'true' : 'false') + '" ' +
    (isAdmin ? 'ondragstart="startBotDrag(event,' + id + ')" ondragover="allowBotDrop(event)" ondrop="dropBot(event,' + id + ')"' : '') +
    ' onclick="openBot(' + id + ')">' +

    '<div class="bot-card-topbar">' +
      '<div class="bot-card-title-group">' +
        '<span class="bot-id-chip">#' + idStr + '</span>' +
        '<h2 class="bot-card-name" title="' + escapeHtml(bot.label) + '">' + escapeHtml(bot.label) + '</h2>' +
        '<button type="button" class="bot-mini-btn btn-rename-alias" data-bot-id="' + id + '" data-bot-label="' + escapeHtml(bot.label) + '" onclick="event.stopPropagation(); handleRenameClick(this)" title="Đổi tên / Ghi chú hiển thị">✏</button>' +
      '</div>' +
      (isAdmin ?
        '<div class="bot-card-admin-actions" onclick="event.stopPropagation()">' +
          '<button type="button" class="bot-mini-btn" onclick="editBot(event,' + id + ')" title="Cấu hình bot">⚙ Sửa</button>' +
          '<button type="button" class="bot-mini-btn danger" onclick="deleteBot(event,' + id + ')" title="Xóa bot khỏi hệ thống">🗑 Xóa</button>' +
        '</div>' : '') +
    '</div>' +

    '<div class="bot-status-strip">' +
      '<div class="bot-status-pill ' + color + '">' +
        '<span class="pulse-status-dot ' + color + '"></span>' +
        '<span>' + escapeHtml(label) + '</span>' +
      '</div>' +
      (isEco ? '<span class="eco-badge-glow" title="Eco Mode: Tiết kiệm 80% CPU & Watchdog khóa RAM < 220MB">🌱 ECO</span>' : '') +
      '<div class="bot-owner-wrap">' + ownerBadgeHtml + '</div>' +
      tagsHtml +
    '</div>' +

    '<div class="bot-ingame-row">' +
      '<div class="bot-ingame-user" title="Nhân vật Minecraft ingame">' +
        '<span class="ingame-icon">🎮</span>' +
        '<span class="ingame-name">' + escapeHtml(username) + '</span>' +
      '</div>' +
      '<div class="bot-ip-pill" title="IP Bot: ' + escapeHtml(ipDisplay) + '">' +
        '<span>🌐 ' + escapeHtml(ipDisplay) + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="bot-vitals-matrix">' +
      '<div class="vital-card hp-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">❤️ MÁU (HP)</span>' +
          '<span class="vital-val" style="color:' + hpColor + ';">' + hpText + '</span>' +
        '</div>' +
        '<div class="hp-bar-track">' +
          '<div class="hp-bar-fill" style="width:' + hpPercent + '%;background:' + hpColor + ';"></div>' +
        '</div>' +
      '</div>' +

      '<div class="vital-card totem-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">🪙 TOTEM</span>' +
          '<span class="vital-val" style="color:var(--gold);">' + totems + ' Cái</span>' +
        '</div>' +
        (totems === 0 ?
          '<div class="totem-warning-badge">⚠️ Hết Totem!</div>' :
          '<div class="totem-ok-badge">🛡️ An Toàn</div>') +
      '</div>' +

      '<div class="vital-card ping-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">📶 PING / TPS ⚡</span>' +
          '<span class="vital-val" style="color:#38bdf8;">' + escapeHtml(ping) + ' <small style="color:' + tpsColor + ';font-weight:700;">(' + tpsVal.toFixed(1) + ' TPS)</small></span>' +
        '</div>' +
        '<div class="sparkline-container">' + pingSpark + '</div>' +
      '</div>' +

      '<div class="vital-card uptime-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">⏱ UPTIME</span>' +
          '<span class="vital-val" style="color:var(--green);">' + uptimeText + '</span>' +
        '</div>' +
        '<div class="vital-sub-info">Tọa độ: ' + escapeHtml(pos) + '</div>' +
      '</div>' +
    '</div>' +

    (hostRamTotalMb > 0 ?
      '<div class="bot-ram-meter-box">' +
        '<div class="bot-ram-meter-labels" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;font-size:11px;">' +
          '<span>🧠 RAM: <strong style="color:' + ramColor + ';">' + botRamMb + ' MB</strong>' + (botHeapMb > 0 ? ' <small style="color:var(--muted);">(Heap: ' + botHeapMb + 'MB)</small>' : '') + '</span>' +
          '<span>⚡ CPU: <strong style="color:' + cpuColor + ';">' + (hw ? hw.cpuPercent + '%' : '--') + '</strong></span>' +
          '<span>🌐 Net: <strong style="color:#a78bfa;">' + netText + '</strong></span>' +
        '</div>' +
        '<div class="ram-meter-track" style="margin-top:6px;">' +
          '<div class="ram-meter-bar-fill" style="width:' + Math.max(4, Math.min(100, hostRamPercent)) + '%;background:' + ramColor + ';" title="Host RAM: ' + hostRamUsedMb + '/' + hostRamTotalMb + ' MB (' + hostRamPercent + '%)"></div>' +
        '</div>' +
      '</div>' : '') +

    '<div class="card-quick-actions" onclick="event.stopPropagation()">' +
      '<button type="button" class="small card-btn" onclick="quickBotAction(event,' + id + ',\'restart\')">⚡ Restart</button>' +
      (isOffline ?
        '<button type="button" class="small card-btn primary" onclick="quickBotAction(event,' + id + ',\'start\')">▶ Bật</button>' :
        '<button type="button" class="small card-btn danger" onclick="quickBotAction(event,' + id + ',\'stop\')">⏹ Dừng</button>'
      ) +
      '<button type="button" class="small card-btn detail-link-btn" onclick="openBot(' + id + ')">⚙ Chi Tiết →</button>' +
    '</div>' +

  '</div>';
}

function startBotDrag(event,id){
  draggedBotId=Number(id);
  try{event.dataTransfer.setData('text/plain',String(id));event.dataTransfer.effectAllowed='move';}catch(_){}
  event.currentTarget.classList.add('dragging');
}
function allowBotDrop(event){event.preventDefault();}
async function dropBot(event,targetId){
  event.preventDefault();
  const sourceId=Number((()=>{try{return event.dataTransfer.getData('text/plain')||draggedBotId}catch(_){return draggedBotId}})());
  draggedBotId=null;
  if(!Number.isInteger(sourceId)||sourceId===Number(targetId))return;
  const ids=bots.map(x=>Number(x.id));
  const from=ids.indexOf(sourceId);const to=ids.indexOf(Number(targetId));
  if(from<0||to<0)return;
  const [item]=ids.splice(from,1);ids.splice(to,0,item);
  try{
    const result=await requestJson('/api/manager/bots/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
    const data=result.data||{};
    if(!result.ok)throw new Error(data.error||'Không thể sắp xếp bot.');
    await refreshHome();
  }catch(err){showToast(err.message||'Không thể sắp xếp bot.');}
}

function renderEditBotTagPreviews(raw) {
  const box = document.getElementById('editBotTagsPreview');
  if (!box) return;
  const tags = String(raw || '').split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  if (!tags.length) {
    box.innerHTML = '<span style="font-size:11px;color:var(--muted);font-style:italic;">Chưa có tag nào</span>';
    return;
  }
  box.innerHTML = tags.map(t => '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-weight:600;">#' + escapeHtml(t) + '</span>').join('');
}
window.renderEditBotTagPreviews = renderEditBotTagPreviews;

function editBot(event,id){
  if(event)event.stopPropagation();
  const bot=bots.find(x=>Number(x.id)===Number(id));
  if(!bot)return;
  document.getElementById('editBotId').value=String(id);
  document.getElementById('editBotUrl').value=bot.url||'';
  document.getElementById('editBotLabel').value=bot.label||'';
  const tagsVal = Array.isArray(bot.tags) ? bot.tags.join(', ') : '';
  const tagsInput = document.getElementById('editBotTags');
  if (tagsInput) tagsInput.value = tagsVal;
  renderEditBotTagPreviews(tagsVal);
  document.getElementById('editBotModal').classList.remove('hidden');
}
function closeEditBotModal(){document.getElementById('editBotModal').classList.add('hidden');}
async function saveEditBot(){
  const id=Number(document.getElementById('editBotId').value);
  const url=document.getElementById('editBotUrl').value.trim();
  const label=document.getElementById('editBotLabel').value.trim();
  const rawTags=document.getElementById('editBotTags')?.value || '';
  const tags = rawTags.split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  if(!url){showToast('URL không được trống.');return;}
  try{
    const result=await requestJson('/api/manager/bot/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,label,tags})});
    const data=result.data||{};
    if(!result.ok)throw new Error(data.error||'Không thể sửa bot.');
    closeEditBotModal();
    showToast(data.message||'Đã lưu thông tin bot.');
    const found = bots.find(b => Number(b.id) === id);
    if (found && data.bot) {
      if (data.bot.label) found.label = data.bot.label;
      if (data.bot.tags) found.tags = data.bot.tags;
    }
    updateTagPills();
    filterBots();
    await refreshHome();
  }catch(err){showToast(err.message||'Không thể sửa bot.');}
}

async function openAdminModal(){
  document.getElementById('adminModal').classList.remove('hidden');
  await loadAdminCredentials();
}
function closeAdminModal(){document.getElementById('adminModal').classList.add('hidden');}
async function loadAdminCredentials(){
  const box = document.getElementById('adminCredentialList');
  box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang tải thông tin tài khoản bot...</div>';
  try{
    const result=await requestJson('/api/manager/admin/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({}),timeoutMs:15000});
    const data=result.data||{};
    if(!result.ok)throw new Error(data.error||'Không thể mở thông tin bot.');
    box.innerHTML = '';
    if (!data.bots || data.bots.length === 0) {
      box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">Chưa có bot nào trong danh sách.</div>';
      return;
    }
    (data.bots || []).forEach(bot => {
      const card = document.createElement('div');
      card.className = 'credential-card';
      const title = document.createElement('strong');
      title.textContent = bot.label || ('Bot ' + bot.id);
      card.appendChild(title);
      if (bot.ok) {
        const rowUser = document.createElement('div');
        rowUser.className = 'credential-row';
        const valUser = document.createElement('div');
        valUser.className = 'credential-value';
        valUser.textContent = bot.username || '(Chưa đặt)';
        const btnUser = document.createElement('button');
        btnUser.className = 'small';
        btnUser.type = 'button';
        btnUser.textContent = 'Copy User';
        btnUser.addEventListener('click', () => copyText(bot.username || ''));
        rowUser.appendChild(valUser);
        rowUser.appendChild(btnUser);
        card.appendChild(rowUser);

        const rowPass = document.createElement('div');
        rowPass.className = 'credential-row';
        const valPass = document.createElement('div');
        valPass.className = 'credential-value';
        valPass.textContent = '••••••••';
        valPass.setAttribute('data-full-pass', bot.password || '');
        const btnToggle = document.createElement('button');
        btnToggle.className = 'small';
        btnToggle.type = 'button';
        btnToggle.textContent = '👁 Hiện';
        btnToggle.addEventListener('click', function() {
          if (valPass.textContent === '••••••••') {
            valPass.textContent = valPass.getAttribute('data-full-pass') || '(Trống)';
            btnToggle.textContent = '🙈 Ẩn';
          } else {
            valPass.textContent = '••••••••';
            btnToggle.textContent = '👁 Hiện';
          }
        });
        const btnPass = document.createElement('button');
        btnPass.className = 'small';
        btnPass.type = 'button';
        btnPass.textContent = 'Copy Pass';
        btnPass.addEventListener('click', () => copyText(bot.password || ''));
        rowPass.appendChild(valPass);
        rowPass.appendChild(btnToggle);
        rowPass.appendChild(btnPass);
        card.appendChild(rowPass);
      } else {
        const note = document.createElement('div');
        note.className = 'note';
        note.style.color = 'var(--red)';
        note.textContent = '⚠️ ' + (bot.error || 'Lỗi đọc bot.');
        card.appendChild(note);
      }
      box.appendChild(card);
    });
  }catch(err){box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);">⚠️ ' + escapeHtml(err.message) + '</div>';}
}

async function copyText(value){
  try{await navigator.clipboard.writeText(String(value??''));showToast('Đã copy.');}
  catch(_){showToast('Không thể copy trên trình duyệt này.');}
}

// ============================================================================
// HỆ THỐNG XÁC THỰC & PHÂN QUYỀN ĐA NGƯỜI DÙNG (CLIENT RBAC)
// ============================================================================

function showLoginGate() {
  document.getElementById('loginGate')?.classList.remove('hidden');
}

function hideLoginGate() {
  document.getElementById('loginGate')?.classList.add('hidden');
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁';
  }
}

async function handleLoginSubmit(event) {
  if (event) event.preventDefault();
  const uInput = document.getElementById('loginUsername');
  const pInput = document.getElementById('loginPassword');
  const alertEl = document.getElementById('loginAlert');
  const btn = document.getElementById('loginSubmitBtn');

  const username = String(uInput?.value || '').trim();
  const password = pInput?.value ?? '';

  if (!username || !password) {
    if (alertEl) {
      alertEl.textContent = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.';
      alertEl.className = 'login-alert error';
    }
    return;
  }

  if (alertEl) alertEl.className = 'login-alert hidden';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Đang xác thực...';
  }

  const licenseKey = String(document.getElementById('loginLicenseKey')?.value || '').trim().toUpperCase();
  const rememberMe = !!document.getElementById('loginRememberMe')?.checked;

  try {
    const res = await requestJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, licenseKey, rememberMe })
    });

    if (!res.ok) {
      throw new Error(res.data?.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    const data = res.data || {};
    currentUser = data.user || null;
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }

    if (alertEl) {
      alertEl.textContent = '✅ ' + (data.message || 'Đăng nhập thành công!');
      alertEl.className = 'login-alert success';
    }

    setTimeout(async () => {
      hideLoginGate();
      applyUserRoleUI();
      await refreshHome();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
    }, 350);

  } catch (err) {
    if (alertEl) {
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.className = 'login-alert error';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 ĐĂNG NHẬP VÀO HỆ THỐNG';
    }
  }
}

async function logout() {
  invalidateDetailReads();
  if (typeof managerPollTimerId !== 'undefined' && managerPollTimerId) {
    clearTimeout(managerPollTimerId);
    managerPollTimerId = null;
  }
  try {
    localStorage.removeItem('kingmc_session');
    sessionStorage.removeItem('kingmc_session');
    document.cookie = 'kingmc_mgr_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; SameSite=Lax';
  } catch (_) {}

  try {
    await requestJson('/api/auth/logout', { method: 'POST', timeoutMs: 3000 });
  } catch (_) {}

  currentUser = null;
  bots = [];
  selectedBotId = null;
  detailBot = null;

  const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '';
  const dLog = document.getElementById('detailEventLogs'); if (dLog) dLog.innerHTML = '';
  const uInput = document.getElementById('detailUsernameInput'); if (uInput) uInput.value = '';
  const pInput = document.getElementById('detailPasswordInput'); if (pInput) pInput.value = '';

  document.getElementById('detailPage')?.classList.add('hidden');
  document.getElementById('homePage')?.classList.remove('hidden');

  applyUserRoleUI();
  renderHome();
  showLoginGate();

  window.location.replace('/');
}

function applyUserRoleUI() {
  const appEl = document.getElementById('mainApp');
  const badgeEl = document.getElementById('userRoleBadge');
  const detailBadgeEl = document.getElementById('detailUserRoleBadge');
  const globalBadgeEl = document.getElementById('globalUserRoleBadge');
  const badges = [badgeEl, detailBadgeEl, globalBadgeEl].filter(Boolean);
  const lockedOverlay = document.getElementById('accountLockedOverlay');
  const expiredOverlay = document.getElementById('accountExpiredOverlay');

  if (!currentUser) {
    appEl?.classList.add('user-mode');
    appEl?.classList.remove('account-restricted-blur');
    lockedOverlay?.classList.add('hidden');
    expiredOverlay?.classList.add('hidden');
    badges.forEach(b => {
      b.innerHTML = '🔒 <strong>CHƯA ĐĂNG NHẬP</strong>';
      b.style.background = 'rgba(148,163,184,0.15)';
      b.style.color = '#94a3b8';
      b.style.borderColor = 'rgba(148,163,184,0.3)';
    });
    ['userProfileName', 'detailUserProfileName', 'globalUserProfileName'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = 'Đăng nhập';
    });
    ['userAvatarBadge', 'detailUserAvatarBadge', 'globalUserAvatarBadge', 'dropdownAvatar', 'detailDropdownAvatar', 'globalDropdownAvatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '🔑';
    });
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'none'; });
    return;
  }

  const username = currentUser.username || (currentUser.role === 'admin' ? 'admin' : 'User');
  const isAdmin = currentUser.role === 'admin';
  const avatar = isAdmin ? '👑' : '👤';
  const roleText = isAdmin ? '👑 Quản trị viên (Toàn quyền)' : '👤 Người vận hành (' + (Array.isArray(currentUser.assignedBotIds) ? currentUser.assignedBotIds.length : 0) + ' Bot)';

  // Kiểm tra hạn thuê và tạm khóa cho tài khoản User
  if (!isAdmin) {
    const isLocked = currentUser.status === 'disabled';
    const isExpired = currentUser.status === 'expired' || (currentUser.expiresAt && Date.now() > Date.parse(currentUser.expiresAt));

    if (isLocked) {
      appEl?.classList.add('account-restricted-blur');
      if (lockedOverlay) {
        lockedOverlay.classList.remove('hidden');
        const reasonEl = document.getElementById('lockedReasonMessage');
        if (reasonEl) reasonEl.textContent = currentUser.lockReason || 'Tài khoản của bạn đang bị tạm khóa. Vui lòng liên hệ Admin để được hỗ trợ.';
      }
      if (expiredOverlay) expiredOverlay.classList.add('hidden');
    } else if (isExpired) {
      appEl?.classList.add('account-restricted-blur');
      if (expiredOverlay) expiredOverlay.classList.remove('hidden');
      if (lockedOverlay) lockedOverlay.classList.add('hidden');
    } else {
      appEl?.classList.remove('account-restricted-blur');
      if (lockedOverlay) lockedOverlay.classList.add('hidden');
      if (expiredOverlay) expiredOverlay.classList.add('hidden');
    }
  } else {
    appEl?.classList.remove('account-restricted-blur');
    if (lockedOverlay) lockedOverlay.classList.add('hidden');
    if (expiredOverlay) expiredOverlay.classList.add('hidden');
  }

  if (isAdmin) {
    appEl?.classList.remove('user-mode');
    badges.forEach(b => {
      b.innerHTML = '👑 <strong>ADMIN (Toàn quyền)</strong>';
      b.style.background = 'rgba(234,179,8,0.2)';
      b.style.color = '#eab308';
      b.style.borderColor = 'rgba(234,179,8,0.4)';
    });
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; });
  } else {
    appEl?.classList.add('user-mode');
    badges.forEach(b => {
      b.innerHTML = '👤 <strong>USER: ' + escapeHtml(currentUser.username) + '</strong>';
      b.style.background = 'rgba(56,189,248,0.2)';
      b.style.color = '#38bdf8';
      b.style.borderColor = 'rgba(56,189,248,0.4)';
    });
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'none'; });
  }

  // Cập nhật Profile Buttons & Dropdowns góc trên bên phải
  ['userProfileName', 'detailUserProfileName', 'globalUserProfileName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = username;
  });
  ['userAvatarBadge', 'detailUserAvatarBadge', 'globalUserAvatarBadge', 'dropdownAvatar', 'detailDropdownAvatar', 'globalDropdownAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = avatar;
  });
  ['dropdownUsername', 'detailDropdownUsername', 'globalDropdownUsername'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = username;
  });
  ['dropdownRole', 'detailDropdownRole', 'globalDropdownRole'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = roleText;
  });

  const expEl = document.getElementById('globalDropdownExpires');
  if (expEl) {
    if (isAdmin) {
      expEl.style.display = 'none';
    } else {
      expEl.style.display = 'block';
      if (!currentUser.expiresAt) {
        expEl.textContent = '👑 VIP Vĩnh Viễn';
        expEl.style.color = '#eab308';
      } else {
        const expDate = new Date(currentUser.expiresAt);
        const isExp = Date.now() > expDate.getTime();
        expEl.textContent = (isExp ? '⛔ Đã hết hạn: ' : '⏳ Hạn dùng: ') + expDate.toLocaleDateString('vi-VN');
        expEl.style.color = isExp ? '#ef4444' : '#38bdf8';
      }
    }
  }

  // Ẩn nút nhập mã key đối với tài khoản VIP Vĩnh Viễn
  const isPermanentUser = !isAdmin && !currentUser.expiresAt;
  const renewBtnTop = document.getElementById('btnUserRenewKey');
  const renewBtnDropdown = document.getElementById('globalRenewKeyBtn');
  if (renewBtnTop) renewBtnTop.style.display = (isAdmin || isPermanentUser) ? 'none' : '';
  if (renewBtnDropdown) renewBtnDropdown.style.display = (isAdmin || isPermanentUser) ? 'none' : '';
}

function toggleUserProfileDropdown(event) {
  if (typeof toggleGlobalProfileDropdown === 'function') {
    return toggleGlobalProfileDropdown(event);
  }
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('globalUserProfileDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

function closeUserProfileDropdown() {
  document.getElementById('userProfileDropdown')?.classList.add('hidden');
  document.getElementById('detailUserProfileDropdown')?.classList.add('hidden');
  document.getElementById('globalUserProfileDropdown')?.classList.add('hidden');
}

function openChangePasswordModal() {
  closeUserProfileDropdown();
  const modal = document.getElementById('changePasswordModal');
  const uInput = document.getElementById('changePassUsernameDisplay');
  const oldInput = document.getElementById('changePassOld');
  const newInput = document.getElementById('changePassNew');
  const confirmInput = document.getElementById('changePassConfirm');
  const alertEl = document.getElementById('changePassAlert');

  if (uInput) uInput.value = currentUser ? currentUser.username : '';
  if (oldInput) oldInput.value = '';
  if (newInput) newInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (alertEl) { alertEl.className = 'login-alert hidden'; alertEl.textContent = ''; }

  modal?.classList.remove('hidden');
  setTimeout(() => oldInput?.focus(), 50);
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal')?.classList.add('hidden');
}

function openChangelogModal() {
  closeUserProfileDropdown();
  document.getElementById('changelogModal')?.classList.remove('hidden');
}

function closeChangelogModal() {
  document.getElementById('changelogModal')?.classList.add('hidden');
}

let cachedAuditLogs = [];
let auditLogCurrentPage = 1;
let auditLogTotalPages = 1;
let auditLogTotalRecords = 0;
let auditFilterDebounceTimer = null;
let auditLogType = 'SYSTEM';

function switchAuditLogType(logType) {
  const requestedType = String(logType || '').trim().toUpperCase();
  auditLogType = requestedType === 'SYSTEM' || requestedType === 'BOT'
    ? requestedType
    : '';

  const tabs = [
    ['auditTabSystem', 'SYSTEM'],
    ['auditTabBot', 'BOT'],
    ['auditTabAll', '']
  ];
  for (const [id, type] of tabs) {
    document.getElementById(id)?.classList.toggle('active', auditLogType === type);
  }

  refreshAuditLogs(1);
}

async function openAuditLogModal() {
  closeUserProfileDropdown();
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền xem Audit Logs.');
    return;
  }
  navigateTo('audit');
}

function closeAuditLogModal() {
  navigateTo('dashboard');
}

function debounceAuditFilter() {
  if (auditFilterDebounceTimer) clearTimeout(auditFilterDebounceTimer);
  auditFilterDebounceTimer = setTimeout(() => {
    refreshAuditLogs(1);
  }, 280);
}

async function refreshAuditLogs(page) {
  if (!page || page < 1) page = 1;
  const tbody = document.getElementById('auditLogTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">Đang tải nhật ký hoạt động...</td></tr>';

  const q = encodeURIComponent((document.getElementById('auditLogSearchInput')?.value || '').trim());
  const category = encodeURIComponent((document.getElementById('auditLogCategoryFilter')?.value || '').trim());
  const status = encodeURIComponent((document.getElementById('auditLogStatusFilter')?.value || '').trim());
  const logType = encodeURIComponent(auditLogType);
  const limit = Math.max(10, Math.min(200, Number(document.getElementById('auditLogLimitSelect')?.value || 50)));

  try {
    const url = '/api/manager/audit-logs?page=' + page + '&limit=' + limit + '&q=' + q + '&category=' + category + '&status=' + status + '&logType=' + logType;
    const res = await requestJson(url);
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải nhật ký.');

    cachedAuditLogs = Array.isArray(res.data?.logs) ? res.data.logs : [];
    auditLogCurrentPage = Number(res.data?.page || 1);
    auditLogTotalPages = Number(res.data?.totalPages || 1);
    auditLogTotalRecords = Number(res.data?.total || cachedAuditLogs.length);

    renderAuditLogs(cachedAuditLogs, auditLogTotalRecords, auditLogCurrentPage, auditLogTotalPages, limit);
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
  }
}

function navigateAuditPage(delta) {
  const targetPage = auditLogCurrentPage + delta;
  if (targetPage >= 1 && targetPage <= auditLogTotalPages) {
    refreshAuditLogs(targetPage);
  }
}

function renderAuditLogs(items, total, page, totalPages, limit) {
  const tbody = document.getElementById('auditLogTableBody');
  if (!tbody) return;

  const infoEl = document.getElementById('auditLogPaginationInfo');
  const indEl = document.getElementById('auditLogPageIndicator');
  const prevBtn = document.getElementById('auditLogPrevBtn');
  const nextBtn = document.getElementById('auditLogNextBtn');

  const startRecord = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRecord = Math.min(total, page * limit);
  if (infoEl) infoEl.textContent = 'Hiển thị ' + startRecord + ' - ' + endRecord + ' trong tổng số ' + total + ' bản ghi';
  if (indEl) indEl.textContent = 'Trang ' + page + ' / ' + totalPages;
  if (prevBtn) prevBtn.disabled = (page <= 1);
  if (nextBtn) nextBtn.disabled = (page >= totalPages);

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Không tìm thấy bản ghi nhật ký nào phù hợp với bộ lọc.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    const d = item.timestamp ? new Date(item.timestamp) : null;
    const timeDisplay = d ? d.toLocaleTimeString('vi-VN', { hour12: false }) + ' ' + d.toLocaleDateString('vi-VN') : '-';
    const relativeTime = d ? formatRelativeTime(d) : '';

    const statusMap = {
      'SUCCESS': { text: '🟢 THÀNH CÔNG', color: 'var(--green)', bg: 'rgba(34,197,94,0.14)' },
      'FAILED': { text: '🔴 THẤT BẠI', color: 'var(--red)', bg: 'rgba(239,68,68,0.14)' },
      'BLOCKED': { text: '🟠 BỊ CHẶN', color: 'var(--yellow)', bg: 'rgba(234,179,8,0.14)' },
      'PARTIAL': { text: '🟡 MỘT PHẦN', color: 'var(--cyan)', bg: 'rgba(56,189,248,0.14)' }
    };
    const st = statusMap[item.status] || { text: item.status || 'UNKNOWN', color: 'var(--muted)', bg: 'rgba(255,255,255,0.06)' };

    const roleMap = {
      'admin': '<span style="color:var(--cyan);font-weight:700;">👑 Quản trị viên</span>',
      'user': '<span style="color:var(--green);font-weight:700;">👤 Khách thuê</span>',
      'system': '<span style="color:#a78bfa;font-weight:700;">🤖 Hệ thống tự động</span>'
    };
    const actorRole = roleMap[item.actor?.role] || ('<span style="color:var(--muted);">' + escapeHtml(item.actor?.role || 'Guest') + '</span>');
    const actorUser = item.actor?.username || 'system';
    const actorIp = item.actor?.ip || '127.0.0.1';

    let targetText = '-';
    if (item.target) {
      if (typeof item.target === 'object') {
        if (item.target.label) targetText = '🤖 ' + item.target.label + ' (#' + (item.target.botId || '') + ')';
        else if (item.target.username) targetText = '👤 ' + item.target.username;
        else if (item.target.key) targetText = '🔑 ' + item.target.key;
        else if (item.target.botId !== undefined) targetText = '🤖 Bot #' + item.target.botId;
        else targetText = JSON.stringify(item.target);
      } else {
        targetText = String(item.target);
      }
    }

    let detailsText = item.details || '-';
    if (typeof detailsText === 'object') detailsText = JSON.stringify(detailsText);

    const catBadgeStyle = 'display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:0.5px;background:rgba(255,255,255,0.08);margin-right:6px;border:1px solid rgba(255,255,255,0.12);';
    const cat = item.category || 'SYSTEM';
    const actionLabel = item.actionLabel || item.action || 'UNKNOWN';

    return '<tr>' +
      '<td style="white-space:nowrap;font-family:monospace;font-size:11px;" title="' + escapeHtml(relativeTime) + '">' +
        '<div>' + escapeHtml(timeDisplay) + '</div>' +
        '<div style="font-size:10px;color:var(--muted);">' + escapeHtml(relativeTime) + '</div>' +
      '</td>' +
      '<td>' +
        '<div>' + actorRole + '</div>' +
        '<div style="font-size:10.5px;color:#cbd5e1;font-weight:600;">' + escapeHtml(actorUser) + '</div>' +
        '<div style="font-size:10px;color:var(--muted);font-family:monospace;">' + escapeHtml(actorIp) + '</div>' +
      '</td>' +
      '<td>' +
        '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">' +
          '<span style="' + catBadgeStyle + '">' + escapeHtml(cat) + '</span>' +
          '<span style="font-weight:600;font-size:11.5px;color:#f8fafc;">' + escapeHtml(actionLabel) + '</span>' +
        '</div>' +
      '</td>' +
      '<td style="font-size:11px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:135px;" title="' + escapeHtml(targetText) + '">' +
        escapeHtml(targetText) +
      '</td>' +
      '<td style="font-size:11.5px;color:#e2e8f0;line-height:1.45;word-break:break-word;">' +
        escapeHtml(detailsText) +
      '</td>' +
      '<td style="text-align:right;white-space:nowrap;">' +
        '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700;color:' + st.color + ';background:' + st.bg + ';border:1px solid ' + st.color + '40;">' + escapeHtml(st.text) + '</span>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function formatRelativeTime(date) {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 5) return 'vừa xong';
  if (diffSec < 60) return diffSec + ' giây trước';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + ' phút trước';
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return diffHours + ' giờ trước';
  const diffDays = Math.floor(diffHours / 24);
  return diffDays + ' ngày trước';
}

function exportAuditLogs(format) {
  if (!format) format = 'csv';
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền xuất nhật ký.');
    return;
  }
  showToast('Đang tải file xuất nhật ký (' + format.toUpperCase() + ')...');
  const a = document.createElement('a');
  a.href = '/api/manager/audit-logs/export?format=' + format;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function clearAllAuditLogs() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền xóa nhật ký.');
    return;
  }
  const confirm = window.confirm('⚠️ CẢNH BÁO QUẢN TRỊ VIÊN:\n\nBạn có chắc chắn muốn XÓA SẠCH toàn bộ lịch sử nhật ký hoạt động không?\n\nHành động này không thể hoàn tác và sự kiện xóa này sẽ được ghi nhận vào nhật ký mới để đối soát.');
  if (!confirm) return;

  try {
    const res = await requestJson('/api/manager/audit-logs/clear', { method: 'POST' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể xóa nhật ký.');
    showToast(res.data?.message || 'Đã xóa toàn bộ nhật ký cũ thành công!');
    await refreshAuditLogs(1);
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function openBackupManagerModal() {
  closeUserProfileDropdown();
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền quản lý Backups.');
    return;
  }
  navigateTo('backup');
}

function closeBackupManagerModal() {
  navigateTo('dashboard');
}

async function refreshBackupList() {
  const tbody = document.getElementById('backupTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);">Đang tải danh sách bản sao lưu...</td></tr>';
  try {
    const res = await requestJson('/api/manager/backups');
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải danh sách backup.');
    const backups = Array.isArray(res.data?.backups) ? res.data.backups : [];
    const countEl = document.getElementById('backupTotalCount');
    if (countEl) countEl.textContent = 'Tổng cộng: ' + backups.length + ' bản sao lưu (Tối đa 30)';

    if (!backups.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);">Chưa có bản sao lưu nào. Hãy bấm "Tạo Sao Lưu Ngay".</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = backups.map(b => {
        const timeStr = b.createdAt ? new Date(b.createdAt).toLocaleTimeString('vi-VN', { hour12: false }) + ' ' + new Date(b.createdAt).toLocaleDateString('vi-VN') : '-';
        const sizeKb = b.sizeBytes ? (b.sizeBytes / 1024).toFixed(1) + ' KB' : '-';
        return '<tr>' +
          '<td style="font-weight:600;font-family:monospace;font-size:11.5px;color:var(--text);">' + escapeHtml(b.filename) + '</td>' +
          '<td style="color:var(--muted);font-size:11px;">' + escapeHtml(timeStr) + '</td>' +
          '<td style="color:var(--muted);font-size:11px;">' + escapeHtml(sizeKb) + '</td>' +
          '<td style="text-align:right;white-space:nowrap;">' +
            '<span style="color:var(--green);font-size:10.5px;font-weight:700;background:rgba(34,197,94,0.15);padding:2px 8px;border-radius:999px;">✓ An toàn</span> ' +
            '<button type="button" class="small danger btn-delete-backup" data-filename="' + escapeHtml(b.filename) + '" style="margin-left:6px;padding:2px 8px;">🗑 Xóa</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      if (!tbody._delegationInit) {
        tbody._delegationInit = true;
        tbody.addEventListener('click', function(e) {
          const btn = e.target.closest('button.btn-delete-backup');
          if (!btn) return;
          const fn = btn.getAttribute('data-filename');
          if (fn) deleteBackupFile(fn);
        });
      }
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--red);padding:20px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
  }
}

async function deleteBackupFile(filename) {
  if (!filename) return;
  if (!confirm('Bạn có chắc chắn muốn xóa vĩnh viễn bản sao lưu "' + filename + '" không?')) return;
  try {
    const res = await requestJson('/api/manager/backups/' + encodeURIComponent(filename), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể xóa bản sao lưu.');
    showToast('✅ ' + (res.data?.message || 'Đã xóa bản sao lưu thành công!'));
    await refreshBackupList();
  } catch (err) {
    showToast('❌ Lỗi: ' + err.message);
  }
}
window.deleteBackupFile = deleteBackupFile;
async function triggerCreateBackup() {
  try {
    showToast('Đang tạo bản sao lưu hệ thống...');
    const res = await requestJson('/api/manager/backups/create', { method: 'POST' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạo backup.');
    showToast('✅ ' + (res.data?.message || 'Đã tạo bản sao lưu thành công!'));
    await refreshBackupList();
  } catch (err) {
    showToast('❌ Lỗi: ' + err.message);
  }
}

async function submitChangePassword(event) {
  if (event) event.preventDefault();
  const oldPassword = document.getElementById('changePassOld')?.value || '';
  const newPassword = document.getElementById('changePassNew')?.value || '';
  const confirmPassword = document.getElementById('changePassConfirm')?.value || '';
  const alertEl = document.getElementById('changePassAlert');
  const btn = document.getElementById('changePassSubmitBtn');

  if (!oldPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập mật khẩu hiện tại.'; }
    return;
  }
  if (!newPassword || newPassword.length < 5) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu mới phải từ 5 ký tự trở lên.'; }
    return;
  }
  if (newPassword !== confirmPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Xác nhận mật khẩu mới không trùng khớp.'; }
    return;
  }
  if (oldPassword === newPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu mới không được trùng với mật khẩu hiện tại.'; }
    return;
  }

  if (alertEl) alertEl.className = 'login-alert hidden';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu...'; }

  try {
    const res = await requestJson('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    if (!res.ok) {
      throw new Error(res.data?.error || 'Không thể đổi mật khẩu.');
    }
    showToast('✅ ' + (res.data?.message || 'Đổi mật khẩu thành công!'));
    closeChangePasswordModal();
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Cập Nhật Mật Khẩu'; }
  }
}

// ============================================================================
// V11.6 COMMERCIAL ENTERPRISE EDITION — ROUTER & USER MANAGEMENT CONTROLLER
// ============================================================================

let currentEditingUserId = null;
let userManagementBotOwnership = {};
let currentUserStatusFilter = 'all';
let userFilterSearchTimer = null;
let pendingBotReassignCallback = null;
let currentNavPage = 'dashboard';

// Điều hướng trang lớn (Full-Page Navigation Router)
function navigateTo(pageName) {
  if (pageName === 'backup') {
    openSupabaseModal();
    pageName = 'dashboard';
  }
  if (pageName === 'users' || pageName === 'audit') {
    if (!currentUser || currentUser.role !== 'admin') {
      pageName = 'dashboard';
    }
  }
  currentNavPage = pageName;
  closeGlobalProfileDropdown();

  const pages = {
    dashboard: document.getElementById('homePage'),
    users: document.getElementById('userManagementPage'),
    audit: document.getElementById('auditPage'),
    backup: document.getElementById('backupPage'),
    detail: document.getElementById('detailPage')
  };

  const navPills = {
    dashboard: document.getElementById('navPillHome'),
    users: document.getElementById('navPillUsers'),
    audit: document.getElementById('navPillAudit'),
    backup: document.getElementById('navPillBackup')
  };

  // Ẩn tất cả trang và tắt active nav pill
  Object.keys(pages).forEach(k => {
    if (pages[k]) pages[k].classList.add('hidden');
    if (navPills[k]) navPills[k]?.classList.remove('active');
  });

  if (pageName !== 'detail') {
    selectedBotId = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('bot');
    url.searchParams.delete('botUrl');
    history.pushState({}, '', url.pathname + url.search);
  }

  const targetPage = pages[pageName] || pages.dashboard;
  if (targetPage) targetPage.classList.remove('hidden');
  if (navPills[pageName]) navPills[pageName]?.classList.add('active');

  // Kích hoạt nạp dữ liệu cho trang đích
  if (pageName === 'dashboard') {
    refreshHome();
  } else if (pageName === 'users') {
    refreshUserManagementPage();
  } else if (pageName === 'audit') {
    refreshAuditLogs(1);
  } else if (pageName === 'backup') {
    refreshBackupList();
  }
}
window.navigateTo = navigateTo;

function toggleGlobalProfileDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('globalUserProfileDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}
window.toggleGlobalProfileDropdown = toggleGlobalProfileDropdown;

function closeGlobalProfileDropdown() {
  document.getElementById('globalUserProfileDropdown')?.classList.add('hidden');
}
window.closeGlobalProfileDropdown = closeGlobalProfileDropdown;

window.addEventListener('click', (e) => {
  if (!e.target.closest('#globalUserProfileBtn') && !e.target.closest('#globalUserProfileDropdown')) {
    closeGlobalProfileDropdown();
  }
});

// ⌨️ ACCESSIBILITY: Đóng modal và menu khi nhấn phím Escape
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeGlobalProfileDropdown();
    const openModals = document.querySelectorAll('.modal:not(.hidden)');
    openModals.forEach(modal => {
      if (modal.id === 'loginGateModal' && !currentUser) return;
      modal.classList.add('hidden');
    });
  }
});

// Chuyển tab Đăng nhập / Đăng ký tại Login Gate
function switchLoginGateTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const btnLogin = document.getElementById('tabBtnLogin');
  const btnReg = document.getElementById('tabBtnRegister');
  const alertEl = document.getElementById('loginAlert');
  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (tab === 'register') {
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'flex';
    if (btnReg) {
      btnReg.style.background = 'rgba(56,189,248,0.2)';
      btnReg.style.color = '#38bdf8';
      btnReg.style.borderColor = 'rgba(56,189,248,0.4)';
    }
    if (btnLogin) {
      btnLogin.style.background = 'transparent';
      btnLogin.style.color = '#94a3b8';
      btnLogin.style.borderColor = 'transparent';
    }
  } else {
    if (loginForm) loginForm.style.display = 'flex';
    if (regForm) regForm.style.display = 'none';
    if (btnLogin) {
      btnLogin.style.background = 'rgba(56,189,248,0.2)';
      btnLogin.style.color = '#38bdf8';
      btnLogin.style.borderColor = 'rgba(56,189,248,0.4)';
    }
    if (btnReg) {
      btnReg.style.background = 'transparent';
      btnReg.style.color = '#94a3b8';
      btnReg.style.borderColor = 'transparent';
    }
  }
}
window.switchLoginGateTab = switchLoginGateTab;

// Xử lý tự đăng ký tài khoản mới trên In-App Login Gate
async function handleInAppRegisterSubmit(event) {
  event.preventDefault();
  const alertEl = document.getElementById('loginAlert');
  const submitBtn = document.getElementById('regSubmitBtn');
  const username = String(document.getElementById('regUsername')?.value || '').trim();
  const password = String(document.getElementById('regPassword')?.value || '');
  const confirmPassword = String(document.getElementById('regConfirmPassword')?.value || '');
  const licenseKey = String(document.getElementById('regLicenseKey')?.value || '').trim();

  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (!username) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập tên đăng nhập.'; alertEl.classList.remove('hidden'); }
    return;
  }
  if (password !== confirmPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu xác nhận không khớp!'; alertEl.classList.remove('hidden'); }
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Đang khởi tạo tài khoản...'; }

  try {
    const res = await requestJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, licenseKey })
    });

    if (!res.ok) {
      throw new Error(res.data?.error || 'Đăng ký tài khoản thất bại.');
    }

    showToast('🎉 ' + (res.data?.message || 'Đăng ký thành công! Đang vào hệ thống...'));
    hideLoginGate();
    setTimeout(() => { window.location.reload(); }, 600);
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📝 TẠO TÀI KHOẢN & VÀO HỆ THỐNG'; }
  }
}
window.handleInAppRegisterSubmit = handleInAppRegisterSubmit;

// Kích hoạt mã Key từ màn hình thông báo Hết hạn (Blur Overlay)
async function redeemKeyFromExpiredOverlay() {
  const keyInput = document.getElementById('expiredKeyInput');
  const alertEl = document.getElementById('expiredKeyAlert');
  const key = String(keyInput?.value || '').trim().toUpperCase();

  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (!key) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập mã Key gia hạn.'; alertEl.classList.remove('hidden'); }
    return;
  }

  try {
    const res = await requestJson('/api/manager/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: key })
    });
    if (!res.ok) {
      throw new Error(res.data?.error || 'Mã Key không hợp lệ hoặc đã qua sử dụng.');
    }
    showToast('🎉 Kích hoạt Key thành công! Đang tải lại phiên làm việc...');
    setTimeout(() => { window.location.reload(); }, 800);
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.classList.remove('hidden');
    }
  }
}
window.redeemKeyFromExpiredOverlay = redeemKeyFromExpiredOverlay;

// Chuyển Sub-Tab giữa User List và Key List trên trang Quản lý User
function switchUserMgmtSubTab(subTab) {
  const panelUsers = document.getElementById('subPanelUsers');
  const panelKeys = document.getElementById('subPanelKeys');
  const tabUsers = document.getElementById('subTabUsers');
  const tabKeys = document.getElementById('subTabKeys');

  if (subTab === 'keys') {
    if (panelUsers) panelUsers.classList.add('hidden');
    if (panelKeys) panelKeys.classList.remove('hidden');
    if (tabKeys) tabKeys.classList.add('active');
    if (tabUsers) tabUsers.classList.remove('active');
    refreshKeysTable();
  } else {
    if (panelUsers) panelUsers.classList.remove('hidden');
    if (panelKeys) panelKeys.classList.add('hidden');
    if (tabUsers) tabUsers.classList.add('active');
    if (tabKeys) tabKeys.classList.remove('active');
    refreshUserManagementPage();
  }
}
window.switchUserMgmtSubTab = switchUserMgmtSubTab;

async function openUserManagementModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền mở quản lý user.');
    return;
  }
  navigateTo('users');
}
window.openUserManagementModal = openUserManagementModal;

function closeUserManagementModal() {
  document.getElementById('userManagementModal')?.classList.add('hidden');
}
window.closeUserManagementModal = closeUserManagementModal;

// Tải dữ liệu toàn bộ User và Bot Ownership
async function refreshUserManagementPage() {
  void loadTrialGiftSetting();
  const tbodyFull = document.getElementById('userFullTableBody');
  const tbodyModal = document.getElementById('userTableBody');
  const placeholders = [tbodyFull, tbodyModal].filter(Boolean);
  placeholders.forEach(tb => {
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang làm mới dữ liệu người dùng...</td></tr>';
  });

  try {
    const res = await requestJson('/api/manager/users');
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải danh sách user.');
    userManagementList = Array.isArray(res.data?.users) ? res.data.users : [];
    userManagementAvailableBots = Array.isArray(res.data?.availableBots) ? res.data.availableBots : [];
    userManagementBotOwnership = (res.data?.botOwnership && typeof res.data.botOwnership === 'object') ? res.data.botOwnership : {};

    // Cập nhật các thống kê số liệu
    const total = userManagementList.length;
    const now = Date.now();
    const activeCount = userManagementList.filter(u => u.status === 'active' && (!u.expiresAt || Date.parse(u.expiresAt) > now)).length;
    const disabledCount = userManagementList.filter(u => u.status === 'disabled').length;
    const expiredCount = userManagementList.filter(u => u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now)).length;
    const lifetimeCount = userManagementList.filter(u => !u.expiresAt).length;

    const elTotal = document.getElementById('userMgmtTotalCount'); if (elTotal) elTotal.textContent = total;
    const elStatAll = document.getElementById('statUserAll'); if (elStatAll) elStatAll.textContent = total;
    const elStatAct = document.getElementById('statUserActive'); if (elStatAct) elStatAct.textContent = activeCount;
    const elStatDis = document.getElementById('statUserDisabled'); if (elStatDis) elStatDis.textContent = disabledCount;
    const elStatExp = document.getElementById('statUserExpired'); if (elStatExp) elStatExp.textContent = expiredCount;
    const elStatLife = document.getElementById('statUserLifetime'); if (elStatLife) elStatLife.textContent = lifetimeCount;

    renderUserTable();
  } catch (err) {
    placeholders.forEach(tb => {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--red);padding:24px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }
}
window.refreshUserManagementPage = refreshUserManagementPage;
window.refreshUserManagementList = refreshUserManagementPage;

function setUserStatusFilter(status) {
  currentUserStatusFilter = status;
  const chipMap = {
    all: document.getElementById('userFilterAll'),
    active: document.getElementById('userFilterActive'),
    disabled: document.getElementById('userFilterDisabled'),
    expired: document.getElementById('userFilterExpired'),
    lifetime: document.getElementById('userFilterLifetime')
  };
  Object.keys(chipMap).forEach(k => {
    if (chipMap[k]) chipMap[k].classList.toggle('active', k === status);
  });
  renderUserTable();
}
window.setUserStatusFilter = setUserStatusFilter;

function debounceUserFilter() {
  if (userFilterSearchTimer) clearTimeout(userFilterSearchTimer);
  userFilterSearchTimer = setTimeout(() => { renderUserTable(); }, 200);
}
window.debounceUserFilter = debounceUserFilter;

// Bật / tắt hiển thị mật khẩu người dùng (Toggle Peek - On-Demand)
async function toggleUserPasswordPeek(userId) {
  const u = userManagementList.find(x => x.id === userId);
  if (!userPassPeekMap[userId]) {
    if (u && !u.password) {
      try {
        const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/reveal-password', { method: 'POST' });
        const pass = res.data?.password ?? res.password;
        if (res.ok && typeof pass === 'string' && pass.length > 0) {
          u.password = pass;
        } else if (!res.ok) {
          showToast(res.data?.error || 'Không thể lấy mật khẩu người dùng.', 'error');
          return;
        } else {
          u.password = pass || '(trống)';
        }
      } catch (err) {
        showToast('Không thể lấy mật khẩu: ' + (err.message || err), 'error');
        return;
      }
    }
    userPassPeekMap[userId] = true;
  } else {
    userPassPeekMap[userId] = false;
  }
  renderUserTable();
}
window.toggleUserPasswordPeek = toggleUserPasswordPeek;
window.togglePassPeek = (userId) => toggleUserPasswordPeek(userId);

// Render bảng User (áp dụng bộ lọc trạng thái và tìm kiếm thời gian thực)
function renderUserTable() {
  const tbodyFull = document.getElementById('userFullTableBody');
  const tbodyModal = document.getElementById('userTableBody');
  const targets = [tbodyFull, tbodyModal].filter(Boolean);
  if (!targets.length) return;

  const searchQuery = String(document.getElementById('userFilterSearch')?.value || '').trim().toLowerCase();
  const now = Date.now();

  const filtered = userManagementList.filter(u => {
    // Lọc theo từ khóa tìm kiếm
    if (searchQuery) {
      const matchUser = String(u.username || '').toLowerCase().includes(searchQuery);
      const matchNote = String(u.note || '').toLowerCase().includes(searchQuery);
      const matchPlan = String(u.planName || '').toLowerCase().includes(searchQuery);
      if (!matchUser && !matchNote && !matchPlan) return false;
    }

    // Lọc theo trạng thái
    const isAct = u.status === 'active' && (!u.expiresAt || Date.parse(u.expiresAt) > now);
    const isDis = u.status === 'disabled';
    const isExp = u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now);
    const isLife = !u.expiresAt;

    if (currentUserStatusFilter === 'active') return isAct;
    if (currentUserStatusFilter === 'disabled') return isDis;
    if (currentUserStatusFilter === 'expired') return isExp;
    if (currentUserStatusFilter === 'lifetime') return isLife;
    return true;
  });

  if (!filtered.length) {
    const emptyHtml = '<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--muted);">' +
      (userManagementList.length ? 'Không có người dùng nào khớp với bộ lọc.' : 'Chưa có người dùng nào. Nhấn "＋ Thêm Người Dùng Mới" để tạo ngay!') +
      '</td></tr>';
    targets.forEach(tb => { tb.innerHTML = emptyHtml; });
    return;
  }

  const rowsHtml = filtered.map(u => {
    const isAct = u.status === 'active' && (!u.expiresAt || Date.parse(u.expiresAt) > now);
    const isDis = u.status === 'disabled';
    const isExp = u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now);
    const isLife = !u.expiresAt;

    // Cột 1: Người dùng
    const isAdmin = u.role === 'admin';
    const userCol = '<div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<strong style="font-size:13.5px;color:#fff;">' + (isAdmin ? '👑' : '👤') + ' ' + escapeHtml(u.username) + '</strong>' +
        (isAdmin ? ' <span class="vip-pill-mini">ADMIN</span>' : '') +
      '</div>' +
      (u.note ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">📝 ' + escapeHtml(u.note) + '</div>' : '') +
      (u.planName ? '<div style="font-size:11px;color:#38bdf8;margin-top:1px;font-weight:700;">' + escapeHtml(u.planName) + '</div>' : '') +
    '</div>';

    // Cột 2: Mật khẩu (Peek Toggle)
    const isPeek = !!userPassPeekMap[u.id];
    const passDisplay = isPeek ? (u.password || '—') : '••••••••';
    const eyeIcon = isPeek ? '🙈' : '👁';
    const passCol = '<div class="password-cell-wrap">' +
      '<span class="password-text ' + (isPeek ? 'revealed' : 'masked') + '" ' + (isPeek && u.password && u.password !== '—' && u.password !== '(trống)' ? 'onclick="copyToClipboard(\'' + escapeHtml(u.password) + '\', \'Mật khẩu\')" style="cursor:pointer;" title="Click để copy mật khẩu"' : '') + '>' + escapeHtml(passDisplay) + '</span>' +
      '<button type="button" class="btn-peek" onclick="toggleUserPasswordPeek(\'' + u.id + '\')" title="' + (isPeek ? 'Ẩn mật khẩu' : 'Hiện mật khẩu') + '">' + eyeIcon + '</button>' +
    '</div>';

    // Cột 3: Hạn dùng & Gia hạn nhanh
    let expBadge = '';
    if (isLife) {
      expBadge = '<span class="badge-lifetime">👑 Vĩnh Viễn</span>';
    } else if (isExp) {
      const expExact = typeof formatFullDateTime === 'function' ? formatFullDateTime(u.expiresAt) : new Date(u.expiresAt).toLocaleString('vi-VN');
      expBadge = '<span class="badge-expired" title="Hết hạn: ' + expExact + '">⛔ Hết hạn (' + expExact + ')</span>';
    } else {
      const diffMs = Date.parse(u.expiresAt) - now;
      const totalHours = Math.floor(diffMs / 3600000);
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      const expExact = typeof formatFullDateTime === 'function' ? formatFullDateTime(u.expiresAt) : new Date(u.expiresAt).toLocaleString('vi-VN');
      const timeRemaining = days > 0 ? (days + ' ngày ' + hours + ' giờ') : (totalHours + ' giờ');
      expBadge = '<span class="badge-active" title="Hạn dùng: ' + expExact + '">⏳ Còn ' + timeRemaining + ' (' + expExact + ')</span>';
    }

    const quickBtns = isAdmin ? '' : '<div class="quick-renew-row">' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 1)" title="Cộng 1 ngày">+1N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 3)" title="Cộng 3 ngày">+3N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 7)" title="Cộng 7 ngày">+7N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 15)" title="Cộng 15 ngày">+15N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 30)" title="Cộng 30 ngày">+30N</button>' +
      '<button type="button" class="quick-renew-btn minus" onclick="quickRenewUser(\'' + u.id + '\', -1)" title="Trừ 1 ngày">-1N</button>' +
      '<button type="button" class="quick-renew-btn vip" onclick="quickSetLifetimeUser(\'' + u.id + '\')" title="Đặt VIP Vĩnh viễn">👑 Vĩnh viễn</button>' +
      '<button type="button" class="quick-renew-btn custom" onclick="openCustomRenewModal(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')" title="Tùy chỉnh ngày">⏱</button>' +
    '</div>';

    const expiryCol = '<div>' + expBadge + quickBtns + '</div>';

    // Cột 4: Trạng thái & Nút Khóa / Mở
    let statusCol = '';
    if (isDis) {
      statusCol = '<div>' +
        '<span style="color:#ef4444;font-weight:750;">🔒 Tạm khóa</span>' +
        (u.lockReason ? '<div style="font-size:10.5px;color:#fca5a5;margin-top:2px;max-width:140px;line-height:1.3;">💬 ' + escapeHtml(u.lockReason) + '</div>' : '') +
        '<div style="margin-top:4px;"><button type="button" class="small" style="background:#059669;border-color:#10b981;color:#fff;padding:2px 8px;font-size:11px;" onclick="unlockUser(\'' + u.id + '\')">🔓 Mở Khóa</button></div>' +
      '</div>';
    } else if (isExp) {
      statusCol = '<div>' +
        '<span style="color:#ef4444;font-weight:750;">⏳ Hết hạn</span>' +
        (!isAdmin ? '<div style="margin-top:4px;"><button type="button" class="small danger" style="padding:2px 8px;font-size:11px;" onclick="promptLockUser(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')">🔒 Khóa</button></div>' : '') +
      '</div>';
    } else {
      statusCol = '<div>' +
        '<span style="color:#10b981;font-weight:750;">🟢 Hoạt động</span>' +
        (!isAdmin ? '<div style="margin-top:4px;"><button type="button" class="small danger" style="padding:2px 8px;font-size:11px;" onclick="promptLockUser(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')">🔒 Tạm Khóa</button></div>' : '') +
      '</div>';
    }

    // Cột 5: Bot được cấp (1-Bot-1-User Exclusive)
    const assignedIds = Array.isArray(u.assignedBotIds) ? u.assignedBotIds : [];
    const botBadges = assignedIds.length
      ? assignedIds.map(id => {
          const b = userManagementAvailableBots.find(x => Number(x.id) === Number(id));
          const name = b ? b.label : ('Bot ' + id);
          return '<span class="badge-tag" style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 6px;border-radius:4px;margin:2px;display:inline-block;font-size:11px;font-weight:700;">🤖 ' + escapeHtml(name) + '</span>';
        }).join('')
      : '<span style="color:var(--muted);font-style:italic;font-size:11.5px;">Chưa gán bot nào</span>';

    // Cột 6: Thao tác
    const actionsCol = '<div style="text-align:right;white-space:nowrap;">' +
      '<button type="button" class="small" onclick="openEditUserModal(\'' + u.id + '\')">✏ Sửa</button> ' +
      (isAdmin ? '' : '<button type="button" class="small danger" onclick="deleteUserPrompt(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')">🗑 Xóa</button>') +
    '</div>';

    return '<tr>' +
      '<td>' + userCol + '</td>' +
      '<td>' + passCol + '</td>' +
      '<td>' + expiryCol + '</td>' +
      '<td>' + statusCol + '</td>' +
      '<td>' + botBadges + '</td>' +
      '<td>' + actionsCol + '</td>' +
    '</tr>';
  }).join('');

  targets.forEach(tb => { tb.innerHTML = rowsHtml; });
}

// Tạm khóa User kèm lời nhắn gửi đến màn hình của User
function promptLockUser(userId, username) {
  document.getElementById('lockTargetUserId').value = userId;
  document.getElementById('lockTargetUsername').textContent = username;
  document.getElementById('lockReasonInput').value = '';
  document.getElementById('userLockReasonModal')?.classList.remove('hidden');
}
window.promptLockUser = promptLockUser;

function closeUserLockReasonModal() {
  document.getElementById('userLockReasonModal')?.classList.add('hidden');
}
window.closeUserLockReasonModal = closeUserLockReasonModal;

async function submitLockUserWithReason() {
  const userId = document.getElementById('lockTargetUserId')?.value;
  const reason = document.getElementById('lockReasonInput')?.value.trim();
  if (!userId) return;

  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled', lockReason: reason })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạm khóa người dùng.');
    showToast('🔒 Đã tạm khóa người dùng thành công.');
    closeUserLockReasonModal();
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitLockUserWithReason = submitLockUserWithReason;

// Mở khóa người dùng
async function unlockUser(userId) {
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', lockReason: '' })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể mở khóa.');
    showToast('🔓 Đã mở khóa tài khoản thành công!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi mở khóa: ' + err.message);
  }
}
window.unlockUser = unlockUser;

// Gia hạn nhanh (+N / -N ngày)
async function quickRenewUser(userId, days) {
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: Number(days) })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Gia hạn thất bại.');
    showToast(res.data?.message || 'Đã cập nhật hạn thuê bot!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.quickRenewUser = quickRenewUser;

// Đặt VIP vĩnh viễn
async function quickSetLifetimeUser(userId) {
  if (!confirm('Đặt tài khoản này thành VIP Vĩnh Viễn?')) return;
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setPermanent: true })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Đặt vĩnh viễn thất bại.');
    showToast(res.data?.message || 'Đã nâng cấp VIP Vĩnh Viễn!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.quickSetLifetimeUser = quickSetLifetimeUser;

// Modal Tùy chỉnh hạn dùng
function openCustomRenewModal(userId, username) {
  document.getElementById('customRenewTargetUserId').value = userId;
  document.getElementById('customRenewTargetUser').textContent = username;
  document.getElementById('customRenewMode').value = 'add_days';
  handleCustomRenewModeChange();
  const u = userManagementList.find(x => x.id === userId || x.username === username);
  const planInput = document.getElementById('customRenewPlanNameInput');
  if (planInput) {
    planInput.value = u?.planName || '';
  }
  document.getElementById('customRenewModal')?.classList.remove('hidden');
}
window.openCustomRenewModal = openCustomRenewModal;

function closeCustomRenewModal() {
  document.getElementById('customRenewModal')?.classList.add('hidden');
}
window.closeCustomRenewModal = closeCustomRenewModal;

function handleCustomRenewModeChange() {
  const mode = document.getElementById('customRenewMode')?.value;
  const daysGroup = document.getElementById('customRenewDaysGroup');
  const dateGroup = document.getElementById('customRenewDateGroup');

  if (mode === 'set_date') {
    if (daysGroup) daysGroup.style.display = 'none';
    if (dateGroup) dateGroup.style.display = 'block';
  } else if (mode === 'set_permanent') {
    if (daysGroup) daysGroup.style.display = 'none';
    if (dateGroup) dateGroup.style.display = 'none';
  } else {
    if (daysGroup) daysGroup.style.display = 'block';
    if (dateGroup) dateGroup.style.display = 'none';
  }
}
window.handleCustomRenewModeChange = handleCustomRenewModeChange;

async function submitCustomRenew() {
  const userId = document.getElementById('customRenewTargetUserId')?.value;
  const mode = document.getElementById('customRenewMode')?.value;
  const daysVal = parseInt(document.getElementById('customRenewDaysInput')?.value, 10);
  const dateVal = document.getElementById('customRenewDateInput')?.value;
  const planName = document.getElementById('customRenewPlanNameInput')?.value?.trim();

  if (!userId) return;

  const payload = {};
  if (planName) {
    payload.planName = planName;
  }
  if (mode === 'set_permanent') {
    payload.setPermanent = true;
  } else if (mode === 'set_date') {
    if (!dateVal) { showToast('Vui lòng chọn ngày giờ hết hạn!'); return; }
    payload.fixedDate = dateVal;
  } else if (mode === 'add_days') {
    if (isNaN(daysVal) || daysVal <= 0) { showToast('Số ngày không hợp lệ!'); return; }
    payload.days = daysVal;
  } else if (mode === 'subtract_days') {
    if (isNaN(daysVal) || daysVal <= 0) { showToast('Số ngày không hợp lệ!'); return; }
    payload.days = -daysVal;
  }

  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.data?.error || 'Cập nhật hạn thất bại.');
    showToast(res.data?.message || 'Đã cập nhật hạn thuê bot!');
    closeCustomRenewModal();
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitCustomRenew = submitCustomRenew;

// Quản lý Modal Tạo/Sửa User & Checkbox Bot Độc Quyền (1-Bot-1-User)
function openCreateUserModal() {
  currentEditingUserId = null;
  document.getElementById('userEditModalTitle').textContent = 'Thêm Người Dùng Mới';
  document.getElementById('userFormId').value = '';
  document.getElementById('userFormUsername').value = '';
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').placeholder = 'Tối thiểu 5 ký tự (chữ hoặc số, phân biệt hoa thường)...';
  document.getElementById('userFormStatus').value = 'active';
  if (document.getElementById('userFormPlanName')) document.getElementById('userFormPlanName').value = 'Gói thường';
  if (document.getElementById('userFormExpiresAt')) document.getElementById('userFormExpiresAt').value = '';
  if (document.getElementById('userFormNote')) document.getElementById('userFormNote').value = '';
  if (document.getElementById('userFormAllowAccountChange')) document.getElementById('userFormAllowAccountChange').checked = true;
  renderUserFormBotsCheckboxes([], null);
  document.getElementById('userEditModal')?.classList.remove('hidden');
}
window.openCreateUserModal = openCreateUserModal;

function openEditUserModal(userId) {
  const u = userManagementList.find(x => x.id === userId);
  if (!u) return;
  currentEditingUserId = u.id;
  document.getElementById('userEditModalTitle').textContent = 'Sửa Người Dùng: ' + u.username;
  document.getElementById('userFormId').value = u.id;
  document.getElementById('userFormUsername').value = u.username;
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').placeholder = 'Để trống nếu không đổi mật khẩu';
  document.getElementById('userFormStatus').value = u.status || 'active';
  if (document.getElementById('userFormPlanName')) document.getElementById('userFormPlanName').value = u.planName || 'Gói thường';
  if (document.getElementById('userFormExpiresAt')) {
    if (u.expiresAt) {
      const d = new Date(u.expiresAt);
      if (!isNaN(d.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('userFormExpiresAt').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } else {
        document.getElementById('userFormExpiresAt').value = '';
      }
    } else {
      document.getElementById('userFormExpiresAt').value = '';
    }
  }
  if (document.getElementById('userFormNote')) document.getElementById('userFormNote').value = u.note || '';
  if (document.getElementById('userFormAllowAccountChange')) {
    document.getElementById('userFormAllowAccountChange').checked = u.allowAccountChange !== false;
  }
  renderUserFormBotsCheckboxes(u.assignedBotIds || [], u.id);
  document.getElementById('userEditModal')?.classList.remove('hidden');
}
window.openEditUserModal = openEditUserModal;

function closeUserEditModal() {
  currentEditingUserId = null;
  document.getElementById('userEditModal')?.classList.add('hidden');
}
window.closeUserEditModal = closeUserEditModal;

// Render checkbox phân quyền bot theo nguyên tắc 1-Bot-1-User độc quyền
function renderUserFormBotsCheckboxes(selectedIds, targetUserId) {
  const grid = document.getElementById('userFormBotsGrid');
  if (!grid) return;
  if (!userManagementAvailableBots.length) {
    grid.innerHTML = '<div style="color:var(--muted);padding:10px;grid-column:1/-1;">Chưa có bot nào trong Manager. Hãy thêm bot trước.</div>';
    return;
  }
  const set = new Set((selectedIds || []).map(Number));

  grid.innerHTML = userManagementAvailableBots.map(b => {
    const botId = Number(b.id);
    const isChecked = set.has(botId);
    const owner = userManagementBotOwnership[botId] || b.currentOwner;
    const isOccupiedByOther = owner && owner.userId && (!targetUserId || owner.userId !== targetUserId);

    if (isOccupiedByOther) {
      return '<label class="bot-check-item bot-occupied" style="position:relative;">' +
        '<input type="checkbox" class="user-bot-chk" value="' + botId + '" ' + (isChecked ? 'checked' : '') + ' data-occupied="1" data-bot-id="' + botId + '" data-bot-label="' + escapeHtml(b.label || 'Bot #' + botId) + '" data-owner="' + escapeHtml(owner.username) + '" onclick="handleOccupiedBotClick(event)">' +
        '<div>' +
          '<span><strong>' + escapeHtml(b.label || 'Bot #' + botId) + '</strong> (ID: ' + botId + ')</span>' +
          '<span class="badge-occupied">👤 Đang cấp cho: ' + escapeHtml(owner.username) + '</span>' +
        '</div>' +
      '</label>';
    }

    return '<label class="bot-check-item">' +
      '<input type="checkbox" class="user-bot-chk" value="' + botId + '" ' + (isChecked ? 'checked' : '') + '>' +
      '<span><strong>' + escapeHtml(b.label || 'Bot #' + botId) + '</strong> (ID: ' + botId + ')</span>' +
    '</label>';
  }).join('');
}
window.renderUserFormBotsCheckboxes = renderUserFormBotsCheckboxes;

// Bắt sự kiện click bot đã có người dùng khác sở hữu
function handleOccupiedBotClick(event, directBotId, directBotLabel, directOldOwner) {
  const chk = event.target;
  const botId = directBotId !== undefined ? directBotId : Number(chk.dataset.botId || chk.value);
  const botLabel = directBotLabel !== undefined ? directBotLabel : (chk.dataset.botLabel || ('Bot #' + botId));
  const oldOwnerName = directOldOwner !== undefined ? directOldOwner : (chk.dataset.owner || '');
  if (chk.checked) {
    // Tạm bỏ check trước khi xác nhận
    chk.checked = false;
    event.preventDefault();

    const msgEl = document.getElementById('reassignBotConfirmMsg');
    if (msgEl) {
      msgEl.innerHTML = '⚠️ Bot <strong>#' + botId + ' (' + escapeHtml(botLabel) + ')</strong> hiện đang thuộc về người dùng <strong>' + escapeHtml(oldOwnerName) + '</strong>.<br/><br/>Bạn có chắc chắn muốn hủy bot khỏi <strong>' + escapeHtml(oldOwnerName) + '</strong> để cấp quyền cho người dùng này không?';
    }
    pendingBotReassignCallback = () => {
      chk.checked = true;
      chk.closest('.bot-check-item')?.classList.remove('bot-occupied');
    };
    document.getElementById('reassignBotConfirmModal')?.classList.remove('hidden');
  }
}
window.handleOccupiedBotClick = handleOccupiedBotClick;

function closeReassignBotConfirmModal(confirmed) {
  if (confirmed && typeof pendingBotReassignCallback === 'function') {
    pendingBotReassignCallback();
  }
  pendingBotReassignCallback = null;
  document.getElementById('reassignBotConfirmModal')?.classList.add('hidden');
}
window.closeReassignBotConfirmModal = closeReassignBotConfirmModal;

function toggleSelectAllUserBots(select) {
  document.querySelectorAll('.user-bot-chk').forEach(el => {
    if (select) {
      // Nếu là bot đang bận, bỏ qua không auto chọn hết để tránh cướp bot vô tình
      if (!el.closest('.bot-occupied')) el.checked = true;
    } else {
      el.checked = false;
    }
  });
}
window.toggleSelectAllUserBots = toggleSelectAllUserBots;

function generateRandomUserPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  document.getElementById('userFormPassword').value = pass;
}
window.generateRandomUserPassword = generateRandomUserPassword;

async function saveUserForm() {
  const id = document.getElementById('userFormId').value.trim();
  const username = document.getElementById('userFormUsername').value.trim();
  const password = document.getElementById('userFormPassword').value.trim();
  const status = document.getElementById('userFormStatus').value;
  const chks = document.querySelectorAll('.user-bot-chk:checked');
  const assignedBotIds = Array.from(chks).map(el => Number(el.value));

  if (!username) { showToast('Vui lòng nhập tên đăng nhập.'); return; }
  const isUpdate = !!id;
  if (!isUpdate && !password) { showToast('Vui lòng nhập mật khẩu.'); return; }

  const btn = document.getElementById('userFormSubmitBtn');
  if (btn) btn.disabled = true;

  try {
    const url = isUpdate ? ('/api/manager/users/' + encodeURIComponent(id)) : '/api/manager/users';
    const method = isUpdate ? 'PUT' : 'POST';
    const planName = document.getElementById('userFormPlanName')?.value.trim() || 'Gói thường';
    const expiresAt = document.getElementById('userFormExpiresAt')?.value ? new Date(document.getElementById('userFormExpiresAt').value).toISOString() : null;
    const note = document.getElementById('userFormNote')?.value.trim() || '';
    const allowAccountChange = !!document.getElementById('userFormAllowAccountChange')?.checked;

    const payload = { username, status, planName, expiresAt, note, allowAccountChange, assignedBotIds };
    if (password) payload.password = password;

    const res = await requestJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi khi lưu user.');
    showToast(res.data?.message || 'Đã lưu người dùng thành công.');
    closeUserEditModal();
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.saveUserForm = saveUserForm;

async function deleteUserPrompt(userId, username) {
  if (!confirm('Bạn có chắc chắn muốn xóa người dùng "' + username + '"? Người dùng này sẽ mất quyền truy cập ngay lập tức.')) return;
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể xóa user.');
    showToast(res.data?.message || 'Đã xóa người dùng.');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi xóa user: ' + err.message);
  }
}
window.deleteUserPrompt = deleteUserPrompt;

function onKeyDaysSelectChange(source) {
  if (source === 'mgmt') {
    const sel = document.getElementById('mgmtKeyDays');
    const customInp = document.getElementById('mgmtKeyCustomDays');
    if (sel && customInp) {
      customInp.style.display = sel.value === 'custom' ? 'inline-block' : 'none';
      if (sel.value === 'custom') customInp.focus();
    }
  } else if (source === 'modal') {
    const sel = document.getElementById('createKeyDays');
    const customInp = document.getElementById('createKeyCustomDays');
    if (sel && customInp) {
      customInp.style.display = sel.value === 'custom' ? 'inline-block' : 'none';
      if (sel.value === 'custom') customInp.focus();
    }
  }
}
window.onKeyDaysSelectChange = onKeyDaysSelectChange;

// Phát hành mã Key từ Sub-panel Quản lý Key
async function submitCreateKeysFromMgmt() {
  const daysVal = document.getElementById('mgmtKeyDays')?.value;
  const customInp = document.getElementById('mgmtKeyCustomDays');
  const planName = document.getElementById('mgmtKeyPlan')?.value.trim();
  const count = parseInt(document.getElementById('mgmtKeyCount')?.value, 10) || 1;

  const isPermanent = daysVal === 'lifetime';
  let days = 7;
  if (isPermanent) {
    days = 36500;
  } else if (daysVal === 'custom') {
    const customVal = parseInt(customInp?.value, 10);
    if (!Number.isFinite(customVal) || customVal < 1) {
      showToast('Vui lòng nhập số ngày hợp lệ (tối thiểu 1 ngày).', 'error');
      if (customInp) customInp.focus();
      return;
    }
    days = Math.min(customVal, 3650);
  } else {
    days = parseInt(daysVal, 10) || 7;
  }

  try {
    const res = await requestJson('/api/manager/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days,
        planName: planName || (isPermanent ? 'VIP Vĩnh Viễn' : ('Gói ' + days + ' Ngày')),
        count,
        setPermanent: isPermanent
      })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạo mã Key.');
    showToast('🎉 ' + (res.data?.message || 'Đã tạo ' + count + ' mã Key thành công!'));
    await refreshKeysTable();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitCreateKeysFromMgmt = submitCreateKeysFromMgmt;



async function quickBotAction(event, id, action) {
  event.stopPropagation();
  showToast('Đang gửi lệnh ' + action + ' tới Bot ' + id + '...');
  try {
    const res = await requestJson('/api/manager/bot/' + id + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.ok) {
      showToast('Đã thực hiện ' + action + ' Bot ' + id + ' thành công!');
      refreshHome();
    } else {
      showToast(res.data?.error || ('Lỗi khi ' + action + ' bot.'));
    }
  } catch (err) {
    showToast(err.message || 'Lỗi kết nối.');
  }
}
window.quickBotAction = quickBotAction;

let activeStatusFilter = 'all';
function setStatusFilter(filter) {
  activeStatusFilter = filter;
  ['all','afk','online','offline'].forEach(k => {
    const el = document.getElementById('tab' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) el.classList.toggle('active', k === filter);
  });
  filterBots();
}
window.setStatusFilter = setStatusFilter;

let soundAlertEnabled = localStorage.getItem('kingmc_mgr_sound') === '1';
let previousOfflineSet = new Set();

let _sharedAudioCtx = null;
function getSharedAudioContext() {
  if (!_sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) _sharedAudioCtx = new AudioCtx();
  }
  if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume().catch(() => {});
  }
  return _sharedAudioCtx;
}

function playAlertTone(type = 'warn') {
  if (!soundAlertEnabled) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type === 'danger' ? 'sawtooth' : 'sine';
    const now = ctx.currentTime;
    if (type === 'danger') {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    }
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (_) {}
}

function toggleSoundAlert() {
  soundAlertEnabled = !soundAlertEnabled;
  localStorage.setItem('kingmc_mgr_sound', soundAlertEnabled ? '1' : '0');
  updateSoundAlertButton();
  if (soundAlertEnabled) playAlertTone('info');
}

function updateSoundAlertButton() {
  const btn = document.getElementById('soundAlertBtn');
  if (!btn) return;
  if (soundAlertEnabled) {
    btn.className = 'small sound-btn active';
    btn.innerHTML = '🔔 Cảnh báo: BẬT';
  } else {
    btn.className = 'small sound-btn';
    btn.innerHTML = '🔕 Cảnh báo: TẮT';
  }
}
window.toggleSoundAlert = toggleSoundAlert;

function exportBotList() {
  const exportData = bots.map(b => ({
    id: b.id,
    label: b.label,
    url: b.url
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kingmc_bots_backup.json';
  a.click();
  showToast('Đã xuất danh sách bot ra file JSON!');
}
window.exportBotList = exportBotList;

function triggerImport() {
  const input = document.getElementById('importFileInput');
  if (input) input.click();
}
window.triggerImport = triggerImport;

async function handleImportFile(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  event.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('File JSON không đúng định dạng danh sách bot.');
    let added = 0;
    showToast('Đang khôi phục ' + data.length + ' bot từ file...');
    for (const item of data) {
      const rawUrl = item.url || item.endpoint || item.sourceUrl;
      const url = normalizeClientBotUrl(rawUrl);
      if (!url) continue;
      const label = String(item.label || item.name || '').trim();
      try {
        const res = await requestJson('/api/manager/bots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, label })
        });
        if (res.ok) added++;
      } catch (_) {}
    }
    showToast('Đã khôi phục thành công ' + added + ' bot mới!');
    await refreshHome();
  } catch (err) {
    showToast('Lỗi đọc file: ' + (err.message || 'Không thể khôi phục.'));
  }
}
window.handleImportFile = handleImportFile;

async function reconnectOfflineBots() {
  const offlineList = bots.filter(b => (!b.available || b.status === 'offline' || b.status === 'kicked') && !b.manuallyStopped);
  if (!offlineList.length) {
    showToast('Tất cả bot đều đang hoạt động tốt!');
    return;
  }
  if (!confirm('Kết nối lại ' + offlineList.length + ' bot đang Offline / Lỗi?')) return;
  showToast('Đang kết nối lại ' + offlineList.length + ' bot...');
  let success = 0;
  for (const b of offlineList) {
    try {
      const res = await requestJson('/api/manager/bot/' + encodeURIComponent(String(b.id)) + '/start', {
        method: 'POST',
        timeoutMs: 15000
      });
      if (res.ok) success++;
    } catch (_) {}
  }
  showToast('Đã kích hoạt kết nối lại ' + success + '/' + offlineList.length + ' bot!');
  await refreshHome();
}
window.reconnectOfflineBots = reconnectOfflineBots;

let currentSortMode = 'default';
function changeBotSort(mode) {
  currentSortMode = mode || 'default';
  filterBots();
}
window.changeBotSort = changeBotSort;

function updateKpis() {
  const total = bots.length;
  const afk = bots.filter(b => b.status === 'afk').length;
  const online = bots.filter(b => ['online','connecting','authenticating','entering'].includes(b.status)).length;
  const offline = bots.filter(b => !b.available || b.status === 'offline' || b.status === 'kicked').length;
  const totems = bots.reduce((sum, b) => sum + Number(b.totemCount || 0), 0);

  const tEl = document.getElementById('kpiTotal'); if(tEl) tEl.textContent = String(total);
  const aEl = document.getElementById('kpiAfk'); if(aEl) aEl.textContent = String(afk);
  const oEl = document.getElementById('kpiOnline'); if(oEl) oEl.textContent = String(online);
  const fEl = document.getElementById('kpiOffline'); if(fEl) fEl.textContent = String(offline);
  const ttEl = document.getElementById('kpiTotem'); if(ttEl) ttEl.textContent = String(totems);

  // Cập nhật Chỉ số Sức khỏe Hạm đội (Fleet Health Score)
  const healthPercent = total > 0 ? Math.round(((afk * 1.0 + online * 0.7) / total) * 100) : 100;
  const hEl = document.getElementById('kpiFleetHealth');
  const hSubEl = document.getElementById('kpiFleetHealthSub');
  if (hEl) {
    hEl.textContent = healthPercent + '%';
    hEl.style.color = healthPercent >= 90 ? 'var(--green)' : (healthPercent >= 60 ? 'var(--yellow)' : 'var(--red)');
  }
  if (hSubEl) {
    hSubEl.textContent = healthPercent >= 90 ? 'Hệ thống tối ưu' : (healthPercent >= 60 ? 'Cần chú ý kết nối' : 'Cảnh báo gián đoạn!');
  }
  updateTagPills();

  // Cập nhật Fleet Resource Bar (Eco & RAM Fleet & Host Hardware Aggregation)
  const ecoCount = bots.filter(b => b.available && b.settings?.ecoMode !== false && b.ecoMode !== false).length;
  const activeBots = bots.filter(b => b.available && b.status !== 'offline' && b.status !== 'kicked');
  const totalFleetRam = bots.reduce((sum, b) => sum + Number(b.hostHardware?.botRssMb || b.ramRss || b.rssMb || b.memory?.rssMb || 0), 0);
  const avgFleetRam = activeBots.length > 0 ? Math.round(totalFleetRam / activeBots.length) : 0;

  // Tính tổng RAM đã dùng / Tổng RAM được cấp, Trung bình % CPU và Tổng băng thông toàn hạm đội
  const botsWithHw = activeBots.filter(b => b.hostHardware && Number(b.hostHardware.ramTotalMb) > 0);
  let fleetRamUsedMb = 0;
  let fleetRamTotalMb = 0;
  let fleetCpuSum = 0;
  let fleetRxKbps = 0;
  let fleetTxKbps = 0;

  for (const b of botsWithHw) {
    fleetRamUsedMb += Number(b.hostHardware.ramUsedMb || b.hostHardware.botRssMb || 0);
    fleetRamTotalMb += Number(b.hostHardware.ramTotalMb || 0);
    fleetCpuSum += Number(b.hostHardware.cpuPercent || 0);
    fleetRxKbps += Number(b.hostHardware.netDownKb || 0);
    fleetTxKbps += Number(b.hostHardware.netUpKb || 0);
  }

  const fleetRamPercent = fleetRamTotalMb > 0 ? Math.round((fleetRamUsedMb / fleetRamTotalMb) * 1000) / 10 : 0;
  const avgFleetCpu = botsWithHw.length > 0 ? Math.round((fleetCpuSum / botsWithHw.length) * 10) / 10 : 0;

  const ecoCountEl = document.getElementById('fleetEcoCount'); if(ecoCountEl) ecoCountEl.textContent = String(ecoCount);
  const ecoTotalEl = document.getElementById('fleetEcoTotal'); if(ecoTotalEl) ecoTotalEl.textContent = String(total);
  const totalRamEl = document.getElementById('fleetTotalRam');
  if (totalRamEl) {
    if (fleetRamTotalMb > 0) {
      totalRamEl.textContent = fleetRamUsedMb + ' / ' + fleetRamTotalMb + ' MB (' + fleetRamPercent + '%)';
    } else {
      totalRamEl.textContent = totalFleetRam + ' MB RSS';
    }
  }
  const avgRamEl = document.getElementById('fleetAvgRam'); if(avgRamEl) avgRamEl.textContent = avgFleetRam + ' MB RSS';
  const cpuSavedEl = document.getElementById('fleetCpuSaved');
  if (cpuSavedEl) {
    if (botsWithHw.length > 0) {
      cpuSavedEl.textContent = avgFleetCpu + '% TB' + (fleetRxKbps > 0 || fleetTxKbps > 0 ? ' • ↓' + Math.round(fleetRxKbps) + ' ↑' + Math.round(fleetTxKbps) + 'KB/s' : '');
    } else {
      cpuSavedEl.textContent = ecoCount > 0 ? '~80%' : '0%';
    }
  }

  // Cập nhật số đếm trên các Tab Bộ lọc
  const cAll = document.getElementById('countAll'); if(cAll) cAll.textContent = String(total);
  const cAfk = document.getElementById('countAfk'); if(cAfk) cAfk.textContent = String(afk);
  const cOn = document.getElementById('countOnline'); if(cOn) cOn.textContent = String(online);
  const cOff = document.getElementById('countOffline'); if(cOff) cOff.textContent = String(offline);

  // Âm thanh cảnh báo nếu có bot vừa mất kết nối
  const currentOfflineIds = new Set(bots.filter(b => (!b.available || b.status === 'offline' || b.status === 'kicked') && !b.manuallyStopped).map(b => b.id));
  if (previousOfflineSet.size > 0) {
    for (const id of currentOfflineIds) {
      if (!previousOfflineSet.has(id)) {
        playAlertTone('danger');
        break;
      }
    }
  }
  previousOfflineSet = currentOfflineIds;
}

let activeTagFilter = '';
function filterByTag(tag) {
  activeTagFilter = String(tag || '').trim().toLowerCase();
  updateTagPills();
  filterBots();
}
window.filterByTag = filterByTag;

function updateTagPills() {
  const container = document.getElementById('tagPillsContainer');
  if (!container) return;
  const tagSet = new Set();
  bots.forEach(b => {
    if (Array.isArray(b.tags)) b.tags.forEach(t => tagSet.add(t));
  });
  const tags = Array.from(tagSet).sort();
  let html = '<button type="button" class="tab-btn ' + (!activeTagFilter ? 'active' : '') + '" onclick="filterByTag(\'\')" style="padding:3px 9px;font-size:11px;border-radius:6px;">Tất cả</button>';
  tags.forEach(t => {
    const isAct = activeTagFilter === t;
    html += '<button type="button" class="tab-btn ' + (isAct ? 'active' : '') + '" onclick="filterByTag(\'' + escapeHtml(t) + '\')" style="padding:3px 9px;font-size:11px;border-radius:6px;">#' + escapeHtml(t) + '</button>';
  });
  container.innerHTML = html;
}
window.updateTagPills = updateTagPills;

function editBotTags(id) {
  editBot(null, id);
  setTimeout(() => {
    const input = document.getElementById('editBotTags');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}
window.editBotTags = editBotTags;

function filterBots() {
  const query = String(document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const grid = document.getElementById('botGrid');
  if(!grid) return;
  const filtered = bots.filter(b => {
    // 1. Lọc theo Tab trạng thái
    if (activeStatusFilter === 'afk' && b.status !== 'afk') return false;
    if (activeStatusFilter === 'online' && !['online','connecting','authenticating','entering'].includes(b.status)) return false;
    if (activeStatusFilter === 'offline' && (b.available && b.status !== 'offline' && b.status !== 'kicked')) return false;

    // 2. Lọc theo Tag phân loại
    if (activeTagFilter) {
      const bTags = Array.isArray(b.tags) ? b.tags : [];
      if (!bTags.includes(activeTagFilter)) return false;
    }

    // 3. Lọc theo Từ khóa tìm kiếm
    if(!query) return true;
    return (b.label && b.label.toLowerCase().includes(query)) ||
      (b.username && b.username.toLowerCase().includes(query)) ||
      (b.ipAddress && b.ipAddress.toLowerCase().includes(query)) ||
      (b.status && b.status.toLowerCase().includes(query));
  });

  // 3. Sắp xếp theo chế độ được chọn
  if (currentSortMode === 'status') {
    const order = { afk: 1, entering: 2, authenticating: 3, connecting: 4, online: 5, offline: 6, kicked: 7 };
    filtered.sort((a, b) => (order[a.status] || 99) - (order[b.status] || 99));
  } else if (currentSortMode === 'uptime') {
    filtered.sort((a, b) => (b.uptimeSeconds || 0) - (a.uptimeSeconds || 0));
  } else if (currentSortMode === 'totem') {
    filtered.sort((a, b) => (b.totemCount || 0) - (a.totemCount || 0));
  } else if (currentSortMode === 'name') {
    filtered.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
  }

  if(!filtered.length){
    const emptyHtml='<div class="panel" style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px;">Không có bot nào khớp với tiêu chí tìm kiếm/bộ lọc.</div>';
    if(grid.innerHTML!==emptyHtml) grid.innerHTML=emptyHtml;
    return;
  }
  if (draggedBotId !== null) return;

  const currentCards = Array.from(grid.querySelectorAll('.bot-card'));
  const currentIds = currentCards.map(c => c.getAttribute('data-bot-id')).filter(Boolean);
  const nextIds = filtered.map(b => String(b.id));
  const isSameOrder = currentIds.length === nextIds.length && currentIds.every((id, idx) => id === nextIds[idx]);

  if (isSameOrder) {
    filtered.forEach(b => {
      const card = grid.querySelector('.bot-card[data-bot-id="' + b.id + '"]');
      if (card) {
        try {
          const newHtml = botCardHtml(b);
          const temp = document.createElement('div');
          temp.innerHTML = newHtml;
          const fresh = temp.firstElementChild;
          if (fresh && card.innerHTML !== fresh.innerHTML) {
            card.innerHTML = fresh.innerHTML;
          }
        } catch(e){}
      }
    });
  } else {
    const nextHtml = filtered.map(b => {
      try {
        return botCardHtml(b);
      } catch (e) {
        return '';
      }
    }).join('');
    if (grid.innerHTML !== nextHtml) {
      grid.innerHTML = nextHtml;
    }
  }
}

function renderHome() {
  updateKpis();
  filterBots();
}

let currentUserAnnouncement = null;

function renderAnnouncementHtml(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  let html = '';
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { html += '<ul style="margin:6px 0 10px;padding-left:20px;">'; inList = true; }
      const itemContent = escapeHtml(trimmed.slice(2));
      html += '<li style="margin-bottom:4px;">' + itemContent + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (!trimmed) {
        html += '<div style="height:8px;"></div>';
      } else {
        html += '<p style="margin:0 0 8px;">' + escapeHtml(line) + '</p>';
      }
    }
  }
  if (inList) html += '</ul>';
  return html;
}

async function checkAndShowAnnouncement() {
  if (!currentUser) return;
  try {
    const res = await requestJson('/api/manager/announcement');
    if (!res.ok || !res.data?.announcement) return;
    const ann = res.data.announcement;
    if (!ann.enabled || !ann.content?.trim()) return;

    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE'); // YYYY-MM-DD
    const annId = ann.id || 'default';

    if (ann.mode === 'daily') {
      const dismissedDate = localStorage.getItem('kingmc_ann_dismiss_daily_' + annId);
      if (dismissedDate === todayStr) {
        return; // Đã đóng trong ngày hôm nay!
      }
    } else if (ann.mode === 'every_login') {
      const sessionDismissed = sessionStorage.getItem('kingmc_ann_dismiss_session_' + annId);
      if (sessionDismissed) {
        return; // Đã đóng trong phiên làm việc này!
      }
    } else if (ann.mode === 'time_range') {
      if (ann.startDate && new Date(ann.startDate + 'T00:00:00') > now) return;
      if (ann.endDate && new Date(ann.endDate + 'T23:59:59') < now) return;
      const dismissedDate = localStorage.getItem('kingmc_ann_dismiss_range_' + annId);
      if (dismissedDate === todayStr) {
        return;
      }
    }

    showUserAnnouncement(ann);
  } catch (_) {}
}

function showUserAnnouncement(ann) {
  if (!ann) return;
  currentUserAnnouncement = ann;
  const titleEl = document.getElementById('userAnnouncementTitle');
  const bodyEl = document.getElementById('userAnnouncementBody');
  const timeEl = document.getElementById('userAnnouncementTime');
  const freqEl = document.getElementById('userAnnouncementFreqNote');

  if (titleEl) titleEl.textContent = ann.title || 'THÔNG BÁO HỆ THỐNG';
  if (bodyEl) bodyEl.innerHTML = renderAnnouncementHtml(ann.content || '');
  if (timeEl) {
    const d = ann.updatedAt ? new Date(ann.updatedAt) : new Date();
    timeEl.textContent = 'Cập nhật: ' + d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN');
  }
  if (freqEl) {
    if (ann.mode === 'daily') {
      freqEl.innerHTML = '🗓️ <span>Thông báo xuất hiện 1 lần mỗi ngày khi truy cập</span>';
    } else if (ann.mode === 'every_login') {
      freqEl.innerHTML = '⚡ <span>Thông báo xuất hiện mỗi phiên đăng nhập</span>';
    } else if (ann.mode === 'time_range') {
      freqEl.innerHTML = '⏳ <span>Áp dụng từ ' + escapeHtml(ann.startDate || '...') + ' đến ' + escapeHtml(ann.endDate || '...') + '</span>';
    }
  }

  document.getElementById('userAnnouncementModal')?.classList.remove('hidden');
}

function dismissUserAnnouncement() {
  document.getElementById('userAnnouncementModal')?.classList.add('hidden');
  if (!currentUserAnnouncement) return;
  const ann = currentUserAnnouncement;
  const annId = ann.id || 'default';
  const todayStr = new Date().toLocaleDateString('sv-SE');

  if (ann.mode === 'daily') {
    localStorage.setItem('kingmc_ann_dismiss_daily_' + annId, todayStr);
  } else if (ann.mode === 'every_login') {
    sessionStorage.setItem('kingmc_ann_dismiss_session_' + annId, '1');
  } else if (ann.mode === 'time_range') {
    localStorage.setItem('kingmc_ann_dismiss_range_' + annId, todayStr);
  }
}

async function openAnnouncementAdminModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền cài đặt thông báo.');
    return;
  }
  try {
    const res = await requestJson('/api/manager/announcement');
    const ann = (res.ok && res.data?.announcement) ? res.data.announcement : {};
    const enabledEl = document.getElementById('announcementEnabled');
    const titleEl = document.getElementById('announcementTitle');
    const contentEl = document.getElementById('announcementContent');
    const modeEl = document.getElementById('announcementMode');
    const startEl = document.getElementById('announcementStartDate');
    const endEl = document.getElementById('announcementEndDate');

    if (enabledEl) enabledEl.checked = ann.enabled !== false;
    if (titleEl) titleEl.value = ann.title || '📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN';
    if (contentEl) contentEl.value = ann.content || '';
    if (modeEl) modeEl.value = ann.mode || 'daily';
    if (startEl) startEl.value = ann.startDate || '';
    if (endEl) endEl.value = ann.endDate || '';

    handleAnnouncementModeChange();
    document.getElementById('announcementAdminModal')?.classList.remove('hidden');
  } catch (err) {
    showToast('Lỗi tải thông báo: ' + err.message);
  }
}

function closeAnnouncementAdminModal() {
  document.getElementById('announcementAdminModal')?.classList.add('hidden');
}

function handleAnnouncementModeChange() {
  const mode = document.getElementById('announcementMode')?.value;
  const rangeGroup = document.getElementById('announcementDateRangeGroup');
  if (rangeGroup) {
    rangeGroup.style.display = (mode === 'time_range') ? 'block' : 'none';
  }
}

async function saveAnnouncementConfig() {
  const enabled = !!document.getElementById('announcementEnabled')?.checked;
  const title = String(document.getElementById('announcementTitle')?.value || '').trim();
  const content = String(document.getElementById('announcementContent')?.value || '').trim();
  const mode = String(document.getElementById('announcementMode')?.value || 'daily');
  const startDate = String(document.getElementById('announcementStartDate')?.value || '').trim();
  const endDate = String(document.getElementById('announcementEndDate')?.value || '').trim();

  if (!title) { showToast('Vui lòng nhập tiêu đề thông báo.'); return; }
  if (enabled && !content) { showToast('Vui lòng nhập nội dung thông báo.'); return; }

  try {
    const res = await requestJson('/api/manager/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, title, content, mode, startDate, endDate })
    });
    if (res.ok) {
      showToast(res.data?.message || 'Đã lưu cấu hình thông báo!');
      closeAnnouncementAdminModal();
    } else {
      showToast(res.data?.error || 'Lỗi khi lưu thông báo.');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message);
  }
}

function previewAnnouncementModal() {
  const enabled = !!document.getElementById('announcementEnabled')?.checked;
  const title = String(document.getElementById('announcementTitle')?.value || '').trim();
  const content = String(document.getElementById('announcementContent')?.value || '').trim();
  const mode = String(document.getElementById('announcementMode')?.value || 'daily');
  const startDate = String(document.getElementById('announcementStartDate')?.value || '').trim();
  const endDate = String(document.getElementById('announcementEndDate')?.value || '').trim();

  showUserAnnouncement({
    enabled,
    title: title || '📢 THÔNG BÁO XEM TRƯỚC',
    content: content || 'Nội dung thông báo mẫu...',
    mode,
    startDate,
    endDate,
    updatedAt: new Date().toISOString()
  });
}

function openBatchSettingsModal() {
  const tagSelect = document.getElementById('batchTargetTag');
  if (tagSelect) {
    const existingTags = new Set();
    (bots || []).forEach(b => {
      if (Array.isArray(b.tags)) b.tags.forEach(t => existingTags.add(String(t).toLowerCase()));
    });
    let html = '<option value="">🌐 Toàn bộ bot trong danh sách (' + (bots || []).length + ' bot)</option>';
    Array.from(existingTags).sort().forEach(tag => {
      const count = (bots || []).filter(b => Array.isArray(b.tags) && b.tags.map(x => String(x).toLowerCase()).includes(tag)).length;
      html += '<option value="' + escapeHtml(tag) + '">🏷️ Nhóm tag #' + escapeHtml(tag) + ' (' + count + ' bot)</option>';
    });
    tagSelect.innerHTML = html;
    if (activeTagFilter && existingTags.has(activeTagFilter.toLowerCase())) {
      tagSelect.value = activeTagFilter.toLowerCase();
    }
  }
  document.getElementById('batchSettingsModal')?.classList.remove('hidden');
}
function closeBatchSettingsModal() {
  document.getElementById('batchSettingsModal')?.classList.add('hidden');
}
function handleBatchScheduleModeChange() {
  const mode = document.getElementById('batchScheduleMode')?.value;
  const isFixed = mode === 'fixed';
  const fixedBox = document.getElementById('batchFixedSettings');
  const cycleBox = document.getElementById('batchCycleSettings');
  if (fixedBox) fixedBox.style.display = isFixed ? 'block' : 'none';
  if (cycleBox) cycleBox.style.display = isFixed ? 'none' : 'block';
}
window.handleBatchScheduleModeChange = handleBatchScheduleModeChange;

async function submitBatchSettings() {
  const targetTag = document.getElementById('batchTargetTag')?.value || '';
  const settings = {
    ecoMode: !!document.getElementById('batchEcoMode')?.checked,
    autoTotem: !!document.getElementById('batchAutoTotem')?.checked,
    antiHungry: !!document.getElementById('batchAntiHungry')?.checked,
    autoReconnect: !!document.getElementById('batchAutoReconnect')?.checked,
    antiAfkKick: !!document.getElementById('batchAntiAfkKick')?.checked
  };

  if (document.getElementById('batchSyncSpawnCommandsEnabled')?.checked) {
    settings.spawnCommands = String(document.getElementById('batchSpawnCommands')?.value || '').trim();
  }

  const syncSchedule = !!document.getElementById('batchSyncScheduleEnabled')?.checked;
  let botSchedules = null;
  if (syncSchedule) {
    const enabled = !!document.getElementById('batchScheduleActive')?.checked;
    const mode = document.getElementById('batchScheduleMode')?.value === 'cycle' ? 'cycle' : 'fixed';
    let items = [];
    if (mode === 'fixed') {
      const stopTime = String(document.getElementById('batchFixedStopTime')?.value || '03:00').trim();
      const startTime = String(document.getElementById('batchFixedStartTime')?.value || '06:00').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(stopTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
        showToast('Giờ hẹn bật/tắt cố định không hợp lệ.');
        return;
      }
      items = [
        { id: 'batch-stop', action: 'stop', time: stopTime },
        { id: 'batch-start', action: 'start', time: startTime }
      ];
    } else {
      const stopMin = clampClientNumber(document.getElementById('batchCycleStopMinutes')?.value, 120, 1, 43200);
      const startMin = clampClientNumber(document.getElementById('batchCycleStartMinutes')?.value, 300, 1, 43200);
      items = [
        { id: 'batch-stop', action: 'stop', afterMinutes: stopMin },
        { id: 'batch-start', action: 'start', afterMinutes: startMin }
      ];
    }
    botSchedules = [{ id: 'batch-' + Date.now(), enabled, mode, items }];
  }

  showToast('Đang đồng bộ cài đặt' + (syncSchedule ? ' & hẹn giờ' : '') + ' cho các bot...');
  try {
    const payload = { settings, botSchedules };
    if (targetTag) payload.tag = targetTag;
    const res = await requestJson('/api/manager/all/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 25000
    });
    if (res.ok && res.data?.ok && (res.data?.okCount === undefined || res.data?.okCount === res.data?.total)) {
      closeBatchSettingsModal();
      showToast('Đã đồng bộ thành công cho ' + (res.data?.total ?? res.data?.okCount ?? '') + ' bot!');
      await refreshHome();
    } else {
      const failCount = (res.data?.total || 0) - (res.data?.okCount || 0);
      showToast(res.data?.error || ('⚠️ Đồng bộ không hoàn tất: ' + failCount + ' bot thất bại.'));
      await refreshHome();
    }
  } catch(err) {
    showToast(err.message || 'Lỗi kết nối.');
  }
}

async function openWebhookModal() {
  const modal = document.getElementById('webhookModal');
  if(!modal) return;
  modal.classList.remove('hidden');
  try {
    const res = await requestJson('/api/manager/webhook');
    if(res.ok && res.data?.webhook) {
      const w = res.data.webhook;
      document.getElementById('webhookEnabled').checked = !!w.enabled;
      document.getElementById('webhookDiscordUrl').value = w.discordUrl || '';
      document.getElementById('webhookTelegramToken').value = w.telegramToken || '';
      document.getElementById('webhookTelegramChatId').value = w.telegramChatId || '';
      document.getElementById('webhookNotifyOffline').checked = w.notifyOnOffline !== false;
      document.getElementById('webhookNotifyRecover').checked = w.notifyOnRecover !== false;
      document.getElementById('webhookNotifyLowTotem').checked = w.notifyOnLowTotem !== false;
      document.getElementById('webhookNotifyLowHealth').checked = w.notifyOnLowHealth !== false;
      document.getElementById('webhookNotifyDeath').checked = w.notifyOnDeath !== false;
      document.getElementById('webhookOfflineThreshold').value = w.offlineThresholdMinutes || 5;
    }
  } catch(_) {}
}

function closeWebhookModal() {
  document.getElementById('webhookModal')?.classList.add('hidden');
}

async function saveWebhookSettings() {
  const payload = {
    enabled: !!document.getElementById('webhookEnabled')?.checked,
    discordUrl: document.getElementById('webhookDiscordUrl')?.value?.trim() || '',
    telegramToken: document.getElementById('webhookTelegramToken')?.value?.trim() || '',
    telegramChatId: document.getElementById('webhookTelegramChatId')?.value?.trim() || '',
    notifyOnOffline: !!document.getElementById('webhookNotifyOffline')?.checked,
    notifyOnRecover: !!document.getElementById('webhookNotifyRecover')?.checked,
    notifyOnLowTotem: !!document.getElementById('webhookNotifyLowTotem')?.checked,
    notifyOnLowHealth: !!document.getElementById('webhookNotifyLowHealth')?.checked,
    notifyOnDeath: !!document.getElementById('webhookNotifyDeath')?.checked,
    offlineThresholdMinutes: Number(document.getElementById('webhookOfflineThreshold')?.value) || 5
  };
  try {
    const res = await requestJson('/api/manager/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(res.data?.error || 'Lỗi lưu cấu hình.');
    showToast('✅ Đã lưu cấu hình Webhook thành công!');
    closeWebhookModal();
  } catch(err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function testWebhookSettings() {
  const payload = {
    discordUrl: document.getElementById('webhookDiscordUrl')?.value?.trim() || '',
    telegramToken: document.getElementById('webhookTelegramToken')?.value?.trim() || '',
    telegramChatId: document.getElementById('webhookTelegramChatId')?.value?.trim() || ''
  };
  try {
    showToast('Đang gửi thử tin nhắn Webhook...');
    const res = await requestJson('/api/manager/webhook/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(res.data?.error || 'Không gửi được test.');
    showToast('✅ ' + (res.data?.message || 'Gửi test thành công!'));
  } catch(err) {
    showToast('Lỗi test: ' + err.message);
  }
}

function generateSparklineSvg(points, strokeColor, width=44, height=14) {
  if(!Array.isArray(points) || points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = (max - min) || 1;
  const step = width / (points.length - 1);
  const ptsArr = points.map((v, i) => {
    const x = Math.round(i * step * 10) / 10;
    const y = Math.round((height - 2 - ((v - min) / range) * (height - 4)) * 10) / 10;
    return x + ',' + y;
  });
  const pts = ptsArr.join(' ');
  const areaPts = '0,' + height + ' ' + pts + ' ' + width + ',' + height;
  return '<svg width="'+width+'" height="'+height+'" style="display:inline-block;vertical-align:middle;margin-left:3px;opacity:0.95;" title="Lịch sử: '+points.join(' -> ')+'"><polygon fill="'+strokeColor+'" fill-opacity="0.18" points="'+areaPts+'"/><polyline fill="none" stroke="'+strokeColor+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="'+pts+'"/></svg>';
}

async function exportBotLogs(event, botId) {
  if(event) event.stopPropagation();
  try {
    showToast('Đang lấy dữ liệu log của Bot ' + botId + '...');
    const result = await requestJson('/api/manager/bot/' + encodeURIComponent(String(botId)) + '/logs');
    if(!result.ok) throw new Error(result.data?.error || 'Không thể lấy log.');
    const logLines = (result.data?.logs || []).join('\n') || 'Chưa có dữ liệu log.';
    const blob = new Blob([logLines], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bot-' + botId + '-logs-' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    showToast('✅ Đã tải file log về máy.');
  } catch(err) {
    showToast('Lỗi tải log: ' + (err.message || 'Không thành công.'));
  }
}

async function getHomeBots() {
  const result=await requestJson('/api/manager/bots');
  if(!result.ok){const error=new Error(result.data?.error||('HTTP '+result.status));error.status=result.status;throw error;}
  return result.data||{};
}

async function getRegistryFallback() {
  const result=await requestJson('/api/manager/registry');
  if(!result.ok)throw new Error(result.data?.error||('HTTP '+result.status));
  const data=result.data||{};
  const list=Array.isArray(data.bots)?data.bots:[];
  return {
    ok:true,
    bots:list.map(bot=>({
      id:Number(bot.id),
      url:bot.url||'',
      source:bot.source||'unknown',
      botId:String(bot.id),
      label:bot.label||('Bot '+bot.id),
      configured:!!bot.url,
      available:false,
      username:'',
      status:'offline',
      ready:false,
      ping:null,
      uptime:'0h 0m 0s',
      uptimeSeconds:0,
      reconnectCount:0,
      host:'',
      port:null,
      position:null,
      dimension:null,
      ipAddress:'',
      locationState:'unknown',
      roundedLocation:null,
      settings:null,
      totemCount:0,
      foodCount:0,
      memory:null,
      rssMb:0,
      heapMb:0,
      error:'Đang chờ bot phản hồi...'
    }))
  };
}

async function refreshHome() {
  if(homeRequestInFlight || selectedBotId!==null) return;
  homeRequestInFlight=true;
  try {
    let data;
    try {
      data=await getHomeBots();
    }catch(primaryError){
      try { data=await getRegistryFallback(); }
      catch(_){ throw primaryError; }
    }
    bots=Array.isArray(data.bots)?data.bots:[];
    if (data.managerRamMb) {
      const ramStr = data.managerRamMb + ' MB';
      const r1 = document.getElementById('managerRamUsage');
      const r2 = document.getElementById('detailManagerRamUsage');
      const r3 = document.getElementById('globalManagerRam');
      if (r1) r1.textContent = ramStr;
      if (r2) r2.textContent = ramStr;
      if (r3) r3.textContent = ramStr;
    }
    const subtitle=document.getElementById('homeSubtitle');
    if(subtitle) subtitle.textContent='Quản lý tập trung '+bots.length+' bot';
    renderHome();
  updateUserHeaderCountdown();
  } catch(err) {
    const subtitle=document.getElementById('homeSubtitle');
    if(subtitle) subtitle.textContent='Không tải được danh sách bot';
  } finally {
    homeRequestInFlight=false;
  }
}

function updateAddBotUrlCounter() {
  const raw = String(document.getElementById('addBotUrl')?.value || '');
  const tokens = raw.split(/[\r\n\s,]+/).map(s => s.trim()).filter(Boolean);
  const badge = document.getElementById('addBotUrlCountBadge');
  const btn = document.getElementById('confirmAddBotButton');
  if (badge) {
    badge.textContent = tokens.length ? (tokens.length + ' link nhận diện') : '0 link';
  }
  if (btn) {
    btn.textContent = tokens.length > 1 ? ('➕ Thêm ' + tokens.length + ' Bot') : '➕ Thêm Bot';
  }
}
window.updateAddBotUrlCounter = updateAddBotUrlCounter;

function openAddBotModal() {
  const modal = document.getElementById('addBotModal');
  const url = document.getElementById('addBotUrl');
  const label = document.getElementById('addBotLabel');
  if (url) url.value = '';
  if (label) label.value = '';
  updateAddBotUrlCounter();
  if (modal) modal.classList.remove('hidden');
  setTimeout(() => url && url.focus(), 50);
}

function closeAddBotModal() {
  const modal = document.getElementById('addBotModal');
  if (modal) modal.classList.add('hidden');
}

async function addBotFromWeb() {
  const button = document.getElementById('confirmAddBotButton');
  const rawInput = String(document.getElementById('addBotUrl')?.value || '').trim();
  const label = String(document.getElementById('addBotLabel')?.value || '').trim();
  const tokens = rawInput.split(/[\r\n\s,]+/).map(s => s.trim()).filter(Boolean);
  if (!tokens.length) {
    showToast('Vui lòng nhập hoặc dán ít nhất 1 URL bot con.');
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = tokens.length > 1 ? '⏳ Đang thêm các bot...' : '⏳ Đang thêm bot...';
  }
  try {
    const result = await requestJson('/api/manager/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: tokens,
        url: tokens[0],
        label
      })
    });
    const data = result.data || {};
    if (!result.ok) throw new Error(data.error || 'Không thể thêm bot.');
    closeAddBotModal();
    showToast(data.message || 'Đã thêm bot thành công!');
    await refreshHome();
  } catch (err) {
    showToast(err.message || 'Không thể thêm bot.');
  } finally {
    if (button) {
      button.disabled = false;
      updateAddBotUrlCounter();
    }
  }
}

async function deleteBot(event,id) {
  if(event) event.stopPropagation();
  const bot=bots.find(x=>Number(x.id)===Number(id));
  if(!bot) return;
  if(!confirm('Xóa '+(bot.label||('Bot '+id))+' khỏi Manager?')) return;
  try {
    const result=await requestJson('/api/manager/bot/'+Number(id),{method:'DELETE'});
    const data=result.data||{};
    if(!result.ok) throw new Error(data.error||'Không thể xóa bot.');
    if(Number(selectedBotId)===Number(id)) goHome();
    showToast(data.message||'Đã xóa bot.');
    await refreshHome();
  } catch(err) {
    showToast(err.message||'Không thể xóa bot.');
  }
}

function openBot(id) {
  selectedBotId=Number(id);
  invalidateDetailReads();
  // Reset all detail UI fields to prevent stale ghost data
  const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '<div style="color:var(--muted);padding:8px;">Đang tải lịch sử chat...</div>';
  const dEvt = document.getElementById('detailEventLogs'); if (dEvt) dEvt.innerHTML = '<div style="color:var(--muted);padding:8px;">Đang tải nhật ký sự kiện...</div>';
  const dUser = document.getElementById('detailUsernameInput'); if (dUser) dUser.value = '';
  const dPass = document.getElementById('detailPasswordInput'); if (dPass) dPass.value = '';
  const dUp = document.getElementById('detailUptime'); if (dUp) dUp.textContent = '-';
  const dRec = document.getElementById('detailReconnects'); if (dRec) dRec.textContent = '-';
  const dStat = document.getElementById('detailStatus'); if (dStat) dStat.innerHTML = '<span class="dot yellow"></span> Đang tải...';
  const dInv = document.getElementById('detailInventory'); if (dInv) dInv.innerHTML = '';
  const dHot = document.getElementById('detailHotbar'); if (dHot) dHot.innerHTML = '';
  const selected=bots.find(item=>Number(item.id)===selectedBotId);
  const url=new URL(window.location.href);
  url.searchParams.set('bot',String(selectedBotId));
  if(selected?.url) url.searchParams.set('botUrl',selected.url); else url.searchParams.delete('botUrl');
  history.pushState({bot:selectedBotId,botUrl:selected?.url||''},'',url);
  document.getElementById('homePage').classList.add('hidden');
  document.getElementById('detailPage').classList.remove('hidden');
  lastEventRevision=-1;
  lastChatRevision=-1;
  detailInventory=null;
  detailSettingsDirty=false;
  detailAutoChatDirty=false;
  detailBotScheduleDirty=false;
  renderDetailRemoteGui(null);
  setTimeout(initDetailChatInputHistory, 50);
  void refreshDetail(true);
}

function goHome() {
  invalidateDetailReads();
  selectedBotId=null;
  const url=new URL(window.location.href);
  url.searchParams.delete('bot');
  url.searchParams.delete('botUrl');
  history.pushState({},'',url.pathname+url.search);
  document.getElementById('detailPage').classList.add('hidden');
  document.getElementById('homePage').classList.remove('hidden');
  refreshHome();
}

async function resolveRouteFromUrl() {
  routeResolving=true;
  try {
    const url=new URL(window.location.href);
    const identity=normalizeClientBotUrl(url.searchParams.get('botUrl'));
    if(identity){
      try{
        const result=await requestJson('/api/manager/registry');
        const match=(result.data?.bots||[]).find(item=>normalizeClientBotUrl(item.url)===identity);
        if(match){
          selectedBotId=Number(match.id);
          invalidateDetailReads();
          document.getElementById('homePage').classList.add('hidden');
          document.getElementById('detailPage').classList.remove('hidden');
          lastEventRevision=-1;
          lastChatRevision=-1;
          detailInventory=null;
          detailSettingsDirty=false;
          detailAutoChatDirty=false;
          detailBotScheduleDirty=false;
          setTimeout(initDetailChatInputHistory, 50);
          await refreshDetail(true);
          return true;
        }
        // A persisted URL identity that no longer exists must never silently fall
        // through to a recycled numeric runtime id.
        selectedBotId=null;
        document.getElementById('detailPage').classList.add('hidden');
        document.getElementById('homePage').classList.remove('hidden');
        return false;
      }catch(_) {
        // Keep legacy numeric fallback only when the identity lookup itself failed.
      }
    }

    const id=Number(url.searchParams.get('bot'));
    if(Number.isInteger(id)&&id>0){
      selectedBotId=id;
      invalidateDetailReads();
      document.getElementById('homePage').classList.add('hidden');
      document.getElementById('detailPage').classList.remove('hidden');
      lastEventRevision=-1;
      lastChatRevision=-1;
      detailInventory=null;
      detailSettingsDirty=false;
      detailAutoChatDirty=false;
      detailBotScheduleDirty=false;
      setTimeout(initDetailChatInputHistory, 50);
      await refreshDetail(true);
      return true;
    }

    selectedBotId=null;
    document.getElementById('detailPage').classList.add('hidden');
    document.getElementById('homePage').classList.remove('hidden');
    return false;
  } finally {
    routeResolving=false;
  }
}

window.addEventListener('popstate',()=>{
  detailSettingsDirty=false;
  detailAutoChatDirty=false;
  detailBotScheduleDirty=false;
  void resolveRouteFromUrl().then(()=>{if(selectedBotId===null) return refreshHome();});
});

async function runAllAction(action) {
  if(allLifecycleActionInFlight) return;
  allLifecycleActionInFlight=true;
  const buttonMap={start:'allStartButton',stop:'allStopButton',restart:'allRestartButton'};
  Object.values(buttonMap).forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=true;});
  try {
    const result=await requestJson('/api/manager/all/'+encodeURIComponent(action),{method:'POST',timeoutMs:30000});
    const data=result.data||{};
    if(!result.ok) throw new Error(data.error||'Thao tác thất bại.');
    const summary=(data.results||[]).map(x=>x.label+': '+(x.ok?'OK':'FAIL')).join(' | ');
    showToast(summary||data.message||'Đã thực hiện.');
    await refreshHome();
  } catch(err) {
    showToast(err.message||'Không thể thực hiện thao tác.');
  } finally {
    allLifecycleActionInFlight=false;
    Object.values(buttonMap).forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=false;});
  }
}

function detailStatusHtml() {
  if(!detailBot) return;
  const [color,label]=statusMeta(detailBot.status,detailBot.available,!!detailBot.manuallyStopped);
  document.getElementById('detailStatus').innerHTML='<span class="dot '+color+'"></span>'+escapeHtml(label);
  document.getElementById('detailTitle').textContent=detailBot.label||('Bot '+selectedBotId);
  document.getElementById('detailUsername').textContent=detailBot.username||'Chưa đặt';
  document.getElementById('detailHost').textContent=detailBot.host?detailBot.host+':'+detailBot.port:'-';
  document.getElementById('detailPing').textContent=Number.isFinite(Number(detailBot.ping))?Number(detailBot.ping)+' ms':'--';
  const tpsEl = document.getElementById('detailTps');
  if (tpsEl) {
    const tpsVal = Number(detailBot.tps ?? detailBot.serverTps ?? 20.0);
    tpsEl.textContent = tpsVal.toFixed(1);
    tpsEl.style.color = tpsVal >= 18.5 ? 'var(--green)' : (tpsVal >= 14.0 ? 'var(--yellow)' : 'var(--red)');
  }
  const pos=detailBot.position;
  document.getElementById('detailPosition').textContent=pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y)&&Number.isFinite(pos.z)?Math.round(pos.x)+' '+Math.round(pos.y)+' '+Math.round(pos.z):'-';
  document.getElementById('detailDimension').textContent=detailBot.dimension||'-';
  document.getElementById('detailIp').textContent=detailBot.ipAddress||'-';

  const hw = detailBot.hostHardware;
  const botRamMb = Number(hw?.botRssMb || detailBot.ramRss || detailBot.rssMb || detailBot.memory?.rssMb || 0);

  // 1. RAM Máy Host
  const hostRamEl = document.getElementById('detailHostRam');
  if (hostRamEl) {
    if (hw && hw.ramTotalMb > 0) {
      hostRamEl.textContent = hw.ramUsedMb + ' / ' + hw.ramTotalMb + ' MB (' + hw.ramPercent + '%)';
      hostRamEl.style.color = hw.ramPercent > 85 ? 'var(--red)' : hw.ramPercent > 70 ? 'var(--yellow)' : 'var(--green)';
    } else {
      hostRamEl.textContent = '--';
    }
  }

  // 2. CPU Máy Host
  const hostCpuEl = document.getElementById('detailHostCpu');
  if (hostCpuEl) {
    if (hw) {
      hostCpuEl.textContent = hw.cpuPercent + '% / ' + hw.cpuCores + ' Cores';
      hostCpuEl.style.color = hw.cpuPercent > 85 ? 'var(--red)' : hw.cpuPercent > 60 ? 'var(--yellow)' : '#38bdf8';
    } else {
      hostCpuEl.textContent = '--';
    }
  }

  // 3. Lưu lượng mạng
  const hostNetEl = document.getElementById('detailHostNet');
  if (hostNetEl) {
    if (hw) {
      hostNetEl.textContent = '↓ ' + hw.netDownKb + ' KB/s • ↑ ' + hw.netUpKb + ' KB/s (Tổng: ' + hw.netTotalRxMb + ' MB)';
    } else {
      hostNetEl.textContent = '--';
    }
  }

  // 4. RAM Bot con
  const ramEl = document.getElementById('detailRam');
  if (ramEl) {
    ramEl.textContent = botRamMb > 0 ? (botRamMb + ' MB RSS') : '--';
  }

  // 5. Uptime & Reconnects
  const uptimeEl = document.getElementById('detailUptime');
  if (uptimeEl) {
    const sec = Number(detailBot.uptimeSeconds || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    uptimeEl.textContent = h + 'h ' + m + 'm ' + s + 's';
  }
  const recEl = document.getElementById('detailReconnects');
  if (recEl) {
    recEl.textContent = String(detailBot.reconnectAttempts || detailBot.reconnectCount || 0);
  }

  // 6. Phân quyền đổi tài khoản Minecraft (Cứ cấp bot là auto được đổi)
  const accountPanel = document.getElementById('detailAccountPanel');
  if (accountPanel) {
    accountPanel.style.display = 'block';
  }

  // Render Proxy riêng của Bot
  renderDetailProxy(detailBot.settings?.proxy);

  // 7. Render Remote GUI Inspector
  renderDetailRemoteGui(detailBot.currentWindow);

  document.getElementById('detailStartButton').disabled=false;
  document.getElementById('detailStopButton').disabled=false;
  document.getElementById('detailRestartButton').disabled=false;
}

async function detailGet(path) {
  if(selectedBotId===null) throw new Error('Chưa chọn bot.');
  const result=await requestJson('/api/manager/bot/'+encodeURIComponent(String(selectedBotId))+path);
  if(!result.ok){const error=new Error(result.data?.error||'Không thể lấy dữ liệu bot.');error.status=result.status;error.data=result.data||{};throw error;}
  return result.data||{};
}


// ----------------------------------------------------------------------------
// COMMERCIAL SAAS FRONTEND FUNCTIONS
// ----------------------------------------------------------------------------

function openBroadcastModal() {
  document.getElementById('broadcastCommandInput').value = '';
  document.getElementById('broadcastResultBox').style.display = 'none';
  const tagSelect = document.getElementById('broadcastTargetTag');
  if (tagSelect) {
    const existingTags = new Set();
    (bots || []).forEach(b => {
      if (Array.isArray(b.tags)) b.tags.forEach(t => existingTags.add(String(t).toLowerCase()));
    });
    let html = '<option value="">🌐 Toàn bộ bot trong danh sách (' + (bots || []).length + ' bot)</option>';
    Array.from(existingTags).sort().forEach(tag => {
      const count = (bots || []).filter(b => Array.isArray(b.tags) && b.tags.map(x => String(x).toLowerCase()).includes(tag)).length;
      html += '<option value="' + escapeHtml(tag) + '">🏷️ Nhóm tag #' + escapeHtml(tag) + ' (' + count + ' bot)</option>';
    });
    tagSelect.innerHTML = html;
    if (activeTagFilter && existingTags.has(activeTagFilter.toLowerCase())) {
      tagSelect.value = activeTagFilter.toLowerCase();
    }
  }
  document.getElementById('broadcastModal').classList.remove('hidden');
}

function closeBroadcastModal() {
  document.getElementById('broadcastModal').classList.add('hidden');
}

async function submitBroadcastCommand() {
  const msg = document.getElementById('broadcastCommandInput').value.trim();
  const targetTag = document.getElementById('broadcastTargetTag')?.value || '';
  const box = document.getElementById('broadcastResultBox');
  if (!msg) {
    box.style.display = 'block';
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = 'Vui lòng nhập lệnh cần gửi!';
    return;
  }
  box.style.display = 'block';
  box.style.background = 'rgba(56,189,248,0.2)';
  box.style.color = '#38bdf8';
  box.textContent = 'Đang bắn lệnh tới các bot...';
  try {
    const payload = { message: msg };
    if (targetTag) payload.tag = targetTag;
    const res = await requestJson('/api/manager/all/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      box.style.background = 'rgba(16,185,129,0.2)';
      box.style.color = 'var(--green)';
      box.textContent = res.data?.message || 'Đã gửi thành công!';
      showToast('Đã broadcast lệnh thành công!');
      setTimeout(closeBroadcastModal, 1500);
    } else {
      box.style.background = 'rgba(239,68,68,0.2)';
      box.style.color = 'var(--red)';
      box.textContent = res.data?.error || 'Lỗi gửi broadcast.';
    }
  } catch(e) {
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = e.message || 'Lỗi mạng.';
  }
}

function openRenewModal() {
  document.getElementById('renewKeyInput').value = '';
  document.getElementById('renewResultBox').style.display = 'none';
  document.getElementById('renewModal').classList.remove('hidden');
}

function closeRenewModal() {
  document.getElementById('renewModal').classList.add('hidden');
}

async function submitRenewKey() {
  const key = document.getElementById('renewKeyInput').value.trim().toUpperCase();
  const box = document.getElementById('renewResultBox');
  if (!key) {
    box.style.display = 'block';
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = 'Vui lòng nhập mã Key!';
    return;
  }
  box.style.display = 'block';
  box.style.background = 'rgba(56,189,248,0.2)';
  box.style.color = '#38bdf8';
  box.textContent = 'Đang kích hoạt Key...';
  try {
    const res = await requestJson('/api/manager/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (res.ok) {
      box.style.background = 'rgba(16,185,129,0.2)';
      box.style.color = 'var(--green)';
      box.textContent = res.data?.message || 'Gia hạn thành công!';
      showToast('🎉 Kích hoạt Key gia hạn thành công!');
      if (currentUser && res.data.expiresAt) {
        currentUser.expiresAt = res.data.expiresAt;
        updateUserHeaderCountdown();
      }
      setTimeout(closeRenewModal, 1800);
    } else {
      box.style.background = 'rgba(239,68,68,0.2)';
      box.style.color = 'var(--red)';
      box.textContent = res.data?.error || 'Kích hoạt thất bại.';
    }
  } catch (e) {
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = e.message || 'Lỗi kết nối.';
  }
}

async function openKeyManagementModal() {
  document.getElementById('keyManagementModal').classList.remove('hidden');
  await refreshKeysTable();
}

function closeKeyManagementModal() {
  document.getElementById('keyManagementModal').classList.add('hidden');
}

async function refreshKeysTable() {
  const tbody = document.getElementById('keysTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--muted);">Đang tải danh sách Key...</td></tr>';
  try {
    const res = await requestJson('/api/manager/keys');
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi tải danh sách key');
    const keys = res.data?.keys || [];
    if (!keys.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--muted);">Chưa có mã Key nào. Bấm Tạo Key phía trên để tạo mới.</td></tr>';
      return;
    }
    tbody.innerHTML = keys.map(k => {
      const isUsed = !!k.used;
      const statusBadge = isUsed
        ? '<span style="color:var(--red);background:rgba(239,68,68,0.15);padding:2px 6px;border-radius:4px;">Đã dùng</span>'
        : '<span style="color:var(--green);background:rgba(16,185,129,0.15);padding:2px 6px;border-radius:4px;">Chưa dùng</span>';
      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:8px 10px;font-family:monospace;font-weight:700;color:#38bdf8;">' + escapeHtml(k.key) + '</td>' +
        '<td style="padding:8px 10px;">' + escapeHtml(k.planName || (k.days + ' Ngày')) + '</td>' +
        '<td style="padding:8px 10px;">' + statusBadge + '</td>' +
        '<td style="padding:8px 10px;color:var(--muted);">' + (isUsed ? (escapeHtml(k.usedBy) + ' (' + new Date(k.usedAt).toLocaleDateString('vi-VN') + ')') : '-') + '</td>' +
        '<td style="padding:8px 10px;text-align:right;">' +
          '<button type="button" class="small btn-copy-key" data-key="' + escapeHtml(k.key) + '" style="margin-right:6px;">📋 Copy</button>' +
          '<button type="button" class="small danger btn-delete-key" data-key="' + escapeHtml(k.key) + '">🗑 Xóa</button>' +
        '</td>' +
      '</tr>';
    }).join('');
    if (!tbody._delegationInit) {
      tbody._delegationInit = true;
      tbody.addEventListener('click', function(e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('btn-copy-key')) {
          copyToClipboard(btn.getAttribute('data-key'), 'Mã Key');
        } else if (btn.classList.contains('btn-delete-key')) {
          deleteLicenseKey(btn.getAttribute('data-key'));
        }
      });
    }
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--red);">' + escapeHtml(e.message) + '</td></tr>';
  }
}

async function submitCreateKeys() {
  const daysSelect = document.getElementById('createKeyDays')?.value;
  const customInp = document.getElementById('createKeyCustomDays');
  let days = 7;
  if (daysSelect === 'custom') {
    const customVal = parseInt(customInp?.value, 10);
    if (!Number.isFinite(customVal) || customVal < 1) {
      showToast('Vui lòng nhập số ngày hợp lệ (tối thiểu 1 ngày).', 'error');
      if (customInp) customInp.focus();
      return;
    }
    days = Math.min(customVal, 3650);
  } else {
    days = Number(daysSelect) || 7;
  }
  const defaultPlanName = 'Gói ' + days + ' Ngày';
  const planName = document.getElementById('createKeyPlan')?.value.trim() || defaultPlanName;
  const count = Number(document.getElementById('createKeyCount')?.value) || 1;
  try {
    const res = await requestJson('/api/manager/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days, planName, count })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi tạo key');
    showToast(res.data?.message || 'Đã tạo key thành công!');
    await refreshKeysTable();
  } catch(e) {
    showToast(e.message || 'Lỗi tạo key');
  }
}

async function deleteLicenseKey(key) {
  if (!confirm('Bạn có chắc chắn muốn xóa mã Key ' + key + ' không?')) return;
  try {
    const res = await requestJson('/api/manager/keys/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi xóa key');
    showToast('Đã xóa key ' + key);
    await refreshKeysTable();
  } catch(e) {
    showToast(e.message || 'Lỗi xóa key');
  }
}

async function quickAddUserDays(username, days) {
  const label = days === -1 ? 'Vĩnh viễn' : ('+' + days + ' ngày');
  if (!confirm('Cộng ' + label + ' hạn thuê cho tài khoản ' + username + '?')) return;
  try {
    const res = await requestJson('/api/manager/user/' + encodeURIComponent(username) + '/add-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi cập nhật');
    showToast(res.data?.message || 'Đã cộng ngày thuê!');
    if (typeof refreshUserManagementList === 'function') refreshUserManagementList();
  } catch(e) {
    showToast(e.message || 'Lỗi cộng ngày thuê');
  }
}

async function resetCustomerBot() {
  if (!selectedBotId) return;
  if (!confirm('⚠️ BẠN CÓ CHẮC CHẮN MUỐN RESET BÀN GIAO BOT?\n\nThao tác này sẽ:\n1. Dừng bot ngay lập tức\n2. Xóa sạch tài khoản Minecraft cũ trên bot\n3. Xóa toàn bộ lịch sử Chat và Event Log\n4. Tắt toàn bộ lịch hẹn giờ và auto-chat\n\nSẵn sàng 100% để giao cho khách thuê mới!')) return;
  try {
    invalidateDetailReads();
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/reset-customer', { method: 'POST' });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi reset bot');
    showToast(res.data?.message || 'Đã reset bàn giao bot thành công!');
    if (detailBot) {
      detailBot.username = '';
      detailBot.status = 'offline';
      detailBot.manuallyStopped = true;
    }
    const uInput = document.getElementById('detailUsernameInput'); if (uInput) uInput.value = '';
    const pInput = document.getElementById('detailPasswordInput'); if (pInput) pInput.value = '';
    const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '<div style="color:var(--muted);padding:8px;">Chưa có tin nhắn nào.</div>';
    const dLog = document.getElementById('detailEventLogs'); if (dLog) dLog.innerHTML = '<div style="color:var(--muted);padding:8px;">Chưa có nhật ký nào.</div>';
    detailStatusHtml();
    renderDetailAutoChatSchedules([]);
    renderDetailBotSchedules([]);
    const botIdx = bots.findIndex(b => Number(b.id) === Number(selectedBotId));
    if (botIdx !== -1) {
      bots[botIdx].username = '';
      bots[botIdx].status = 'offline';
      bots[botIdx].manuallyStopped = true;
    }
    await refreshDetail(true);
  } catch(e) {
    showToast(e.message || 'Lỗi reset bàn giao');
  }
}

function renderDetailRemoteGui(win) {
  const card = document.getElementById('detailRemoteGuiCard');
  if (!card) return;
  const placeholder = document.getElementById('detailRemoteGuiPlaceholder');
  const content = document.getElementById('detailRemoteGuiContent');
  const badge = document.getElementById('detailRemoteGuiBadge');
  const closeBtn = document.getElementById('detailRemoteGuiCloseBtn');
  const titleEl = document.getElementById('detailRemoteGuiTitle');

  if (!win || !win.slots || win.slots.length === 0) {
    if (placeholder) placeholder.style.display = 'block';
    if (content) content.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    if (titleEl) titleEl.textContent = '🖥️ Cửa Sổ GUI / Menu Ingame';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';
  if (content) content.style.display = 'block';
  if (badge) badge.style.display = 'inline-block';
  if (closeBtn) closeBtn.style.display = 'inline-block';
  if (titleEl) titleEl.textContent = '🖥️ ' + (win.title || 'GUI Sảnh / Máy Chủ Đang Mở');

  const container = document.getElementById('detailRemoteGuiSlots');
  if (!container) return;
  container.innerHTML = win.slots.slice(0, 54).map(function(item, idx) {
    if (!item) {
      return '<div onclick="clickDetailGuiSlot(' + idx + ')" style="aspect-ratio:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.18);font-size:10px;font-family:monospace;" title="Ô #' + idx + ' (Trống)">' + idx + '</div>';
    }
    const rawName = String(item.displayName || item.name || 'Vật phẩm');
    const safeName = escapeHtml(rawName);
    return '<div onclick="clickDetailGuiSlot(' + idx + ')" style="aspect-ratio:1;background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.45);border-radius:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;padding:3px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:all 0.15s ease;" onmouseenter="this.style.transform=\'scale(1.05)\'" onmouseleave="this.style.transform=\'none\'" title="Ô #' + idx + ': ' + safeName + ' (Click để chọn)">' +
      '<span style="font-size:11px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.2;max-width:100%;word-break:break-word;">' + safeName + '</span>' +
      (item.count > 1 ? '<span style="position:absolute;bottom:2px;right:2px;font-size:9.5px;font-weight:800;background:rgba(15,23,42,0.9);border:1px solid rgba(56,189,248,0.4);padding:0 3px;border-radius:3px;color:#38bdf8;">x' + item.count + '</span>' : '') +
      '</div>';
  }).join('');
}

async function clickDetailGuiSlot(slot) {
  if (!selectedBotId) return;
  try {
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/window/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, mouseButton: 0 })
    });
    if (!res.ok) showToast(res.data?.error || 'Lỗi click GUI');
    else showToast('Đã click ô ' + slot);
  } catch(e) {
    showToast('Lỗi gửi click GUI');
  }
}

async function closeDetailGuiWindow() {
  if (!selectedBotId) return;
  try {
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/window/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!res.ok) {
      showToast(res.data?.error || 'Không thể đóng GUI.');
      return;
    }
    showToast(res.data?.message || 'Đã đóng GUI.');
    await refreshDetail(true);
  } catch (_) {
    showToast('Lỗi gửi yêu cầu đóng GUI.');
  }
}

function formatFullDateTime(isoString) {
  if (!isoString) return 'Vĩnh Viễn';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'Không xác định';
  const pad = function(n) { return String(n).padStart(2, '0'); };
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  return hours + ':' + minutes + ' - ' + day + '/' + month + '/' + year;
}

function formatRentalCountdown(isoString) {
  if (!isoString) return { expired: false, text: 'Vĩnh viễn', color: 'var(--green)' };
  const expTime = Date.parse(isoString);
  if (isNaN(expTime)) return { expired: false, text: 'Không xác định', color: 'var(--muted)' };
  const diffMs = expTime - Date.now();
  if (diffMs <= 0) {
    return { expired: true, text: 'ĐÃ HẾT HẠN', color: 'var(--red)' };
  }
  const totalHours = Math.floor(diffMs / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  let text = '';
  if (days > 0) {
    text = 'Còn ' + days + ' ngày ' + hours + ' giờ ' + minutes + ' phút';
  } else if (hours > 0) {
    text = 'Còn ' + hours + ' giờ ' + minutes + ' phút';
  } else {
    text = 'Còn ' + minutes + ' phút';
  }
  let color = 'var(--green)';
  if (days < 1) color = 'var(--red)';
  else if (days < 3) color = 'var(--yellow)';
  return { expired: false, text: text, color: color };
}

function updateUserHeaderCountdown() {
  let badge = document.getElementById('userRentalCountdownBadge');
  const banner = document.getElementById('userRentalDashboardBanner');
  if (!currentUser || currentUser.role === 'admin') {
    if (badge) badge.style.display = 'none';
    if (banner) banner.style.display = 'none';
    return;
  }
  const topBar = document.querySelector('.top-actions') || document.querySelector('.header') || document.getElementById('homePage');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'userRentalCountdownBadge';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '8px';
    badge.style.fontSize = '12px';
    badge.style.padding = '4px 10px';
    badge.style.borderRadius = '20px';
    badge.style.marginRight = '8px';
    const ref = document.querySelector('.top-actions');
    if (ref) ref.insertBefore(badge, ref.firstChild);
  }

  const bannerIcon = document.getElementById('userRentalBannerIcon');
  const bannerPlan = document.getElementById('userRentalBannerPlan');
  const bannerExactTime = document.getElementById('userRentalBannerExactTime');
  const bannerCountdown = document.getElementById('userRentalBannerCountdown');

  if (banner) {
    banner.style.display = 'flex';
    if (bannerPlan) bannerPlan.textContent = currentUser.planName || 'Gói thường';
  }

  if (!currentUser.expiresAt) {
    badge.style.display = 'inline-flex';
    badge.style.background = 'rgba(16,185,129,0.15)';
    badge.style.color = 'var(--green)';
    badge.style.border = '1px solid rgba(16,185,129,0.3)';
    badge.innerHTML = '<span>👑 Hạn thuê: <b>VIP Vĩnh Viễn</b></span>';

    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '👑';
      if (bannerExactTime) bannerExactTime.textContent = 'Vĩnh Viễn';
      if (bannerCountdown) {
        bannerCountdown.textContent = 'Không giới hạn thời gian';
        bannerCountdown.style.color = 'var(--green)';
      }
      banner.style.background = 'rgba(16,185,129,0.1)';
      banner.style.borderColor = 'rgba(16,185,129,0.3)';
    }
    return;
  }

  const exactFormatted = formatFullDateTime(currentUser.expiresAt);
  const countdown = formatRentalCountdown(currentUser.expiresAt);

  if (countdown.expired) {
    badge.style.display = 'inline-flex';
    badge.style.background = 'rgba(239,68,68,0.2)';
    badge.style.color = 'var(--red)';
    badge.style.border = '1px solid rgba(239,68,68,0.4)';
    badge.innerHTML = '<span>⚠️ Hạn thuê: <b>ĐÃ HẾT HẠN (' + exactFormatted + ')</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn Ngay</button>';

    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '⛔';
      if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
      if (bannerCountdown) {
        bannerCountdown.textContent = 'ĐÃ HẾT HẠN (Tạm dừng dịch vụ)';
        bannerCountdown.style.color = 'var(--red)';
      }
      banner.style.background = 'rgba(239,68,68,0.15)';
      banner.style.borderColor = 'rgba(239,68,68,0.4)';
    }
    return;
  }

  badge.style.display = 'inline-flex';
  badge.style.background = countdown.color === 'var(--green)' ? 'rgba(16,185,129,0.15)' : (countdown.color === 'var(--yellow)' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.2)');
  badge.style.color = countdown.color;
  badge.style.border = '1px solid ' + (countdown.color === 'var(--green)' ? 'rgba(16,185,129,0.3)' : (countdown.color === 'var(--yellow)' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.4)'));
  badge.innerHTML = '<span>⏳ Hạn thuê: <b>' + countdown.text + '</b> (' + exactFormatted + ')</span><button class="small" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn</button>';

  if (banner) {
    if (bannerIcon) bannerIcon.textContent = '⏳';
    if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
    if (bannerCountdown) {
      bannerCountdown.textContent = countdown.text;
      bannerCountdown.style.color = countdown.color;
    }
    banner.style.background = 'rgba(30,41,59,0.7)';
    banner.style.borderColor = 'rgba(59,130,246,0.35)';
  }
}
window.formatFullDateTime = formatFullDateTime;
window.formatRentalCountdown = formatRentalCountdown;
window.updateUserHeaderCountdown = updateUserHeaderCountdown;

async function refreshDetail(force=false) {
  if(selectedBotId===null) return;
  if(detailRequestInFlight){
    if(force) detailRefreshQueued=true;
    return;
  }

  const requestGeneration = detailRefreshGeneration;
  const requestBotId = selectedBotId;
  detailRequestInFlight=true;

  const isCurrentRequest = () =>
    requestGeneration === detailRefreshGeneration &&
    requestBotId === selectedBotId;

  try {
    const snapshot=await detailGet('/snapshot');
    if(!isCurrentRequest()) return;

    if(snapshot && snapshot.bot){
      detailBot=snapshot.bot;
      detailInventory=snapshot.inventory||null;
      if(!detailSettingsDirty && snapshot.settings) renderDetailSettings(snapshot.settings);
      if(!detailAutoChatDirty && Array.isArray(snapshot.autoChatSchedules)) renderDetailAutoChatSchedules(snapshot.autoChatSchedules);
      if(!detailBotScheduleDirty && Array.isArray(snapshot.botSchedules)) renderDetailBotSchedules(snapshot.botSchedules);
    } else {
      const fallbackBot=await detailGet('/state');
      if(!isCurrentRequest()) return;
      const fallbackInventory=await detailGet('/inventory');
      if(!isCurrentRequest()) return;
      const settingsData=await detailGet('/settings');
      if(!isCurrentRequest()) return;
      const autoChatData=await detailGet('/autoChat');
      if(!isCurrentRequest()) return;
      const scheduleData=await detailGet('/botSchedules');
      if(!isCurrentRequest()) return;
      detailBot=fallbackBot;
      detailInventory=fallbackInventory;
      if(!detailSettingsDirty) renderDetailSettings(settingsData);
      if(!detailAutoChatDirty) renderDetailAutoChatSchedules(autoChatData.autoChatSchedules||[]);
      if(!detailBotScheduleDirty) renderDetailBotSchedules(scheduleData.botSchedules||[]);
    }

    if(!isCurrentRequest()) return;
    uptimeSyncAt=Date.now();
    detailStatusHtml();
    renderDetailInventory();
    await loadDetailLogs(force, requestGeneration, requestBotId);
    if(!isCurrentRequest()) return;
    await loadDetailChat(force, requestGeneration, requestBotId);
  } catch(err) {
    if(!isCurrentRequest()) return;
    if(err && err.status===404){
      showToast('Bot này không còn tồn tại trong Manager.');
      goHome();
      return;
    }
    if(
      err &&
      err.status===503 &&
      err.data &&
      err.data.label
    ) {
      detailBot=err.data;
      uptimeSyncAt=Date.now();
      detailStatusHtml();
    }
  } finally {
    detailRequestInFlight=false;
    if(detailRefreshQueued && selectedBotId!==null){detailRefreshQueued=false;void refreshDetail(true);}
  }
}

function nearBottom(box){return box.scrollHeight-box.scrollTop-box.clientHeight<24;}

async function loadDetailLogs(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  if(eventLoading) return;
  if(!force && detailBot && lastEventRevision===Number(detailBot.logRevision)) return;
  eventLoading=true;
  try {
    const data=await detailGet('/logs');
    if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
    const box=document.getElementById('detailEventLogs');
    const keep=nearBottom(box);
    box.innerHTML=(data.logs||[]).map(line=>'<div class="line">'+escapeHtml(line)+'</div>').join('');
    lastEventRevision=Number(data.revision||0);
    if(keep) box.scrollTop=box.scrollHeight;
  } finally {eventLoading=false;}
}

async function loadDetailChat(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  if(chatLoading) return;
  if(!force && lastChatRevision>=0 && detailBot && lastChatRevision===Number(detailBot.chatLogRevision)) return;
  chatLoading=true;
  try {
    const data=await detailGet('/chat-logs');
    if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
    const box=document.getElementById('detailChatLogs');
    const keep=nearBottom(box);
    box.innerHTML=(data.logs||[]).map(line=>'<div class="line">'+escapeHtml(line)+'</div>').join('');
    lastChatRevision=Number(data.revision||0);
    if(keep) box.scrollTop=box.scrollHeight;
  } finally {chatLoading=false;}
}

function itemLabel(item) {
  if(!item) return '-';
  const name=item.displayName||item.name||'-';
  const count=Number(item.count||0);
  return String(name).replace(/_/g,' ')+(count>1?' x'+count:'');
}

function createDetailSlot(item,slot,selected) {
  const el=document.createElement('div');
  el.className='inventory-slot'+(selected?' selected':'')+(!item?' empty':'');
  el.draggable=!!item;
  el.dataset.slot=String(slot);
  el.ondragstart=function(e){detailDragged={type:'slot',slot};try{e.dataTransfer.setData('text/plain',String(slot));e.dataTransfer.effectAllowed='move';}catch(_) {}};
  el.ondragover=allowDrop;
  el.ondragleave=clearDragOver;
  el.ondrop=function(e){dropDetailInventory(e,slot);};
  if(slot>=36&&slot<=44) el.onclick=function(){selectDetailHotbar(slot-36);};
  const idx=document.createElement('div');idx.className='slot-index';idx.textContent=slot>=36?String(slot-35):String(slot-8);
  const name=document.createElement('div');name.className='slot-name';name.textContent=itemLabel(item);
  const count=document.createElement('div');count.className='slot-count';count.textContent=item&&Number(item.count||0)>1?String(item.count):'';
  el.appendChild(idx);el.appendChild(name);el.appendChild(count);return el;
}

function renderDetailInventory(){
  if(!detailInventory) return;
  const dSlots = detailInventory.slots || [];
  let usedCount = 0;
  for (let i = 9; i <= 44; i++) {
    if (dSlots[i]) usedCount++;
  }
  const capPercent = Math.round((usedCount / 36) * 100);
  const capEl = document.getElementById('detailInventoryCapacity');
  if (capEl) {
    capEl.textContent = usedCount + '/36 ô (' + capPercent + '%)';
    capEl.className = 'capacity-badge' + (capPercent >= 90 ? ' danger' : capPercent >= 75 ? ' warning' : '');
  }
  const health=Math.max(0,Math.min(20,Number(detailInventory.health||0)));
  const food=Math.max(0,Math.min(20,Number(detailInventory.food||0)));
  document.getElementById('detailHealth').textContent=health.toFixed(1)+' / 20';
  document.getElementById('detailFood').textContent=String(food)+' / 20';
  document.getElementById('detailHealthBar').style.width=(health/20*100)+'%';
  document.getElementById('detailFoodBar').style.width=(food/20*100)+'%';
  document.getElementById('detailGolden').textContent=String(detailInventory.goldenAppleCount||0);
  document.getElementById('detailTotem').textContent=String(detailInventory.totemCount||0);
  document.getElementById('detailOffhand').textContent=String(detailInventory.offhand||'-').replace(/_/g,' ');
  document.getElementById('detailFoodCount').textContent=String(detailInventory.foodCount||0);
  document.getElementById('detailInventoryRevision').textContent='revision '+String(detailInventory.revision||0);
  const armor=detailInventory.armor||{};
  document.getElementById('equipHead').textContent=itemLabel(armor.head);
  document.getElementById('equipTorso').textContent=itemLabel(armor.torso);
  document.getElementById('equipLegs').textContent=itemLabel(armor.legs);
  document.getElementById('equipFeet').textContent=itemLabel(armor.feet);
  const off=detailInventory.slots?detailInventory.slots['45']:null;
  document.getElementById('equipOffhand').textContent=itemLabel(off);

  const slots=detailInventory.slots||{};
  const invBox=document.getElementById('detailInventory');invBox.innerHTML='';
  for(let slot=9;slot<=35;slot++) invBox.appendChild(createDetailSlot(slots[String(slot)]||null,slot,false));
  const hotBox=document.getElementById('detailHotbar');hotBox.innerHTML='';
  const selected=Number(detailInventory.selectedHotbar??detailInventory.selectedSlot??0);
  for(let slot=36;slot<=44;slot++) hotBox.appendChild(createDetailSlot(slots[String(slot)]||null,slot,slot-36===selected));
}

function allowDrop(event){
  event.preventDefault();
  try{event.dataTransfer.dropEffect='move';}catch(_){}
  if(event.currentTarget&&event.currentTarget.classList) event.currentTarget.classList.add('dragover');
}
function clearDragOver(event){if(event.currentTarget&&event.currentTarget.classList) event.currentTarget.classList.remove('dragover');}
function startEquipmentDrag(event,destination){
  const map={head:5,torso:6,legs:7,feet:8,'off-hand':45};
  detailDragged={type:'slot',slot:map[destination],equipment:destination};
  try{event.dataTransfer.setData('text/plain',String(map[destination]));event.dataTransfer.effectAllowed='move';}catch(_){}
}
function dropDetailInventory(event,destinationSlot){
  event.preventDefault();clearDragOver(event);
  let source=detailDragged&&detailDragged.slot;
  try{const value=event.dataTransfer.getData('text/plain');if(value!=='') source=Number(value);}catch(_){}
  detailDragged=null;
  if(!Number.isInteger(source)||source===destinationSlot) return;
  if(source>=5&&source<=8) {const map={5:'head',6:'torso',7:'legs',8:'feet'};unequipAndMove(map[source],destinationSlot);return;}
  if(source===45){unequipAndMove('off-hand',destinationSlot);return;}
  moveDetailItem(source,destinationSlot);
}
async function unequipAndMove(destination,slot){
  showToast('Đang tháo trang bị...');
  const result=await detailPost('/inventory/unequip',{destination});
  if(!result.ok){showToast(result.data?.error||'Không thể tháo trang bị.');return;}
  await refreshDetail(true);
  if(!detailInventory) return;
  const targetSlot = result.data?.unequippedToSlot ?? result.data?.slot;
  if(Number.isInteger(targetSlot) && targetSlot !== slot){
    await moveDetailItem(targetSlot, slot);
  } else {
    let found=null;
    const slots=detailInventory.slots||{};
    for(let s=9;s<=35;s++){
      const item=slots[String(s)];
      if(item&&item.name){found={slot:s,item};break;}
    }
    if(found&&slot!==found.slot){await moveDetailItem(found.slot,slot);}
  }
}
async function moveDetailItem(sourceSlot,destSlot){
  if(detailInventoryBusy||!detailInventory) return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/move',{sourceSlot,destSlot,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    if(!result.ok){showToast(result.data?.error||'Di chuyển thất bại.');await refreshDetail(true);return;}
    showToast(result.data?.message||'Đã di chuyển item.');
  } finally {detailInventoryBusy=false;}
}
async function dropDetailItemToWorld(event){
  event.preventDefault();clearDragOver(event);
  let source=detailDragged&&detailDragged.slot;
  try{const value=event.dataTransfer.getData('text/plain');if(value!=='') source=Number(value);}catch(_){}
  detailDragged=null;
  if(!Number.isInteger(source)) return;
  if(source>=5&&source<=8){await unequipDetail({head:'head',torso:'torso',legs:'legs',feet:'feet'}[getEquipmentNameBySlot(source)]||'head');return;}
  if(source===45){await unequipDetail('off-hand');return;}
  if(detailInventoryBusy||!detailInventory) return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/drop',{sourceSlot:source,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
function getEquipmentNameBySlot(slot){return slot===5?'head':slot===6?'torso':slot===7?'legs':'feet';}
async function dropEquip(event,destination){
  event.preventDefault();clearDragOver(event);
  let source=detailDragged&&detailDragged.slot;
  try{const value=event.dataTransfer.getData('text/plain');if(value!=='') source=Number(value);}catch(_){}
  detailDragged=null;
  if(!Number.isInteger(source)||source===45&&destination==='off-hand') return;
  if(source>=5&&source<=8||source===45){showToast('Không thể lấy item từ equipment để equip vào chính equipment.');return;}
  await equipDetailItem(source,destination);
}
async function equipDetailItem(sourceSlot,destination){
  if(detailInventoryBusy||!detailInventory)return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/equip',{sourceSlot,destination,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
async function unequipDetail(destination){
  if(detailInventoryBusy||!detailInventory)return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/unequip',{destination,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
async function selectDetailHotbar(slot){
  if(detailInventoryBusy||!detailInventory)return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/select',{slot,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
function setDetailScheduleFieldVisibility(card){
  if(!card)return;
  const mode=card.querySelector('[data-field="mode"]')?.value==='fixed'?'fixed':'interval';
  const interval=card.querySelector('[data-role="interval-field"]');
  const fixed=card.querySelector('[data-role="fixed-field"]');
  if(interval)interval.classList.toggle('hidden-field',mode!=='interval');
  if(fixed)fixed.classList.toggle('hidden-field',mode!=='fixed');
}

function renderDetailSettings(data){
  const settings=data?.settings||data||{};
  const eco=document.getElementById('detailSettingEcoMode');
  const a=document.getElementById('detailSettingAutoTotem');
  const h=document.getElementById('detailSettingAntiHungry');
  const r=document.getElementById('detailSettingAutoReconnect');
  const k=document.getElementById('detailSettingAntiAfkKick');

  if(eco&&!detailSettingsDirty)eco.checked=settings.ecoMode!==false;
  if(a&&!detailSettingsDirty)a.checked=settings.autoTotem!==false;
  if(h&&!detailSettingsDirty)h.checked=settings.antiHungry!==false;
  if(r&&!detailSettingsDirty)r.checked=settings.autoReconnect!==false;
  if(k&&!detailSettingsDirty)k.checked=settings.antiAfkKick!==false;
}

function renderDetailAutoChatSchedules(schedules){
  detailAutoChatSchedules=Array.isArray(schedules)?schedules:[];
  const box=document.getElementById('detailAutoChatSchedules');
  if(!box)return;
  if(!detailAutoChatSchedules.length){box.innerHTML='<div class="note">Chưa có lịch Auto Chat. Bấm “＋ Thêm” để tạo.</div>';return;}

  box.innerHTML=detailAutoChatSchedules.map((s,i)=>{
    const fixed=s.mode==='fixed';
    return '<div class="schedule-row" draggable="true" data-index="'+i+'" data-id="'+escapeHtml(String(s.id||Date.now()+'-'+i))+'" ondragstart="dragDetailAutoChat(event,'+i+')" ondragover="allowDetailAutoChatDrop(event)" ondrop="dropDetailAutoChat(event,'+i+')" ondragend="endDetailScheduleDrag(this)">'+
      '<div class="schedule-row-top">'+
        '<div class="schedule-handle" title="Kéo để sắp xếp">⋮⋮</div>'+ 
        '<div class="schedule-row-title">Lịch #'+(i+1)+'</div>'+ 
        '<label class="check-row" style="margin:0;padding:5px 7px;"><input data-field="enabled" type="checkbox"'+(s.enabled!==false?' checked':'')+'> <span>Bật</span></label>'+ 
        '<button class="small danger" type="button" onclick="removeDetailAutoChatSchedule('+i+')">Xóa</button>'+ 
      '</div>'+ 
      '<div class="schedule-inline" style="margin-top:7px;">'+
        '<select data-field="mode" onchange="detailScheduleModeChanged(this)"><option value="interval"'+(!fixed?' selected':'')+'>Lặp lại</option><option value="fixed"'+(fixed?' selected':'')+'>Giờ cố định</option></select>'+ 
        (fixed
          ? '<input data-field="times" style="width:min(100%,280px);" value="'+escapeHtml((s.times||[]).join(', '))+'" placeholder="08:00, 12:00, 18:00">'
          : '<input data-field="intervalSeconds" class="minutes-input" type="number" min="10" max="604800" value="'+clampClientNumber(s.intervalSeconds,3600,10,604800)+'" title="Khoảng lặp (giây)">')+
        '<input data-field="messageDelaySeconds" class="minutes-input" type="number" min="0" max="3600" value="'+clampClientNumber(s.messageDelaySeconds,2,0,3600)+'" title="Delay giữa các tin (giây)"><span class="schedule-meta">Delay tin (s)</span>'+ 
      '</div>'+ 
      '<div class="schedule-row-main"><label class="schedule-field"><span>Tin nhắn — mỗi dòng một tin</span><textarea data-field="messages" placeholder="Tin 1&#10;Tin 2&#10;Tin 3">'+escapeHtml((s.messages||[]).join('\n'))+'</textarea></label><div class="schedule-meta" style="padding-bottom:6px;"><span>'+ (fixed?'Theo giờ':'Theo khoảng lặp') +'</span></div></div>'+ 
    '</div>';
  }).join('');
}

function detailScheduleModeChanged(select){const current=collectDetailAutoChatSchedules();const index=Number(select?.closest('.schedule-row')?.dataset.index??-1);if(current[index]){if(current[index].mode==='fixed'&&!current[index].times.length)current[index].times=['08:00'];if(current[index].mode==='interval'&&!Number.isFinite(Number(current[index].intervalSeconds)))current[index].intervalSeconds=3600;}detailAutoChatDirty=true;renderDetailAutoChatSchedules(current);}
function collectDetailAutoChatSchedules(){
  const box=document.getElementById('detailAutoChatSchedules'); if(!box)return [];
  return [...box.querySelectorAll('.schedule-row')].map((row,i)=>{
    const get=f=>row.querySelector('[data-field="'+f+'"]');
    const mode=get('mode')?.value==='fixed'?'fixed':'interval';
    return {id:row.dataset.id||detailAutoChatSchedules[i]?.id||(Date.now()+'-'+i),enabled:!!get('enabled')?.checked,mode,intervalSeconds:clampClientNumber(get('intervalSeconds')?.value,3600,10,604800),times:String(get('times')?.value||'').split(/[,\n]+/).map(x=>x.trim()).filter(Boolean),messages:String(get('messages')?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),messageDelaySeconds:clampClientNumber(get('messageDelaySeconds')?.value,2,0,3600)};
  });
}
function validateDetailAutoChatSchedules(schedules){
  const re=/^([01]\d|2[0-3]):[0-5]\d$/;
  for(let i=0;i<schedules.length;i++){const s=schedules[i];if(!s.messages.length)return 'Lịch #'+(i+1)+' chưa có tin nhắn.';if(s.mode==='fixed'){if(!s.times.length)return 'Lịch #'+(i+1)+' chưa có giờ cố định.';for(const t of s.times)if(!re.test(t))return 'Lịch #'+(i+1)+' có giờ không hợp lệ: '+t;}}
  return '';
}
function addDetailAutoChatSchedule(){if(detailAutoChatSaveInFlight)return;const data=collectDetailAutoChatSchedules();data.push({id:Date.now()+'-'+Math.random().toString(36).slice(2,8),enabled:true,mode:'interval',intervalSeconds:3600,times:[],messages:[''],messageDelaySeconds:2});detailAutoChatDirty=true;renderDetailAutoChatSchedules(data);document.getElementById('detailAutoChatSchedules')?.lastElementChild?.querySelector('[data-field="messages"]')?.focus();}
function removeDetailAutoChatSchedule(index){if(detailAutoChatSaveInFlight)return;const data=collectDetailAutoChatSchedules();data.splice(index,1);detailAutoChatDirty=true;renderDetailAutoChatSchedules(data);}
let draggedDetailAutoChatIndex=null;
function dragDetailAutoChat(event,index){draggedDetailAutoChatIndex=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));event.currentTarget.classList.add('dragging');}
function allowDetailAutoChatDrop(event){event.preventDefault();event.dataTransfer.dropEffect='move';}
function dropDetailAutoChat(event,targetIndex){event.preventDefault();const from=draggedDetailAutoChatIndex;draggedDetailAutoChatIndex=null;if(!Number.isInteger(from)||from===targetIndex)return;const data=collectDetailAutoChatSchedules();const [moved]=data.splice(from,1);data.splice(targetIndex,0,moved);detailAutoChatDirty=true;renderDetailAutoChatSchedules(data);}
function endDetailScheduleDrag(element){if(element)element.classList.remove('dragging');draggedDetailAutoChatIndex=null;draggedDetailBotScheduleIndex=null;}

function detailDefaultFixedTime(index){const hour=(3+Number(index||0)*3)%24;return String(hour).padStart(2,'0')+':00';}
function normalizeDetailBotScheduler(schedules){
  const raw=Array.isArray(schedules)?schedules[0]:null;
  if(!raw)return{id:String(Date.now()),enabled:true,mode:'fixed',items:[]};
  const mode=raw.mode==='cycle'?'cycle':'fixed';
  let items=Array.isArray(raw.items)?raw.items.slice():[];
  if(!items.length&&Array.isArray(schedules))items=schedules.filter(s=>(s.mode==='cycle'?'cycle':'fixed')===mode).flatMap(s=>mode==='fixed'?[{id:s.id,action:s.action,time:s.time}]:[{id:String(s.id||'')+'-stop',action:'stop',afterMinutes:clampClientNumber(s.offAfterMinutes,120,1,43200)},{id:String(s.id||'')+'-start',action:'start',afterMinutes:clampClientNumber(s.onAfterMinutes,300,1,43200)}]);
  return{id:String(raw.id||Date.now()),enabled:raw.enabled!==false,mode,items:items.map((item,i)=>mode==='fixed'?{id:String(item.id||Date.now()+'-'+i),action:item.action==='start'?'start':'stop',time:String(item.time||'03:00')}:{id:String(item.id||Date.now()+'-'+i),action:item.action==='start'?'start':'stop',afterMinutes:clampClientNumber(item.afterMinutes,i===0?120:300,1,43200)})};
}
function renderDetailBotScheduleModeNote(mode){const note=document.getElementById('detailBotScheduleModeNote');if(!note)return;note.textContent=mode==='cycle'?'Mỗi dòng kích hoạt sau khoảng thời gian tính từ dòng ngay phía trên. Dòng đầu tiên tính từ lúc bấm Lưu. Kéo ⋮⋮ để đổi thứ tự.':'Mỗi dòng dùng giờ Việt Nam (GMT+7). Có thể thêm nhiều giờ: 03:00 Tắt → 06:00 Bật → 12:00 Tắt → 19:00 Bật.';}
function renderDetailBotSchedules(schedules){
  detailBotSchedules=(Array.isArray(schedules)?schedules:[]);const box=document.getElementById('detailBotSchedules');if(!box)return;
  const scheduler=normalizeDetailBotScheduler(detailBotSchedules);
  document.getElementById('detailBotScheduleMode').value=scheduler.mode;document.getElementById('detailBotScheduleEnabled').checked=scheduler.enabled!==false;renderDetailBotScheduleModeNote(scheduler.mode);
  if(!scheduler.items.length){box.innerHTML='<div class="note">Chưa có dòng hẹn giờ. Bấm “＋ Thêm” để tạo dòng đầu tiên.</div>';return;}
  box.innerHTML=scheduler.items.map((item,i)=>{
    const action=item.action==='start'?'start':'stop';const actionText=action==='start'?'Bật Bot':'Tắt Bot';
    const timing=scheduler.mode==='fixed'?'<input data-field="time" class="time-input" type="time" value="'+escapeHtml(item.time||'03:00')+'">':'<input data-field="afterMinutes" class="minutes-input" type="number" min="1" max="43200" value="'+clampClientNumber(item.afterMinutes,i===0?120:300,1,43200)+'" title="Phút">';
    const relation=scheduler.mode==='fixed'?'Mỗi ngày':(i===0?'Tính từ lúc lưu':'Tính từ dòng '+i);
    return '<div class="schedule-row" draggable="true" data-index="'+i+'" data-id="'+escapeHtml(item.id)+'" ondragstart="dragDetailBotSchedule(event,'+i+')" ondragover="allowDetailBotScheduleDrop(event)" ondrop="dropDetailBotSchedule(event,'+i+')" ondragend="endDetailScheduleDrag(this)">'+
      '<div class="schedule-row-top"><div class="schedule-handle" title="Kéo để đổi thứ tự">⋮⋮</div><div class="schedule-row-title">'+(i+1)+'. '+actionText+'</div><div class="schedule-inline"><select data-field="action" class="action-select"><option value="stop"'+(action==='stop'?' selected':'')+'>Tắt</option><option value="start"'+(action==='start'?' selected':'')+'>Bật</option></select>'+timing+'</div><button class="small danger" type="button" onclick="removeDetailBotSchedule('+i+')">Xóa</button></div>'+ 
      '<div class="schedule-meta" style="margin-top:5px;"><span>'+relation+'</span>'+(scheduler.mode==='cycle'?'<span>•</span><span>Tính từ dòng kề trên</span>':'')+'</div></div>';
  }).join('');
}
function collectDetailBotSchedules(){
  const box=document.getElementById('detailBotSchedules');if(!box)return[];const mode=document.getElementById('detailBotScheduleMode')?.value==='cycle'?'cycle':'fixed';const current=normalizeDetailBotScheduler(detailBotSchedules);
  const items=[...box.querySelectorAll('.schedule-row')].map((row,i)=>{const get=f=>row.querySelector('[data-field="'+f+'"]');const id=row.dataset.id||current.items[i]?.id||(Date.now()+'-'+i);return mode==='fixed'?{id,action:get('action')?.value==='start'?'start':'stop',time:String(get('time')?.value||'').trim()}:{id,action:get('action')?.value==='start'?'start':'stop',afterMinutes:clampClientNumber(get('afterMinutes')?.value,i===0?120:300,1,43200)};});
  return items.length?[{id:current.id||String(Date.now()),enabled:!!document.getElementById('detailBotScheduleEnabled')?.checked,mode,items}]:[];
}
function validateDetailBotSchedules(schedules){if(!schedules.length)return'';if(schedules.length!==1)return'Chỉ được lưu một chế độ hẹn giờ Bot cùng lúc.';const s=schedules[0];if(!s.items.length)return'Hẹn giờ Bot chưa có dòng nào.';if(s.mode==='fixed'){const seen=new Set();for(let i=0;i<s.items.length;i++){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.items[i].time))return'Dòng #'+(i+1)+' có giờ không hợp lệ.';if(seen.has(s.items[i].time))return'Dòng #'+(i+1)+' bị trùng giờ '+s.items[i].time+'.';seen.add(s.items[i].time);}}else for(let i=0;i<s.items.length;i++){const v=Number(s.items[i].afterMinutes);if(!Number.isFinite(v)||v<1||v>43200)return'Dòng #'+(i+1)+' có thời gian chờ không hợp lệ.';}return'';}
function detailBotScheduleModeChanged(select){const current=collectDetailBotSchedules();const s=normalizeDetailBotScheduler(current.length?current:detailBotSchedules);const mode=select?.value==='cycle'?'cycle':'fixed';const items=s.items.map((item,i)=>mode==='fixed'?{id:item.id,action:item.action,time:detailDefaultFixedTime(i)}:{id:item.id,action:item.action,afterMinutes:i===0?120:300});detailBotSchedules=[{id:s.id||String(Date.now()),enabled:!!document.getElementById('detailBotScheduleEnabled')?.checked,mode,items}];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
function addDetailBotSchedule(){const current=collectDetailBotSchedules();const s=normalizeDetailBotScheduler(current.length?current:detailBotSchedules);const i=s.items.length;const item=s.mode==='fixed'?{id:Date.now()+'-'+Math.random().toString(36).slice(2,8),action:'stop',time:detailDefaultFixedTime(i)}:{id:Date.now()+'-'+Math.random().toString(36).slice(2,8),action:i%2===0?'stop':'start',afterMinutes:i===0?120:300};s.items.push(item);detailBotSchedules=[s];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
function removeDetailBotSchedule(index){if(detailBotScheduleSaveInFlight)return;const s=normalizeDetailBotScheduler(collectDetailBotSchedules());s.items.splice(index,1);detailBotSchedules=s.items.length?[s]:[];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
let draggedDetailBotScheduleIndex=null;
function dragDetailBotSchedule(event,index){draggedDetailBotScheduleIndex=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));event.currentTarget.classList.add('dragging');}
function allowDetailBotScheduleDrop(event){event.preventDefault();event.dataTransfer.dropEffect='move';}
function dropDetailBotSchedule(event,targetIndex){event.preventDefault();const from=draggedDetailBotScheduleIndex;draggedDetailBotScheduleIndex=null;if(!Number.isInteger(from)||from===targetIndex)return;const s=normalizeDetailBotScheduler(collectDetailBotSchedules());const[moved]=s.items.splice(from,1);s.items.splice(targetIndex,0,moved);detailBotSchedules=[s];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}

async function saveDetailSettings(){
  if(detailSettingsSaveInFlight)return;
  invalidateDetailReads();
  const body={settings:{
    ecoMode:!!document.getElementById('detailSettingEcoMode')?.checked,
    autoTotem:!!document.getElementById('detailSettingAutoTotem')?.checked,
    antiHungry:!!document.getElementById('detailSettingAntiHungry')?.checked,
    autoReconnect:!!document.getElementById('detailSettingAutoReconnect')?.checked,
    antiAfkKick:!!document.getElementById('detailSettingAntiAfkKick')?.checked
  }};
  detailSettingsSaveInFlight=true;setDetailSettingsDisabled(true);
  try{const result=await detailPost('/settings',body);showToast(result.data?.message||result.data?.error||'Đã xử lý.');if(result.ok){detailSettingsDirty=false;renderDetailSettings(result.data.settings||result.data);}}finally{detailSettingsSaveInFlight=false;setDetailSettingsDisabled(false);}
}
async function saveDetailAutoChat(){
  if(detailAutoChatSaveInFlight)return;
  invalidateDetailReads();const schedules=collectDetailAutoChatSchedules();const validationError=validateDetailAutoChatSchedules(schedules);if(validationError){showToast(validationError);return;}
  detailAutoChatSaveInFlight=true;setDetailAutoChatDisabled(true);
  try{const result=await detailPost('/auto-chat',{autoChatSchedules:schedules});showToast(result.data?.message||result.data?.error||'Đã xử lý.');if(result.ok){detailAutoChatDirty=false;detailAutoChatSchedules=result.data?.autoChatSchedules||schedules;renderDetailAutoChatSchedules(detailAutoChatSchedules);}}finally{detailAutoChatSaveInFlight=false;setDetailAutoChatDisabled(false);}
}
async function saveDetailBotSchedules(){
  if(detailBotScheduleSaveInFlight)return;const schedules=collectDetailBotSchedules();const validationError=validateDetailBotSchedules(schedules);if(validationError){showToast(validationError);return;}
  detailBotScheduleSaveInFlight=true;setDetailBotScheduleDisabled(true);
  try{const result=await detailPost('/bot-schedules',{botSchedules:schedules});showToast(result.data?.message||result.data?.error||'Đã xử lý.');if(result.ok){detailBotScheduleDirty=false;detailBotSchedules=result.data?.botSchedules||schedules;renderDetailBotSchedules(detailBotSchedules);}}finally{detailBotScheduleSaveInFlight=false;setDetailBotScheduleDisabled(false);}
}

async function clearDetailLogs(){if(!confirm('Xóa Event Log của bot này?'))return;try{const result=await detailPost('/logs/clear',{});showToast(result.data?.message||result.data?.error||'Đã xử lý.');if(result.ok)await loadDetailLogs(true);}catch(err){showToast(err.message||'Không thể xóa Event Log.');}}
async function clearDetailChat(){if(!confirm('Xóa Chat Log của bot này?'))return;try{const result=await detailPost('/chat-logs/clear',{});showToast(result.data?.message||result.data?.error||'Đã xử lý.');if(result.ok)await loadDetailChat(true);}catch(err){showToast(err.message||'Không thể xóa Chat Log.');}}


window.dragDetailAutoChat = dragDetailAutoChat;
window.allowDetailAutoChatDrop = allowDetailAutoChatDrop;
window.dropDetailAutoChat = dropDetailAutoChat;
window.endDetailScheduleDrag = endDetailScheduleDrag;
window.dragDetailBotSchedule = dragDetailBotSchedule;
window.allowDetailBotScheduleDrop = allowDetailBotScheduleDrop;
window.dropDetailBotSchedule = dropDetailBotSchedule;
async function detailPost(path,body){
  if(selectedBotId===null) return {ok:false,status:0,data:{error:'Chưa chọn bot.'}};
  invalidateDetailReads();
  return requestJson(
    '/api/manager/bot/'+encodeURIComponent(String(selectedBotId))+path,
    {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body||{}),
      timeoutMs:30000
    }
  );
}

async function detailAction(action){
  if(detailLifecycleActionInFlight)return;
  invalidateDetailReads();
  detailLifecycleActionInFlight=true;
  const buttons=['detailStartButton','detailStopButton','detailRestartButton'];
  buttons.forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=true;});
  try{
    showToast(action==='start'?'Đang chạy bot...':action==='stop'?'Đang dừng bot...':'Đang khởi động lại bot...');
    const result=await detailPost('/'+encodeURIComponent(action),{});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok) await refreshDetail(true);
  }catch(err){showToast(err.message||'Không thể thực hiện thao tác.');}
  finally{detailLifecycleActionInFlight=false;buttons.forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=false;});}
}

let detailCommandHistory = [];
let detailCommandHistoryIndex = -1;

function initDetailChatInputHistory() {
  const input = document.getElementById('detailMessageInput');
  if (!input || !input.dataset || input.dataset.historyAttached) return;
  input.dataset.historyAttached = 'true';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      if (!detailCommandHistory.length) return;
      e.preventDefault();
      if (detailCommandHistoryIndex === -1) {
        detailCommandHistoryIndex = detailCommandHistory.length - 1;
      } else if (detailCommandHistoryIndex > 0) {
        detailCommandHistoryIndex--;
      }
      input.value = detailCommandHistory[detailCommandHistoryIndex] || '';
    } else if (e.key === 'ArrowDown') {
      if (!detailCommandHistory.length || detailCommandHistoryIndex === -1) return;
      e.preventDefault();
      if (detailCommandHistoryIndex < detailCommandHistory.length - 1) {
        detailCommandHistoryIndex++;
        input.value = detailCommandHistory[detailCommandHistoryIndex] || '';
      } else {
        detailCommandHistoryIndex = -1;
        input.value = '';
      }
    }
  });
}

function quickDetailCommand(cmd) {
  const input = document.getElementById('detailMessageInput');
  if (!input) return;
  const raw = String(cmd || '').trim();
  const needsSpace = ['/dn', '/login', '/pay'].includes(raw.toLowerCase());
  const finalCmd = needsSpace ? (raw + ' ') : raw;
  input.value = finalCmd;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
window.quickDetailCommand = quickDetailCommand;

async function copyToClipboard(text, label) {
  text = String(text || '').trim();
  if (!text || text === '-') return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('Clipboard API not supported');
    }
    showToast('Đã sao chép ' + (label || 'nội dung') + ': ' + text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Đã sao chép ' + (label || 'nội dung') + ': ' + text);
    } catch (e) {
      showToast('Không thể sao chép tự động: ' + text);
    }
    document.body.removeChild(ta);
  }
}
window.copyToClipboard = copyToClipboard;

async function sendDetailMessage(event){
  event.preventDefault();
  if(detailRequestInFlight)return;
  const input=document.getElementById('detailMessageInput');
  const text=String(input?.value||'');
  if(!text.trim()){showToast('Nội dung không được trống.');return;}
  if (!detailCommandHistory.length || detailCommandHistory[detailCommandHistory.length - 1] !== text.trim()) {
    detailCommandHistory.push(text.trim());
    if (detailCommandHistory.length > 50) detailCommandHistory.shift();
  }
  detailCommandHistoryIndex = -1;
  try{
    const result=await detailPost('/send',{text});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){input.value='';await loadDetailChat(true);}
  }catch(err){showToast(err.message||'Không thể gửi chat.');}
}

async function saveDetailAccount(){
  if(detailAccountSaveInFlight)return;
  invalidateDetailReads();
  const username=String(document.getElementById('detailUsernameInput')?.value||'').trim();
  const password=String(document.getElementById('detailPasswordInput')?.value||'');
  if(!username&&!password){showToast('Nhập username hoặc password cần thay đổi.');return;}
  const userInput=document.getElementById('detailUsernameInput');
  const passInput=document.getElementById('detailPasswordInput');
  detailAccountSaveInFlight=true;
  if(userInput)userInput.disabled=true;
  if(passInput)passInput.disabled=true;
  try{
    const result=await detailPost('/account',{username,password});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){if(userInput)userInput.value='';if(passInput)passInput.value='';await refreshDetail(true);}
  }catch(err){showToast(err.message||'Không thể cập nhật tài khoản.');}
  finally{detailAccountSaveInFlight=false;if(userInput)userInput.disabled=false;if(passInput)passInput.disabled=false;}
}

async function saveAndRestartBot(){
  if(detailAccountSaveInFlight)return;
  invalidateDetailReads();
  const username=String(document.getElementById('detailUsernameInput')?.value||'').trim();
  const password=String(document.getElementById('detailPasswordInput')?.value||'');
  if(!username&&!password){showToast('Nhập username hoặc password cần thay đổi.');return;}
  const userInput=document.getElementById('detailUsernameInput');
  const passInput=document.getElementById('detailPasswordInput');
  detailAccountSaveInFlight=true;
  if(userInput)userInput.disabled=true;
  if(passInput)passInput.disabled=true;
  try{
    const result=await detailPost('/account',{username,password});
    if(!result.ok){showToast(result.data?.error||'Không thể cập nhật tài khoản.');return;}
    showToast('Đã lưu tài khoản. Đang khởi động lại bot...');
    if(userInput)userInput.value='';
    if(passInput)passInput.value='';
    const restartRes=await detailPost('/restart',{});
    showToast(restartRes.data?.message||restartRes.data?.error||'Đã gửi lệnh chạy lại bot.');
    await refreshDetail(true);
  }catch(err){showToast(err.message||'Lỗi khi lưu và khởi động lại bot.');}
  finally{detailAccountSaveInFlight=false;if(userInput)userInput.disabled=false;if(passInput)passInput.disabled=false;}
}

function renderDetailProxy(proxy) {
  const badge = document.getElementById('detailProxyBadge');
  const enabledInput = document.getElementById('detailProxyEnabled');
  const protocolInput = document.getElementById('detailProxyProtocol');
  const hostInput = document.getElementById('detailProxyHost');
  const portInput = document.getElementById('detailProxyPort');
  const usernameInput = document.getElementById('detailProxyUsername');
  const passwordInput = document.getElementById('detailProxyPassword');

  const p = proxy || {};
  if (badge) {
    if (p.enabled) {
      badge.textContent = '🟢 BẬT';
      badge.style.background = 'rgba(34, 197, 94, 0.2)';
      badge.style.color = '#4ade80';
    } else {
      badge.textContent = 'TẮT';
      badge.style.background = 'var(--border)';
      badge.style.color = 'var(--muted)';
    }
  }

  if (enabledInput && document.activeElement !== enabledInput) enabledInput.checked = !!p.enabled;
  if (protocolInput && document.activeElement !== protocolInput) protocolInput.value = p.protocol || 'socks5';
  if (hostInput && document.activeElement !== hostInput) hostInput.value = p.host || '';
  if (portInput && document.activeElement !== portInput) portInput.value = p.port || '';
  if (usernameInput && document.activeElement !== usernameInput) usernameInput.value = p.username || '';
  if (passwordInput && document.activeElement !== passwordInput) passwordInput.value = p.password || '';
}

async function saveDetailProxy() {
  if (selectedBotId === null) return;
  const enabled = !!document.getElementById('detailProxyEnabled')?.checked;
  const protocol = document.getElementById('detailProxyProtocol')?.value || 'socks5';
  const host = document.getElementById('detailProxyHost')?.value?.trim() || '';
  const port = Number(document.getElementById('detailProxyPort')?.value) || 0;
  const username = document.getElementById('detailProxyUsername')?.value?.trim() || '';
  const password = document.getElementById('detailProxyPassword')?.value || '';

  if (enabled && (!host || !port)) {
    showToast('Vui lòng nhập đầy đủ Host và Port khi kích hoạt Proxy!');
    return;
  }

  try {
    const res = await detailPost('/proxy', {
      proxy: { enabled, protocol, host, port, username, password }
    });
    if (res.ok) {
      showToast('Đã lưu cấu hình Proxy thành công!');
      await refreshDetail(true);
    } else {
      showToast('Lỗi lưu Proxy: ' + (res.data?.error || 'Không rõ nguyên nhân'));
    }
  } catch (err) {
    showToast('Lỗi lưu Proxy: ' + (err.message || ''));
  }
}

async function testDetailProxy() {
  if (selectedBotId === null) return;
  const btn = document.getElementById('detailProxyTestBtn');
  const resDiv = document.getElementById('detailProxyTestResult');
  const enabled = !!document.getElementById('detailProxyEnabled')?.checked;
  const protocol = document.getElementById('detailProxyProtocol')?.value || 'socks5';
  const host = document.getElementById('detailProxyHost')?.value?.trim() || '';
  const port = Number(document.getElementById('detailProxyPort')?.value) || 0;
  const username = document.getElementById('detailProxyUsername')?.value?.trim() || '';
  const password = document.getElementById('detailProxyPassword')?.value || '';

  if (!host || !port) {
    showToast('Vui lòng nhập Host và Port Proxy trước khi kiểm tra!');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang test...'; }
  if (resDiv) { resDiv.innerHTML = '<span style="color:var(--accent);">Đang kết nối thử tới Proxy...</span>'; }

  try {
    const res = await detailPost('/proxy/test', {
      proxy: { enabled, protocol, host, port, username, password }
    });
    if (res.ok && res.data?.ok) {
      if (resDiv) resDiv.innerHTML = '<span style="color:var(--green);font-weight:700;">✅ ' + escapeHtml(res.data.message) + '</span>';
      showToast('Proxy hoạt động tốt! Ping: ' + res.data.latencyMs + 'ms');
    } else {
      const err = res.data?.error || 'Không thể kết nối tới Proxy.';
      if (resDiv) resDiv.innerHTML = '<span style="color:var(--red);font-weight:700;">❌ ' + escapeHtml(err) + '</span>';
      showToast('Kiểm tra Proxy thất bại: ' + err);
    }
  } catch (err) {
    if (resDiv) resDiv.innerHTML = '<span style="color:var(--red);">❌ Lỗi kiểm tra: ' + escapeHtml(err.message) + '</span>';
    showToast('Lỗi kiểm tra: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧪 Kiểm Tra Kết Nối'; }
  }
}

async function clearDetailProxy() {
  if (document.getElementById('detailProxyEnabled')) document.getElementById('detailProxyEnabled').checked = false;
  if (document.getElementById('detailProxyHost')) document.getElementById('detailProxyHost').value = '';
  if (document.getElementById('detailProxyPort')) document.getElementById('detailProxyPort').value = '';
  if (document.getElementById('detailProxyUsername')) document.getElementById('detailProxyUsername').value = '';
  if (document.getElementById('detailProxyPassword')) document.getElementById('detailProxyPassword').value = '';
  await saveDetailProxy();
}

async function loadTrialGiftSetting() {
  try {
    const res = await requestJson('/api/manager/settings/system');
    if (res.ok && res.data?.settings) {
      const isEnabled = res.data.settings.trialGiftEnabled !== false;
      const trialDays = Number(res.data.settings.trialDays) || 1;
      const badge = document.getElementById('trialGiftStatusBadge');
      if (badge) {
        badge.textContent = isEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = isEnabled ? '#4ade80' : '#f87171';
      }
      const daysInput = document.getElementById('trialDaysInput');
      if (daysInput) {
        daysInput.value = trialDays;
        daysInput.disabled = !isEnabled;
      }
      const label = document.getElementById('trialGiftBtnLabel');
      if (label) {
        label.textContent = '🎁 Tặng Dùng Thử:';
      }
    }
  } catch (_) {}
}

async function toggleTrialGiftSetting() {
  const badge = document.getElementById('trialGiftStatusBadge');
  const currentEnabled = badge ? badge.textContent.trim() === 'BẬT' : true;
  const newEnabled = !currentEnabled;
  const daysInput = document.getElementById('trialDaysInput');
  const trialDays = daysInput ? Math.max(1, Math.min(365, parseInt(daysInput.value, 10) || 1)) : 1;

  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { trialGiftEnabled: newEnabled, trialDays }
    });
    if (res.ok) {
      if (badge) {
        badge.textContent = newEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = newEnabled ? '#4ade80' : '#f87171';
      }
      if (daysInput) daysInput.disabled = !newEnabled;
      showToast(res.data?.message || 'Đã cập nhật chế độ tặng dùng thử!');
    } else {
      showToast('Lỗi cập nhật: ' + (res.data?.error || ''));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function saveTrialDaysSetting() {
  const badge = document.getElementById('trialGiftStatusBadge');
  const isEnabled = badge ? badge.textContent.trim() === 'BẬT' : true;
  const daysInput = document.getElementById('trialDaysInput');
  const trialDays = daysInput ? Math.max(1, Math.min(365, parseInt(daysInput.value, 10) || 1)) : 1;
  if (daysInput) daysInput.value = trialDays;

  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { trialGiftEnabled: isEnabled, trialDays }
    });
    if (res.ok) {
      showToast('Đã lưu số ngày dùng thử: ' + trialDays + ' ngày!');
    } else {
      showToast('Lỗi lưu số ngày: ' + (res.data?.error || ''));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.toggleTrialGiftSetting = toggleTrialGiftSetting;
window.saveTrialDaysSetting = saveTrialDaysSetting;

function updateDetailUptime(){
  if(!detailBot||detailBot.status!=='afk')return;
  const base=Number(detailBot.uptimeSeconds||0);
  const extra=Math.floor((Date.now()-uptimeSyncAt)/1000);
  const seconds=Math.min(base+extra,3596399);
  const h=Math.floor(seconds/3600);const m=Math.floor((seconds%3600)/60);const s=seconds%60;
  const el=document.getElementById('detailUptime');if(el)el.textContent=h+'h '+m+'m '+s+'s';
}

async function handleRenameClick(btn) {
  if (!btn) return;
  const botId = Number(btn.getAttribute('data-bot-id'));
  const currentLabel = btn.getAttribute('data-bot-label') || '';
  await renameBotAlias(botId, currentLabel);
}

function renameBotAlias(botId, currentLabel) {
  editBot(null, botId);
  setTimeout(() => {
    const input = document.getElementById('editBotLabel');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}

async function renameDetailBotAlias() {
  if (!selectedBotId) return;
  const current = detailBot?.label || '';
  await renameBotAlias(selectedBotId, current);
}

async function openSupabaseModal() {
  const modal = document.getElementById('supabaseModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const alertBox = document.getElementById('supabaseAlertBox');
  if (alertBox) {
    alertBox.className = 'login-alert hidden';
    alertBox.textContent = '';
  }

  const badge = document.getElementById('supabaseStatusBadge');
  if (badge) {
    badge.innerHTML = '⏳ Đang kiểm tra...';
    badge.style.background = 'rgba(148,163,184,0.15)';
    badge.style.color = '#94a3b8';
    badge.style.borderColor = 'rgba(148,163,184,0.3)';
  }

  const statusMsg = document.getElementById('supabaseStatusMsg');
  if (statusMsg) statusMsg.textContent = 'Đang truy vấn trạng thái Supabase từ server...';

  try {
    const res = await requestJson('/api/manager/supabase/status');
    if (res.ok && res.data) {
      const urlInput = document.getElementById('supabaseUrlInput');
      const keyInput = document.getElementById('supabaseKeyInput');
      if (urlInput) urlInput.value = res.data.url || '';
      if (keyInput) keyInput.value = res.data.hasKey ? '••••••••••••••••' : '';

      if (badge) {
        if (res.data.connected) {
          badge.innerHTML = '🟢 Đã kết nối';
          badge.style.background = 'rgba(34,197,94,0.2)';
          badge.style.color = '#4ade80';
          badge.style.borderColor = 'rgba(34,197,94,0.4)';
        } else {
          badge.innerHTML = '🔴 Chưa kết nối';
          badge.style.background = 'rgba(239,68,68,0.2)';
          badge.style.color = '#f87171';
          badge.style.borderColor = 'rgba(239,68,68,0.4)';
        }
      }

      if (statusMsg) {
        statusMsg.textContent = res.data.message || (res.data.connected ? 'Kết nối Supabase Cloud hoạt động tốt.' : 'Chưa kết nối Supabase Cloud.');
      }
    } else {
      if (statusMsg) statusMsg.textContent = res.data?.error || 'Không thể tải trạng thái Supabase.';
    }
  } catch (err) {
    if (statusMsg) statusMsg.textContent = 'Lỗi kết nối: ' + err.message;
  }
}

function closeSupabaseModal() {
  document.getElementById('supabaseModal')?.classList.add('hidden');
}

async function copySupabaseSchemaSql() {
  const btn = document.getElementById('supabaseSchemaBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lấy SQL...'; }
  try {
    const res = await requestJson('/api/manager/supabase/schema');
    if (!res.ok || !res.data?.sql) throw new Error(res.data?.error || 'Không thể lấy SQL schema.');
    const sql = String(res.data.sql);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(sql);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = sql;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      if (!document.execCommand('copy')) throw new Error('Trình duyệt không cho phép sao chép tự động.');
      textarea.remove();
    }
    showToast('✅ Đã sao chép SQL. Mở Supabase SQL Editor, dán và Run một lần.');
  } catch (err) {
    showToast('⚠️ ' + (err.message || 'Không thể sao chép SQL schema.'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📋 Sao chép SQL tạo bảng'; }
  }
}

async function testSupabaseConnection() {
  const btn = document.getElementById('supabaseTestBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  const badge = document.getElementById('supabaseStatusBadge');
  const statusMsg = document.getElementById('supabaseStatusMsg');

  const url = (document.getElementById('supabaseUrlInput')?.value || '').trim();
  const key = (document.getElementById('supabaseKeyInput')?.value || '').trim();

  if (!url) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Vui lòng nhập Supabase Project URL.';
      alertBox.className = 'login-alert error';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang test...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key })
    });

    if (res.ok) {
      if (alertBox) {
        alertBox.textContent = '✅ ' + (res.data?.message || 'Kết nối Supabase thành công!');
        alertBox.className = 'login-alert success';
      }
      if (badge) {
        badge.innerHTML = '🟢 Kết nối OK';
        badge.style.background = 'rgba(34,197,94,0.2)';
        badge.style.color = '#4ade80';
        badge.style.borderColor = 'rgba(34,197,94,0.4)';
      }
      if (statusMsg) statusMsg.textContent = 'Kết nối Supabase Cloud phản hồi ping thành công!';
      showToast('✅ Kết nối Supabase thành công!');
    } else {
      if (alertBox) {
        alertBox.textContent = '⚠️ ' + (res.data?.error || 'Kết nối Supabase thất bại.');
        alertBox.className = 'login-alert error';
      }
      if (badge) {
        badge.innerHTML = '🔴 Lỗi kết nối';
        badge.style.background = 'rgba(239,68,68,0.2)';
        badge.style.color = '#f87171';
        badge.style.borderColor = 'rgba(239,68,68,0.4)';
      }
      if (statusMsg) statusMsg.textContent = res.data?.error || 'Lỗi kết nối Supabase.';
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Lỗi kiểm tra: ' + err.message;
      alertBox.className = 'login-alert error';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧪 Kiểm tra kết nối'; }
  }
}

async function saveSupabaseConfig() {
  const btn = document.getElementById('supabaseSaveBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  const badge = document.getElementById('supabaseStatusBadge');
  const statusMsg = document.getElementById('supabaseStatusMsg');

  const url = (document.getElementById('supabaseUrlInput')?.value || '').trim();
  const key = (document.getElementById('supabaseKeyInput')?.value || '').trim();

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key })
    });

    if (res.ok) {
      if (alertBox) {
        alertBox.textContent = '✅ ' + (res.data?.message || 'Đã lưu cấu hình Supabase!');
        alertBox.className = 'login-alert success';
      }
      if (badge) {
        if (res.data.connected) {
          badge.innerHTML = '🟢 Đã kết nối';
          badge.style.background = 'rgba(34,197,94,0.2)';
          badge.style.color = '#4ade80';
          badge.style.borderColor = 'rgba(34,197,94,0.4)';
        } else {
          badge.innerHTML = '🟡 Đã lưu (Chưa ping)';
          badge.style.background = 'rgba(234,179,8,0.2)';
          badge.style.color = '#eab308';
          badge.style.borderColor = 'rgba(234,179,8,0.4)';
        }
      }
      if (statusMsg) statusMsg.textContent = res.data?.message || 'Cấu hình đã được lưu.';
      showToast('✅ Đã lưu cấu hình Supabase Cloud!');
    } else {
      if (alertBox) {
        alertBox.textContent = '⚠️ ' + (res.data?.error || 'Lưu cấu hình thất bại.');
        alertBox.className = 'login-alert error';
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Lỗi: ' + err.message;
      alertBox.className = 'login-alert error';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Lưu cấu hình'; }
  }
}

async function syncAllToSupabase() {
  const btn = document.getElementById('supabaseSyncBtn');
  const alertBox = document.getElementById('supabaseAlertBox');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang đồng bộ...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/sync-now', {
      method: 'POST'
    });

    if (res.ok) {
      if (alertBox) {
        alertBox.textContent = '✅ ' + (res.data?.message || 'Đồng bộ Supabase thành công!');
        alertBox.className = 'login-alert success';
      }
      showToast(res.data?.message || '✅ Đã đồng bộ toàn bộ dữ liệu lên Supabase!');
    } else {
      if (alertBox) {
        alertBox.textContent = '⚠️ ' + (res.data?.error || 'Đồng bộ thất bại.');
        alertBox.className = 'login-alert error';
      }
      showToast('⚠️ ' + (res.data?.error || 'Lỗi đồng bộ'));
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Lỗi: ' + err.message;
      alertBox.className = 'login-alert error';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Đồng bộ ngay (Sync Now)'; }
  }
}

window.handleRenameClick = handleRenameClick;
window.renameBotAlias = renameBotAlias;
window.renameDetailBotAlias = renameDetailBotAlias;
window.addBotFromWeb = addBotFromWeb;
window.addDetailAutoChatSchedule = addDetailAutoChatSchedule;
window.addDetailBotSchedule = addDetailBotSchedule;
window.allowBotDrop = allowBotDrop;
window.clearDetailChat = clearDetailChat;
window.saveDetailProxy = saveDetailProxy;
window.testDetailProxy = testDetailProxy;
window.clearDetailProxy = clearDetailProxy;
window.toggleTrialGiftSetting = toggleTrialGiftSetting;
window.clearDetailLogs = clearDetailLogs;
window.closeAddBotModal = closeAddBotModal;
window.closeAdminModal = closeAdminModal;
window.closeEditBotModal = closeEditBotModal;
window.copyText = copyText;
window.deleteBot = deleteBot;
window.detailAction = detailAction;
window.detailPost = detailPost;
window.detailScheduleModeChanged = detailScheduleModeChanged;
window.dropBot = dropBot;
window.dropDetailInventory = dropDetailInventory;
window.dropDetailItemToWorld = dropDetailItemToWorld;
window.editBot = editBot;
window.equipDetailItem = equipDetailItem;
window.goHome = goHome;
window.loadAdminCredentials = loadAdminCredentials;
window.moveDetailItem = moveDetailItem;
window.openAddBotModal = openAddBotModal;
window.openAdminModal = openAdminModal;
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.submitBroadcast = submitBroadcastCommand;
window.hideLoginGate = hideLoginGate;
window.openBatchSettingsModal = openBatchSettingsModal;
window.closeBatchSettingsModal = closeBatchSettingsModal;
window.submitBatchSettings = submitBatchSettings;
window.filterBots = filterBots;
window.updateKpis = updateKpis;
window.openBot = openBot;
window.refreshDetail = refreshDetail;
window.refreshHome = refreshHome;
window.removeDetailAutoChatSchedule = removeDetailAutoChatSchedule;
window.removeDetailBotSchedule = removeDetailBotSchedule;
window.runAllAction = runAllAction;
window.saveDetailAccount = saveDetailAccount;
window.saveDetailAutoChat = saveDetailAutoChat;
window.saveDetailBotSchedules = saveDetailBotSchedules;
window.saveDetailSettings = saveDetailSettings;
window.detailBotScheduleModeChanged = detailBotScheduleModeChanged;
window.saveEditBot = saveEditBot;
window.selectDetailHotbar = selectDetailHotbar;
window.sendDetailMessage = sendDetailMessage;
window.showToast = showToast;
window.startBotDrag = startBotDrag;
window.unequipDetail = unequipDetail;
window.quickBotAction = quickBotAction;
window.setStatusFilter = setStatusFilter;
window.toggleSoundAlert = toggleSoundAlert;
window.exportBotList = exportBotList;
window.triggerImport = triggerImport;
window.handleImportFile = handleImportFile;
window.reconnectOfflineBots = reconnectOfflineBots;
window.changeBotSort = changeBotSort;
window.quickDetailCommand = quickDetailCommand;
window.copyToClipboard = copyToClipboard;
window.openWebhookModal = openWebhookModal;
window.closeWebhookModal = closeWebhookModal;
window.saveWebhookSettings = saveWebhookSettings;
window.testWebhookSettings = testWebhookSettings;
window.exportBotLogs = exportBotLogs;
window.handleLoginSubmit = handleLoginSubmit;
window.logout = logout;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openUserManagementModal = openUserManagementModal;
window.closeUserManagementModal = closeUserManagementModal;
window.openCreateUserModal = openCreateUserModal;
window.openEditUserModal = openEditUserModal;
window.closeUserEditModal = closeUserEditModal;
window.saveUserForm = saveUserForm;
window.deleteUserPrompt = deleteUserPrompt;
window.toggleSelectAllUserBots = toggleSelectAllUserBots;
window.generateRandomUserPassword = generateRandomUserPassword;
window.togglePassPeek = toggleUserPasswordPeek;
window.openAnnouncementAdminModal = openAnnouncementAdminModal;
window.closeAnnouncementAdminModal = closeAnnouncementAdminModal;
window.saveAnnouncementConfig = saveAnnouncementConfig;
window.previewAnnouncementModal = previewAnnouncementModal;
window.handleAnnouncementModeChange = handleAnnouncementModeChange;
window.dismissUserAnnouncement = dismissUserAnnouncement;
window.toggleUserProfileDropdown = toggleUserProfileDropdown;
window.closeUserProfileDropdown = closeUserProfileDropdown;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.submitChangePassword = submitChangePassword;
window.openChangelogModal = openChangelogModal;
window.closeChangelogModal = closeChangelogModal;
window.openAuditLogModal = openAuditLogModal;
window.closeAuditLogModal = closeAuditLogModal;
window.refreshAuditLogs = refreshAuditLogs;
window.switchAuditLogType = switchAuditLogType;
window.openSupabaseModal = openSupabaseModal;
window.closeSupabaseModal = closeSupabaseModal;
window.copySupabaseSchemaSql = copySupabaseSchemaSql;
window.testSupabaseConnection = testSupabaseConnection;
window.saveSupabaseConfig = saveSupabaseConfig;
window.syncAllToSupabase = syncAllToSupabase;
window.debounceAuditFilter = debounceAuditFilter;
window.filterAuditLogs = debounceAuditFilter;
window.navigateAuditPage = navigateAuditPage;
window.exportAuditLogs = exportAuditLogs;
window.clearAllAuditLogs = clearAllAuditLogs;
window.openBackupManagerModal = openBackupManagerModal;
window.closeBackupManagerModal = closeBackupManagerModal;
window.refreshBackupList = refreshBackupList;
window.triggerCreateBackup = triggerCreateBackup;
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.submitBroadcastCommand = submitBroadcastCommand;
window.openRenewModal = openRenewModal;
window.closeRenewModal = closeRenewModal;
window.submitRenewKey = submitRenewKey;
window.openKeyManagementModal = openKeyManagementModal;
window.closeKeyManagementModal = closeKeyManagementModal;
window.refreshKeysTable = refreshKeysTable;
window.submitCreateKeys = submitCreateKeys;
window.deleteLicenseKey = deleteLicenseKey;
window.quickAddUserDays = quickAddUserDays;
window.resetCustomerBot = resetCustomerBot;
window.resetBotForNewCustomer = resetCustomerBot;
window.renderDetailRemoteGui = renderDetailRemoteGui;
window.clickDetailGuiSlot = clickDetailGuiSlot;
window.closeDetailGuiWindow = closeDetailGuiWindow;
window.saveAndRestartBot = saveAndRestartBot;

window.addEventListener('error',event=>{
  try{console.error('[MANAGER UI]',event.error||event.message||'Unknown UI error');}catch(_){}
});
window.addEventListener('unhandledrejection',event=>{
  try{console.error('[MANAGER UI] Unhandled rejection',event.reason);}catch(_){}
});

(async function init(){
  updateSoundAlertButton();
  initDetailChatInputHistory();

  if (currentUser) {
    try {
      applyUserRoleUI();
      hideLoginGate();
    } catch (_) {}
  }

  try {
    let res = await requestJson('/api/auth/me');
    if (!res.ok && res.status === 401) {
      // Nếu có stale Bearer token trong localStorage khiến bị 401 dù cookie hợp lệ,
      // xóa bỏ stale token và thử lại lần 2 bằng session cookie:
      const staleToken = localStorage.getItem('kingmc_session');
      if (staleToken) {
        try { localStorage.removeItem('kingmc_session'); } catch (_) {}
        res = await requestJson('/api/auth/me');
      }
    }

    if (res.ok && res.data?.user) {
      currentUser = res.data.user;
      applyUserRoleUI();
      hideLoginGate();
      const routed = await resolveRouteFromUrl();
      if (!routed) await refreshHome();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
    } else if (res.status === 401) {
      currentUser = null;
      bots = [];
      selectedBotId = null;
      detailBot = null;
      if (managerPollTimerId) clearTimeout(managerPollTimerId);
      try {
        localStorage.removeItem('kingmc_session');
        sessionStorage.removeItem('kingmc_session');
        document.cookie = 'kingmc_mgr_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; SameSite=Lax';
      } catch (_) {}
      applyUserRoleUI();
      renderHome();
      showLoginGate();
    } else if (res.status === 403) {
      currentUser = null;
      applyUserRoleUI();
      renderHome();
      showLoginGate();
      showToast(res.data?.error || 'Tài khoản không đủ quyền truy cập.');
    } else {
      if (!currentUser) {
        applyUserRoleUI();
        renderHome();
        showLoginGate();
        showToast('⚠️ Không thể xác minh phiên đăng nhập (' + (res.data?.error || 'Lỗi kết nối') + ').');
      }
    }
  } catch (err) {
    if (!currentUser) {
      applyUserRoleUI();
      renderHome();
      showLoginGate();
    }
  }
})();

// managerPollTimerId declared at top of client script
function scheduleNextManagerPoll() {
  if (managerPollTimerId) clearTimeout(managerPollTimerId);
  if (!currentUser) return;
  const delay = document.hidden ? 5000 : 500;
  managerPollTimerId = setTimeout(async () => {
    try {
      if (!routeResolving && currentUser) {
        if (selectedBotId === null) await refreshHome();
        else await refreshDetail(false);
      }
    } finally {
      if (currentUser) {
        scheduleNextManagerPoll();
      }
    }
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (selectedBotId === null) refreshHome();
    else refreshDetail(true);
  }
  scheduleNextManagerPoll();
});

setInterval(updateDetailUptime,250);
setInterval(updateUserHeaderCountdown, 5000);
</script>

  <!-- MODAL BROADCAST LỆNH -->
  <div id="broadcastModal" class="modal hidden">
    <div class="modal-card" style="max-width:480px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">📡 Broadcast Lệnh Hàng Loạt</h3>
        <button class="small" onclick="closeBroadcastModal()">✕</button>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">Gửi đồng loạt 1 lệnh chat hoặc câu lệnh server (/bal, /menu, /spawn,...) tới toàn bộ các bot trong quyền quản lý của bạn:</p>
      <div style="margin-bottom:12px;">
        <label for="broadcastTargetTag" style="display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:600;">🎯 Đối tượng nhận lệnh:</label>
        <select id="broadcastTargetTag" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);font-size:13px;outline:none;">
          <option value="">🌐 Toàn bộ bot trong danh sách</option>
        </select>
      </div>
      <div style="margin-bottom:14px;">
        <input type="text" id="broadcastCommandInput" placeholder="Ví dụ: /bal hoặc /menu hoặc Tin nhắn..." style="width:100%;box-sizing:border-box;" />
      </div>
      <div class="chip-row" style="margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/bal'">/bal</button>
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/menu'">/menu</button>
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/spawn'">/spawn</button>
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/team chat'">/team chat</button>
      </div>
      <div id="broadcastResultBox" style="display:none;font-size:12px;margin-bottom:12px;padding:8px;border-radius:6px;"></div>
      <div class="modal-actions" style="margin-top:16px;">
        <button onclick="closeBroadcastModal()">Hủy</button>
        <button class="primary" onclick="submitBroadcastCommand()">🚀 Bắn Lệnh Ngay</button>
      </div>
    </div>
  </div>

  <!-- MODAL GIA HẠN BẰNG KEY (USER) -->
  <div id="renewModal" class="modal hidden">
    <div class="modal-card" style="max-width:440px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🎁 Gia Hạn Gói Thuê Bằng Mã Key</h3>
        <button class="small" onclick="closeRenewModal()">✕</button>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">Nhập mã kích hoạt (License Key/Giftcode) được cấp bởi Quản trị viên để gia hạn thời gian sử dụng bot:</p>
      <div style="margin-bottom:14px;">
        <label style="font-size:12px;color:var(--muted);font-weight:600;display:block;margin-bottom:4px;">MÃ KEY GIA HẠN:</label>
        <input type="text" id="renewKeyInput" placeholder="VD: KINGMC-7D-ABC123" style="width:100%;box-sizing:border-box;text-transform:uppercase;" />
      </div>
      <div id="renewResultBox" style="display:none;font-size:12px;margin-bottom:12px;padding:8px;border-radius:6px;"></div>
      <div class="modal-actions" style="margin-top:16px;">
        <button onclick="closeRenewModal()">Đóng</button>
        <button class="primary" onclick="submitRenewKey()">Kích Hoạt Ngay</button>
      </div>
    </div>
  </div>

  <!-- MODAL QUẢN LÝ KEY GIA HẠN (ADMIN ONLY) -->
  <div id="keyManagementModal" class="modal hidden">
    <div class="modal-card" style="max-width:750px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🎟️ Quản Lý Mã Key Gia Hạn (License Keys)</h3>
        <button class="small" onclick="closeKeyManagementModal()">✕</button>
      </div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);padding:14px;border-radius:8px;margin-bottom:16px;">
        <h4 style="margin:0 0 10px 0;font-size:14px;">Tạo Mã Key Mới</h4>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">GÓI THUÊ (NGÀY):</label>
            <div style="display:flex;gap:4px;align-items:center;">
              <select id="createKeyDays" onchange="onKeyDaysSelectChange('modal')" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px;border-radius:6px;font-size:13px;">
                <option value="1">1 Ngày (Dùng thử)</option>
                <option value="3">3 Ngày</option>
                <option value="7" selected>7 Ngày (1 Tuần)</option>
                <option value="14">14 Ngày (2 Tuần)</option>
                <option value="30">30 Ngày (1 Tháng)</option>
                <option value="custom">✏️ Tùy chỉnh ngày...</option>
              </select>
              <input type="number" id="createKeyCustomDays" min="1" max="3650" placeholder="Số ngày" style="display:none;width:75px;background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px;border-radius:6px;font-size:13px;" />
            </div>
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">TÊN GÓI:</label>
            <input type="text" id="createKeyPlan" placeholder="VD: Gói Tuần VIP" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 10px;border-radius:6px;font-size:13px;width:130px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">SỐ LƯỢNG KEY:</label>
            <input type="number" id="createKeyCount" value="1" min="1" max="10" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 10px;border-radius:6px;font-size:13px;width:60px;" />
          </div>
          <button class="primary" onclick="submitCreateKeys()" style="padding:8px 16px;">+ Tạo Key</button>
        </div>
      </div>

      <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
          <thead>
            <tr style="background:rgba(255,255,255,0.06);border-bottom:1px solid var(--border);">
              <th style="padding:8px 10px;">MÃ KEY</th>
              <th style="padding:8px 10px;">GÓI</th>
              <th style="padding:8px 10px;">TRẠNG THÁI</th>
              <th style="padding:8px 10px;">NGƯỜI KÍCH HOẠT</th>
              <th style="padding:8px 10px;text-align:right;">THAO TÁC</th>
            </tr>
          </thead>
          <tbody id="keysTableBody"></tbody>
        </table>
      </div>
      <div class="modal-actions" style="margin-top:16px;">
        <button onclick="closeKeyManagementModal()">Đóng</button>
      </div>
    </div>
  </div>

</body>
</html>`;

// ============================================================================
// CÁC ENDPOINT XÁC THỰC (AUTH) & QUẢN LÝ NGƯỜI DÙNG (USER MANAGEMENT)
// ============================================================================


let registerLock = Promise.resolve();
function withRegisterLock(fn) {
    const next = registerLock.then(() => fn(), () => fn());
    registerLock = next.catch(() => {});
    return next;
}

async function resetBotsForAssignment(botIds, reason = 'reassignment') {
    if (!Array.isArray(botIds) || botIds.length === 0) return { ok: true };
    for (const rawId of botIds) {
        const bId = Number(rawId);
        const botConfig = BOT_CONFIG.find(c => Number(c.id) === bId);
        if (!botConfig) continue;
        try {
            const resetRes = await fetchChild(botConfig, '/api/bot/reset-customer', { method: 'POST', timeoutMs: 5000 });
            if (!resetRes || !resetRes.ok || resetRes.data?.ok !== true) {
                console.error(`[RESET_ASSIGN] Bot #${bId} reset trả về lỗi khi ${reason}:`, resetRes?.data || resetRes?.status);
                return { ok: false, botId: bId, error: resetRes?.data?.error || 'RESET_FAILED' };
            }
            summaryCache.delete(bId);
            try { await refreshSummary(botConfig, true); } catch (_) {}
        } catch (e) {
            console.error(`[RESET_ASSIGN] Không thể kết nối để reset bot #${bId} khi ${reason}:`, e.message);
            return { ok: false, botId: bId, error: e.message };
        }
    }
    return { ok: true };
}

async function allocateBotForNewUser(newUsername) {
    const users = loadUsers(true);
    const now = Date.now();

    // 1. Tập hợp các bot đang có người dùng active (chưa hết hạn) thuê
    const activeOccupiedBotMap = new Map();
    for (const u of users) {
        if (u.status === 'active') {
            const isExpired = u.expiresAt && Date.parse(u.expiresAt) <= now;
            if (!isExpired && Array.isArray(u.assignedBotIds)) {
                for (const bId of u.assignedBotIds) {
                    activeOccupiedBotMap.set(Number(bId), u.username);
                }
            }
        }
    }

    // 2. Tập hợp tất cả bot đã từng gán cho bất kỳ user nào
    const allAssignedBotIds = new Set();
    for (const u of users) {
        if (Array.isArray(u.assignedBotIds)) {
            for (const bId of u.assignedBotIds) {
                allAssignedBotIds.add(Number(bId));
            }
        }
    }

    const candidates = [];

    // Ưu tiên 1: Bot trong BOT_CONFIG hoàn toàn chưa ai thuê
    for (const b of BOT_CONFIG) {
        const bId = Number(b.id);
        if (!allAssignedBotIds.has(bId)) {
            candidates.push({ botConfig: b, reclaimedFrom: null });
        }
    }

    // Ưu tiên 2: Nếu không có bot hoàn toàn trống, tìm bot của user đã hết hạn thuê
    for (const u of users) {
        const isExpired = u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now);
        if (isExpired && Array.isArray(u.assignedBotIds) && u.assignedBotIds.length > 0) {
            for (const bId of u.assignedBotIds) {
                if (!activeOccupiedBotMap.has(Number(bId))) {
                    const found = BOT_CONFIG.find(c => Number(c.id) === Number(bId));
                    if (found && !candidates.some(c => Number(c.botConfig.id) === Number(bId))) {
                        candidates.push({ botConfig: found, reclaimedFrom: u });
                    }
                }
            }
        }
    }

    if (candidates.length === 0) {
        return { ok: false, error: 'FULL_BOTS' };
    }

    // Thử từng candidate tuần tự: bot nào reset thành công trước thì bàn giao bot đó!
    for (const { botConfig, reclaimedFrom } of candidates) {
        const chosenBotId = Number(botConfig.id);
        try {
            const resetRes = await fetchChild(botConfig, '/api/bot/reset-customer', { method: 'POST', timeoutMs: 5000 });
            if (resetRes && resetRes.ok && resetRes.data?.ok === true) {
                if (reclaimedFrom) {
                    reclaimedFrom.assignedBotIds = (reclaimedFrom.assignedBotIds || []).filter(id => Number(id) !== chosenBotId);
                    saveUsers(users);
                    logAuditEvent({
                        action: 'BOT_RECLAIM_EXPIRED',
                        target: { botId: chosenBotId, label: botConfig.label },
                        details: `Thu hồi Bot #${chosenBotId} (${botConfig.label || ''}) từ tài khoản hết hạn "${reclaimedFrom.username}" để bàn giao cho khách mới "${newUsername}".`,
                        status: 'SUCCESS'
                    });
                }
                summaryCache.delete(chosenBotId);
                try { await refreshSummary(botConfig, true); } catch (_) {}
                return {
                    ok: true,
                    botId: chosenBotId,
                    botLabel: botConfig.label || ('Bot ' + chosenBotId)
                };
            } else {
                console.warn(`[ALLOCATE] Bot #${chosenBotId} reset trả về lỗi (${resetRes?.data?.error || resetRes?.status}), đang thử ứng viên tiếp theo...`);
            }
        } catch (e) {
            console.warn(`[ALLOCATE] Không thể kết nối tới Bot #${chosenBotId} (${e.message}), đang thử ứng viên tiếp theo...`);
        }
    }

    return { ok: false, error: 'RESET_FAILED' };
}

// Khách tự đăng ký tài khoản mới (Tự động cấp bot trống hoặc tái sử dụng bot của tài khoản hết hạn)
app.post('/api/auth/register', (req, res) => {
    return withRegisterLock(async () => {
        try {
            const clientIp = getClientIp(req);
            const username = String(req.body?.username || '').trim();
            const password = String(req.body?.password ?? '');
            const providedKey = String(req.body?.licenseKey || req.body?.key || '').trim().toUpperCase();

            const rateLimit = checkRegisterRateLimit(clientIp, username || 'register_user');
            if (!rateLimit.allowed) {
                return res.status(429).json({ ok: false, error: rateLimit.error });
            }

            if (!username) {
                recordRegisterAttempt(clientIp, username, false);
                return res.status(400).json({ ok: false, error: 'Vui lòng nhập tên đăng nhập.' });
            }
            if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
                recordRegisterAttempt(clientIp, username, false);
                return res.status(400).json({ ok: false, error: 'Tên người dùng chỉ được chứa chữ cái, số, gạch dưới, gạch ngang và chấm (3-32 ký tự).' });
            }
            if (username.toLowerCase() === 'admin') {
                recordRegisterAttempt(clientIp, username, false);
                return res.status(400).json({ ok: false, error: 'Tên "admin" được bảo lưu cho Quản trị viên chính.' });
            }

            const passPolicy = validatePasswordPolicy(password);
            if (!passPolicy.valid) {
                recordRegisterAttempt(clientIp, username, false);
                return res.status(400).json({ ok: false, error: passPolicy.error });
            }

            const users = loadUsers(true);
            if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
                recordRegisterAttempt(clientIp, username, false);
                return res.status(400).json({ ok: false, error: `Tên người dùng "${username}" đã tồn tại. Vui lòng chọn tên khác!` });
            }

            const trialGiftEnabled = registry.systemSettings?.trialGiftEnabled !== false;
            const trialDays = Math.max(1, Math.min(365, parseInt(registry.systemSettings?.trialDays, 10) || 1));
            let planName = trialDays === 1 ? 'Dùng thử 1 ngày' : `Dùng thử ${trialDays} ngày`;
            let expiresAt = new Date(Date.now() + trialDays * 86400000).toISOString();
            let assignedBotIds = [];
            let keyObj = null;
            let registerMessage = `Đăng ký thành công! Chào mừng ${username} đến với KBOT.`;

            if (providedKey !== '') {
                const keysList = loadKeysFile();
                const keyIndex = keysList.findIndex(k => k.key.toUpperCase() === providedKey);
                if (keyIndex === -1 || keysList[keyIndex].used) {
                    recordRegisterAttempt(clientIp, username, false);
                    return res.status(400).json({ ok: false, error: 'Mã Key gia hạn không hợp lệ hoặc đã được sử dụng!' });
                }
                keyObj = keysList[keyIndex];
                keyObj.used = true;
                keyObj.usedBy = username;
                keyObj.usedAt = new Date().toISOString();
                const days = Number(keyObj.days || 30);
                expiresAt = new Date(Date.now() + days * 86400000).toISOString();
                planName = keyObj.planName || `Gói ${days} ngày`;
                if (Array.isArray(keyObj.botIds) && keyObj.botIds.length > 0) {
                    assignedBotIds = keyObj.botIds.map(Number);
                    const resetRes = await resetBotsForAssignment(assignedBotIds, `đăng ký tài khoản "${username}" với Key ${providedKey}`);
                    if (!resetRes.ok) {
                        recordRegisterAttempt(clientIp, username, false);
                        return res.status(500).json({ ok: false, error: `Không thể dọn dẹp reset Bot #${resetRes.botId} để bàn giao (${resetRes.error}). Vui lòng liên hệ Admin!` });
                    }
                }
                registerMessage = `Đăng ký thành công với Mã Key! Gói: ${planName}, Hạn: ${days} ngày.`;
            } else {
                // Đăng ký không có Key -> kiểm tra cài đặt tặng ngày dùng thử của Admin
                if (trialGiftEnabled) {
                    const alloc = await allocateBotForNewUser(username);
                    if (alloc.ok) {
                        assignedBotIds = [alloc.botId];
                        registerMessage = `Đăng ký thành công! Bạn đã được cấp Bot #${alloc.botId} (${alloc.botLabel}) dùng thử ${trialDays} ngày miễn phí.`;
                    } else if (alloc.error === 'RESET_FAILED') {
                        // Bot đang có trục trặc dọn dẹp -> tạo tài khoản nhưng chưa cấp bot bẩn
                        assignedBotIds = [];
                        planName = `Chờ cấp bot (${planName})`;
                        registerMessage = `Đăng ký thành công! Bot hiện tại đang bảo trì/dọn dẹp. Tài khoản của bạn đã được tạo kèm ${trialDays} ngày dùng thử, vui lòng liên hệ Admin để được kích hoạt bot.`;
                    } else {
                        // Toàn bộ bot đều đang có người thuê -> acc vẫn tạo nhưng chưa cấp bot
                        assignedBotIds = [];
                        planName = `Chờ cấp bot (${planName})`;
                        registerMessage = `Đăng ký thành công! Hiện tại toàn bộ bot đều đang có người thuê. Tài khoản của bạn đã được tạo kèm ${trialDays} ngày dùng thử, vui lòng liên hệ Admin để được cấp bot.`;
                    }
                } else {
                    // Admin đã TẮT chế độ tặng dùng thử -> Chặn đăng ký không có Key
                    recordRegisterAttempt(clientIp, username, false);
                    return res.status(400).json({
                        ok: false,
                        error: 'Chế độ tặng ngày dùng thử hiện đang tạm dừng. Vui lòng nhập Mã Key kích hoạt gói thuê để đăng ký tài khoản!'
                    });
                }
            }

            const newUser = {
                id: 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                username,
                password,
                role: 'user',
                status: 'active',
                planName,
                expiresAt,
                note: providedKey ? `Tự đăng ký với mã Key ${providedKey}` : (assignedBotIds.length ? `Tự đăng ký (Được cấp Bot #${assignedBotIds.join(', ')})` : 'Tự đăng ký (Chưa có bot)'),
                allowAccountChange: true,
                assignedBotIds,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            assignBotsExclusively(users, '', assignedBotIds);
            users.push(newUser);
            const saved = saveUsers(users);
            if (!saved) {
                users.pop();
                recordRegisterAttempt(clientIp, username, false);
                return res.status(500).json({ ok: false, error: 'Không thể lưu tài khoản mới vào hệ thống. Vui lòng thử lại!' });
            }

            if (keyObj) {
                const keysList = loadKeysFile();
                const keySaved = saveKeysFile(keysList.map(k => k.key.toUpperCase() === providedKey ? keyObj : k));
                if (!keySaved) {
                    users.pop();
                    saveUsers(users);
                    recordRegisterAttempt(clientIp, username, false);
                    return res.status(500).json({ ok: false, error: 'Không thể cập nhật trạng thái Key. Đã hủy đăng ký, vui lòng thử lại!' });
                }
            }

            // Ghi nhận đăng ký thành công cho rate limiter
            recordRegisterAttempt(clientIp, username, true);

            void syncAuthToAllBots(true);

            logAuditEvent({
                req,
                action: 'USER_REGISTER',
                target: { userId: newUser.id, username },
                details: `Người dùng tự đăng ký tài khoản "${username}" thành công (Gói: ${planName}, Cấp bot: ${assignedBotIds.length ? assignedBotIds.join(', ') : 'Chưa có'}). Mật khẩu tạo: "********"`,
                status: 'SUCCESS'
            });

            // Tự động cấp phiên đăng nhập ngay sau khi đăng ký
            const sessionDurationMs = 30 * 86400000;
            const cookieMaxAge = 2592000;
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = hashSessionToken(token);
            const session = {
                tokenHash,
                userId: newUser.id,
                username: newUser.username,
                role: 'user',
                assignedBotIds,
                expiresAt: Date.now() + sessionDurationMs,
                expiresAtRental: newUser.expiresAt,
                planName: newUser.planName,
                allowAccountChange: true,
                status: 'active'
            };
            activeSessions.set(tokenHash, session);
            saveSessions();

            res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
            return res.json({
                ok: true,
                user: {
                    username: newUser.username,
                    role: 'user',
                    assignedBotIds,
                    planName: newUser.planName,
                    expiresAt: newUser.expiresAt,
                    allowAccountChange: true,
                    status: 'active'
                },
                message: registerMessage
            });
        } catch (err) {
            console.error('[AUTH] Lỗi đăng ký tài khoản:', err.message);
            return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi máy chủ trong quá trình đăng ký.' });
        }
    });
});

app.post('/api/auth/login', async (req, res) => {
    const clientIp = getClientIp(req);
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password ?? '');
    const providedKey = String(req.body?.licenseKey || req.body?.key || '').trim().toUpperCase();
    const rememberMe = req.body?.rememberMe === true;
    const sessionDurationMs = rememberMe ? (30 * 86400000) : (24 * 3600000);
    const cookieMaxAge = rememberMe ? 2592000 : 86400;

    const rateLimit = checkLoginRateLimit(clientIp, username);
    if (!rateLimit.allowed) {
        logAuditEvent({
            req,
            action: 'AUTH_LOGIN_BLOCKED',
            target: { username },
            details: 'Bị chặn do thử đăng nhập sai quá nhiều lần từ IP ' + clientIp,
            status: 'BLOCKED'
        });
        return res.status(429).json({ ok: false, error: rateLimit.error });
    }

    if (!username || !password) {
        return res.status(400).json({ ok: false, error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' });
    }

    // 1. Quản trị viên ADMIN
    if (username.toLowerCase() === 'admin') {
        const adminPass = getAdminPassword();
        if (!verifyAdminPassword(password, adminPass)) {
            recordLoginAttempt(clientIp, username, false);
            logAuditEvent({
                req,
                action: 'AUTH_ADMIN_LOGIN_FAILED',
                target: { username: 'admin' },
                details: 'Đăng nhập Quản trị viên thất bại: Sai mật khẩu.',
                status: 'FAILED'
            });
            return res.status(401).json({ ok: false, error: 'Mật khẩu Quản trị viên (Admin) không chính xác.' });
        }

        if (providedKey !== '') {
            return res.status(400).json({
                ok: false,
                error: 'Tài khoản Quản trị viên (Admin) không dùng Mã Key gia hạn. Vui lòng để trống ô Mã Key!'
            });
        }

        recordLoginAttempt(clientIp, username, true);

        // Tự động di trú mật khẩu Admin sang scrypt nếu đang là plaintext
        if (!adminPass.startsWith('scrypt$')) {
            registry.adminPassword = hashAdminPassword(password);
            const regSaved = saveRegistry();
            if (regSaved) {
                console.log('[SECURITY] 🔐 Đã tự động nâng cấp mật khẩu Admin sang scrypt hash an toàn!');
            } else {
                console.error('[SECURITY] ❌ Không thể lưu registry khi nâng cấp mật khẩu Admin');
            }
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashSessionToken(token);
        const expiresAt = Date.now() + sessionDurationMs;
        const session = {
            tokenHash,
            userId: 'admin',
            username: 'admin',
            role: 'admin',
            assignedBotIds: null,
            expiresAt
        };
        activeSessions.set(tokenHash, session);
        saveSessions();
        logAuditEvent({
            req,
            action: 'AUTH_ADMIN_LOGIN_SUCCESS',
            target: { username: 'admin' },
            details: 'Quản trị viên đăng nhập thành công vào hệ thống.',
            status: 'SUCCESS'
        });
        res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
        return res.json({
            ok: true,
            token,
            user: {
                username: 'admin',
                role: 'admin',
                assignedBotIds: null,
                mustChangePassword: registry.mustChangePassword === true
            },
            message: 'Đăng nhập thành công với quyền Quản trị viên (ADMIN)!'
        });
    }

    // 2. Tài khoản người dùng USER
    const users = loadUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
        recordLoginAttempt(clientIp, username, false);
        logAuditEvent({
            req,
            action: 'AUTH_LOGIN_FAILED',
            target: { username },
            details: 'Đăng nhập thất bại: Tài khoản "' + username + '" không tồn tại.',
            status: 'FAILED'
        });
        return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    }

    // BẮT BUỘC kiểm tra mật khẩu TRƯỚC KHI kiểm tra hay gạch Key
    if (!verifyUserPassword(password, user.password)) {
        recordLoginAttempt(clientIp, username, false);
        logAuditEvent({
            req,
            action: 'AUTH_LOGIN_FAILED',
            target: { username },
            details: 'Đăng nhập thất bại: Sai mật khẩu cho tài khoản "' + username + '".',
            status: 'FAILED'
        });
        return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    }

    recordLoginAttempt(clientIp, username, true);

    // Xử lý nạp Key gia hạn (nếu có nhập)
    if (providedKey !== '') {
        const renewRate = checkRenewRateLimit(req, user.username);
        if (!renewRate.allowed) {
            return res.status(429).json({ ok: false, error: renewRate.error });
        }

        const keysList = loadKeysFile();
        const keyIndex = keysList.findIndex(k => k.key.toUpperCase() === providedKey);
        if (keyIndex === -1 || keysList[keyIndex].used) {
            recordRenewAttempt(req, user.username, false);
            return res.status(400).json({ ok: false, error: 'Mã Key gia hạn không hợp lệ hoặc đã được sử dụng!' });
        }

        recordRenewAttempt(req, user.username, true);
        const keyObj = keysList[keyIndex];

        // Giao dịch atomic nạp Key
        const keysBackup = JSON.parse(JSON.stringify(keysList));
        const usersBackup = JSON.parse(JSON.stringify(users));

        keyObj.used = true;
        keyObj.usedBy = user.username;
        keyObj.usedAt = new Date().toISOString();

        const baseTime = (user.expiresAt && Date.parse(user.expiresAt) > Date.now())
            ? Date.parse(user.expiresAt)
            : Date.now();
        user.expiresAt = new Date(baseTime + Number(keyObj.days || 30) * 86400000).toISOString();
        user.status = 'active';
        if (keyObj.planName) user.planName = keyObj.planName;
        if (Array.isArray(keyObj.botIds) && keyObj.botIds.length > 0) {
            const currentBots = Array.isArray(user.assignedBotIds) ? user.assignedBotIds.map(Number) : [];
            const newlyAssigned = keyObj.botIds.map(Number).filter(id => !currentBots.includes(id));
            if (newlyAssigned.length > 0) {
                const resetRes = await resetBotsForAssignment(newlyAssigned, `nạp Key gia hạn cho "${user.username}"`);
                if (!resetRes.ok) {
                    recordRenewAttempt(req, user.username, false);
                    return res.status(500).json({ ok: false, error: `Không thể dọn dẹp reset Bot #${resetRes.botId} để bàn giao (${resetRes.error}). Vui lòng liên hệ Admin!` });
                }
            }
            const merged = [...new Set([...currentBots, ...keyObj.botIds.map(Number)])];
            user.assignedBotIds = merged;
            assignBotsExclusively(users, user.id || user.username, keyObj.botIds);
        }

        const keysSaved = saveKeysFile(keysList);
        const usersSaved = saveUsers(users);

        if (!keysSaved || !usersSaved) {
            saveKeysFile(keysBackup);
            saveUsers(usersBackup);
            return res.status(500).json({ ok: false, error: 'Lỗi lưu trữ giao dịch nạp Key. Vui lòng thử lại!' });
        }

        logAuditEvent({
            req,
            action: 'RENTAL_RENEW_KEY',
            target: { username: user.username, key: keyObj.key },
            details: 'Gia hạn thành công khi đăng nhập bằng Key (' + keyObj.key + ', +' + keyObj.days + ' ngày). Hạn mới: ' + user.expiresAt,
            status: 'SUCCESS'
        });

        void syncAuthToAllBots(true);
    }

    // Tự động mã hóa AES-256-GCM nếu trong file thô lưu plaintext
    try {
        if (fs.existsSync(USERS_FILE)) {
            const raw = fs.readFileSync(USERS_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.users) && data.users.some(u => u && u.password && !String(u.password).startsWith('aes256$gcm$'))) {
                saveUsers(users);
            }
        }
    } catch (_) {}

    // Xác định trạng thái tài khoản: disabled, expired hoặc active
    const isTemporarilyDisabled = user.status === 'disabled';
    const isExpired = !isTemporarilyDisabled && (user.status === 'expired' || (user.expiresAt && Date.now() > Date.parse(user.expiresAt)));
    const finalStatus = isTemporarilyDisabled ? 'disabled' : (isExpired ? 'expired' : 'active');

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(token);
    const expiresAt = Date.now() + sessionDurationMs;
    const assignedBotIds = Array.isArray(user.assignedBotIds) ? user.assignedBotIds.map(Number) : [];
    const session = {
        tokenHash,
        userId: user.id,
        username: user.username,
        role: 'user',
        assignedBotIds,
        expiresAt,
        expiresAtRental: user.expiresAt || null,
        planName: user.planName || 'Gói thường',
        allowAccountChange: user.allowAccountChange !== false,
        status: finalStatus,
        lockReason: user.lockReason || ''
    };
    activeSessions.set(tokenHash, session);
    saveSessions();

    logAuditEvent({
        req,
        action: isTemporarilyDisabled ? 'AUTH_USER_LOGIN_DISABLED' : (isExpired ? 'AUTH_USER_LOGIN_EXPIRED' : 'AUTH_USER_LOGIN_SUCCESS'),
        target: { userId: user.id, username: user.username },
        details: isTemporarilyDisabled
            ? `Khách thuê "${user.username}" đăng nhập (Tài khoản đang bị tạm khóa: ${user.lockReason || 'Không có lý do'}).`
            : (isExpired
                ? `Khách thuê "${user.username}" đăng nhập (Gói thuê đã hết hạn).`
                : `Khách thuê "${user.username}" đăng nhập thành công (Gói: ${user.planName || 'Chuẩn'}, Hạn: ${user.expiresAt || 'Vĩnh viễn'}, Quản lý: ${assignedBotIds.length} bot).`),
        status: 'SUCCESS'
    });

    res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
    return res.json({
        ok: true,
        token,
        user: {
            username: user.username,
            role: 'user',
            assignedBotIds,
            planName: user.planName || 'Gói thường',
            expiresAt: user.expiresAt || null,
            allowAccountChange: user.allowAccountChange !== false,
            status: finalStatus,
            lockReason: user.lockReason || ''
        },
        message: isTemporarilyDisabled
            ? 'Tài khoản của bạn đang bị tạm khóa. Vui lòng xem thông báo của Quản trị viên.'
            : (isExpired
                ? 'Tài khoản của bạn đã hết hạn thuê. Vui lòng nạp Mã Key để tiếp tục sử dụng!'
                : 'Đăng nhập thành công! Chào mừng ' + user.username + '.')
    });
});

app.post('/api/auth/logout', async (req, res) => {
    const session = getSessionUser(req);
    const headerToken = getAuthToken(req);
    const cookies = parseCookies(req);
    const cookieToken = cookies.kingmc_mgr_session;

    let modified = false;
    if (headerToken) {
        const h = hashSessionToken(headerToken);
        if (activeSessions.has(h)) {
            activeSessions.delete(h);
            modified = true;
            if (supabaseAdapter && supabaseAdapter.isEnabled()) {
                await supabaseAdapter.deleteSession(h);
            }
        }
    }
    if (cookieToken) {
        const h = hashSessionToken(cookieToken);
        if (activeSessions.has(h)) {
            activeSessions.delete(h);
            modified = true;
            if (supabaseAdapter && supabaseAdapter.isEnabled()) {
                await supabaseAdapter.deleteSession(h);
            }
        }
    }
    if (modified) {
        saveSessions();
    }

    if (session) {
        logAuditEvent({ req, action: 'AUTH_LOGOUT', details: 'Đăng xuất tài khoản "' + session.username + '" (IP: ' + getClientIp(req) + ')', status: 'SUCCESS' });
    }
    res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));
    res.json({ ok: true, message: 'Đã đăng xuất.' });
});

app.get('/api/auth/me', (req, res) => {
    const session = getSessionUser(req);
    if (!session) {
        return res.status(401).json({ ok: false, user: null, error: 'Chưa đăng nhập.' });
    }
    const users = loadUsers();
    const u = users.find(x => x.username.toLowerCase() === session.username.toLowerCase());
    const isRentalExpired = session.role === 'user' && (session.status === 'expired' || u?.status === 'expired' || (u?.expiresAt && Date.now() > Date.parse(u.expiresAt)) || (session?.expiresAtRental && Date.now() > Date.parse(session.expiresAtRental)));
    const finalStatus = (session.role === 'user' && (session.status === 'disabled' || u?.status === 'disabled'))
        ? 'disabled'
        : (isRentalExpired ? 'expired' : (u?.status || session.status || 'active'));
    res.json({
        ok: true,
        user: {
            username: session.username,
            role: session.role,
            assignedBotIds: session.assignedBotIds,
            planName: u?.planName || (session.role === 'admin' ? 'Admin VIP' : 'Gói thường'),
            expiresAt: u?.expiresAt || session.expiresAtRental || null,
            note: u?.note || '',
            allowAccountChange: u ? u.allowAccountChange !== false : true,
            status: finalStatus,
            lockReason: u?.lockReason || session.lockReason || '',
            mustChangePassword: session.role === 'admin' ? (registry.mustChangePassword === true) : false
        }
    });
});

function validatePasswordPolicy(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: 'Mật khẩu không được để trống.' };
    }
    if (password.length < 5) {
        return { valid: false, error: 'Mật khẩu phải có tối thiểu 5 ký tự.' };
    }
    return { valid: true };
}

app.post('/api/auth/change-password', (req, res) => {
    const session = getSessionUser(req);
    if (!session) {
        return res.status(401).json({ ok: false, error: 'Chưa đăng nhập hệ thống.' });
    }

    const clientIp = getClientIp(req);
    const rateCheck = changePassLimiter.check(clientIp, session.username);
    if (!rateCheck.allowed) {
        return res.status(429).json({ ok: false, error: rateCheck.error });
    }

    const oldPassword = String(req.body?.oldPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (!oldPassword) {
        return res.status(400).json({ ok: false, error: 'Vui lòng nhập mật khẩu hiện tại.' });
    }
    const passPolicy = validatePasswordPolicy(newPassword);
    if (!passPolicy.valid) {
        return res.status(400).json({ ok: false, error: passPolicy.error });
    }
    if (oldPassword === newPassword) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.' });
    }

    if (session.role === 'admin') {
        if (!verifyAdminPassword(oldPassword, getAdminPassword())) {
            changePassLimiter.record(clientIp, session.username, false);
            logAuditEvent({ req, action: 'AUTH_ADMIN_CHANGE_PASS_FAILED', status: 'FAILED' });
            return res.status(400).json({ ok: false, error: 'Mật khẩu hiện tại của Quản trị viên không chính xác.' });
        }
        changePassLimiter.record(clientIp, session.username, true);
        createSystemBackup('pre-admin-pass-change');
        registry.adminPassword = hashAdminPassword(newPassword);
        registry.mustChangePassword = false;
        const saved = saveRegistry();
        if (!saved) {
            return res.status(500).json({ ok: false, error: 'Không thể lưu mật khẩu Quản trị viên vào hệ thống.' });
        }
        for (const [token, s] of activeSessions.entries()) {
            if (s.role === 'admin' && token !== session.token) {
                activeSessions.delete(token);
            }
        }
        saveSessions();
        void syncAuthToAllBots(true);
        logAuditEvent({ req, action: 'AUTH_ADMIN_CHANGE_PASS_SUCCESS', status: 'SUCCESS' });
        return res.json({ ok: true, message: 'Đổi mật khẩu Quản trị viên (ADMIN) thành công!' });
    } else {
        const users = loadUsers();
        const userIndex = users.findIndex(u => u.id === session.userId || u.username.toLowerCase() === session.username.toLowerCase());
        if (userIndex === -1) {
            return res.status(404).json({ ok: false, error: 'Không tìm thấy thông tin tài khoản người dùng.' });
        }
        if (!verifyUserPassword(oldPassword, users[userIndex].password)) {
            changePassLimiter.record(clientIp, session.username, false);
            logAuditEvent({ req, action: 'AUTH_USER_CHANGE_PASS_FAILED', details: { username: session.username }, status: 'FAILED' });
            return res.status(400).json({ ok: false, error: 'Mật khẩu hiện tại không chính xác.' });
        }
        changePassLimiter.record(clientIp, session.username, true);
        createSystemBackup('pre-user-pass-change');
        users[userIndex].password = newPassword;
        users[userIndex].updatedAt = new Date().toISOString();
        const saved = saveUsers(users);
        if (!saved) {
            return res.status(500).json({ ok: false, error: 'Không thể lưu mật khẩu người dùng vào hệ thống.' });
        }
        const currentUserId = users[userIndex].id;
        for (const [token, s] of activeSessions.entries()) {
            if ((s.userId === currentUserId || s.username?.toLowerCase() === session.username.toLowerCase()) && token !== session.token) {
                activeSessions.delete(token);
            }
        }
        saveSessions();
        void syncAuthToAllBots(true);
        logAuditEvent({ req, action: 'AUTH_USER_CHANGE_PASS_SUCCESS', details: `Đổi mật khẩu tài khoản "${session.username}" thành công`, status: 'SUCCESS' });
        return res.json({ ok: true, message: 'Đổi mật khẩu thành công!' });
    }
});

// Admin: Lấy danh sách users (Không trả mật khẩu plaintext hàng loạt)
app.get('/api/manager/users', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền truy cập danh sách người dùng.' });
    }
    const allUsers = loadUsers(true);
    const users = allUsers.map(u => ({
        id: u.id,
        username: u.username,
        password: '',
        hasPassword: !!u.password,
        status: u.status || 'active',
        lockReason: u.lockReason || '',
        assignedBotIds: Array.isArray(u.assignedBotIds) ? u.assignedBotIds.map(Number) : [],
        planName: u.planName || 'Gói thường',
        expiresAt: u.expiresAt || null,
        note: u.note || '',
        allowAccountChange: u.allowAccountChange !== false,
        role: u.role || 'user',
        createdAt: u.createdAt || new Date().toISOString()
    }));

    // Xây dựng bản đồ quyền sở hữu bot độc quyền (1 bot -> tối đa 1 user)
    const botOwnership = {};
    for (const u of allUsers) {
        if (Array.isArray(u.assignedBotIds)) {
            for (const bId of u.assignedBotIds) {
                botOwnership[Number(bId)] = { userId: u.id, username: u.username };
            }
        }
    }

    const availableBots = BOT_CONFIG.map(b => ({
        id: b.id,
        label: b.label || `Bot ${b.id}`,
        url: b.url || '',
        currentOwner: botOwnership[b.id] || null
    }));
    res.json({ ok: true, users, availableBots, botOwnership });
});

// Admin: Xem mật khẩu người dùng theo yêu cầu (On-Demand Reveal)
app.post('/api/manager/users/:id/reveal-password', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền xem mật khẩu người dùng.' });
    }
    const allUsers = loadUsers(true);
    const target = allUsers.find(u => u.id === req.params.id || (u.username && u.username.toLowerCase() === String(req.params.id).toLowerCase()));
    if (!target) {
        return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });
    }
    const plain = decryptUserPassword(target.password);
    logAuditEvent({
        req,
        action: 'USER_PASSWORD_REVEAL',
        target: { userId: target.id, username: target.username },
        details: `Admin xem mật khẩu của người dùng "${target.username}".`,
        status: 'SUCCESS'
    });
    return res.json({ ok: true, password: plain });
});

// Admin: Tạo user mới
app.post('/api/manager/users', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền tạo người dùng.' });
    }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const assignedBotIds = Array.isArray(req.body?.assignedBotIds) ? req.body.assignedBotIds.map(Number) : [];
    const status = req.body?.status === 'disabled' ? 'disabled' : (req.body?.status === 'expired' ? 'expired' : 'active');
    const lockReason = req.body?.lockReason ? String(req.body.lockReason).trim() : '';

    if (!username) return res.status(400).json({ ok: false, error: 'Tên đăng nhập không được để trống.' });
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
        return res.status(400).json({ ok: false, error: 'Tên người dùng chỉ được chứa chữ cái, số, gạch dưới, gạch ngang và chấm (3-32 ký tự).' });
    }
    if (username.toLowerCase() === 'admin') return res.status(400).json({ ok: false, error: 'Tên "admin" được bảo lưu cho Quản trị viên chính.' });
    const passPolicy = validatePasswordPolicy(password);
    if (!passPolicy.valid) {
        return res.status(400).json({ ok: false, error: passPolicy.error });
    }

    const parsedExp = parseSafeIsoDate(req.body?.expiresAt);
    if (!parsedExp.valid) {
        return res.status(400).json({ ok: false, error: parsedExp.error });
    }

    const users = loadUsers(true);
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ ok: false, error: `Người dùng "${username}" đã tồn tại.` });
    }

    // Reset bot được cấp cho user mới để bàn giao sạch sẽ
    if (assignedBotIds.length > 0) {
        const resetRes = await resetBotsForAssignment(assignedBotIds, `Admin tạo người dùng "${username}"`);
        if (!resetRes.ok) {
            return res.status(500).json({ ok: false, error: `Không thể dọn dẹp reset Bot #${resetRes.botId} để bàn giao (${resetRes.error}).` });
        }
    }

    // Đảm bảo nguyên tắc 1 bot chỉ cấp cho tối đa 1 user
    assignBotsExclusively(users, '', assignedBotIds);

    const newUser = {
        id: 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        username,
        password,
        role: 'user',
        status,
        lockReason,
        planName: String(req.body?.planName || 'Gói thường').trim(),
        expiresAt: parsedExp.value,
        note: String(req.body?.note || '').trim(),
        allowAccountChange: req.body?.allowAccountChange !== false,
        assignedBotIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    users.push(newUser);
    const saved = saveUsers(users);
    if (!saved) {
        users.pop();
        return res.status(500).json({ ok: false, error: 'Không thể lưu dữ liệu người dùng mới vào hệ thống.' });
    }
    createSystemBackup('post-user-create');
    void syncAuthToAllBots(true);

    logAuditEvent({ req, action: 'USER_CREATE', target: { userId: newUser.id, username }, status: 'SUCCESS' });
    const safeNewUser = { ...newUser, password: '' };
    res.json({ ok: true, user: safeNewUser, message: `Đã tạo người dùng "${username}" thành công!` });
});

// Admin: Cập nhật user
const handleUpdateUser = async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền cập nhật người dùng.' });
    }
    const userId = String(req.params.id);
    const users = loadUsers(true);
    const userIndex = users.findIndex(u => u.id === userId || u.username.toLowerCase() === userId.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });

    const userBackup = JSON.parse(JSON.stringify(users[userIndex]));
    const user = { ...userBackup };
    let passwordChanged = false;

    if (typeof req.body?.username === 'string') {
        const newUsername = req.body.username.trim();
        if (newUsername && newUsername.toLowerCase() !== user.username.toLowerCase()) {
            if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(newUsername)) {
                return res.status(400).json({ ok: false, error: 'Tên người dùng chỉ được chứa chữ cái, số, gạch dưới, gạch ngang và chấm (3-32 ký tự).' });
            }
            if (newUsername.toLowerCase() === 'admin') return res.status(400).json({ ok: false, error: 'Tên "admin" được bảo lưu.' });
            if (users.some((u, i) => i !== userIndex && u.username.toLowerCase() === newUsername.toLowerCase())) {
                return res.status(400).json({ ok: false, error: `Tên người dùng "${newUsername}" đã được sử dụng.` });
            }
            user.username = newUsername;
        }
    }
    if (typeof req.body?.password === 'string' && req.body.password.trim().length > 0) {
        const newPassword = req.body.password.trim();
        if (newPassword !== userBackup.password) {
            const passPolicy = validatePasswordPolicy(newPassword);
            if (!passPolicy.valid) {
                return res.status(400).json({ ok: false, error: passPolicy.error });
            }
            user.password = newPassword;
            passwordChanged = true;
        }
    }
    if (Array.isArray(req.body?.assignedBotIds)) {
        const nextBotIds = req.body.assignedBotIds.map(Number);
        const prevBotIds = Array.isArray(userBackup.assignedBotIds) ? userBackup.assignedBotIds.map(Number) : [];
        const newlyAssigned = nextBotIds.filter(id => !prevBotIds.includes(id));
        if (newlyAssigned.length > 0) {
            const resetRes = await resetBotsForAssignment(newlyAssigned, `Admin gán Bot cho "${user.username}"`);
            if (!resetRes.ok) {
                return res.status(500).json({ ok: false, error: `Không thể dọn dẹp reset Bot #${resetRes.botId} để bàn giao (${resetRes.error}).` });
            }
        }
        user.assignedBotIds = nextBotIds;
        assignBotsExclusively(users, user.id, user.assignedBotIds);
    }
    if (typeof req.body?.status === 'string') {
        user.status = req.body.status === 'disabled' ? 'disabled' : (req.body.status === 'expired' ? 'expired' : 'active');
    }
    if (req.body?.lockReason !== undefined) {
        user.lockReason = String(req.body.lockReason || '').trim();
    }
    if (req.body?.planName !== undefined) {
        user.planName = String(req.body.planName || '').trim();
    }
    if (req.body?.expiresAt !== undefined) {
        const parsedExp = parseSafeIsoDate(req.body.expiresAt);
        if (!parsedExp.valid) {
            return res.status(400).json({ ok: false, error: parsedExp.error });
        }
        user.expiresAt = parsedExp.value;
    }
    if (req.body?.note !== undefined) {
        user.note = String(req.body.note || '').trim();
    }
    if (req.body?.allowAccountChange !== undefined) {
        user.allowAccountChange = !!req.body.allowAccountChange;
    }
    user.updatedAt = new Date().toISOString();
    users[userIndex] = user;

    const saved = saveUsers(users);
    if (!saved) {
        users[userIndex] = userBackup;
        return res.status(500).json({ ok: false, error: 'Không thể lưu dữ liệu cập nhật người dùng.' });
    }
    createSystemBackup('post-user-update');
    void syncAuthToAllBots(true);

    for (const [token, s] of activeSessions.entries()) {
        if (s.userId === user.id || s.username.toLowerCase() === user.username.toLowerCase()) {
            if (user.status !== 'active' || passwordChanged) {
                activeSessions.delete(token);
            } else {
                s.assignedBotIds = user.assignedBotIds;
                s.username = user.username;
                s.status = 'active';
            }
        }
    }
    saveSessions();

    logAuditEvent({ req, action: 'USER_UPDATE', target: { userId: user.id, username: user.username }, status: 'SUCCESS' });
    const safeUser = { ...user, password: '' };
    res.json({ ok: true, user: safeUser, message: `Đã cập nhật người dùng "${user.username}" thành công!` });
};
app.put('/api/manager/users/:id', handleUpdateUser);
app.patch('/api/manager/users/:id', handleUpdateUser);

// Admin: Xóa user
app.delete('/api/manager/users/:id', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền xóa người dùng.' });
    }
    const userId = String(req.params.id);
    let users = loadUsers(true);
    const target = users.find(u => u.id === userId || u.username.toLowerCase() === userId.toLowerCase());
    if (!target) return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });

    createSystemBackup('pre-user-delete');
    const usersBackup = [...users];
    users = users.filter(u => u.id !== target.id);
    const saved = saveUsers(users);
    if (!saved) {
        users = usersBackup;
        return res.status(500).json({ ok: false, error: 'Không thể lưu dữ liệu sau khi xóa người dùng.' });
    }
    void syncAuthToAllBots(true);
    if (supabaseAdapter && supabaseAdapter.isEnabled()) {
        await supabaseAdapter.deleteUser(target.id);
    }

    for (const [token, s] of activeSessions.entries()) {
        if (s.userId === target.id || s.username.toLowerCase() === target.username.toLowerCase()) {
            activeSessions.delete(token);
            if (supabaseAdapter && supabaseAdapter.isEnabled()) {
                await supabaseAdapter.deleteSession(token);
            }
        }
    }
    saveSessions();

    logAuditEvent({ req, action: 'USER_DELETE', target: { userId: target.id, username: target.username }, status: 'SUCCESS' });
    res.json({ ok: true, message: `Đã xóa người dùng "${target.username}".` });
});

// Admin: Gia hạn linh hoạt cho người dùng (thêm/bớt ngày, ngày cố định, vĩnh viễn)
app.post('/api/manager/users/:id/renew-days', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền gia hạn tài khoản.' });
    }
    const userId = String(req.params.id);
    const users = loadUsers(true);
    const userIndex = users.findIndex(u => u.id === userId || u.username.toLowerCase() === userId.toLowerCase());
    if (userIndex === -1) {
        return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });
    }
    const targetUser = users[userIndex];
    const userBackup = JSON.parse(JSON.stringify(targetUser));

    const setPermanent = req.body?.setPermanent === true;
    const fixedDate = req.body?.fixedDate ? String(req.body.fixedDate).trim() : null;
    const days = Number(req.body?.days);

    if (setPermanent) {
        targetUser.expiresAt = null;
        targetUser.planName = (typeof req.body?.planName === 'string' && req.body.planName.trim()) ? req.body.planName.trim() : 'VIP Vĩnh Viễn';
        targetUser.status = 'active';
    } else if (fixedDate) {
        const parsed = new Date(fixedDate);
        if (isNaN(parsed.getTime())) {
            return res.status(400).json({ ok: false, error: 'Ngày cố định không hợp lệ.' });
        }
        targetUser.expiresAt = parsed.toISOString();
        if (typeof req.body?.planName === 'string' && req.body.planName.trim()) {
            targetUser.planName = req.body.planName.trim();
        } else if (targetUser.planName === 'VIP Vĩnh Viễn') {
            targetUser.planName = 'Gói tùy chỉnh';
        }
        targetUser.status = (parsed.getTime() > Date.now()) ? 'active' : 'expired';
    } else if (Number.isFinite(days) && days !== 0) {
        const now = Date.now();
        // Nếu người dùng đang là VIP Vĩnh Viễn (expiresAt === null) hoặc đã hết hạn:
        // Luôn tính bắt đầu từ thời điểm hiện tại (now)!
        // Nếu đang có hạn dùng cụ thể và chưa hết hạn: Tính tiếp từ mốc hạn đó.
        let baseTime = now;
        if (targetUser.expiresAt) {
            const currentExp = Date.parse(targetUser.expiresAt);
            if (!isNaN(currentExp) && currentExp > now) {
                baseTime = currentExp;
            }
        }
        const newExpMs = baseTime + days * 86400000;
        targetUser.expiresAt = new Date(newExpMs).toISOString();
        if (typeof req.body?.planName === 'string' && req.body.planName.trim()) {
            targetUser.planName = req.body.planName.trim();
        } else if (targetUser.planName === 'VIP Vĩnh Viễn') {
            targetUser.planName = days > 0 ? `Gói ${days} ngày` : 'Gói tùy chỉnh';
        }
        targetUser.status = (newExpMs > now) ? 'active' : 'expired';
    } else {
        return res.status(400).json({ ok: false, error: 'Tham số gia hạn không hợp lệ.' });
    }

    targetUser.updatedAt = new Date().toISOString();
    users[userIndex] = targetUser;
    const saved = saveUsers(users);
    if (!saved) {
        users[userIndex] = userBackup;
        return res.status(500).json({ ok: false, error: 'Không thể lưu thông tin gia hạn người dùng.' });
    }

    void syncAuthToAllBots(true);
    logAuditEvent({
        req,
        action: 'ADMIN_RENEW_USER',
        target: { userId: targetUser.id, username: targetUser.username },
        details: `Quản trị viên gia hạn cho ${targetUser.username}: Hạn mới = ${targetUser.expiresAt || 'Vĩnh viễn'} (Gói: ${targetUser.planName})`,
        status: 'SUCCESS'
    });

    const safeTargetUser = { ...targetUser, password: '' };
    return res.json({
        ok: true,
        user: safeTargetUser,
        message: `Gia hạn thành công cho "${targetUser.username}"! Hạn mới: ${targetUser.expiresAt ? new Date(targetUser.expiresAt).toLocaleString('vi-VN') : 'Vĩnh viễn'}.`
    });
});

// Admin: Lấy danh sách Audit Logs & Phân trang, Bộ lọc
app.get('/api/manager/audit-logs', async (req, res) => {
    try {
        const session = getSessionUser(req);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền xem Audit Logs.' });
        }
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
        const page = Math.max(1, Number(req.query?.page || 1));
        const q = String(req.query?.q || '').trim();
        const category = String(req.query?.category || '').trim();
        const status = String(req.query?.status || '').trim();
        const actor = String(req.query?.actor || '').trim();
        const botId = String(req.query?.botId || '').trim();
        const logType = String(req.query?.logType || '').trim();

        let result = null;
        if (supabaseAdapter && supabaseAdapter.isEnabled()) {
            try {
                result = await supabaseAdapter.fetchAuditLogs({ logType, category, status, q, limit, page });
            } catch (err) {
                console.warn('[AUDIT] Không lấy được log từ Supabase, fallback về local:', err.message);
            }
        }
        if (!result) {
            result = readAuditLogs({ limit, page, q, category, status, actor, botId, logType });
        }
        res.json({ 
            ok: true, 
            logs: result.logs, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            totalPages: result.totalPages 
        });
    } catch (err) {
        console.error('[AUDIT] Lỗi đọc audit logs:', err.message);
        res.status(500).json({ ok: false, error: 'Lỗi máy chủ khi đọc danh sách Audit Logs.' });
    }
});

// Admin: Xuất file Audit Logs (CSV / JSONL)
app.get('/api/manager/audit-logs/export', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền xuất Audit Logs.' });
    }
    const format = String(req.query?.format || 'csv').toLowerCase() === 'jsonl' ? 'jsonl' : 'csv';
    const dateStr = new Date().toISOString().slice(0, 10);
    const content = exportAuditLogsFile(format);

    if (format === 'jsonl') {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="kingmc_audit_logs_${dateStr}.jsonl"`);
    } else {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="kingmc_audit_logs_${dateStr}.csv"`);
    }
    res.send(content);
});

// Admin: Xóa sạch toàn bộ Audit Logs

// ============================================================================
// SUPABASE CLOUD MANAGEMENT API ROUTES
// ============================================================================

app.get('/api/manager/supabase/status', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền truy cập cấu hình Supabase.' });
    }
    res.json({
        ok: true,
        connected: supabaseAdapter.isEnabled() && supabaseAdapter.lastPingOk,
        url: supabaseAdapter.url,
        hasKey: !!supabaseAdapter.key,
        missingTables: supabaseAdapter.lastMissingTables || [],
        message: supabaseAdapter.lastPingError || (supabaseAdapter.isEnabled() ? 'Đã cấu hình' : 'Chưa cấu hình')
    });
});

app.get('/api/manager/supabase/schema', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền xem SQL schema Supabase.' });
    }
    res.json({ ok: true, sql: SUPABASE_SCHEMA_SQL, tables: SUPABASE_REQUIRED_TABLES });
});

app.post('/api/manager/supabase/test', async (req, res) => {
    try {
        const session = getSessionUser(req);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền kiểm tra kết nối Supabase.' });
        }
        const testUrl = String(req.body?.url || supabaseAdapter.url || '').trim();
        const testKey = String(req.body?.key && req.body.key !== '••••••••••••••••' ? req.body.key : supabaseAdapter.key || '').trim();
        const tempAdapter = new SupabaseAdapter({ url: testUrl, key: testKey });
        const result = await tempAdapter.testConnection();
        if (result.ok) {
            supabaseAdapter.lastPingOk = true;
            supabaseAdapter.lastPingError = '';
            supabaseAdapter.lastMissingTables = [];
            res.json({ ok: true, message: 'Kết nối Supabase thành công!', missingTables: [] });
        } else {
            res.status(400).json({ ok: false, error: result.error, missingTables: result.missingTables || [] });
        }
    } catch (err) {
        res.status(400).json({ ok: false, error: 'Lỗi kiểm tra Supabase: ' + err.message });
    }
});

app.post('/api/manager/supabase/config', async (req, res) => {
    try {
        const session = getSessionUser(req);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền lưu cấu hình Supabase.' });
        }
        const newUrl = String(req.body?.url || '').trim();
        let newKey = String(req.body?.key || '').trim();
        if (newKey === '••••••••••••••••') {
            newKey = supabaseAdapter.key || loadSupabaseSecretKey();
        }
        if (newKey) {
            saveSupabaseSecretKey(newKey);
        }
        supabaseAdapter.updateConfig(newUrl, newKey);
        registry.supabase = {
            url: newUrl,
            key: newKey,
            enabled: !!(newUrl && newKey)
        };
        saveRegistry();

        const test = await supabaseAdapter.testConnection();
        logAuditEvent({
            req,
            action: 'SUPABASE_SYNC',
            category: 'SYSTEM',
            details: `Admin cập nhật cấu hình Supabase Cloud URL: ${newUrl} (${test.ok ? 'Kết nối thành công' : 'Chưa kết nối: ' + test.error})`,
            status: test.ok ? 'SUCCESS' : 'PARTIAL'
        });

        res.json({
            ok: true,
            message: test.ok ? 'Đã lưu cấu hình và kết nối Supabase thành công!' : 'Đã lưu cấu hình, nhưng chưa ping được: ' + test.error,
            connected: test.ok
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: 'Lỗi lưu cấu hình Supabase: ' + err.message });
    }
});

app.post('/api/manager/supabase/sync-now', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền đồng bộ Supabase.' });
    }
    if (!supabaseAdapter.isEnabled()) {
        return res.status(400).json({ ok: false, error: 'Chưa cấu hình Supabase URL và Key.' });
    }

    try {
        const users = loadUsers(true);
        const keys = loadKeysFile();
        const activeAuditLogs = readAuditLogs({ limit: Number.MAX_SAFE_INTEGER }).logs;
        const okUsers = await supabaseAdapter.syncAllUsers(users);
        const okKeys = await supabaseAdapter.syncAllKeys(keys);
        const okReg = await supabaseAdapter.saveRegistry(registry);
        const okSessions = await supabaseAdapter.syncAllSessions(activeSessions);
        const okAuditLogs = await supabaseAdapter.syncAuditLogs(activeAuditLogs);

        if (!okUsers || !okKeys || !okReg || !okSessions || !okAuditLogs) {
            const failed = [];
            if (!okUsers) failed.push('users');
            if (!okKeys) failed.push('keys');
            if (!okReg) failed.push('registry');
            if (!okSessions) failed.push('sessions');
            if (!okAuditLogs) failed.push('audit_logs');
            logAuditEvent({
                req,
                action: 'SUPABASE_SYNC',
                category: 'SYSTEM',
                details: `Đồng bộ Supabase thất bại một phần: [${failed.join(', ')}]`,
                status: 'FAILED'
            });
            return res.status(500).json({
                ok: false,
                error: `Đồng bộ thất bại một phần: không thể đồng bộ [${failed.join(', ')}] lên Supabase.`
            });
        }

        logAuditEvent({
            req,
            action: 'SUPABASE_SYNC',
            category: 'SYSTEM',
            details: `Đồng bộ toàn bộ dữ liệu lên Supabase: ${users.length} users, ${keys.length} keys, ${activeAuditLogs.length} audit logs, phiên đăng nhập và registry hạm đội`,
            status: 'SUCCESS'
        });

        res.json({ ok: true, message: `Đã đồng bộ ${users.length} users, ${keys.length} keys, ${activeAuditLogs.length} audit logs, phiên đăng nhập và cấu hình hạm đội lên Supabase!` });
    } catch (err) {
        res.status(500).json({ ok: false, error: 'Lỗi đồng bộ: ' + err.message });
    }
});

app.post('/api/manager/audit-logs/clear', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền xóa Audit Logs.' });
    }
    if (supabaseAdapter && supabaseAdapter.isEnabled()) {
        const cloudCleared = await supabaseAdapter.clearAuditLogs();
        if (!cloudCleared) {
            return res.status(502).json({ ok: false, error: 'Không thể xóa Audit Logs trên Supabase; dữ liệu cục bộ chưa bị thay đổi.' });
        }
    }
    const result = clearAuditLogsFile(session, req);
    if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error || 'Lỗi khi xóa audit logs.' });
    }
    if (supabaseAdapter && supabaseAdapter.isEnabled() && result.entry) {
        const cloudLogged = await supabaseAdapter.insertAuditLog(result.entry);
        if (!cloudLogged) {
            return res.status(502).json({ ok: false, error: 'Đã xóa Audit Logs cục bộ nhưng không thể ghi lại sự kiện xóa lên Supabase.' });
        }
    }
    res.json({ ok: true, message: result.message });
});

// Admin: Lấy danh sách System Backups
// Admin: Xóa bản sao lưu
app.delete('/api/manager/backups/:filename', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền xóa bản sao lưu.' });
    }
    const filename = String(req.params.filename || '');
    const result = deleteSystemBackupFile(filename);
    if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
    }
    logAuditEvent({
        req,
        action: 'BACKUP_DELETED',
        details: 'Đã xóa bản sao lưu: ' + filename,
        status: 'SUCCESS'
    });
    res.json({ ok: true, message: 'Đã xóa bản sao lưu ' + filename });
});
app.get('/api/manager/backups', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền xem danh sách bản sao lưu.' });
    }
    res.json({ ok: true, backups: listSystemBackups() });
});

// Admin: Tạo bản sao lưu thủ công ngay
app.post('/api/manager/backups/create', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền tạo bản sao lưu.' });
    }
    const result = createSystemBackup('manual-admin-trigger');
    if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error || 'Lỗi khi tạo bản sao lưu.' });
    }
    res.json({ ok: true, filename: result.filename, message: `Đã tạo bản sao lưu ${result.filename} thành công!` });
});

// Lấy thông báo hệ thống (User + Admin)
app.get('/api/manager/announcement', (req, res) => {
    const session = getSessionUser(req);
    if (!session) {
        return res.status(401).json({ ok: false, error: 'Chưa đăng nhập hệ thống.' });
    }
    const announcement = registry.announcement || {
        enabled: true,
        id: 'ann_v71_init',
        title: '📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN',
        content: 'Chào mừng bạn đến với KingMC Bot Manager V7.1!\n\n• Hệ thống nâng cấp Multi-User RBAC & bảo mật phiên 30 ngày.\n• HUD đồng bộ toàn diện trên cả trang chủ lẫn chi tiết bot con.\n• Mọi thắc mắc vui lòng liên hệ Admin.',
        mode: 'daily',
        startDate: '',
        endDate: '',
        updatedAt: new Date().toISOString()
    };
    res.json({ ok: true, announcement });
});

// Admin cập nhật thông báo hệ thống
app.post('/api/manager/announcement', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền cài đặt thông báo.' });
    }
    const body = req.body || {};
    const title = String(body.title || '📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN').trim();
    const content = String(body.content || '').trim();
    const mode = ['daily', 'every_login', 'time_range'].includes(body.mode) ? body.mode : 'daily';
    const enabled = !!body.enabled;
    const startDate = String(body.startDate || '').trim();
    const endDate = String(body.endDate || '').trim();

    registry.announcement = {
        enabled,
        id: 'ann_' + Date.now(),
        title,
        content,
        mode,
        startDate,
        endDate,
        updatedAt: new Date().toISOString()
    };
    const saved = saveRegistry();
    if (!saved) {
        return res.status(500).json({ ok: false, error: 'Không thể lưu cấu hình thông báo hệ thống.' });
    }

    logAuditEvent({ req, action: 'ANNOUNCEMENT_UPDATE', details: title, status: 'SUCCESS' });

    res.json({
        ok: true,
        message: 'Đã lưu cấu hình thông báo thành công!',
        announcement: registry.announcement
    });
});

app.get('/api/manager/registry', (req, res) => {
    const session = getSessionUser(req);
    if (!session) {
        return res.status(401).json({ ok: false, error: 'Chưa đăng nhập hệ thống.' });
    }
    let configs = BOT_CONFIG;
    if (session && session.role === 'user') {
        configs = BOT_CONFIG.filter(bot => (session.assignedBotIds || []).includes(Number(bot.id)));
    }
    res.json({
        ok: true,
        bots: configs.map(bot => ({
            id: bot.id,
            label: bot.label,
            url: (session && session.role === 'admin') ? bot.url : '',
            source: bot.source,
            identity: (session && session.role === 'admin') ? bot.url : `Bot #${bot.id}`
        }))
    });
});

app.post('/api/manager/bots', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên (Admin) mới có quyền thêm bot mới.' });
    }

    try {
        let rawTokens = [];
        if (Array.isArray(req.body?.urls) && req.body.urls.length > 0) {
            rawTokens = req.body.urls.flatMap(u => String(u || '').split(/[\r\n\s,]+/));
        } else if (typeof req.body?.url === 'string') {
            rawTokens = req.body.url.split(/[\r\n\s,]+/);
        }
        rawTokens = rawTokens.map(s => s.trim()).filter(Boolean);

        if (!rawTokens.length) {
            return res.status(400).json({ error: 'URL bot không được trống.' });
        }

        const requestedLabel = typeof req.body?.label === 'string'
            ? req.body.label.trim()
            : '';

        // If exactly 1 token, preserve 100% backward compatibility with single-bot flow
        if (rawTokens.length === 1) {
            const url = await validateSafeBotUrl(rawTokens[0]);
            if (!url) {
                return res.status(400).json({ error: 'URL bot không được trống.' });
            }

            if (BOT_CONFIG.some(bot => bot.url === url) || pendingBotUrls.has(url)) {
                return res.status(409).json({ error: 'Bot URL này đã tồn tại hoặc đang được thêm.' });
            }

            pendingBotUrls.add(url);

            try {
                // Re-check after acquiring the reservation so concurrent requests cannot
                // insert the same URL twice.
                if (BOT_CONFIG.some(bot => bot.url === url)) {
                    return res.status(409).json({ error: 'Bot URL này đã tồn tại.' });
                }

                const id = nextBotId();
                const config = {
                    id,
                    label: requestedLabel || `bot${id}`,
                    url,
                    source: 'dynamic',
                    sourceUrl: url,
                    legacyNumber: null
                };

                let remote = null;
                let checkWarning = null;

                try {
                    const result = await fetchChild(config, '/api/bot');
                    if (result.ok && result.data) {
                        remote = result.data;
                    } else {
                        checkWarning = result.data?.error || `Bot trả HTTP ${result.status}.`;
                    }
                } catch (err) {
                    checkWarning = err.message || 'Không thể kiểm tra bot ngay lúc này.';
                }

                if (!requestedLabel && remote?.label) {
                    config.label = String(remote.label);
                }

                if (BOT_CONFIG.some(bot => bot.url === url)) {
                    return res.status(409).json({ error: 'Bot URL này đã tồn tại.' });
                }

                createSystemBackup('pre-bot-add');
                if (!registry.botIdMap) registry.botIdMap = {};
                registry.botIdMap[url] = config.id;
                registry.lastBotId = config.id;
                BOT_CONFIG.push(config);
                summaryCache.delete(config.id);
                summaryRefreshInFlight.delete(config.id);

                const saved = saveRegistry();
                if (!saved) {
                    delete registry.botIdMap[url];
                    BOT_CONFIG.pop();
                    return res.status(500).json({
                        error: 'Không thể lưu registry; bot chưa được thêm.'
                    });
                }

                await refreshSummary(config, true);
                void syncAuthToBot(config, true);
                void syncAuthToAllBots(false);

                logAuditEvent({
                    req,
                    action: 'BOT_CREATE',
                    target: { botId: config.id, label: config.label },
                    details: config.url,
                    status: 'SUCCESS'
                });

                return res.status(201).json({
                    ok: true,
                    message: checkWarning
                        ? `${config.label} đã được thêm, nhưng chưa kết nối được lúc kiểm tra.`
                        : `${config.label} đã được thêm.`,
                    warning: checkWarning,
                    bot: {
                        ...config,
                        connected: !!remote
                    }
                });
            } finally {
                pendingBotUrls.delete(url);
            }
        }

        // --- Bulk / Batch addition mode (rawTokens.length > 1) ---
        const skipped = [];
        const validUrls = [];
        const seenInBatch = new Set();

        for (const rawToken of rawTokens) {
            let normalizedUrl = '';
            try {
                normalizedUrl = await validateSafeBotUrl(rawToken);
            } catch (err) {
                skipped.push({ url: rawToken, reason: err.message || 'URL không hợp lệ hoặc vi phạm bảo mật' });
                continue;
            }

            if (!normalizedUrl) {
                skipped.push({ url: rawToken, reason: 'URL trống hoặc không hợp lệ' });
                continue;
            }

            if (seenInBatch.has(normalizedUrl)) {
                skipped.push({ url: normalizedUrl, reason: 'Trùng lặp trong danh sách dán' });
                continue;
            }
            seenInBatch.add(normalizedUrl);

            if (BOT_CONFIG.some(b => b.url === normalizedUrl) || pendingBotUrls.has(normalizedUrl)) {
                skipped.push({ url: normalizedUrl, reason: 'Bot URL này đã tồn tại hoặc đang được xử lý' });
                continue;
            }

            validUrls.push(normalizedUrl);
        }

        if (!validUrls.length) {
            return res.status(400).json({
                ok: false,
                error: 'Không có URL bot nào hợp lệ hoặc tất cả các URL đã tồn tại.',
                skipped
            });
        }

        // Reserve in pendingBotUrls to avoid race condition
        for (const u of validUrls) {
            pendingBotUrls.add(u);
        }

        try {
            const addedBots = [];

            // Pre-allocate configs with sequential IDs
            for (const url of validUrls) {
                if (BOT_CONFIG.some(b => b.url === url)) {
                    skipped.push({ url, reason: 'Bot URL này đã tồn tại trong hệ thống' });
                    continue;
                }

                const id = nextBotId();
                const config = {
                    id,
                    label: requestedLabel ? `${requestedLabel} ${id}` : `bot${id}`,
                    url,
                    source: 'dynamic',
                    sourceUrl: url,
                    legacyNumber: null
                };
                addedBots.push({ config, url, remote: null });
            }

            if (!addedBots.length) {
                return res.status(400).json({
                    ok: false,
                    error: 'Không có bot nào được thêm sau khi kiểm tra lại trạng thái trùng lặp.',
                    skipped
                });
            }

            // Probe remote bots in parallel (with reasonable timeout 2.5s)
            const probePromises = addedBots.map(async (item) => {
                try {
                    const probeRes = await fetchChild(item.config, '/api/bot', { timeoutMs: 2500 });
                    if (probeRes.ok && probeRes.data) {
                        item.remote = probeRes.data;
                        if (!requestedLabel && probeRes.data.label) {
                            item.config.label = String(probeRes.data.label);
                        }
                    }
                } catch (_) {
                    // Offline or unreachable during probe - still added successfully
                }
            });
            await Promise.allSettled(probePromises);

            createSystemBackup('pre-bulk-bot-add');
            if (!registry.botIdMap) registry.botIdMap = {};

            for (const item of addedBots) {
                registry.botIdMap[item.url] = item.config.id;
                registry.lastBotId = item.config.id;
                BOT_CONFIG.push(item.config);
                summaryCache.delete(item.config.id);
                summaryRefreshInFlight.delete(item.config.id);
            }

            const saved = saveRegistry();
            if (!saved) {
                // Rollback newly added bots
                for (const item of addedBots) {
                    delete registry.botIdMap[item.url];
                    const idx = BOT_CONFIG.findIndex(b => b.id === item.config.id);
                    if (idx !== -1) BOT_CONFIG.splice(idx, 1);
                }
                return res.status(500).json({
                    error: 'Không thể lưu registry; các bot chưa được thêm.'
                });
            }

            // Trigger summary refresh and auth sync for newly added bots
            for (const item of addedBots) {
                void refreshSummary(item.config, true);
                void syncAuthToBot(item.config, true);
            }
            void syncAuthToAllBots(false);

            logAuditEvent({
                req,
                action: 'BOT_CREATE_BULK',
                details: `Đã thêm ${addedBots.length} bot mới (IDs: ${addedBots.map(b => b.config.id).join(', ')})`,
                status: 'SUCCESS'
            });

            let responseMsg = `Đã thêm thành công ${addedBots.length} bot mới!`;
            if (skipped.length > 0) {
                responseMsg += ` (Bỏ qua ${skipped.length} link không hợp lệ hoặc trùng lặp)`;
            }

            return res.status(201).json({
                ok: true,
                message: responseMsg,
                addedCount: addedBots.length,
                skippedCount: skipped.length,
                bots: addedBots.map(b => ({
                    ...b.config,
                    connected: !!b.remote
                })),
                skipped
            });
        } finally {
            for (const u of validUrls) {
                pendingBotUrls.delete(u);
            }
        }
    } catch (err) {
        return res.status(400).json({ error: err.message || 'Dữ liệu không hợp lệ.' });
    }
});

app.patch('/api/manager/bot/:id', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền sửa bot.' });
    }
    const id = Number(req.params.id);
    const bot = getBotConfig(id);
    if (!bot) return res.status(404).json({ error: 'Bot không tồn tại.' });

    try {
        const nextLabel = typeof req.body?.label === 'string'
            ? req.body.label.trim()
            : '';
        const nextUrl = req.body?.url !== undefined
            ? await validateSafeBotUrl(req.body.url)
            : bot.url;

        if (!nextUrl) {
            return res.status(400).json({ error: 'URL bot không được trống.' });
        }

        if (BOT_CONFIG.some(item => item.id !== id && item.url === nextUrl)) {
            return res.status(409).json({ error: 'URL bot này đã tồn tại.' });
        }

        const previousSourceUrl = bot.sourceUrl || bot.url;
        const previousBot = { ...bot };
        const previousDynamicBots = registry.dynamicBots.map(item => ({ ...item }));
        const previousOverrides = registry.overrides.map(item => ({ ...item }));
        const previousBotIdMap = { ...(registry.botIdMap || {}) };
        const previousBotTags = { ...(registry.botTags || {}) };

        bot.label = nextLabel || bot.label || `Bot ${id}`;

        if (req.body?.tags !== undefined) {
            const rawTags = Array.isArray(req.body.tags)
                ? req.body.tags
                : String(req.body.tags || '').split(/[,;\s]+/);
            const cleanedTags = Array.from(new Set(
                rawTags.map(t => String(t || '').trim().toLowerCase().replace(/^#/, ''))
                    .filter(t => t.length > 0 && t.length <= 32)
            )).slice(0, 10);
            if (!registry.botTags) registry.botTags = {};
            registry.botTags[id] = cleanedTags;
        }

        if (bot.source === 'dynamic') {
            const dynamic = registry.dynamicBots.find(item =>
                item.url === bot.sourceUrl || item.url === bot.url
            );

            if (dynamic) {
                dynamic.label = bot.label;
                dynamic.url = nextUrl;
            }

            bot.url = nextUrl;
            bot.sourceUrl = nextUrl;
        } else {
            bot.url = nextUrl;

            const overrideIndex = registry.overrides.findIndex(item =>
                item.sourceUrl === previousSourceUrl ||
                item.legacyId === bot.legacyNumber
            );

            const override = {
                sourceUrl: previousSourceUrl,
                legacyId: bot.legacyNumber || null,
                label: bot.label,
                url: bot.url
            };

            if (overrideIndex >= 0) {
                registry.overrides[overrideIndex] = override;
            } else {
                registry.overrides.push(override);
            }
        }

        if (!registry.botIdMap) registry.botIdMap = {};
        if (previousSourceUrl !== nextUrl) {
            delete registry.botIdMap[previousSourceUrl];
            if (previousBot.url && previousBot.url !== previousSourceUrl) {
                delete registry.botIdMap[previousBot.url];
            }
            registry.botIdMap[nextUrl] = id;
        }

        summaryCache.delete(id);
        summaryRefreshInFlight.delete(id);

        const saved = saveRegistry();
        if (!saved) {
            Object.assign(bot, previousBot);
            registry.dynamicBots = previousDynamicBots;
            registry.overrides = previousOverrides;
            registry.botIdMap = previousBotIdMap;
            registry.botTags = previousBotTags;
            return res.status(500).json({
                error: 'Không thể lưu registry; thay đổi đã được rollback.'
            });
        }

        await refreshSummary(bot, true);
        void syncAuthToBot(bot, true);

        logAuditEvent({
            req,
            action: 'BOT_UPDATE',
            target: { botId: id, label: bot.label },
            details: `Cập nhật cấu hình Bot #${id}: Tên="${bot.label}", URL="${bot.url}" (Trước đó: "${previousBot.label}", "${previousBot.url}")`,
            status: 'SUCCESS'
        });

        const resultBot = { ...bot, tags: (registry.botTags && registry.botTags[id]) || [] };
        res.json({ ok: true, message: `${bot.label} đã được cập nhật.`, bot: resultBot });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Không thể sửa bot.' });
    }
});

app.post('/api/manager/bots/reorder', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên (Admin) mới có quyền sắp xếp bot.' });
    }
    const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map(Number).filter(Number.isInteger)
        : [];

    if (!ids.length) {
        return res.status(400).json({ error: 'Danh sách thứ tự không hợp lệ.' });
    }

    const known = new Set(BOT_CONFIG.map(bot => bot.id));

    if (ids.some(id => !known.has(id))) {
        return res.status(400).json({
            error: 'Danh sách thứ tự không hợp lệ.'
        });
    }

    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) {
            return res.status(400).json({ error: 'Danh sách thứ tự chứa bot trùng lặp.' });
        }
        seen.add(id);
    }

    for (const bot of BOT_CONFIG) {
        if (!seen.has(bot.id)) {
            ids.push(bot.id);
            seen.add(bot.id);
        }
    }

    const order = new Map(
        ids.map((id, index) => [id, index])
    );
    const previousBotOrder = BOT_CONFIG.slice();
    const previousOrderUrls = [...(registry.orderUrls || [])];

    BOT_CONFIG.sort(
        (a, b) => order.get(a.id) - order.get(b.id)
    );

    registry.orderUrls = BOT_CONFIG.map(bot => bot.url);

    const saved = saveRegistry();

    if (!saved) {
        BOT_CONFIG.splice(0, BOT_CONFIG.length, ...previousBotOrder);
        registry.orderUrls = previousOrderUrls;
        return res.status(500).json({
            error: 'Không thể lưu registry; thay đổi thứ tự đã được rollback.'
        });
    }

    void syncAuthToAllBots(false);

    logAuditEvent({
        req,
        action: 'BOT_REORDER',
        target: { botIds: ids },
        details: `Sắp xếp lại thứ tự hiển thị ${ids.length} bot trong hạm đội: [${ids.join(', ')}]`,
        status: 'SUCCESS'
    });

    res.json({
        ok: true,
        order: registry.orderUrls
    });
});

app.get('/api/manager/webhook', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền xem cấu hình Webhook.' });
    }
    const config = registry.webhook || {};
    res.json({
        ok: true,
        webhook: {
            enabled: !!config.enabled,
            discordUrl: config.discordUrl || '',
            telegramToken: config.telegramToken || '',
            telegramChatId: config.telegramChatId || '',
            notifyOnOffline: config.notifyOnOffline !== false,
            notifyOnLowTotem: config.notifyOnLowTotem !== false,
            notifyOnRecover: config.notifyOnRecover !== false,
            notifyOnLowHealth: config.notifyOnLowHealth !== false,
            notifyOnDeath: config.notifyOnDeath !== false,
            offlineThresholdMinutes: config.offlineThresholdMinutes || 5
        }
    });
});

app.post('/api/manager/webhook', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền cài đặt Webhook.' });
    }
    try {
        const body = req.body || {};
        createSystemBackup('pre-webhook-update');
        registry.webhook = {
            enabled: !!body.enabled,
            discordUrl: body.discordUrl !== undefined ? String(body.discordUrl).trim() : (registry.webhook?.discordUrl || ''),
            telegramToken: body.telegramToken !== undefined ? String(body.telegramToken).trim() : (registry.webhook?.telegramToken || ''),
            telegramChatId: body.telegramChatId !== undefined ? String(body.telegramChatId).trim() : (registry.webhook?.telegramChatId || ''),
            notifyOnOffline: body.notifyOnOffline !== false,
            notifyOnLowTotem: body.notifyOnLowTotem !== false,
            notifyOnRecover: body.notifyOnRecover !== false,
            notifyOnLowHealth: body.notifyOnLowHealth !== false,
            notifyOnDeath: body.notifyOnDeath !== false,
            offlineThresholdMinutes: Math.max(1, Math.min(60, Number(body.offlineThresholdMinutes || 5)))
        };
        const saved = saveRegistry();
        if (!saved) {
            return res.status(500).json({ ok: false, error: 'Không thể lưu cấu hình Webhook vào hệ thống.' });
        }
        logAuditEvent({
            req,
            action: 'WEBHOOK_CONFIG_UPDATE',
            details: `Kích hoạt: ${registry.webhook.enabled ? 'BẬT' : 'TẮT'}`,
            status: 'SUCCESS'
        });
        res.json({ ok: true, message: 'Đã lưu cấu hình Webhook thành công.', webhook: registry.webhook });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/manager/webhook/test', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền kiểm tra Webhook.' });
    }
    try {
        const targetUrl = req.body?.discordUrl || registry.webhook?.discordUrl;
        const tgToken = req.body?.telegramToken || registry.webhook?.telegramToken;
        const tgChat = req.body?.telegramChatId || registry.webhook?.telegramChatId;

        let sentDiscord = false;
        let sentTelegram = false;

        if (targetUrl) {
            sentDiscord = await sendDiscordWebhook(targetUrl, {
                username: 'KingMC Bot Sentinel',
                embeds: [{
                    title: '🧪 [TEST] Kiểm Tra Kết Nối Webhook',
                    description: 'Kết nối Discord Webhook từ KingMC Bot Manager thành công 100%!',
                    color: 0x2ECC71,
                    footer: { text: 'Kiểm tra lúc ' + new Date().toLocaleTimeString('vi-VN') },
                    timestamp: new Date().toISOString()
                }]
            });
        }

        if (tgToken && tgChat) {
            sentTelegram = await sendTelegramMessage(tgToken, tgChat, '<b>🧪 [TEST] KingMC Bot Manager:</b> Kết nối Telegram Bot thành công 100%!');
        }

        if (sentDiscord || sentTelegram) {
            res.json({ ok: true, message: `Gửi thử thành công! (Discord: ${sentDiscord ? 'OK' : 'Không dùng'}, Telegram: ${sentTelegram ? 'OK' : 'Không dùng'})` });
        } else {
            res.status(400).json({ ok: false, error: 'Không thể gửi tin nhắn. Hãy kiểm tra lại Webhook URL hoặc Telegram Token / Chat ID.' });
        }
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Route /api/manager/bot/:id/logs is properly unified via detailGetRoutes

app.post('/api/manager/admin/credentials', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');

    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên (Admin) mới có quyền xem thông tin đăng nhập bot.' });
    }

    logAuditEvent({ req, action: 'ADMIN_CREDENTIALS_ACCESS', details: 'Admin xem danh sách thông tin tài khoản tất cả bot', status: 'SUCCESS' });

    const configs = BOT_CONFIG.slice();
    const results = new Array(configs.length);
    let cursor = 0;

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= configs.length) return;
            const config = configs[index];

            try {
                const result = await fetchChild(config, '/api/bot/credentials', {
                    method: 'GET',
                    timeoutMs: ADMIN_FETCH_TIMEOUT_MS
                });

                results[index] = {
                    id: config.id,
                    label: config.label,
                    ok: result.ok &&
                        typeof result.data?.username === 'string' &&
                        typeof result.data?.password === 'string',
                    username: result.ok ? String(result.data?.username || '') : '',
                    password: result.ok ? String(result.data?.password || '') : '',
                    error: result.ok ? null : (result.data?.error || `Bot trả HTTP ${result.status}.`)
                };
            } catch (err) {
                results[index] = {
                    id: config.id,
                    label: config.label,
                    ok: false,
                    username: '',
                    password: '',
                    error: err.message || 'Không thể kết nối bot.'
                };
            }
        }
    }

    const workerCount = Math.min(BOT_MAX_PARALLEL_REQUESTS, Math.max(configs.length, 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    res.json({ ok: true, bots: results });
});
app.delete('/api/manager/bot/:id', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên (Admin) mới có quyền xóa bot.' });
    }
    const id = Number(req.params.id);
    const index = BOT_CONFIG.findIndex(bot => bot.id === id);

    if (index < 0) {
        return res.status(404).json({ error: 'Bot không tồn tại.' });
    }

    createSystemBackup('pre-bot-delete');

    const previousOrder = BOT_CONFIG.slice();
    const previousDisabledEnvUrls = [...registry.disabledEnvUrls];
    const previousDynamicBots = registry.dynamicBots.map(item => ({ ...item }));
    const previousOverrides = registry.overrides.map(item => ({ ...item }));
    const previousOrderUrls = [...(registry.orderUrls || [])];
    const previousBotIdMap = { ...(registry.botIdMap || {}) };
    const previousCache = summaryCache.get(id);
    const previousInFlight = summaryRefreshInFlight.get(id);
    const [removed] = BOT_CONFIG.splice(index, 1);

    summaryCache.delete(id);
    summaryRefreshInFlight.delete(id);

    if (registry.botIdMap) {
        if (removed.url) delete registry.botIdMap[removed.url];
        if (removed.sourceUrl) delete registry.botIdMap[removed.sourceUrl];
    }

    if (removed.source === 'env') {
        const sourceUrl = normalizeRegistryUrl(
            removed.sourceUrl || removed.url
        );

        if (
            sourceUrl &&
            !registry.disabledEnvUrls.includes(sourceUrl)
        ) {
            registry.disabledEnvUrls.push(sourceUrl);
        }
    } else {
        registry.dynamicBots = registry.dynamicBots.filter(
            item => item.url !== removed.sourceUrl &&
                    item.url !== removed.url
        );
    }

    registry.overrides = registry.overrides.filter(
        item => item.sourceUrl !== removed.sourceUrl
    );

    registry.orderUrls = BOT_CONFIG.map(
        bot => bot.url
    );

    const saved = saveRegistry();

    if (!saved) {
        BOT_CONFIG.splice(0, BOT_CONFIG.length, ...previousOrder);
        registry.disabledEnvUrls = previousDisabledEnvUrls;
        registry.dynamicBots = previousDynamicBots;
        registry.overrides = previousOverrides;
        registry.orderUrls = previousOrderUrls;
        registry.botIdMap = previousBotIdMap;
        if (previousCache) summaryCache.set(id, previousCache);
        if (previousInFlight) summaryRefreshInFlight.set(id, previousInFlight);
        return res.status(500).json({
            error: 'Không thể lưu registry; thao tác xóa đã được rollback.'
        });
    }

    void syncAuthToAllBots(true);

    logAuditEvent({
        req,
        action: 'BOT_DELETE',
        target: { botId: removed.id, label: removed.label },
        details: removed.url,
        status: 'SUCCESS'
    });

    return res.json({
        ok: true,
        message: `${removed.label} đã được xóa khỏi Manager.`,
        removedId: removed.id
    });
});

app.get('/api/manager/bots', (req, res) => {
    const session = getSessionUser(req);
    if (!session) {
        return res.status(401).json({ ok: false, error: 'Chưa đăng nhập hệ thống.' });
    }
    let configs = BOT_CONFIG;
    let currentUserObj = null;
    const allUsers = loadUsers();
    if (session && session.role === 'user') {
        configs = BOT_CONFIG.filter(config => (session.assignedBotIds || []).includes(Number(config.id)));
        currentUserObj = allUsers.find(u => u.username.toLowerCase() === session.username.toLowerCase());
    }
    const bots = configs.map((config, index) => {
        const item = summaryCache.get(config.id)?.data ||
            buildUnavailableSummary(config, 'Đang kiểm tra bot...');
        const copy = sanitizeBotForSession(item, session);

        if (session.role === 'admin') {
            const adminAlias = registry.botAliases && registry.botAliases[config.id];
            copy.displayIndex = config.id;
            copy.label = adminAlias || (config.label && !config.label.startsWith('Bot ') ? config.label : `bot${config.id}`);
            const assignedUser = allUsers.find(u => Array.isArray(u.assignedBotIds) && u.assignedBotIds.includes(Number(config.id)));
            copy.assignedUsername = assignedUser ? assignedUser.username : null;
            copy.assignedPlan = assignedUser ? (assignedUser.planName || 'Gói thuê') : null;
            copy.assignedStatus = assignedUser ? assignedUser.status : null;
            copy.assignedExpiresAt = assignedUser ? assignedUser.expiresAt : null;
        } else {
            // Khách thuê nhìn thấy số thứ tự bot của riêng mình (1, 2,...)
            const userIndex = index + 1;
            copy.displayIndex = userIndex;
            const userAlias = currentUserObj?.botAliases && currentUserObj.botAliases[config.id];
            copy.label = userAlias || `bot${userIndex}`;
            copy.assignedUsername = session.username;
            copy.assignedPlan = session.planName || 'Gói thuê';
            copy.assignedStatus = session.status || 'active';
            copy.assignedExpiresAt = session.expiresAtRental || null;
        }
        copy.tags = (registry.botTags && registry.botTags[config.id]) || [];
        return copy;
    });

    void refreshAllSummaries();

    const mem = process.memoryUsage();
    const managerRamMb = Math.round(mem.rss / (1024 * 1024));

    res.json({
        ok: true,
        bots,
        serverTime: Date.now(),
        cacheMs: BOT_SUMMARY_CACHE_MS,
        registryFile: session.role === 'admin' ? REGISTRY_FILE : undefined,
        managerRamMb,
        currentUser: { username: session.username, role: session.role }
    });
});

app.post('/api/manager/bot/:id/alias', (req, res) => {
    const session = getSessionUser(req);
    if (!session) return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });
    const botId = Number(req.params.id);
    const newLabel = String(req.body?.label || '').trim();
    if (newLabel.length > 50) {
        return res.status(400).json({ ok: false, error: 'Tên ghi chú bot không được vượt quá 50 ký tự.' });
    }

    if (session.role === 'admin') {
        registry.botAliases = registry.botAliases || {};
        if (newLabel) {
            registry.botAliases[botId] = newLabel;
        } else {
            delete registry.botAliases[botId];
        }
        const botConfig = BOT_CONFIG.find(b => Number(b.id) === botId);
        if (botConfig) {
            botConfig.label = newLabel || `bot${botId}`;
        }
        saveRegistry();
        logAuditEvent({
            req,
            action: 'BOT_RENAME',
            category: 'SYSTEM',
            details: `Admin cập nhật tên ghi chú bot #${botId} thành: "${newLabel || ('bot' + botId)}"`,
            status: 'SUCCESS'
        });
        return res.json({ ok: true, message: 'Đã cập nhật tên ghi chú bot (Admin)!', label: newLabel || `bot${botId}` });
    } else {
        if (!Array.isArray(session.assignedBotIds) || !session.assignedBotIds.includes(botId)) {
            return res.status(403).json({ ok: false, error: 'Bạn không có quyền quản lý bot này.' });
        }
        const users = loadUsers(true);
        const userObj = users.find(u => u.username.toLowerCase() === session.username.toLowerCase());
        if (!userObj) return res.status(404).json({ ok: false, error: 'Không tìm thấy thông tin tài khoản.' });

        userObj.botAliases = userObj.botAliases || {};
        if (newLabel) {
            userObj.botAliases[botId] = newLabel;
        } else {
            delete userObj.botAliases[botId];
        }
        saveUsers(users);
        const userIdx = (session.assignedBotIds.indexOf(botId) + 1) || 1;
        const effectiveLabel = newLabel || `bot${userIdx}`;
        logAuditEvent({
            req,
            action: 'BOT_RENAME',
            category: 'USER_ACTION',
            details: `User ${session.username} cập nhật tên ghi chú bot #${botId} thành: "${effectiveLabel}"`,
            status: 'SUCCESS'
        });
        return res.json({ ok: true, message: 'Đã cập nhật tên ghi chú bot của bạn!', label: effectiveLabel });
    }
});

app.post('/api/manager/bot/:id/tags', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền gắn tag phân loại bot.' });
    }
    const botId = Number(req.params.id);
    const rawTags = req.body?.tags;
    let tags = [];
    if (Array.isArray(rawTags)) {
        tags = rawTags.map(t => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean).slice(0, 10);
    } else if (typeof rawTags === 'string') {
        tags = rawTags.split(/[,\s]+/).map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean).slice(0, 10);
    }
    registry.botTags = registry.botTags || {};
    registry.botTags[botId] = [...new Set(tags)];
    saveRegistry();
    logAuditEvent({
        req,
        action: 'BOT_TAGS_UPDATE',
        category: 'SYSTEM',
        details: `Cập nhật tags cho bot #${botId}: [${registry.botTags[botId].join(', ')}]`,
        status: 'SUCCESS'
    });
    res.json({ ok: true, botId, tags: registry.botTags[botId] });
});

app.get('/api/manager/bot/:id/state', async (req, res) => {
    const perm = checkBotPermission(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ error: perm.error });
    const config = getBotConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Bot không tồn tại.' });

    const summary = await getBotSummary(config, { force: true });
    if (!summary.available) return res.status(503).json(summary);
    res.json(summary);
});

const detailGetRoutes = {
    snapshot: '/api/snapshot',
    inventory: '/api/inventory',
    logs: '/api/bot/logs',
    'chat-logs': '/api/bot/chat-logs',
    settings: '/api/settings',
    autoChat: '/api/auto-chat',
    botSchedules: '/api/bot-schedules'
};

for (const [name, childPath] of Object.entries(detailGetRoutes)) {
    app.get(`/api/manager/bot/:id/${name}`, async (req, res) => {
        const perm = checkBotPermission(req, req.params.id);
        if (!perm.allowed) return res.status(perm.status).json({ error: perm.error });
        const config = getBotConfig(req.params.id);
        if (!config) return res.status(404).json({ error: 'Bot không tồn tại.' });

        try {
            const query = new URLSearchParams();
            for (const [key, value] of Object.entries(req.query || {})) {
                if (value !== undefined) query.set(key, String(value));
            }
            const path = query.toString()
                ? `${childPath}?${query.toString()}`
                : childPath;
            const extraHeaders = {
                'X-Manager-Role': String(perm.user?.role || 'user')
            };
            const result = await fetchChild(config, path, { headers: extraHeaders });
            let status = result.status;
            if (status === 401 || status === 403) status = 502;
            if (result.ok && name === 'snapshot' && result.data) {
                try {
                    const botId = Number(config.id);
                    const seq = (summaryRequestSeq.get(botId) || 0) + 1;
                    summaryRequestSeq.set(botId, seq);
                    const summary = normalizeSnapshotToSummary(config, result.data);
                    const lastApplied = summaryLastAppliedSeq.get(botId) || 0;
                    if (seq >= lastApplied) {
                        summaryLastAppliedSeq.set(botId, seq);
                        summaryCache.set(botId, { at: Date.now(), data: summary });
                    }
                    recordBotMetrics(botId, summary);
                } catch (_) {}
            }
            if (result.data && perm.user?.role !== 'admin') {
                if (result.data.settings?.proxy) {
                    result.data.settings.proxy = { enabled: result.data.settings.proxy.enabled === true };
                }
                if (result.data.proxy) {
                    result.data.proxy = { enabled: result.data.proxy.enabled === true };
                }
            }
            return res.status(status).json(result.data || {});
        } catch (err) {
            return res.status(502).json({ error: err.message || 'Không thể kết nối bot.' });
        }
    });
}


// Public System Info (công khai cho trang đăng nhập/đăng ký biết trạng thái ưu đãi dùng thử)
app.get('/api/public/system-info', (req, res) => {
    registry.systemSettings = registry.systemSettings || { trialGiftEnabled: true, trialDays: 1 };
    return res.json({
        ok: true,
        trialGiftEnabled: registry.systemSettings.trialGiftEnabled !== false,
        trialDays: Math.max(1, Math.min(365, parseInt(registry.systemSettings.trialDays, 10) || 1))
    });
});

// System Settings API (Quản trị viên bật/tắt tặng ngày dùng thử, chỉnh số ngày, v.v.)
app.get('/api/manager/settings/system', (req, res) => {
    const session = getSessionUser(req);
    if (!session) return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });
    registry.systemSettings = registry.systemSettings || { trialGiftEnabled: true, trialDays: 1 };
    return res.json({
        ok: true,
        settings: {
            trialGiftEnabled: registry.systemSettings.trialGiftEnabled !== false,
            trialDays: Math.max(1, Math.min(365, parseInt(registry.systemSettings.trialDays, 10) || 1))
        }
    });
});

app.post('/api/manager/settings/system', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên mới có quyền đổi cài đặt hệ thống.' });
    }
    registry.systemSettings = registry.systemSettings || { trialGiftEnabled: true, trialDays: 1 };
    if (req.body?.trialGiftEnabled !== undefined) {
        registry.systemSettings.trialGiftEnabled = req.body.trialGiftEnabled === true;
    }
    if (req.body?.trialDays !== undefined) {
        const td = parseInt(req.body.trialDays, 10);
        if (Number.isInteger(td) && td >= 1 && td <= 365) {
            registry.systemSettings.trialDays = td;
        }
    }
    const saved = saveRegistry(registry);
    if (!saved) return res.status(500).json({ ok: false, error: 'Không thể lưu cài đặt hệ thống.' });
    const trialDays = Math.max(1, Math.min(365, parseInt(registry.systemSettings.trialDays, 10) || 1));
    const statusText = registry.systemSettings.trialGiftEnabled ? `BẬT (${trialDays} ngày)` : 'TẮT';
    logAuditEvent({
        req,
        action: 'SYSTEM_SETTINGS_UPDATE',
        details: `Cập nhật chế độ tặng dùng thử cho tài khoản mới: ${statusText}`,
        status: 'SUCCESS'
    });
    return res.json({
        ok: true,
        message: 'Đã ' + (registry.systemSettings.trialGiftEnabled ? `BẬT chế độ tặng ${trialDays} ngày dùng thử.` : 'TẮT chế độ tặng dùng thử.'),
        settings: {
            trialGiftEnabled: registry.systemSettings.trialGiftEnabled,
            trialDays
        }
    });
});

const detailPostRoutes = {
    start: '/api/bot/start',
    stop: '/api/bot/stop',
    restart: '/api/bot/restart',
    send: '/api/bot/send',
    account: '/api/bot/account',
    inventoryMove: '/api/inventory/move',
    inventoryEquip: '/api/inventory/equip',
    inventoryUnequip: '/api/inventory/unequip',
    inventorySelect: '/api/inventory/select',
    inventoryDrop: '/api/inventory/drop',
    clearLogs: '/api/bot/logs/clear',
    clearChatLogs: '/api/bot/chat-logs/clear',
    settings: '/api/settings',
    autoChat: '/api/auto-chat',
    botSchedules: '/api/bot-schedules',
    windowClick: '/api/bot/window/click',
    windowClose: '/api/bot/window/close',
    resetCustomer: '/api/bot/reset-customer',
    proxy: '/api/proxy',
    proxyTest: '/api/proxy/test'
};

const managerPostPathMap = {
    '/start': detailPostRoutes.start,
    '/stop': detailPostRoutes.stop,
    '/restart': detailPostRoutes.restart,
    '/send': detailPostRoutes.send,
    '/account': detailPostRoutes.account,
    '/inventory/move': detailPostRoutes.inventoryMove,
    '/inventory/equip': detailPostRoutes.inventoryEquip,
    '/inventory/unequip': detailPostRoutes.inventoryUnequip,
    '/inventory/select': detailPostRoutes.inventorySelect,
    '/inventory/drop': detailPostRoutes.inventoryDrop,
    '/logs/clear': detailPostRoutes.clearLogs,
    '/chat-logs/clear': detailPostRoutes.clearChatLogs,
    '/settings': detailPostRoutes.settings,
    '/auto-chat': detailPostRoutes.autoChat,
    '/bot-schedules': detailPostRoutes.botSchedules,
    '/window/click': detailPostRoutes.windowClick,
    '/window/close': detailPostRoutes.windowClose,
    '/reset-customer': detailPostRoutes.resetCustomer,
    '/proxy': detailPostRoutes.proxy,
    '/proxy/test': detailPostRoutes.proxyTest
};

for (const [managerSuffix, childPath] of Object.entries(managerPostPathMap)) {
    app.post(`/api/manager/bot/:id${managerSuffix}`, async (req, res) => {
        const perm = checkBotPermission(req, req.params.id);
        if (!perm.allowed) return res.status(perm.status).json({ error: perm.error });
        if (managerSuffix === '/reset-customer' && perm.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền reset bàn giao bot.' });
        }
        if ((managerSuffix === '/proxy' || managerSuffix === '/proxy/test') && perm.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền cấu hình hoặc kiểm tra Proxy.' });
        }
        if (perm.user?.role !== 'admin' && !canChangeMinecraftAccount(perm.user)) {
            if (managerSuffix === '/account') {
                return res.status(403).json({ error: 'Tài khoản của bạn không được phép tự đổi tài khoản Minecraft.' });
            }
            if (managerSuffix === '/send' && isRestrictedMinecraftAccountCommand(req.body?.text || req.body?.message)) {
                return res.status(403).json({ error: 'Tài khoản của bạn không được phép gửi lệnh thay đổi tài khoản Minecraft.' });
            }
            if (managerSuffix === '/auto-chat' && hasRestrictedMinecraftAccountCommand(req.body?.autoChatSchedules)) {
                return res.status(403).json({ error: 'Tài khoản của bạn không được phép lên lịch lệnh thay đổi tài khoản Minecraft.' });
            }
        }
        let forwardBody = req.body || {};
        if (managerSuffix === '/settings' && perm.user?.role !== 'admin') {
            forwardBody = JSON.parse(JSON.stringify(forwardBody));
            delete forwardBody.proxy;
            if (forwardBody.settings) delete forwardBody.settings.proxy;
        }
        const botId = Number(req.params.id);
        const targetBot = BOT_CONFIG.find(b => b.id === botId);
        const botLabel = targetBot?.label || `Bot ${botId}`;

        const extraHeaders = {
            'X-Manager-Allow-Account-Change': canChangeMinecraftAccount(perm.user) ? '1' : '0',
            'X-Manager-Role': String(perm.user?.role || 'user')
        };
        const result = await runChildAction(
            req.params.id,
            childPath,
            forwardBody,
            extraHeaders
        );

        const stateChangeSuffixes = ['/start', '/stop', '/restart', '/account', '/settings', '/auto-chat', '/bot-schedules', '/reset-customer', '/proxy'];
        if (stateChangeSuffixes.includes(managerSuffix)) {
            summaryCache.delete(botId);
            if (targetBot) {
                try { await refreshSummary(targetBot, true); } catch (_) {}
            }
        }

        const auditedActions = {
            '/start': 'BOT_START',
            '/stop': 'BOT_STOP',
            '/restart': 'BOT_RESTART',
            '/send': 'BOT_CHAT_SEND',
            '/account': 'BOT_ACCOUNT_CHANGE',
            '/settings': 'BOT_SETTINGS_UPDATE',
            '/logs/clear': 'BOT_LOGS_CLEAR',
            '/chat-logs/clear': 'BOT_CHAT_LOGS_CLEAR',
            '/inventory/drop': 'BOT_INVENTORY_DROP',
            '/inventory/move': 'BOT_INVENTORY_MOVE',
            '/inventory/equip': 'BOT_INVENTORY_EQUIP',
            '/window/click': 'BOT_WINDOW_CLICK',
            '/auto-chat': 'BOT_AUTOCHAT_UPDATE',
            '/bot-schedules': 'BOT_SCHEDULES_UPDATE',
            '/reset-customer': 'BOT_RESET_CUSTOMER',
            '/proxy': 'BOT_PROXY_UPDATE'
        };

        if (auditedActions[managerSuffix]) {
            let details = undefined;
            if (managerSuffix === '/start') {
                details = `Bấm nút Bật/Start bot ${botLabel} kết nối vào server`;
            } else if (managerSuffix === '/stop') {
                details = `Bấm nút Dừng/Stop bot ${botLabel} ngắt kết nối`;
            } else if (managerSuffix === '/restart') {
                details = `Bấm nút Khởi động lại/Restart bot ${botLabel}`;
            } else if (managerSuffix === '/send') {
                const msg = String(req.body?.text || req.body?.message || '');
                details = `Bấm nút Gửi lệnh trên bot ${botLabel}: "${msg}"`;
            } else if (managerSuffix === '/account') {
                details = `Bấm nút Đổi tài khoản Minecraft bot ${botLabel}: Username="${req.body?.username || '(giữ nguyên)'}", Mật khẩu bot="${req.body?.password ? '********' : '(không đổi)'}"`;
            } else if (managerSuffix === '/proxy') {
                const p = (req.body && req.body.proxy) ? req.body.proxy : req.body;
                details = `Bấm nút Cập nhật Proxy bot ${botLabel}: ${p?.enabled ? 'BẬT' : 'TẮT'} (${p?.protocol || 'socks5'}://${p?.host}:${p?.port}, user: "${p?.username || ''}", pass: "${p?.password ? '********' : ''}")`;
            } else if (managerSuffix === '/settings') {
                const setKeys = Object.keys(req.body || {});
                details = `Cập nhật cài đặt bot (${setKeys.length} mục): ${setKeys.slice(0, 5).map(k => `${k}=${JSON.stringify(req.body[k])}`).join(', ')}${setKeys.length > 5 ? '...' : ''}`;
            } else if (managerSuffix === '/logs/clear') {
                details = `Đã xóa sạch toàn bộ Event Logs của bot ${botLabel}`;
            } else if (managerSuffix === '/chat-logs/clear') {
                details = `Đã xóa sạch toàn bộ Chat Logs của bot ${botLabel}`;
            } else if (managerSuffix === '/inventory/drop') {
                details = `Thả vật phẩm tại ô Slot #${req.body?.slot ?? '?'} (Số lượng: ${req.body?.count ?? 'tất cả'})`;
            } else if (managerSuffix === '/inventory/move') {
                details = `Di chuyển vật phẩm từ Slot #${req.body?.sourceSlot ?? '?'} sang Slot #${req.body?.targetSlot ?? '?'}`;
            } else if (managerSuffix === '/inventory/equip') {
                details = `Trang bị vật phẩm tại Slot #${req.body?.slot ?? '?'} vào vị trí ${req.body?.destination || 'tay chính'}`;
            } else if (managerSuffix === '/window/click') {
                details = `Click slot #${req.body?.slot ?? '?'} trong giao diện GUI.`;
            } else if (managerSuffix === '/auto-chat') {
                details = `Cài đặt tự động chat: ${req.body?.enabled ? `BẬT (Giãn cách ${req.body?.interval || 30}s, ${req.body?.messages?.length || 0} câu)` : 'TẮT'}`;
            } else if (managerSuffix === '/bot-schedules') {
                details = `Cài đặt lịch trình tác vụ: ${req.body?.enabled ? `BẬT (${req.body?.tasks?.length || 0} tác vụ)` : 'TẮT'}`;
            } else if (managerSuffix === '/reset-customer') {
                details = `Đã reset sạch dữ liệu bot ${botLabel} để bàn giao khách mới.`;
            }
            logAuditEvent({
                req,
                action: auditedActions[managerSuffix],
                target: { botId, label: botLabel },
                details,
                status: result.ok ? 'SUCCESS' : 'FAILED'
            });
        }

        return sendProxyResult(res, result);
    });
}

app.get('/api/manager/bot/:id/proxy', async (req, res) => {
    const perm = checkBotPermission(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ error: perm.error });
    const result = await runChildAction(req.params.id, '/api/proxy', {}, {
        'X-Manager-Role': String(perm.user?.role || 'user')
    }, 'GET');
    if (result.data && perm.user?.role !== 'admin') {
        result.data = {
            ok: true,
            proxy: {
                enabled: !!result.data?.proxy?.enabled
            }
        };
    }
    return sendProxyResult(res, result);
});


async function runAll(action, targetConfigs = BOT_CONFIG) {
    const pathMap = {
        start: detailPostRoutes.start,
        stop: detailPostRoutes.stop,
        restart: detailPostRoutes.restart
    };

    const childPath = pathMap[action];
    if (!childPath) {
        throw new Error('Action không hợp lệ.');
    }

    const configs = (Array.isArray(targetConfigs) ? targetConfigs : BOT_CONFIG).slice();
    const results = new Array(configs.length);
    let cursor = 0;

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= configs.length) return;
            const config = configs[index];

            if (!config.url) {
                results[index] = {
                    id: config.id,
                    label: config.label,
                    ok: false,
                    error: 'Chưa cấu hình URL cho bot.'
                };
                continue;
            }

            try {
                const result = await fetchChild(
                    config,
                    childPath,
                    {
                        method: 'POST',
                        body: {}
                    }
                );

                results[index] = {
                    id: config.id,
                    label: config.label,
                    ok: result.ok,
                    status: result.status,
                    message:
                        result.data?.message ||
                        (result.ok ? 'OK' : null),
                    error:
                        result.ok
                            ? null
                            : result.data?.error || `HTTP ${result.status}`
                };
            } catch (err) {
                results[index] = {
                    id: config.id,
                    label: config.label,
                    ok: false,
                    error: err.message || 'Không thể kết nối.'
                };
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(BOT_MAX_PARALLEL_REQUESTS, configs.length) },
            () => worker()
        )
    );

    void refreshAllSummaries();
    return results;
}

for (const action of ['start', 'stop', 'restart']) {
    app.post(`/api/manager/all/${action}`, async (req, res) => {
        const session = getSessionUser(req);
        if (!session) {
            return res.status(401).json({ error: 'Chưa đăng nhập.' });
        }
        let targetConfigs = BOT_CONFIG;
        if (session.role !== 'admin') {
            const allowedSet = new Set((session.assignedBotIds || []).map(id => Number(id)));
            targetConfigs = BOT_CONFIG.filter(c => allowedSet.has(Number(c.id)));
            if (targetConfigs.length === 0) {
                return res.status(403).json({ error: 'Bạn không có quyền quản lý bot nào.' });
            }
        }
        try {
            const results = await runAll(action, targetConfigs);
            const allOk = results.every(result => result.ok);
            logAuditEvent({
                req,
                action: `FLEET_${action.toUpperCase()}`,
                target: { botCount: targetConfigs.length },
                details: `Thao tác hàng loạt trên ${targetConfigs.length} bot`,
                status: allOk ? 'SUCCESS' : 'PARTIAL'
            });
            res.status(allOk ? 200 : 207).json({
                ok: allOk,
                action,
                results
            });
        } catch (err) {
            logAuditEvent({
                req,
                action: `FLEET_${action.toUpperCase()}`,
                target: { botCount: targetConfigs.length },
                details: err.message,
                status: 'FAILED'
            });
            res.status(500).json({ error: err.message || 'Thao tác thất bại.' });
        }
    });
}

app.post('/api/manager/all/send', async (req, res) => {
    const session = getSessionUser(req);
    if (!session) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    const text = String(req.body?.text || req.body?.message || '').trim();
    if (!text) return res.status(400).json({ error: 'Nội dung tin nhắn trống.' });
    if (!canChangeMinecraftAccount(session) && isRestrictedMinecraftAccountCommand(text)) {
        return res.status(403).json({ error: 'Tài khoản của bạn không được phép gửi lệnh thay đổi tài khoản Minecraft.' });
    }

    let targetBots = BOT_CONFIG;
    if (session.role === 'user') {
        targetBots = BOT_CONFIG.filter(b => (session.assignedBotIds || []).includes(Number(b.id)));
    }
    const filterTag = req.body?.tag ? String(req.body.tag).trim().toLowerCase().replace(/^#/, '') : null;
    if (filterTag) {
        targetBots = targetBots.filter(b => {
            const bTags = (registry.botTags && registry.botTags[b.id]) || [];
            return bTags.includes(filterTag);
        });
    }
    if (targetBots.length === 0) {
        return res.status(400).json({ error: filterTag ? `Không tìm thấy bot nào mang tag #${filterTag}.` : 'Không có bot nào trong danh sách.' });
    }

    const results = await Promise.all(targetBots.map(async bot => {
        try {
            const r = await fetchChild(bot, '/api/bot/send', { method: 'POST', body: { text } });
            return { id: bot.id, label: bot.label, ok: r.ok };
        } catch (e) {
            return { id: bot.id, label: bot.label, ok: false, error: e.message };
        }
    }));
    const okCount = results.filter(r => r.ok).length;
    logAuditEvent({
        req,
        action: 'FLEET_BROADCAST_CHAT',
        target: { total: targetBots.length, success: okCount },
        details: `Broadcast lệnh "${text.length > 50 ? text.substring(0, 47) + '...' : text}" tới ${targetBots.length} bot (Thành công: ${okCount}/${targetBots.length})`,
        status: okCount === targetBots.length ? 'SUCCESS' : (okCount > 0 ? 'PARTIAL' : 'FAILED')
    });
    res.json({ ok: true, message: `Đã gửi lệnh tới ${okCount}/${targetBots.length} bot thành công.`, results });
});

app.post('/api/manager/all/settings', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền cài đặt hàng loạt bot.' });
    }
    const settings = req.body?.settings || {};
    const botSchedules = req.body?.botSchedules || null;

    let targetBots = BOT_CONFIG;
    const filterTag = req.body?.tag ? String(req.body.tag).trim().toLowerCase().replace(/^#/, '') : null;
    if (filterTag) {
        targetBots = targetBots.filter(b => {
            const bTags = (registry.botTags && registry.botTags[b.id]) || [];
            return bTags.includes(filterTag);
        });
    }
    if (targetBots.length === 0) {
        return res.status(400).json({ error: filterTag ? `Không tìm thấy bot nào mang tag #${filterTag}.` : 'Không có bot nào trong danh sách.' });
    }

    const results = await Promise.all(targetBots.map(async bot => {
        try {
            const rSettings = await fetchChild(bot, '/api/settings', { method: 'POST', body: { settings } });
            let schedOk = true;
            if (botSchedules) {
                const rSched = await fetchChild(bot, '/api/bot-schedules', { method: 'POST', body: { botSchedules } });
                schedOk = rSched.ok;
            }
            return { id: bot.id, label: bot.label, ok: rSettings.ok && schedOk };
        } catch (e) {
            return { id: bot.id, label: bot.label, ok: false, error: e.message };
        }
    }));
    const okCount = results.filter(r => r.ok).length;
    logAuditEvent({
        req,
        action: 'FLEET_SETTINGS_UPDATE',
        target: { total: targetBots.length, success: okCount },
        details: 'Cập nhật cấu hình' + (botSchedules ? ' & hẹn giờ' : '') + ' hàng loạt cho ' + okCount + '/' + targetBots.length + ' bot' + (filterTag ? ` (Tag: #${filterTag})` : ''),
        status: okCount === targetBots.length ? 'SUCCESS' : 'PARTIAL'
    });
    const allOk = okCount === targetBots.length;
    res.status(allOk ? 200 : 207).json({
        ok: allOk,
        results,
        okCount,
        total: targetBots.length,
        message: `Đã đồng bộ cấu hình tới ${okCount}/${targetBots.length} bot thành công.`,
        error: allOk ? null : `Có ${targetBots.length - okCount}/${targetBots.length} bot thất bại khi đồng bộ.`
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'kingmc-manager',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});


// ============================================================================
// COMMERCIAL RENTAL SAAS API ROUTES
// ============================================================================

// 1. Quản lý License Keys (Admin)
app.get('/api/manager/keys', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền xem danh sách Key.' });
    }
    const keys = loadKeysFile();
    res.json({ ok: true, keys });
});

app.post('/api/manager/keys', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền tạo Key.' });
    }
    const rawDays = Number(req.body?.days);
    const days = Number.isFinite(rawDays) && rawDays >= 1 ? Math.min(Math.floor(rawDays), 3650) : 7;
    const planName = (req.body?.planName || `Gói ${days} Ngày`).trim();
    const botIds = Array.isArray(req.body?.botIds) ? req.body.botIds.map(Number).filter(Number.isFinite) : [];
    const rawCount = Number(req.body?.count);
    const count = Number.isFinite(rawCount) && rawCount >= 1 ? Math.min(Math.floor(rawCount), 50) : 1;

    const keysList = loadKeysFile();
    const previousKeys = [...keysList];
    const createdKeys = [];

    for (let i = 0; i < count; i++) {
        const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
        const keyStr = `KINGMC-${days}D-${rand}`;
        const keyItem = {
            key: keyStr,
            days,
            planName,
            botIds,
            createdAt: new Date().toISOString(),
            used: false,
            usedBy: null,
            usedAt: null
        };
        keysList.unshift(keyItem);
        createdKeys.push(keyItem);
    }

    const saved = saveKeysFile(keysList);
    if (!saved) {
        keysList.length = 0;
        keysList.push(...previousKeys);
        return res.status(500).json({ ok: false, error: 'Không thể lưu danh sách mã key vào hệ thống.' });
    }
    logAuditEvent({
        req,
        action: 'LICENSE_KEYS_CREATE',
        details: `Tạo ${count} mã key gia hạn (${days} ngày, gói ${planName})`,
        status: 'SUCCESS'
    });

    res.json({ ok: true, message: `Đã tạo ${count} mã Key thành công!`, keys: createdKeys });
});

app.delete('/api/manager/keys/:key', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền xóa Key.' });
    }
    const targetKey = String(req.params.key || '').trim().toUpperCase();
    let keysList = loadKeysFile();
    const exists = keysList.some(k => k.key === targetKey);
    if (!exists) return res.status(404).json({ error: 'Key không tồn tại.' });

    const previousKeys = [...keysList];
    keysList = keysList.filter(k => k.key !== targetKey);
    const saved = saveKeysFile(keysList);
    if (!saved) {
        keysList = previousKeys;
        return res.status(500).json({ ok: false, error: 'Không thể lưu danh sách mã key sau khi xóa.' });
    }
    if (supabaseAdapter && supabaseAdapter.isEnabled()) {
        await supabaseAdapter.deleteKey(targetKey);
    }
    logAuditEvent({
        req,
        action: 'LICENSE_KEY_DELETE',
        details: `Xóa mã key ${targetKey}`,
        status: 'SUCCESS'
    });

    res.json({ ok: true, message: `Đã xóa mã Key ${targetKey}.` });
});

// 2. Gia hạn bằng Key (User hoặc Khách tại Login Gate)
app.post('/api/manager/renew', async (req, res) => {
    try {
        const rawKey = String(req.body?.key || req.body?.licenseKey || '').trim().toUpperCase();
        const username = String(req.body?.username || '').trim().toLowerCase();
        const password = String(req.body?.password ?? '');

        if (!rawKey) {
            return res.status(400).json({ error: 'Vui lòng nhập mã Key gia hạn.' });
        }

        const session = getSessionUser(req);
        const rateLimitUsername = session?.username || username;
        const rateCheck = checkRenewRateLimit(req, rateLimitUsername);
        if (!rateCheck.allowed) {
            return res.status(429).json({ ok: false, error: rateCheck.error });
        }

        const keysList = loadKeysFile();
        const keyItem = keysList.find(k => k.key === rawKey);
        if (!keyItem) {
            recordRenewAttempt(req, rateLimitUsername, false);
            return res.status(404).json({ error: 'Mã Key gia hạn không hợp lệ hoặc không tồn tại.' });
        }
        if (keyItem.used) {
            recordRenewAttempt(req, rateLimitUsername, false);
            return res.status(400).json({ error: 'Mã Key này đã được sử dụng.' });
        }

        const users = loadUsers();
        let targetUser = null;
        if (session) {
            targetUser = users.find(u => u.username.toLowerCase() === session.username.toLowerCase());
        } else if (username && password) {
            const u = users.find(x => x.username.toLowerCase() === username.toLowerCase());
            if (u && verifyUserPassword(password, u.password)) {
                targetUser = u;
            } else {
                recordRenewAttempt(req, rateLimitUsername, false);
                return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
            }
        } else {
            recordRenewAttempt(req, rateLimitUsername, false);
            return res.status(400).json({ error: 'Vui lòng cung cấp Username và Mật khẩu tài khoản cần gia hạn.' });
        }

        if (!targetUser) {
            recordRenewAttempt(req, rateLimitUsername, false);
            return res.status(404).json({ error: 'Không tìm thấy tài khoản người dùng.' });
        }

        // Capture deep backup before modifications
        const usersBackup = JSON.parse(JSON.stringify(users));
        const keysBackup = JSON.parse(JSON.stringify(keysList));

        // Cộng dồn hạn thuê
        const now = Date.now();
        const baseTime = (targetUser.expiresAt && Date.parse(targetUser.expiresAt) > now)
            ? Date.parse(targetUser.expiresAt)
            : now;

        targetUser.expiresAt = new Date(baseTime + keyItem.days * 86400000).toISOString();
        targetUser.status = 'active';
        if (keyItem.planName) targetUser.planName = keyItem.planName;

        // Gán thêm bot nếu key có chỉ định
        if (Array.isArray(keyItem.botIds) && keyItem.botIds.length > 0) {
            const currentBots = Array.isArray(targetUser.assignedBotIds) ? targetUser.assignedBotIds.map(Number) : [];
            const newlyAssigned = keyItem.botIds.map(Number).filter(id => !currentBots.includes(id));
            if (newlyAssigned.length > 0) {
                const resetRes = await resetBotsForAssignment(newlyAssigned, `gia hạn Key cho "${targetUser.username}"`);
                if (!resetRes.ok) {
                    recordRenewAttempt(req, rateLimitUsername, false);
                    return res.status(500).json({ ok: false, error: `Không thể dọn dẹp reset Bot #${resetRes.botId} để bàn giao (${resetRes.error}). Vui lòng liên hệ Admin!` });
                }
            }
            targetUser.assignedBotIds = [...new Set([...currentBots, ...keyItem.botIds.map(Number)])];
            assignBotsExclusively(users, targetUser.id || targetUser.username, keyItem.botIds);
        }

        // Đánh dấu Key đã dùng
        keyItem.used = true;
        keyItem.usedBy = targetUser.username;
        keyItem.usedAt = new Date().toISOString();

        const uSaved = saveUsers(users);
        const kSaved = saveKeysFile(keysList);
        if (!uSaved || !kSaved) {
            saveUsers(usersBackup);
            saveKeysFile(keysBackup);
            return res.status(500).json({ ok: false, error: 'Không thể lưu thông tin gia hạn vào hệ thống.' });
        }
        void syncAuthToAllBots(true);
        recordRenewAttempt(req, targetUser.username, true);

        logAuditEvent({
            req,
            action: 'RENTAL_RENEW_KEY',
            target: { username: targetUser.username, key: keyItem.key },
            details: `Kích hoạt Key ${keyItem.key} cộng ${keyItem.days} ngày (Hạn mới: ${targetUser.expiresAt})`,
            status: 'SUCCESS'
        });

        res.json({
            ok: true,
            message: `🎉 Gia hạn thành công ${keyItem.days} ngày! Hạn sử dụng mới đến: ${new Date(targetUser.expiresAt).toLocaleString('vi-VN')}`,
            expiresAt: targetUser.expiresAt,
            planName: targetUser.planName,
            assignedBotIds: targetUser.assignedBotIds
        });
    } catch (err) {
        console.error('[RENEW] Lỗi gia hạn tài khoản:', err.message);
        res.status(500).json({ ok: false, error: 'Lỗi máy chủ khi xử lý gia hạn mã Key.' });
    }
});

// 3. Admin Cộng Ngày Thuê Thủ Công (+1, +3, +7, +15, +30, -1 Vĩnh Viễn)
app.post('/api/manager/user/:username/add-days', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền cộng hạn thuê.' });
    }
    const username = String(req.params.username || '').trim().toLowerCase();
    const days = Number(req.body?.days);
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.username?.toLowerCase() === username);
    if (userIndex === -1) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    const userBackup = JSON.parse(JSON.stringify(users[userIndex]));
    const targetUser = users[userIndex];

    if (days === -1) {
        // Vĩnh viễn
        targetUser.expiresAt = null;
        targetUser.planName = 'VIP Vĩnh Viễn';
        targetUser.status = 'active';
    } else if (days > 0) {
        const now = Date.now();
        const baseTime = (targetUser.expiresAt && Date.parse(targetUser.expiresAt) > now)
            ? Date.parse(targetUser.expiresAt)
            : now;
        targetUser.expiresAt = new Date(baseTime + days * 86400000).toISOString();
        targetUser.status = 'active';
    } else {
        return res.status(400).json({ error: 'Số ngày không hợp lệ.' });
    }

    const saved = saveUsers(users);
    if (!saved) {
        users[userIndex] = userBackup;
        return res.status(500).json({ ok: false, error: 'Không thể lưu hạn thuê của người dùng vào hệ thống.' });
    }
    void syncAuthToAllBots(true);
    logAuditEvent({
        req,
        action: 'ADMIN_EXTEND_RENTAL',
        target: { username },
        details: `Cộng ${days === -1 ? 'Vĩnh viễn' : days + ' ngày'} cho khách ${username} (Hạn mới: ${targetUser.expiresAt || 'Vĩnh viễn'})`,
        status: 'SUCCESS'
    });

    res.json({
        ok: true,
        message: `Đã cập nhật hạn thuê cho ${username} thành công!`,
        expiresAt: targetUser.expiresAt,
        planName: targetUser.planName,
        status: targetUser.status
    });
});

// 7. Đồng Bộ Xác Thực Khách Thuê Cho Bot Con (Login Gate của Bot.js)
app.post('/api/auth/verify-bot-access', (req, res) => {
    // Yêu cầu xác thực service-to-service nội bộ
    if (!isBotSecretRequest(req)) {
        logAuditEvent({
            req,
            action: 'AUTH_VERIFY_BOT_ACCESS',
            details: 'Từ chối: X-Bot-Secret không hợp lệ hoặc thiếu.',
            status: 'BLOCKED'
        });
        return res.status(401).json({ ok: false, error: 'Khóa bảo mật nội bộ X-Bot-Secret không hợp lệ.' });
    }

    const clientIp = getClientIp(req);
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const botId = Number(req.body?.botId);

    const rateLimit = verifyBotLimiter.check(clientIp, username || 'verify-bot');
    if (!rateLimit.allowed) {
        return res.status(429).json({ ok: false, error: rateLimit.error });
    }

    if (!username || !password) {
        verifyBotLimiter.record(clientIp, username || 'verify-bot', false);
        logAuditEvent({
            req,
            action: 'AUTH_VERIFY_BOT_ACCESS',
            target: { botId, username },
            details: 'Cổng Bot #' + botId + ': Từ chối do thiếu thông tin đăng nhập.',
            status: 'BLOCKED'
        });
        return res.status(400).json({ ok: false, error: 'Thiếu thông tin đăng nhập.' });
    }

    const users = loadUsers();
    let user = users.find(u => u.username.toLowerCase() === username);
    if (!user && username.toLowerCase() === 'admin') {
        const adminPass = getAdminPassword();
        if (verifyAdminPassword(password, adminPass)) {
            user = {
                id: 'admin',
                username: 'admin',
                password: adminPass,
                role: 'admin',
                status: 'active',
                expiresAt: null,
                allowAccountChange: true
            };
        } else {
            verifyBotLimiter.record(clientIp, username, false);
            logAuditEvent({
                req,
                action: 'AUTH_VERIFY_BOT_ACCESS',
                target: { botId, username },
                details: 'Cổng Bot #' + botId + ': Sai mật khẩu Quản trị viên.',
                status: 'FAILED'
            });
            return res.status(401).json({ ok: false, error: 'Mật khẩu Quản trị viên không chính xác.' });
        }
    }

    if (!user) {
        verifyBotLimiter.record(clientIp, username, false);
        logAuditEvent({
            req,
            action: 'AUTH_VERIFY_BOT_ACCESS',
            target: { botId, username },
            details: 'Cổng Bot #' + botId + ': Tài khoản "' + username + '" không tồn tại trên hệ thống.',
            status: 'BLOCKED'
        });
        return res.status(401).json({ ok: false, error: 'Tài khoản không tồn tại trên Manager.' });
    }

    if (user.role !== 'admin' && !verifyUserPassword(password, user.password)) {
        verifyBotLimiter.record(clientIp, username, false);
        logAuditEvent({
            req,
            action: 'AUTH_VERIFY_BOT_ACCESS',
            target: { botId, username },
            details: 'Cổng Bot #' + botId + ': Sai mật khẩu cho tài khoản "' + username + '".',
            status: 'FAILED'
        });
        return res.status(401).json({ ok: false, error: 'Mật khẩu không chính xác.' });
    }

    verifyBotLimiter.record(clientIp, username, true);

    if (user.role !== 'admin') {
        const isExpired = user.status === 'expired' || (user.expiresAt && Date.now() > Date.parse(user.expiresAt));
        if (isExpired) {
            logAuditEvent({
                req,
                action: 'AUTH_VERIFY_BOT_ACCESS',
                target: { botId, username },
                details: 'Cổng Bot #' + botId + ': Tài khoản "' + username + '" đã hết hạn thuê vào ngày ' + user.expiresAt + '.',
                status: 'BLOCKED'
            });
            return res.status(403).json({ ok: false, error: 'Tài khoản của bạn đã hết hạn thuê.' });
        }
        if (user.status !== 'active') {
            logAuditEvent({
                req,
                action: 'AUTH_VERIFY_BOT_ACCESS',
                target: { botId, username },
                details: 'Cổng Bot #' + botId + ': Tài khoản "' + username + '" đang bị vô hiệu hóa/khóa.',
                status: 'BLOCKED'
            });
            return res.status(403).json({ ok: false, error: 'Tài khoản đang bị khóa.' });
        }

        const hasBotId = Number.isFinite(botId) && (user.assignedBotIds || []).includes(botId);
        if (!hasBotId) {
            logAuditEvent({
                req,
                action: 'AUTH_VERIFY_BOT_ACCESS',
                target: { botId, username },
                details: 'Cổng Bot #' + botId + ': Khách "' + username + '" không có quyền điều khiển Bot #' + botId + '.',
                status: 'BLOCKED'
            });
            return res.status(403).json({ ok: false, error: 'Bạn không được cấp quyền điều khiển bot này.' });
        }
    }

    logAuditEvent({
        req,
        action: 'AUTH_VERIFY_BOT_ACCESS',
        target: { botId, username: user.username },
        details: 'Cổng Bot #' + botId + ': Xác thực thành công quyền truy cập cho "' + user.username + '" (' + (user.role === 'admin' ? 'Quản trị viên' : 'Khách thuê') + ')',
        status: 'SUCCESS'
    });

    const userPlainPass = decryptUserPassword(user.password);
    const passwordHash = user.role === 'admin'
        ? getSyncAdminPasswordHash()
        : hashSyncUserPassword(user.id || user.username, userPlainPass);

    return res.json({
        ok: true,
        role: user.role,
        username: user.username,
        expiresAt: user.expiresAt,
        allowAccountChange: user.allowAccountChange !== false,
        passwordHash
    });
});

app.get(['/healthz', '/api/health'], (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        service: 'manager',
        uptime: Math.round(process.uptime()),
        memory: {
            rssMb: Math.round(mem.rss / (1024 * 1024)),
            heapMb: Math.round(mem.heapUsed / (1024 * 1024))
        },
        fleet: {
            total: Array.isArray(BOT_CONFIG) ? BOT_CONFIG.length : 0
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    const session = getSessionUser(req);
    if (!session) {
        return res.status(401).json({ error: 'Chưa đăng nhập hệ thống.' });
    }
    let allowedConfigs = BOT_CONFIG;
    if (session.role !== 'admin') {
        const allowedSet = new Set((session.assignedBotIds || []).map(id => Number(id)));
        allowedConfigs = BOT_CONFIG.filter(c => allowedSet.has(Number(c.id)));
    }
    const bots = allowedConfigs.map(config => {
        return summaryCache.get(config.id)?.data ||
            buildUnavailableSummary(config, 'Đang kiểm tra bot...');
    });
    void refreshAllSummaries();
    res.json({
        status: 'ok',
        service: 'kingmc-manager',
        platform: MANAGER_PLATFORM,
        httpPort: HTTP_PORT,
        registryFile: session.role === 'admin' ? REGISTRY_FILE : undefined,
        botCount: allowedConfigs.length,
        bots,
        cacheMs: BOT_SUMMARY_CACHE_MS
    });
});

app.get('/api/manager/diagnostics', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền xem thông tin chẩn đoán.' });
    }
    res.json({
        ok: true,
        platform: MANAGER_PLATFORM,
        httpPort: HTTP_PORT,
        registryFile: REGISTRY_FILE,
        registryCandidates: REGISTRY_CANDIDATES,
        botCount: BOT_CONFIG.length,
        bots: BOT_CONFIG.map(bot => ({
            id: bot.id,
            label: bot.label,
            url: bot.url,
            source: bot.source,
            cached: summaryCache.has(bot.id)
        }))
    });
});

app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const session = getSessionUser(req);
    if (!session) {
        const trialGiftEnabled = registry.systemSettings?.trialGiftEnabled !== false;
        const trialDays = Math.max(1, Math.min(365, parseInt(registry.systemSettings?.trialDays, 10) || 1));
        let loginHtml = PUBLIC_LOGIN_HTML;
        if (!trialGiftEnabled) {
            loginHtml = loginHtml
                .replace('id="publicTrialCalloutBadge"', 'id="publicTrialCalloutBadge" style="display:none;"')
                .replace('(Để trống nếu dùng thử)', '(Cần nhập Key để kích hoạt)')
                .replace('placeholder="Để trống để nhận 1 ngày dùng thử miễn phí..."', 'placeholder="Nhập mã Key kích hoạt gói thuê (Bắt buộc)..."');
        } else if (trialDays !== 1) {
            loginHtml = loginHtml
                .replace('1 NGÀY DÙNG THỬ MIỄN PHÍ', `${trialDays} NGÀY DÙNG THỬ MIỄN PHÍ`)
                .replace('1 ngày dùng thử miễn phí...', `${trialDays} ngày dùng thử miễn phí...`);
        }
        return res.type('html').send(loginHtml);
    }

    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / (1024 * 1024));
    let renderedHtml = HTML
        .replace('id="globalManagerRam">-- MB', `id="globalManagerRam">${rssMb} MB`)
        .replace('id="managerRamUsage">-- MB', `id="managerRamUsage">${rssMb} MB`)
        .replace('id="detailManagerRamUsage">-- MB', `id="detailManagerRamUsage">${rssMb} MB`);

    if (session.role === 'admin') {
        const adminBadge = '👑 <strong>ADMIN (Toàn quyền)</strong>';
        const adminStyle = 'background:rgba(234,179,8,0.2);color:#eab308;border-color:rgba(234,179,8,0.4);';
        renderedHtml = renderedHtml
            .replace(/style="background:rgba\(148,163,184,0\.15\);color:#94a3b8;border-color:rgba\(148,163,184,0\.3\);">🔒 CHƯA ĐĂNG NHẬP<\/span>/g, `style="${adminStyle}">${adminBadge}</span>`);
    } else {
        const escapedU = escapeHtml(session.username);
        const userBadge = `👤 <strong>USER: ${escapedU}</strong>`;
        const userStyle = 'background:rgba(56,189,248,0.2);color:#38bdf8;border-color:rgba(56,189,248,0.4);';
        renderedHtml = renderedHtml
            .replace(/style="background:rgba\(148,163,184,0\.15\);color:#94a3b8;border-color:rgba\(148,163,184,0\.3\);">🔒 CHƯA ĐĂNG NHẬP<\/span>/g, `style="${userStyle}">${userBadge}</span>`)
            .replace(/<span class="user-profile-name" id="globalUserProfileName">admin<\/span>/g, `<span class="user-profile-name" id="globalUserProfileName">${escapedU}</span>`)
            .replace(/<span class="user-avatar-badge" id="globalUserAvatarBadge">👑<\/span>/g, '<span class="user-avatar-badge" id="globalUserAvatarBadge">👤</span>');
    }

    const sessionData = {
        username: session.username,
        role: session.role,
        assignedBotIds: session.assignedBotIds || [],
        planName: session.planName || (session.role === 'admin' ? 'Admin VIP' : 'Gói thường'),
        expiresAt: session.expiresAtRental || null,
        allowAccountChange: session.allowAccountChange !== false,
        status: session.status || 'active'
    };
    const serializedSession = JSON.stringify(sessionData)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    renderedHtml = renderedHtml.replace(
        'window.__INITIAL_USER__ = null;',
        `window.__INITIAL_USER__ = ${serializedSession};`
    );
    res.type('html').send(renderedHtml);
});

// Express Catch-All Error Handler (Mounted after all route handlers)
app.use((err, req, res, next) => {
    console.error(`[UNHANDLED_ERROR] ${req.method} ${req.originalUrl || req.url}:`, err.stack || err.message || err);
    if (res.headersSent) {
        return next(err);
    }
    return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi máy chủ nội bộ.' });
});

let summaryRefreshTimer = setInterval(() => {
    void refreshAllSummaries();
}, Math.max(BOT_POLL_MS, BOT_SUMMARY_CACHE_MS));

let server = null;
listenHttpServer(app, HTTP_PORT, MANAGER_PLATFORM, (serverInstance, activePort) => {
    server = serverInstance;
    HTTP_PORT = activePort;
    const adminPass = getAdminPassword();
    console.log('================================================================================');
    console.log(`  🚀 KINGMC MULTI-BOT MANAGER (COMMANDER V7) ĐÃ KHỞI CHẠY THÀNH CÔNG!`);
    console.log(`  🌐 WEB DASHBOARD: http://localhost:${activePort} (hoặc domain VPS / Hosting)`);
    console.log(`  📦 NỀN TẢNG: ${MANAGER_PLATFORM.toUpperCase()} | PORT WEB: ${activePort}`);
    console.log(`  🔑 ADMIN AUTH: ${adminPass ? 'Đã cấu hình & kích hoạt (scrypt protected)' : 'Chưa cấu hình'}`);
    console.log(`  🤖 SỐ LƯỢNG BOT QUẢN LÝ: ${BOT_CONFIG.length}`);
    console.log('================================================================================');
    console.log(`[REGISTRY] Sử dụng tệp: ${REGISTRY_FILE}`);
    console.log(`[CONFIG] Loaded ${BOT_CONFIG.length} bot(s).`);
    for (const bot of BOT_CONFIG) {
        console.log(`[CONFIG] ${bot.label} | ${bot.url || '(missing)'}`);
    }
    void refreshAllSummaries();
    void initSupabaseCloud();
});

async function initSupabaseCloud() {
    if (!supabaseAdapter || !supabaseAdapter.isEnabled()) {
        console.log('[SUPABASE] Chưa cấu hình Supabase Cloud. Hệ thống sử dụng lưu trữ tệp cục bộ.');
        return;
    }
    console.log('[SUPABASE] ☁️ Đang kiểm tra kết nối Supabase Cloud...');
    const ping = await supabaseAdapter.testConnection();
    if (!ping.ok) {
        console.warn(`[SUPABASE] ⚠️ Không thể kết nối Supabase (${ping.error}). Hệ thống tạm dùng cache tệp cục bộ.`);
        return;
    }
    console.log('[SUPABASE] ✅ Kết nối Supabase Cloud thành công! Đang đồng bộ và khôi phục dữ liệu...');

    try {
        // 1. Registry.
        const remoteReg = await supabaseAdapter.fetchRegistry();
        if (!LOCAL_REGISTRY_EXISTED_AT_BOOT && remoteReg && typeof remoteReg === 'object' && Object.keys(remoteReg).length > 0) {
            console.log('[SUPABASE] 📥 Khôi phục bot_registry từ Supabase Cloud (do registry cục bộ chưa tồn tại)...');
            if (remoteReg.adminPassword) registry.adminPassword = remoteReg.adminPassword;
            if (Array.isArray(remoteReg.dynamicBots)) registry.dynamicBots = remoteReg.dynamicBots;
            if (remoteReg.disabledEnvUrls) registry.disabledEnvUrls = remoteReg.disabledEnvUrls;
            if (remoteReg.disabledEnvIds) registry.disabledEnvIds = remoteReg.disabledEnvIds;
            if (remoteReg.overrides) registry.overrides = remoteReg.overrides;
            if (remoteReg.orderUrls) registry.orderUrls = remoteReg.orderUrls;
            if (remoteReg.order) registry.order = remoteReg.order;
            if (remoteReg.botIdMap) registry.botIdMap = remoteReg.botIdMap;
            if (remoteReg.botAliases) registry.botAliases = remoteReg.botAliases;
            if (remoteReg.systemSettings) registry.systemSettings = remoteReg.systemSettings;
            if (remoteReg.announcement) registry.announcement = remoteReg.announcement;
            if (remoteReg.webhook && typeof remoteReg.webhook === 'object') {
                const { _legacyMaskedSecrets, ...cloudWebhook } = remoteReg.webhook;
                registry.webhook = {
                    ...(registry.webhook || {}),
                    ...cloudWebhook,
                    // Old cloud records intentionally masked webhook secrets. Preserve
                    // any local value instead of replacing it with an unusable marker.
                    ...(_legacyMaskedSecrets ? {
                        discordUrl: registry.webhook?.discordUrl || '',
                        telegramToken: registry.webhook?.telegramToken || ''
                    } : {})
                };
            }
            if (remoteReg.lastBotId) registry.lastBotId = remoteReg.lastBotId;
            if (remoteReg.mustChangePassword !== undefined) registry.mustChangePassword = !!remoteReg.mustChangePassword;
            saveRegistry();
            BOT_CONFIG = buildManagerBotConfig();
        } else if (LOCAL_REGISTRY_EXISTED_AT_BOOT) {
            console.log('[SUPABASE] 📤 Registry cục bộ đã tồn tại tại boot, đồng bộ lên Supabase Cloud...');
            await supabaseAdapter.saveRegistry(registry);
        } else {
            console.log('[SUPABASE] 📤 Supabase Cloud chưa có registry, đồng bộ cấu hình hiện tại lên Cloud...');
            await supabaseAdapter.saveRegistry(registry);
        }

        // 2. Users.
        const remoteUsers = await supabaseAdapter.fetchUsers();
        if (LOCAL_USERS_EXISTED_AT_BOOT) {
            const localUsers = loadUsers(true);
            console.log(`[SUPABASE] 📤 File users cục bộ đã tồn tại tại boot (${localUsers.length} users). Đồng bộ lên Supabase Cloud...`);
            if (Array.isArray(remoteUsers)) {
                const localIds = new Set(localUsers.map(u => String(u.id || ('usr_' + u.username))));
                for (const ru of remoteUsers) {
                    const rId = String(ru.id || ('usr_' + ru.username));
                    if (!localIds.has(rId)) {
                        console.log(`[SUPABASE] 🗑️ Xóa user không còn tồn tại cục bộ khỏi Cloud: ${ru.username} (${rId})`);
                        await supabaseAdapter.deleteUser(rId);
                    }
                }
            }
            if (localUsers.length > 0) {
                await supabaseAdapter.syncAllUsers(localUsers);
            }
        } else if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
            console.log(`[SUPABASE] 📥 Khôi phục ${remoteUsers.length} users từ Supabase Cloud...`);
            saveUsers(remoteUsers);
        } else if (Array.isArray(remoteUsers)) {
            const localUsers = loadUsers(true);
            if (localUsers.length > 0) {
                console.log(`[SUPABASE] 📤 Khởi tạo ${localUsers.length} users cục bộ lên Supabase Cloud...`);
                await supabaseAdapter.syncAllUsers(localUsers);
            }
        }

        // 3. License keys.
        const remoteKeys = await supabaseAdapter.fetchKeys();
        if (LOCAL_KEYS_EXISTED_AT_BOOT) {
            const localKeys = loadKeysFile();
            console.log(`[SUPABASE] 📤 File keys cục bộ đã tồn tại tại boot (${localKeys.length} keys). Đồng bộ lên Supabase Cloud...`);
            if (Array.isArray(remoteKeys)) {
                const localCodes = new Set(localKeys.map(k => String(k.code || k.key || '').trim().toUpperCase()));
                for (const rk of remoteKeys) {
                    const code = String(rk.code || rk.key || '').trim().toUpperCase();
                    if (!localCodes.has(code)) {
                        console.log(`[SUPABASE] 🗑️ Xóa key không còn tồn tại cục bộ khỏi Cloud: ${code}`);
                        await supabaseAdapter.deleteKey(code);
                    }
                }
            }
            if (localKeys.length > 0) {
                await supabaseAdapter.syncAllKeys(localKeys);
            }
        } else if (Array.isArray(remoteKeys) && remoteKeys.length > 0) {
            console.log(`[SUPABASE] 📥 Khôi phục ${remoteKeys.length} license keys từ Supabase Cloud...`);
            saveKeysFile(remoteKeys);
        } else if (Array.isArray(remoteKeys)) {
            const localKeys = loadKeysFile();
            if (localKeys.length > 0) {
                console.log(`[SUPABASE] 📤 Khởi tạo ${localKeys.length} license keys cục bộ lên Supabase Cloud...`);
                await supabaseAdapter.syncAllKeys(localKeys);
            }
        }

        // 4. Sessions (Không tự động hồi sinh session đã hết hạn hoặc bị xóa/logout)
        if (LOCAL_SESSIONS_EXISTED_AT_BOOT) {
            const now = Date.now();
            const activeList = Array.from(activeSessions.values()).filter(s => s.expiresAt > now);
            if (activeList.length > 0) {
                await supabaseAdapter.syncAllSessions(activeSessions);
            }
        } else {
            console.log('[SUPABASE] 🔒 Không khôi phục phiên cũ từ Cloud khi khởi động mới để đảm bảo an toàn xác thực.');
        }

        console.log('[SUPABASE] 🌟 Hoàn tất đồng bộ toàn diện với Supabase Cloud!');
    } catch (err) {
        console.error('[SUPABASE] ❌ Lỗi trong quá trình khởi tạo dữ liệu Supabase:', err.message);
    }
}

function shutdownProcess(signal) {
    console.log(`[PROCESS] Nhận ${signal}, đang shutdown...`);
    if (summaryRefreshTimer) {
        clearInterval(summaryRefreshTimer);
        summaryRefreshTimer = null;
    }
    if (server) {
        server.close(() => {
            console.log('[PROCESS] HTTP server closed.');
            process.exit(0);
        });
        setTimeout(() => process.exit(0), 5000);
    } else {
        process.exit(0);
    }
}

process.on('SIGTERM', () => shutdownProcess('SIGTERM'));
process.on('SIGINT', () => shutdownProcess('SIGINT'));

process.on('uncaughtException', (err) => {
    console.error('[PROCESS] Uncaught Exception:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
    console.error('[PROCESS] Unhandled Rejection:', reason?.message || reason);
});

