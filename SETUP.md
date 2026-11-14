# Cài đặt Discord Manager

## Trình tự ngắn

1. Tạo Supabase project và chạy `supabase/setup.sql` một lần trong SQL Editor. Nếu database đã tồn tại, chạy mọi migration còn thiếu theo thứ tự tên tới `20261111000000_worker_reset_data.sql`.
2. Tạo Discord Application/Bot. Chuẩn bị Token, Application ID, Server ID và tạo hai role Discord: Admin và User. Chỉ Server ID phải pin ở host; role IDs sẽ chọn trong `/setup`.
3. Tạo `MANAGER_ENCRYPTION_KEY` bằng lệnh trong [hướng dẫn deploy](docs/deploy-manager-vi.md); giữ nguyên khóa này qua các lần deploy.
4. Deploy `D:\manager` lên Render theo `render.yaml` hoặc upload lên Wispbyte với Node.js 20+.
5. Điền `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `MANAGER_ENCRYPTION_KEY`. Không cần nhập `HOST`/`PORT`; manager tự nhận diện cổng Render/Wispbyte.
6. Đợi log `discord_commands_registered` và `discord_bot_ready`; kiểm tra `/health`. Server owner chạy `/setup`, chọn role Admin/User và URL HTTPS công khai nếu Wispbyte không tự cung cấp URL.
7. Gán Admin role cho tài khoản quản trị. Từ phản hồi riêng tư của `/setup`, dùng nút **Integration secrets** để nhập Render/Link4M keys nếu cần; manager mã hoá rồi lưu trong Supabase. Dùng `/worker add` để đăng ký mỗi worker slot; nhập ID và secret tương ứng vào host worker.
8. Mở `/bot`, chọn worker, bấm **Game account** để lưu username/password riêng tư, rồi **Start**.
9. Gán User bằng `/user grant` hoặc tạo code bằng `/codecreate` cho thành viên có Discord User role tự redeem.

`DISCORD_GUILD_ID` khóa manager vào đúng một server, không thể thay từ Discord. Role Admin/User được lưu trong Supabase `manager_settings`; interaction ở server khác và member không có role đều bị từ chối. User cần thêm grant còn hạn và worker assignment trong Supabase. Admin role có toàn quyền trong guild được cấu hình. Lệnh, panel và phản hồi đều ephemeral. Server owner khởi tạo role; sau đó chỉ manager Admin đổi setup.

Xem [hướng dẫn deploy và kiểm tra manager](docs/deploy-manager-vi.md) để biết từng bước Render/Wispbyte và [danh sách lệnh/panel](docs/discord-commands-vi.md) để xem tham số cùng quyền chi tiết.

> **Lưu ý bảo mật:** Discord modal không che ký tự password/API key khi nhập; manager không đưa giá trị này vào log/audit, mã hoá trong Supabase và worker nhận credential qua HTTPS đã xác thực.
