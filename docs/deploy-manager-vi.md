# Triển khai Discord Manager

Tài liệu này mô tả cài đặt manager trên Render hoặc Wispbyte, cấu hình Supabase và quy trình nối worker. Manager là bot Discord kèm API HTTPS cho worker; không có dashboard web để người dùng đăng nhập.

## Trước khi deploy

### 1. Chuẩn bị Supabase

1. Tạo project Supabase.
2. Mở **SQL Editor**, chạy toàn bộ `supabase/setup.sql` trong thư mục manager.
3. Lấy Project URL và server-only secret/service-role key. Không đưa key này vào worker.
4. Tạo `MANAGER_ENCRYPTION_KEY` một lần và lưu ở nơi an toàn:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Không đổi khóa này sau khi đã lưu worker secret, proxy hoặc tài khoản Minecraft vào Supabase. Nếu mất khóa, manager không giải mã được dữ liệu đó.

Nếu đã có database từ bản manager trước, cập nhật schema trước khi cập nhật code. Nếu database được tạo bằng `setup.sql`, chạy các migration còn thiếu trong `supabase/migrations/` theo thứ tự tên, tới `20261111000000_worker_reset_data.sql`. Bản này cập nhật lệnh queue và bổ sung reset dữ liệu worker sau ACK.

### 2. Chuẩn bị Discord

1. Tạo Discord Application và Bot trong Developer Portal.
2. Lưu Bot Token và Application ID.
3. Lấy **Server ID** của đúng một Discord server; bật Developer Mode trong Discord rồi dùng Copy Server ID.
4. Tạo hai role Discord riêng (Admin, User). Role ID sẽ chọn trong `/setup` sau khi manager khởi động.
5. Mời app vào server đã chọn với scope `bot` và `applications.commands`. Bot chỉ cần Guilds intent; không bật Message Content hay privileged member intents.

**Cách nhận diện quyền:** `DISCORD_GUILD_ID` là khoá cứng duy nhất cho server. Manager chỉ đăng ký lệnh ở server này và runtime từ chối interaction ở guild khác. Lần đầu, chỉ server owner chạy `/setup admin_role:<role> user_role:<role>`; sau đó chỉ Admin role của manager được đổi cấu hình. Role IDs được lưu trong Supabase `manager_settings` và gắn với đúng `DISCORD_GUILD_ID`. User cần User role cùng grant/hạn/worker assignment hợp lệ trong Supabase. Không có role thì bị từ chối. Admin được ưu tiên nếu thành viên có cả hai role. Tài khoản user trong Supabase không thể tự nâng thành admin.

Khi khởi động, manager đăng ký slash command ở guild đã chọn và xóa bộ slash command global cũ của cùng Discord application. Runtime cũng chặn slash command, nút, menu và modal nếu interaction đến từ guild khác.

## Biến môi trường

| Biến | Bắt buộc | Giá trị |
|---|---|---|
| `DISCORD_TOKEN` | Có | Bot Token từ Developer Portal |
| `DISCORD_CLIENT_ID` | Có | Application ID |
| `DISCORD_GUILD_ID` | Có | Server ID duy nhất được phép dùng manager |
| `ADMIN_ROLE_ID` | Không | Chỉ dùng nhập một lần từ môi trường cũ; ưu tiên cấu hình qua `/setup` và Supabase |
| `USER_ROLE_ID` | Không | Chỉ dùng nhập một lần từ môi trường cũ; phải khác Admin role ID |
| `SUPABASE_URL` | Có | Project URL dạng `https://….supabase.co` |
| `SUPABASE_SECRET_KEY` | Có | Server-only secret key hoặc legacy service-role key |
| `MANAGER_ENCRYPTION_KEY` | Có | Base64 của đúng 32 byte ngẫu nhiên |
| `NODE_ENV` | Nên đặt | `production` |
| `HOST` | Không | Mặc định `0.0.0.0`; tự bind host container |
| `PORT`, `SERVER_PORT`, `P_SERVER_PORT`, `ALLOCATION_PORT` | Không | Manager dò host/cổng theo biến nền tảng; nhận thêm `--port` khi chạy thủ công |
| `PUBLIC_BASE_URL` | Không | Tự nhận `RENDER_EXTERNAL_URL`; nếu host không cấp HTTPS URL, lưu qua `/setup public_url:<https-url>` |
| `RENDER_API_KEY` | Không | Có thể nhập qua `/setup` → **Integration secrets**; mã hoá và lưu Supabase. Biến môi trường chỉ làm giá trị seed ban đầu |
| `RENDER_API_BASE_URL` | Tùy chọn | Mặc định `https://api.render.com/v1` |
| `LINK4M_API_KEY` | Không | Có thể nhập qua `/setup` → **Integration secrets**; mã hoá và lưu Supabase |
| `LINK4M_SECRET_KEY` | Không | Webhook secret; có thể nhập qua `/setup` → **Integration secrets**, mã hoá và lưu Supabase |
| `LINK4M_REWARD_ENABLED` | Tùy chọn | Mặc định `false` |
| `LINK4M_REWARD_HOURS` | Tùy chọn | Mặc định `12`, giới hạn 1–48 giờ |
| `LINK4M_DAILY_LIMIT` | Tùy chọn | Mặc định `2`, giới hạn 1–10 lượt mỗi ngày Việt Nam |
| `WORKER_POLL_WAIT_MS` | Tùy chọn | Mặc định `25000` ms; Wispbyte worker long-poll manager |
| `COMMAND_RESULT_TIMEOUT_MS` | Tùy chọn | Mặc định `35000` ms |
| `LOG_LEVEL` | Tùy chọn | Mặc định `info` |

Manager yêu cầu `DISCORD_GUILD_ID`; bỏ trống biến này khiến manager dừng ngay khi khởi động. `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `SUPABASE_URL`, server-only `SUPABASE_SECRET_KEY` và `MANAGER_ENCRYPTION_KEY` cũng phải có ngay lúc boot; chúng giữ ở host secret store. `PORT`/`HOST`, role IDs và integration settings không cần nhập thủ công. Không commit secrets.

## Deploy manager lên Render

1. Đưa thư mục manager lên Git repository riêng, hoặc chọn `manager` làm Root Directory nếu repository chứa nhiều dự án.
2. Trong Render chọn **New → Blueprint** và dùng [render.yaml](../render.yaml), hoặc tạo Web Service với:
   - Runtime: Node
   - Build: `npm ci --omit=dev`
   - Start: `npm start`
   - Health check: `/health`
3. Chọn plan luôn chạy cho manager. Không dùng free service cho bot cần sẵn sàng liên tục; Render free web service sẽ sleep sau 15 phút không có inbound traffic.
4. Điền các biến bắt buộc trong Environment: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, Supabase URL/secret và `MANAGER_ENCRYPTION_KEY`, rồi deploy. Không cần đặt `PORT`/`HOST`; Render cấp port.
5. Sau deploy, nhập Render API key hoặc Link4M keys từ Discord qua `/setup` → **Integration secrets**; không cần redeploy để cập nhật chúng.

## Deploy manager lên Wispbyte

1. Tạo một app server dùng Node.js 20 trở lên. Manager là một Discord bot; không chạy thêm Discord bot thứ hai trong cùng Wispbyte server trừ khi gói của bạn cho phép.
2. Upload mã nguồn manager (giữ `package.json`, `package-lock.json`, `src/`, `supabase/`; không upload `.env` hoặc `node_modules`).
3. Chạy `npm ci --omit=dev` một lần trong Console.
4. Đặt Startup Command là `npm start`.
5. Trong Startup variables, đặt các biến bắt buộc ở bảng trên. Manager tự nhận `SERVER_PORT`/`P_SERVER_PORT`/`ALLOCATION_PORT`; host mặc định bind `0.0.0.0`.
6. Cần URL HTTPS công khai để worker gọi `MANAGER_URL`. Nếu Wispbyte chỉ cấp IP:port HTTP cho server của bạn, worker sẽ từ chối URL đó; khi ấy đặt manager trên Render hoặc cấu hình một endpoint HTTPS hợp lệ trước khi nối worker.
7. Với free server Wispbyte, đăng nhập panel định kỳ theo chính sách hiện hành để server không bị dừng/archived.

## Kiểm tra sau deploy

1. Mở `https://<manager-host>/health`; phản hồi dự kiến có `ok: true`. Endpoint này chỉ xác nhận HTTP process trả lời, không tự chứng minh Discord và worker đều hoạt động.
2. Xem log manager có `discord_commands_registered` với scope `single-guild`, rồi `discord_bot_ready`.
3. Trong đúng Discord server, server owner chạy `/setup`, chọn hai role Admin/User và URL HTTPS công khai nếu host không tự nhận URL. Role IDs, URL và secrets được lưu vào Supabase; secrets tích hợp được mã hoá AES-256-GCM. Gán Admin role cho tài khoản quản trị, rồi dùng nút **Integration secrets** để đặt Render/Link4M keys. Sau đó thử `/ping`, `/system`, `/panel`.
4. Chạy `/worker add` một lần cho mỗi worker slot, cấu hình ID/secret tương ứng ở host worker, rồi kiểm tra `/worker list` và `/worker status`.
5. Mở `/bot`, chọn bot, nhập tài khoản Minecraft tại **Game account**, rồi bấm **Start**. Password được mã hóa trước khi lưu Supabase và chỉ worker tương ứng lấy được qua endpoint bootstrap đã xác thực bằng worker secret trên HTTPS.
6. Dùng `/user grant` để cấp worker và hạn cho User, hoặc tạo code rồi để thành viên có User role dùng `/code redeem`.

### Triệu chứng thường gặp

- **Manager dừng lúc boot:** kiểm tra Discord token/client/guild ID, Supabase URL/key, encryption key và đã chạy `supabase/setup.sql`.
- **Lệnh chưa hiện:** đợi đồng bộ Discord, kiểm tra guild ID đúng và log đăng ký command.
- **Wispbyte worker không reachable:** kiểm tra `MANAGER_URL` HTTPS, `WORKER_ID`, secret slot và worker có poll/heartbeat gần đây.
- **Không start được:** mở chi tiết bot xem account đã cấu hình chưa, worker reachable không, trạng thái hold/ban/maintenance và log event gần nhất.
- **Không đọc được secret đã lưu:** kiểm tra `MANAGER_ENCRYPTION_KEY` có giữ nguyên như lúc lưu không.

## Giới hạn cần biết

- Phản hồi slash command và panel dùng ephemeral; chỉ người tạo interaction thấy nội dung. Nút/modal kiểm tra lại quyền và assignment trước thao tác. Password và integration secrets không được gửi lại trong tin nhắn/log và được mã hoá khi lưu, nhưng Discord text input không che ký tự trong lúc gõ.
- Mỗi lần bấm nút, panel được render lại; nút Refresh đọc dữ liệu mới. Heartbeat/event nền không tự đẩy vào tin nhắn đang mở, vì vậy panel cũ có thể giữ dữ liệu cũ cho tới khi người dùng bấm Refresh hoặc thao tác tiếp.
- Worker status/chat/events và cấu hình lưu qua Supabase. Reset worker chỉ được ghi sau khi Render trả thành công hoặc worker Wispbyte ACK và queue ghi transaction.
- Discord role IDs được khoá vào `DISCORD_GUILD_ID` và lưu trong Supabase; chỉ manager Admin role có thể đổi setup sau lần khởi tạo của server owner. User vẫn cần grant còn hạn và worker assignment trong Supabase. Không có role nghĩa là không được dùng.
- Manager có thể quản lí worker Render và Wispbyte đồng thời. Worker tự nhận host: Render dùng HTTP control; Wispbyte dùng poll/heartbeat. `MANAGER_URL` và hai worker ID/secret mỗi host vẫn là đầu vào bắt buộc để worker biết manager nào xác thực nó.
- Worker host nhận diện marker Render/Wispbyte/Pterodactyl và port từ `SERVER_PORT`, `P_SERVER_PORT`, `ALLOCATION_PORT` hoặc `PORT`; transport được chọn tự động. Chỉ đặt `WORKER_TRANSPORT` thủ công nếu host không phát ra marker.
- Supabase `manager_settings` lưu role/guild binding, runtime public URL và cấu hình reward; Render/Link4M API secrets nằm trong cùng bảng dưới AES-GCM ciphertext. `MANAGER_ENCRYPTION_KEY` phải giữ nguyên ở host để giải mã.
- Worker tự dừng 04:30 và tiếp tục 05:30 theo `Asia/Ho_Chi_Minh` (UTC+7); khung giờ này khóa reconnect. Panel không tự cập nhật, chỉ tải dữ liệu mới khi mở hoặc có thao tác/nút refresh.
- CPU/RAM là của cả process host dùng chung cho tối đa 2 bot. Lưu lượng đo là byte socket Minecraft thực tế; lọc event/plugin sau parse giúp giảm xử lý/RAM nhưng không loại bỏ byte mạng đã nhận.
- Admin/user commands có thể vẫn hiện trong command picker của thành viên khác trong guild, nhưng manager kiểm tra quyền ở runtime và từ chối riêng tư; không dựa vào việc ẩn command để bảo mật.
