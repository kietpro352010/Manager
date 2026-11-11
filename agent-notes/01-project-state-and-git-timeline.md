# 01 — Trạng thái dự án hiện tại & Lịch sử Git gần nhất

> Tài liệu này mô tả đúng trạng thái code đang nằm tại `D:/manager deploy` (branch `main`, commit `e3c94ec`), **không dựa trên các file tài liệu cũ ở máy local**.

---

## 1. Kiến trúc thực tế của `Manager` hiện tại

### 1.1 Runtime & Startup Flow ([`src/index.js`](../src/index.js))
Khi khởi chạy (`npm start` -> `node src/index.js`):
1. `loadConfig()` ([`src/config/env.js`](../src/config/env.js)): Kiểm tra biến môi trường bắt buộc (`DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `SUPABASE_URL`, key/encryption key...).
2. Khởi tạo 3 store Supabase ([`src/storage/`](../src/storage)):
   - `SupabaseWorkerStore` (`manager_workers`, `bot_registry`, `bot_settings`)
   - `SupabaseDashboardStore` (`manager_users`, `manager_assignments`, `manager_keys`, `audit_logs`, `manager_settings`, `manager_link4m_attempts`, `manager_outbox_queue`, `manager_pending_allocations`, `manager_backups`, với fallback đọc `manager_access` / `manager_audit`)
   - `SupabaseCommandStore` (`manager_commands`)
3. Chạy `commandStore.initialize()` và kiểm tra `commandStore.health()`:
   - Tự probe danh sách `REQUIRED_STATE_SYNC_RPCS` (6 RPC).
   - Nếu thiếu RPC, hệ thống đánh dấu degraded (`ATOMIC_STATE_SYNC_RPC_REQUIRED`) và gọi `logger.error('command_reset_atomic_rpc_missing', ...)` — đây chính là nguồn phát cảnh báo sang Discord Admin Notifier lúc khởi động.
4. Khởi tạo dịch vụ nghiệp vụ:
   - `ManagerRuntimeSettings`, `AccessControl`, `RenderApi`, `WorkerRegistry`, `CommandBroker`, `FleetOperations`, `EntitlementService`, `Link4mService`, `WispbyteKeepAliveManager`.
5. Vòng lặp nền:
   - `broker.startOutboxProcessor({ intervalMs: 5000 })` (xử lý outbox và thu hồi/đồng bộ các lệnh `state_sync_pending` / `execution_completed`).
   - `expiredCheckInterval` (`60000ms`): kiểm tra user hết hạn và dừng bot an toàn (`checkExpiredUsersAndGracefulStop`).
   - `memorySweepInterval` (`30000ms`): giám sát RSS/heap và gọi `registry.pruneStaleMemory()`.
6. HTTP Server ([`src/http/app.js`](../src/http/app.js)): Phục vụ đồng thời **Web Dashboard SPA** và **REST API**.
7. Discord Bot (`discord.js`): Chỉ đăng ký slash command theo phạm vi **single-guild** (`DISCORD_GUILD_ID`), đồng thời xóa global command cũ (`src/discord/register-commands.js`).

### 1.2 Giao diện người dùng & Endpoint chính

#### A. Discord Slash Commands (`src/discord/commands/`)
Kiểm tra trực tiếp bằng module loader xác nhận hiện chỉ có **6 slash commands**:
- `/admin` (`admin.js`): Bảng điều khiển và quản trị hệ thống Enterprise (`status`, `health`, `bots`, `setup`)
- `/bots` (`bots.js`): Mở bảng điều khiển danh sách bot của tài khoản
- `/help` (`help.js`): Xem hướng dẫn sử dụng Discord Dashboard & liên kết Web Manager
- `/login` (`login.js`): Đăng nhập tài khoản Web Manager để liên kết và điều khiển bot
- `/logout` (`logout.js`): Đăng xuất và hủy liên kết tài khoản Discord với Web Manager
- `/logs` (`logs.js`): Xem nhật ký hoạt động gần nhất của bot (`bot`)

#### B. Web Dashboard & HTTP API (`src/http/`)
- **Views SPA**: [`login-html.js`](../src/http/views/login-html.js), [`dashboard-html.js`](../src/http/views/dashboard-html.js).
- **Health / Readiness**:
  - `GET /health`
  - `GET /ready` & `GET /api/ready` (kiểm tra kết nối Supabase, Discord client, `link4m`, và trạng thái `commandSyncRpc` -> trả `503` khi `commandStore.health().degraded` là `true`).
- **API Routes**:
  - `/api/auth` (`auth-api.js`)
  - `/api/manager` (`admin-api.js`) — có `POST /api/manager/bot/:id/reset-customer` và xử lý pending resets
  - `/api/user` (`user-api.js`) — có `POST /api/user/bot/:id/:action` (cho phép `['start', 'stop', 'restart', 'reconnect', 'respawn', 'inventory', 'look', 'toss', 'status', 'reset']`)
  - `/api/v1/workers/:workerId` & `/api/worker` (`worker-api.js`) — long-polling `/poll` và `/result` cho Wispbyte/Worker

### 1.3 Danh sách 15 Unified Actions ([`src/services/worker-registry.js`](../src/services/worker-registry.js))
`start`, `stop`, `restart`, `status`, `chat`, `reset`, `set-afk-mode`, `set-proxy`, `reconnect`, `respawn`, `inventory`, `look`, `toss`, `window_click`, `window_close`.

---

## 2. Lịch sử Git gần đây trên nhánh `main` (`git log`)

| Commit | Ngày (UTC+7) | Nội dung chính | File trọng tâm |
|---|---|---|---|
| `69ebf23` | Trước 10/11 | Gate readiness probe theo Discord client, atomic bot numbering sequence, selective command coalescing, integration tests | HTTP readiness, registry, broker |
| `8dcfc0e` | Trước 10/11 | Sửa atomic worker numbering, advisory lock RPC command coalescing, AsyncKeyLock fallback | Registry, broker, storage |
| `4224cda` | Trước 10/11 | Tái cấu trúc Discord bot thành panel theo dõi gọn nhẹ, dashboard từng bot, liên kết tài khoản | `src/discord/*` |
| `4ec784b` | 10/11/2026 22:17 | Free Trial allocation nguyên tử, sửa contract Link4M, giftcode `code_hash`, expiration state machine (`active -> expiring -> expired`), Discord link 1:1 | `auth-api.js`, `user-api.js`, `entitlement-service.js`, `link4m-service.js`, `schema-sql.js`, `supabase-dashboard-store.js`, `tests/integration.test.js` |
| `b506e43` | 11/11/2026 13:59 | Sửa Link4M wiring, SQL/store schema parity, stop confirmation, worker/discord contracts, thêm `.github/workflows/ci.yml`, `tests/services-wiring.test.js`, `tests/storage-sql.test.js` | `.github/workflows/ci.yml`, `src/discord/*`, `src/services/*`, `tests/*` |
| `6b9cd90` | 11/11/2026 14:17 | Yêu cầu xác nhận stop rõ ràng, surface lỗi init Link4M, lan truyền lỗi reset sync | `app.js`, `command-broker.js`, `link4m-service.js`, `entitlement-service.js` |
| `2cd0a09` | 11/11/2026 16:45 | Tách lệnh polling `reset` thành 2 pha `execution_completed` và `state_sync_pending` có thể retry | `command-broker.js`, `supabase-command-store.js`, `worker-api.js`, `schema-sql.js` |
| `a5421ef` | 11/11/2026 21:49 | Gia cố lease & fencing token cho RESET sync, bật fail-closed RPC khi thiếu atomic RPC, thêm bộ 6 `supabase/migrations/*.sql` và `supabase/setup.sql` | `command-broker.js`, `supabase-command-store.js`, `app.js`, `index.js`, `supabase/*`, `tests/*` |
| `4c184b8` | 11/11/2026 22:10 | Thêm script tổng hợp `supabase/reset_and_setup.sql` (Part 1 dọn sạch + Part 2 schema đầy đủ từ `schema-sql.js`) và kiểm tra cấu trúc trong `tests/storage-sql.test.js` | `supabase/reset_and_setup.sql`, `tests/storage-sql.test.js` |
| `e3c94ec` | 11/11/2026 23:06 | Đồng nhất `command_id` & `p_command_id` kiểu `text` (`cmd_<UUID>`) xuyên suốt `migrations/`, `setup.sql`, `reset_and_setup.sql`, `schema-sql.js`, kèm Test 6 xác thực contract | `schema-sql.js`, `supabase/migrations/20261108*`, `20261111000000*`, `20261111120000*`, `setup.sql`, `reset_and_setup.sql`, `tests/storage-sql.test.js` |
