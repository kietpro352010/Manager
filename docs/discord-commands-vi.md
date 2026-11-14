# Lệnh và panel Discord Manager

Manager chỉ đăng ký lệnh cho `DISCORD_GUILD_ID`. Mọi lệnh, phản hồi và panel đều riêng tư (ephemeral). Nút, menu và modal kiểm tra lại role và quyền với worker trước khi xử lý.

## Nhận diện quyền

- **Admin:** thành viên có role ID đã lưu trong Supabase `manager_settings` và đúng server `DISCORD_GUILD_ID`. Admin được xem mọi worker và dùng lệnh quản trị.
- **User:** thành viên có User role đã lưu trong Supabase, đồng thời có grant đang hiệu lực và được gán worker đó.
- **Không có role:** không dùng được bất cứ lệnh/panel nào, kể cả redeem code.
- Nếu có cả hai role, role Admin được ưu tiên. Role Discord xác định loại quyền; Supabase lưu trạng thái/expiry/worker assignment cho User.
- Lệnh chỉ có trong server cấu hình và runtime cũng từ chối interaction ở server khác.

## Dashboard và worker

| Lệnh | Tham số | Hành động |
|---|---|---|
| `/bot` | Không bắt buộc `number` | Bảng gọn các worker được gán cho User hoặc toàn bộ worker cho Admin; từng dòng có trạng thái, ping, TPS, CPU/RAM host, uptime và reconnect count. Menu mở chi tiết tối đa 25 worker đầu; worker còn lại mở bằng số. |
| `/bot number:<n>` | Số hiển thị của worker | Mở panel riêng của worker. User không được gán worker sẽ nhận cùng thông báo từ chối chung, không nhận thông tin worker. |
| `/panel` | Không | Mở tổng quan; trang Workers. Admin có thêm Members, Activity và thao tác quản lý fleet. |
| `/ping` | Không | Ping Discord, thời gian phản hồi lệnh, thời gian đọc Supabase, uptime manager và ping trung bình các worker người gọi được xem. |
| `/system` | Không | Tình trạng manager, độ trễ đọc Supabase và uptime. |
| `/setup admin_role:<role> user_role:<role> [public_url:<https-url>]` | URL công khai tùy chọn | Server owner khởi tạo lần đầu; sau đó chỉ Admin manager đổi role/URL trong guild đã khoá bởi `DISCORD_GUILD_ID`. Trả lời riêng tư. Nút Integration secrets (chỉ Admin role) mở modal nhập API keys; secrets được mã hoá rồi lưu Supabase. |
| `/worker list` | Không | Liệt kê worker được phép xem. |
| `/worker status id:<id>` | Worker ID | Đọc trạng thái, ping, TPS, uptime, reconnects, CPU/RAM tiến trình host và băng thông socket Minecraft. |
| `/worker start id:<id>` | Worker ID | Start. Nếu chưa có tài khoản, mở `/bot` → chọn worker → Game account để lưu username/password. |
| `/worker stop id:<id>` | Worker ID | Dừng worker. |
| `/worker restart id:<id>` | Worker ID | Khởi động lại worker, trừ khi đang bị server restriction hold. |
| `/worker resume id:<id>` | Worker ID | Gỡ hold sau khi admin/user đã kiểm tra lý do ban/IP limit hoặc restriction. |
| `/worker chat id:<id> message:<text>` | ID, tối đa 256 ký tự | Gửi chat. Lệnh đăng nhập/đăng ký/đổi mật khẩu bị chặn. Chat người chơi và worker nằm chung với event trong 5 dòng gần nhất của panel. |

## Lệnh admin quản lý worker

| Lệnh | Tham số | Hành động |
|---|---|---|
| `/worker add id:<id> name:<name> provider:<render/wispbyte> url:<https-url> render_service_id:<id>` | URL hoặc service ID bắt buộc với Render; Wispbyte dùng worker poll | Tạo worker, cấp số bot ổn định và sinh secret một lần. Đưa secret vào slot tương ứng của host. |
| `/worker remove id:<id> confirm:true` | ID và xác nhận | Thử dừng worker, hủy lệnh chờ, xóa đăng ký và assignment. Không gỡ process khỏi host. |
| `/worker rotate-secret id:<id>` | Worker ID | Thay secret; secret cũ hết hiệu lực. Cập nhật biến `WORKER_SECRET_1` hoặc `_2` ở host. |
| `/worker reset id:<id> confirm:true` | ID và xác nhận | Dừng bot rồi xóa credential Minecraft ở Supabase và worker, event history, reconnect counters. AFK/proxy settings, worker ID và secret vẫn còn. |
| `/worker stop-all confirm:true` | Xác nhận | Gửi Stop tuần tự đến mọi worker đã đăng ký. Không có Run All hay Restart All. |
| `/worker reconnect-errors confirm:true` | Xác nhận | Restart worker đang reachable, trạng thái `error`, không có restriction hold. Worker offline hoặc bị hold được bỏ qua. |
| `/worker clean-dead confirm:true` | Xác nhận | Xóa đăng ký Render chỉ khi Render API trả HTTP 404. Wispbyte và lỗi mạng/401/timeout được giữ lại. Cần Render API key đã cấu hình qua Discord hoặc seed env. |
| `/render services` | Không | Liệt kê Render services (admin). |
| `/render status service_id:<id>` | Render service ID | Đọc tình trạng service. |
| `/render deploy service_id:<id>` | Render service ID | Trigger deploy Render. |

Mọi thao tác admin đều được ghi vào `manager_audit`. Các thao tác fleet cũng trả số worker thành công, đang chờ và lỗi. Stop All/reconnect errors/clean dead đều cần xác nhận thêm bằng nút trong panel.

## User, mã và Link4M

| Lệnh | Tham số | Hành động |
|---|---|---|
| `/user list` | Không | Admin xem các grant, hạn và worker assignment. |
| `/user show discord_id:<id>` | Discord User ID | Xem grant/assignment cụ thể. |
| `/user grant discord_id:<id> workers:<id1,id2> days:<1–36500> permanent:<true/false> plan:<label>` | `workers` tùy chọn; days mặc định 30; permanent tùy chọn | Tạo/cập nhật grant và assignment. Người đó vẫn cần có Discord User role. |
| `/user disable discord_id:<id>` / `/user enable discord_id:<id>` | User ID | Tạm khóa/mở lại grant. |
| `/user remove discord_id:<id>` | User ID | Xóa grant và các assignment. |
| `/codecreate days:<n> permanent:<bool> bots:<0–25> workers:<id1,id2> uses:<1–1000> plan:<label> expires_at:<ISO>` | Tất cả tùy chọn; mặc định 30 ngày, 1 lượt và tự gán 1 worker nếu không chọn | Tạo key. `workers` chỉ dùng được 1 lần; nếu không, có thể chọn số slot tự gán. Key hiện một lần trong phản hồi riêng tư. |
| `/codelist limit:<1–25>` | Mặc định 15 | Admin xem ID, hạn, số lượt và trạng thái; không hiện raw key. |
| `/codedelete id:<key-id>` | ID từ codelist | Xóa key. |
| `/code redeem value:<key>` | Key | User nhận thời hạn và worker theo key. Supabase cập nhật key/grant trong cùng transaction. |
| `/code status` | Không | Xem access, assignment và quota Link4M của chính người gọi. |
| `/code link4m` | Không | Tạo hoặc lấy lại link Link4M nếu đã bật. |
| `/link4m status` | Không | Xem cấu hình công khai/quota cá nhân. |
| `/link4m configure enabled:<bool> hours:<1–48> daily_limit:<1–10>` | Admin; giờ/ngày giữ giá trị cũ nếu bỏ trống | Bật/tắt reward và chỉnh quota. Secret provider ở biến môi trường. |

## Panel và trạng thái worker

- Panel chi tiết có **Start, Stop, Restart, Resume, Refresh status**, AFK mode, Proxy, Game account, Workers và Chat. Admin có thêm Reset data, Rotate secret, Remove.
- Username/password nhập qua modal riêng tư, mã hóa AES-256-GCM trước khi lưu Supabase. Worker chỉ lấy credential của chính slot qua HTTPS đã xác thực.
- Proxy SOCKS5 được mã hóa và đồng bộ giữa Supabase/worker. AFK mode hỗ trợ `still`, `look`, `sneak`.
- Hiển thị TPS ước tính từ tick của worker, ping, uptime, reconnects, CPU/RAM tiến trình host và byte/giây trên socket Minecraft. CPU/RAM là mức của cả tiến trình dùng chung, vì mỗi host chạy tối đa 2 bot.
- Panel snapshot chỉ lấy dữ liệu lúc mở hoặc khi bấm nút/đổi trang/thực hiện thao tác. Không có auto-refresh. Event và chat mới nhất hiển thị tối đa 5 dòng.
- `/setup` chọn Discord Admin/User roles; `DISCORD_GUILD_ID` vẫn là khoá cứng ở host để ngăn server khác nhận quyền. Các role/settings runtime nằm trong Supabase `manager_settings`.
- Không hiển thị IP host hay IP/hostname Minecraft; không có GUI, inventory/container/hotbar, auto-chat hoặc lịch tùy chỉnh. Worker tự dừng 04:30 và tự nối lại 05:30 giờ Việt Nam (`Asia/Ho_Chi_Minh`, UTC+7); không reconnect trong khung đó.
- Packet filter loại một số Mineflayer event/plugin sau khi packet đã nhận và parse. Nó giảm xử lý/tải world nhưng không thể chặn toàn bộ byte mạng; các gói giao thức cần cho kết nối vẫn được xử lý.
