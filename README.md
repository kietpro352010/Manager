# KingMC Worker Manager (`Manager`)

Control plane và hệ thống điều hành trung tâm cho KingMC AFK Workers, kết nối Discord Bot, Web Dashboard và Supabase Database.

---

## 1. Cấu trúc mã nguồn

Toàn bộ mã nguồn nằm hoàn toàn trong thư mục `src/`, tự đóng gói và không phụ thuộc file bên ngoài:

```text
src/
├── index.js                     # Entrypoint khởi động toàn bộ dịch vụ
├── config/                      # Nạp và kiểm tra biến môi trường, nhận diện nền tảng host
│   ├── env.js
│   └── host-runtime.js
├── discord/                     # Discord bot điều khiển
│   ├── command-registry.js      # Nạp và quản lý slash commands
│   ├── register-commands.js     # Đăng ký slash commands với Discord API
│   ├── commands/                # 6 lệnh: /admin, /bots, /help, /login, /logout, /logs
│   ├── handlers/                # Bộ xử lý tương tác buttons, modals, select menus
│   └── panels/                  # Render giao diện Discord embeds & buttons
├── http/                        # Web Server Express (REST API & Web Dashboard)
│   ├── app.js                   # Khởi tạo Express app, middleware bảo mật helmet/cors/rate-limit
│   ├── middleware/              # worker-auth.js (xác thực worker secret)
│   ├── routes/                  # admin-api, auth-api, user-api, worker-api
│   └── views/                   # login-html.js, dashboard-html.js (SPA giao diện hiện đại)
├── services/                    # Logic nghiệp vụ trung tâm
│   ├── access-control.js        # Phân quyền admin/user role
│   ├── admin-notifier.js        # Cảnh báo Discord khi bot chết / hết totem
│   ├── async-key-lock.js        # Khóa đồng bộ chống race condition
│   ├── command-broker.js        # Điều phối và xếp hàng lệnh điều khiển bot
│   ├── entitlement-service.js   # Quản lý thời hạn thuê bot và tự động dừng khi hết hạn
│   ├── fleet-operations.js      # Điều khiển hàng loạt worker
│   ├── link4m-service.js        # Tích hợp nhận thưởng vượt link Link4M
│   ├── manager-runtime-settings.js
│   ├── proxy-validation.js      # Kiểm tra và xác thực định dạng proxy SOCKS5
│   ├── render-api.js            # Tích hợp API quản lý dịch vụ Render
│   ├── wispbyte-keepalive.js    # Tự động duy trì đăng nhập panel Wispbyte
│   └── worker-registry.js       # Quản lý danh sách bot và trạng thái kết nối
├── storage/                     # Tương tác cơ sở dữ liệu Supabase
│   ├── schema-sql.js            # Khai báo schema chuẩn PostgreSQL
│   ├── supabase-client.js       # Adapter kết nối REST / RPC Supabase
│   ├── supabase-command-store.js# Lưu trữ hàng đợi lệnh durable
│   ├── supabase-dashboard-store.js
│   └── supabase-worker-store.js
└── utils/                       # Tiện ích bổ trợ
    ├── http.js
    ├── logger.js
    ├── secrets.js               # Mã hóa AES-256-GCM & băm mật khẩu Scrypt
    └── text-format.js
```

---

## 2. Cấu hình biến môi trường (Environment Variables)

Cấu hình các biến sau trong phần **Environment Variables** trên Render Dashboard:

### A. Biến bắt buộc (Required)

| Tên biến | Kiểu dữ liệu | Mô tả |
|---|---|---|
| `NODE_ENV` | Chuỗi | `production` |
| `DISCORD_TOKEN` | Chuỗi bí mật | Token Bot Discord từ Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Số nguyên | Application Client ID của Bot Discord (17–20 chữ số) |
| `DISCORD_GUILD_ID` | Số nguyên | ID Server Discord chính mà Bot phục vụ (17–20 chữ số) |
| `SUPABASE_URL` | HTTPS URL | Đường dẫn kết nối project Supabase (`https://<project>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Chuỗi bí mật | Supabase `service_role` secret key (bắt buộc quyền server-side) |
| `MANAGER_MASTER_KEY` | Chuỗi bí mật | Khóa mã hóa tĩnh AES-256-GCM (khuyên dùng chuỗi ngẫu nhiên 32+ ký tự để bảo vệ tài khoản Minecraft an toàn qua các lần đổi Supabase key) |

### B. Biến tùy chọn (Optional)

| Tên biến | Mặc định | Mô tả |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | Tên đăng nhập tài khoản Quản trị viên trên Web |
| `ADMIN_PASSWORD` | *(trống)* | Mật khẩu tài khoản Quản trị viên khởi tạo |
| `ADMIN_ROLE_ID` | *(trống)* | ID Role Discord của Quản trị viên (có thể cấu hình qua `/admin setup`) |
| `USER_ROLE_ID` | *(trống)* | ID Role Discord của Thành viên thuê bot (cấu hình qua `/admin setup`) |
| `ADMIN_DISCORD_USER_ID` | *(trống)* | ID tài khoản Discord của SuperAdmin |
| `WEB_SESSION_TTL_HOURS` | `24` | Thời gian hết hạn phiên đăng nhập Web (giờ) |
| `LINK4M_API_KEY` | *(trống)* | API Token tài khoản Link4M |
| `LINK4M_SECRET_KEY` | *(trống)* | Khóa bí mật webhook của Link4M |
| `LINK4M_REWARD_ENABLED` | `false` | Bật tính năng vượt link nhận thêm giờ thuê (`true` / `false`) |
| `LINK4M_REWARD_HOURS` | `12` | Số giờ cộng thêm mỗi lần vượt link thành công |
| `LINK4M_DAILY_LIMIT` | `2` | Số lần vượt link tối đa trong một ngày |
| `WISPBYTE_COOKIE` | *(trống)* | Cookie phiên đăng nhập Wispbyte để giữ session online |
| `WISPBYTE_PANEL_URL` | `https://wispbyte.com/client` | Đường dẫn panel Wispbyte |
| `TELEGRAM_BOT_TOKEN` | *(trống)* | Token bot Telegram nhận thông báo quản trị (tùy chọn) |
| `TELEGRAM_CHAT_ID` | *(trống)* | Chat ID nhận thông báo Telegram |

---

## 3. Hướng dẫn triển khai trên Render (Deploy Guide)

1. Đăng nhập vào [Render Dashboard](https://dashboard.render.com).
2. Nhấn **New +** -> chọn **Web Service**.
3. Chọn repository `kietpro352010/Manager`.
4. Cấu hình các thông số:
   - **Name**: `kingmc-worker-manager`
   - **Region**: `Singapore` (để tối ưu độ trễ với server game và người dùng VN)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm ci --omit=dev`
   - **Start Command**: `npm start`
5. Trong mục **Advanced**:
   - **Health Check Path**: `/health`
   - **Auto-Deploy**: `Yes`
6. Thêm đầy đủ các biến môi trường tại mục **Environment Variables** theo bảng trên.
7. Nhấn **Create Web Service**. Khi deploy hoàn tất, truy cập URL Render để kiểm tra Web Dashboard.

---

## 4. Hệ thống lệnh Discord Slash Commands

Sau khi bot khởi động, hệ thống tự động đồng bộ 6 lệnh slash:

- `/bots`: Mở bảng điều khiển tương tác trực tiếp danh sách bot của người dùng (Bật, Tắt, Khởi động lại, Xem trạng thái).
- `/admin`: Bảng điều khiển quản trị viên (`status`, `health`, `bots`, `setup` phân quyền role).
- `/login`: Đăng nhập liên kết tài khoản Discord với tài khoản Web Manager.
- `/logout`: Đăng xuất tài khoản khỏi thiết bị Discord.
- `/logs`: Xem trực tiếp 50 dòng log hoạt động gần nhất của từng bot.
- `/help`: Hướng dẫn sử dụng và trợ giúp toàn diện.
