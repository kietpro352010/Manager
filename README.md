# KingMC Worker Manager (`Manager`)

Control plane và hệ thống quản trị trung tâm cho KingMC AFK Workers.

---

## Cấu trúc mã nguồn

| Thành phần | Đường dẫn | Mô tả |
|---|---|---|
| Entrypoint & Runtime | [`src/index.js`](src/index.js) | Khởi động Storage, Runtime Settings, Discord Bot, CommandBroker, Entitlement/Link4M, Memory Sweeper, HTTP Server |
| Cấu hình & Host | [`src/config/`](src/config) | [`env.js`](src/config/env.js), [`host-runtime.js`](src/config/host-runtime.js) (validate `SUPABASE_URL`, keys, `DISCORD_*`, Render/Wispbyte port) |
| Discord Bot UI | [`src/discord/`](src/discord) | 6 slash commands (`/admin`, `/bots`, `/help`, `/login`, `/logout`, `/logs`), panel renderer & interaction handlers |
| Web Dashboard & REST API | [`src/http/`](src/http) | Express app ([`app.js`](src/http/app.js)), `/health`, `/ready`, `/api/auth`, `/api/manager`, `/api/user`, `/api/v1/workers`, SPA views |
| Domain Services | [`src/services/`](src/services) | `CommandBroker`, `WorkerRegistry`, `FleetOperations`, `EntitlementService`, `Link4mService`, `AccessControl`, `ManagerRuntimeSettings` |
| Storage & Schema | [`src/storage/`](src/storage) | [`schema-sql.js`](src/storage/schema-sql.js), [`supabase-client.js`](src/storage/supabase-client.js), worker/dashboard/command stores |
| Utilities | [`src/utils/`](src/utils) | `http.js`, `logger.js`, `secrets.js` (AES-256-GCM, Scrypt), `text-format.js` |

---

## Biến môi trường (Environment Variables)

Cấu hình trên Render Dashboard (Environment Variables):

| Tên biến | Bắt buộc | Mô tả |
|---|---|---|
| `NODE_ENV` | Có | `production` |
| `DISCORD_TOKEN` | Có | Bot token Discord |
| `DISCORD_CLIENT_ID` | Có | Application Client ID của bot Discord |
| `DISCORD_GUILD_ID` | Có | Server ID máy chủ Discord |
| `SUPABASE_URL` | Có | HTTPS URL của project Supabase |
| `SUPABASE_SECRET_KEY` | Có | Service Role Key của Supabase |
| `MANAGER_ENCRYPTION_KEY` | Có | Khóa mã hóa AES-256-GCM (32 bytes hex) |
| `RENDER_API_BASE_URL` | Không | `https://api.render.com/v1` (tùy chọn) |
| `LINK4M_REWARD_ENABLED` | Không | Bật/tắt vượt link Link4M (`false` / `true`) |

---

## Triển khai trên Render

1. Tạo mới **Web Service** trên Render Dashboard kết nối với repository này.
2. Thiết lập thông số:
   - **Runtime**: `Node`
   - **Build Command**: `npm ci --omit=dev`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
3. Thêm các biến môi trường như bảng trên.
