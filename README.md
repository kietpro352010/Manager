# KingMC Worker Manager (`Manager`)

Control plane và hệ thống điều hành trung tâm cho KingMC AFK Workers, kết nối Discord Bot, Web Dashboard và Supabase Database.

---

## 1. Cấu hình biến môi trường trên Render (Tối Giản — Chỉ 3 biến)

Hệ thống được thiết kế tối ưu để bạn **chỉ cần nhập đúng 3 biến duy nhất** trên Render Dashboard:

| Tên biến | Bắt buộc | Mô tả |
|---|---|---|
| `DISCORD_TOKEN` | **Có** | Token Bot Discord từ [Discord Developer Portal](https://discord.com/developers/applications) |
| `SUPABASE_URL` | **Có** | HTTPS URL kết nối project Supabase (`https://<project-id>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | **Có** | `service_role` secret key của Supabase (dùng kết nối quản trị backend) |

> 💡 **Tất cả các cài đặt khác được cấu hình trực tiếp qua Discord & Web Dashboard (KHÔNG cần thêm vào Render)**:
> - **`DISCORD_CLIENT_ID`**: Hệ thống tự động trích xuất từ `DISCORD_TOKEN`.
> - **`DISCORD_GUILD_ID` & Phân quyền Role**: Thiết lập trực tiếp trên Discord qua lệnh `/admin setup`.
> - **Mật khẩu Quản trị viên (`admin`)**: Tự động đặt ở lần đầu đăng nhập trên Web Dashboard, hoặc đặt/đổi bất kỳ lúc nào qua lệnh `/admin password <mật_khẩu>` trên Discord.
> - **Khóa mã hóa (`MANAGER_MASTER_KEY`)**: Tự động dẫn xuất an toàn từ `SUPABASE_SECRET_KEY`.
> - **Vượt link Link4M (`LINK4M_*`)**: Bật/tắt và cấu hình API Token trực tiếp trong popup **⚡ Cài đặt Link4M** trên Web Dashboard.
> - **Tài khoản Wispbyte (`WISPBYTE_*`)**: Quản lý và lưu trữ trực tiếp trong Cài đặt hệ thống trên Web Dashboard.

---

## 2. Hướng dẫn triển khai trên Render (3 bước)

1. Đăng nhập [Render Dashboard](https://dashboard.render.com) -> chọn **New +** -> **Web Service**.
2. Kết nối với repository `kietpro352010/Manager`:
   - **Name**: `kingmc-worker-manager`
   - **Region**: `Singapore`
   - **Runtime**: `Node`
   - **Build Command**: `npm ci --omit=dev`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
3. Thêm 3 biến môi trường ở Bảng 1 vào mục **Environment Variables** rồi nhấn **Deploy**.

---

## 3. Thiết lập hệ thống sau khi Deploy (Qua Discord & Web)

### Bước A: Phân quyền quản trị trên Discord (1 phút)
Trong Discord Server của bạn, gõ lệnh:
```text
/admin setup admin_role:@RoleAdmin user_role:@RoleUser
```
Hệ thống sẽ tự động lưu ID Server, kích hoạt phân quyền và đồng bộ ngay lập tức các lệnh slash commands.

### Bước B: Đặt mật khẩu Quản trị viên Web
Bạn có 2 cách cực kỳ tiện lợi:
- **Cách 1 (Ngay trên Discord)**: Gõ `/admin password new_password:MatKhauCuaBan123`.
- **Cách 2 (Trên Web Dashboard)**: Truy cập URL Render của bạn, đăng nhập tài khoản `admin` với mật khẩu bạn muốn khởi tạo (hệ thống sẽ tự động lưu mật khẩu này cho các lần sau).

---

## 4. Hệ thống lệnh Discord Slash Commands

- `/bots`: Mở bảng điều khiển tương tác trực tiếp danh sách bot (Bật, Tắt, Khởi động lại, Xem trạng thái).
- `/admin`: Bảng điều khiển quản trị viên (`status`, `health`, `bots`, `setup`, `password`).
- `/login`: Đăng nhập liên kết tài khoản Discord với Web Manager.
- `/logout`: Hủy liên kết tài khoản khỏi thiết bị Discord.
- `/logs`: Xem trực tiếp 50 dòng log hoạt động gần nhất của từng bot.
- `/help`: Hướng dẫn sử dụng và trợ giúp toàn diện.
