> [!WARNING]
> **[HISTORICAL SNAPSHOT — PRE-e3c94ec]**: Bản ghi lịch sử từ phiên làm việc trước (08/11–10/11/2026). KHÔNG phản ánh trạng thái hiện tại ở e3c94ec. Xem trạng thái mới nhất tại [\gent-notes/README.md\](../README.md).

# Tiến Độ Thực Hiện & Báo Cáo Full System Remediation (V11.8 Enterprise)

## Trạng thái phiên làm việc (Session Status)
- **Tình trạng:** TOÀN BỘ CÁC VẤN ĐỀ FULL SYSTEM REMEDIATION & P0/P1 BUGS ĐÃ HOÀN TẤT & ĐÃ PUSH PRODUCTION (100% PASS)
- **GitHub BotWorker:** `https://github.com/kietpro352010/BotWorker.git` -> Commit `c2f3eae` (main)
- **GitHub Manager:** `https://github.com/kietpro352010/Manager.git` -> Commit `4ec784b` (main)

---

## Danh mục triển khai: Full System Remediation & P0/P1 Bug Fixes

### 1. Free Trial Tự Động Cấp 1 Bot (Free Trial 1 Day Allocation)
- **Cấp phát nguyên tử (Atomic Allocation):** Đăng ký tài khoản mới tự động được cấp đúng 1 bot rảnh với gói `FREE TRIAL`, thời hạn 1 ngày (`expiresAt`), ghi nhận `is_trial = true`, `trial_bot_id`, và tạo bản ghi quyền sở hữu trong `manager_assignments` cùng `assigned_bot_ids`.
- **An toàn giao dịch:** Bổ sung hàm RPC `manager_register_trial_user` dùng `FOR UPDATE OF w SKIP LOCKED`.
- **Xử lý hết bot rảnh:** Khi toàn bộ bot đã có chủ, hệ thống trả về HTTP 503 với thông điệp: `"Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử. Vui lòng liên hệ Quản trị viên hoặc thử lại sau."` mà không tạo tài khoản rác hay cấp phát dở dang.

### 2. Sửa Chữa Toàn Diện Link4M (Link4M Complete Repair & Contract)
- **Đồng bộ giao diện Interface:** Bổ sung đầy đủ các method canonical và alias: `status` / `getDailyQuotaStatus`, `startAttempt` / `createLinkAttempt`, `verifyAndClaimReward` / `completeReturn`.
- **Hỗ trợ Query Params linh hoạt:** Xử lý cả `token` lẫn `attemptId`, kiểm tra `tokenHash` chuẩn SHA-256.
- **Quy tắc gia hạn chuẩn xác:**
  - Tài khoản đang hoạt động (`active`): Gia hạn nối tiếp từ `expiresAt` hiện tại (+4 giờ).
  - Tài khoản đã hết hạn (`expired`): Gia hạn tính từ thời điểm hiện tại (`now`) và khôi phục trạng thái về `active`.
  - Tài khoản vĩnh viễn (`isPermanent`): Từ chối vượt link vì không cần thiết.
  - Tài khoản bị khóa (`disabled`): Từ chối nhận thưởng.
  - Bảo lưu 100% danh sách bot đã gán (`workerIds` / `assignedBotIds`).

### 3. Sửa Chữa Toàn Diện Hệ Thống Mã Key / Giftcode (Redeem & Hash Lookup)
- **Đồng nhất cơ chế Hash:** Tra cứu mã key qua trường `code_hash` (chuẩn SHA-256) và fallback `code`/`key_code`/`id` trong cả bảng `manager_keys` lẫn hàm RPC `manager_redeem_code_with_access`.
- **Bảo toàn giao dịch nguyên tử:** Loại bỏ fallback non-atomic `redeemKeyAtomic` gây hao hụt lượt dùng khi thất bại.
- **Giới hạn số lượt dùng:** Kiểm tra `used_count < max_uses` và `used_users` trước khi kích hoạt.
- **Bảo lưu danh sách Bot:** Khi gia hạn, giữ nguyên toàn bộ bot người dùng đang sở hữu, không bị xóa hay ghi đè.

### 4. Vòng Đời Hết Hạn & Tự Động Dừng Bot (Expiration & Graceful Stop State Machine)
- **State Machine 3 bước:** `active → expiring → expired`.
- **Cơ chế Retry khi dừng bot thất bại:** Khi lệnh STOP bot gặp sự cố mạng hoặc worker tạm thời ngắt kết nối, người dùng được giữ ở trạng thái `expiring` với danh sách bot chưa dừng trong `stopPendingWorkers`. Hệ thống tiếp tục retry dừng bot ở các chu kỳ quét sau với exponential backoff.
- **Giữ nguyên quyền sở hữu:** Bot vẫn thuộc về tài khoản người dùng khi hết hạn, cho phép khi người dùng nạp key gia hạn thì bot được khôi phục ngay lập tức mà không bị mất cấu hình hay phân phối cho người khác.

### 5. Liên Kết Tài Khoản Discord ↔ Web Manager
- **Bảng chuyên dụng `manager_discord_links`:** Khóa ràng buộc 1:1 duy nhất `UNIQUE(manager_user_id)` và `UNIQUE(discord_user_id)`.
- **Giao diện Web Dashboard:** Thẻ hiển thị trạng thái liên kết Discord (Discord ID, ngày liên kết) và nút "Hủy liên kết" trực tiếp trên Web.
- **API chuyên dụng:** Endpoint `GET /api/user/discord-link` và `POST /api/user/discord-unlink`.

### 6. Độ Ổn Định Worker & Mutex Vòng Đời (Worker Concurrency & Reliability)
- **Mutex vòng đời (Lifecycle Mutex):** Ngăn chặn các lệnh xung đột (`start`, `stop`, `restart`, `reconnect`, `reset`) chạy đồng thời trên cùng một Worker.
- **Command Timeout Watchdog:** Timeout 15s cho lifecycle actions và 10s cho các lệnh khác qua `Promise.race`, tự động giải phóng hàng đợi trong khối `finally`.
- **Giới hạn số lần Reconnect:** Giới hạn tối đa 25 lần kết nối lại kèm exponential backoff và jitter. Hủy bỏ hẹn giờ reconnect khi có lệnh STOP, RESET hoặc khi tài khoản hết hạn.

### 7. Đồng Bộ Lệnh Reset / Restart Giữa Render và Wispbyte (Transport Parity)
- Cả hai giao thức HTTP Transport (Render) và Polling Transport (Wispbyte) khi hoàn tất lệnh `reset` đều gọi `registry.resetData(workerId)` để xóa mật khẩu ingame và làm sạch hàng đợi trong cơ sở dữ liệu.

---

## Bằng chứng kiểm thử tự động (Execution Evidence)

| Test Suite | Command | Kết quả | Chi tiết |
|---|---|---|---|
| **Manager Integration Tests** | `npm.cmd --prefix "D:\manager" test` | **PASS (15/15)** | 15 Actions, Secret AES-256-GCM, AsyncKeyLock, Atomic Numbering Sequence, Transaction Advisory Lock Coalescing, Readiness 503/200, 6 Discord Commands, Full Bot ID & Panel Rendering, Cross-tenant Data Isolation, Discord Account Linking, Free Trial Atomic Allocation, Link4M Repair & Contracts, Giftcode Hash Lookup, Expiration State Machine (active->expiring->expired), Reset Parity Across Transports. |
| **Worker Integration Tests** | `npm.cmd --prefix "D:\worker" test` | **PASS (6/6)** | 15 Actions parity, WorkerRuntime execution dispatch, SOCKS5 parsing & private network protection, Timing-safe secret authentication, WorkerRuntime Lifecycle Concurrency Mutex, MinecraftSession Bounded Reconnect & Cancel on Stop/Reset. |
| **Dual-Engine Synchronization** | `node test_dual_engine_sync.js` | **PASS (3/3)** | Write-through cache invalidation, Discord stale worker auto-recovery re-render, Cross-engine concurrency lock serialization. |
| **Exhaustive Real-World Pentest** | `node test_exhaustive_real_world.js` | **PASS (100%)** | Chống CSRF/SSRF/Path Traversal/Brute-force, Phân quyền Admin/User, Free Trial Register, Start-All, Broadcast, Totem switch (<50ms), Packet filtering. |
| **Deploy Startup Simulation** | `node test_startup_render_wispbyte.js` | **PASS (4/4)** | Manager on Render (Port 10000), Manager on Wispbyte (Port 25577), Worker on Render (Port 10001), Worker on Wispbyte (Port 25588 + Manager Base URL). |
| **Codebase Syntax Lint** | `node run_all_checks.js` | **PASS (100%)** | Source Manager (43 files), Source Worker (21 files), Deploy Manager (43 files), Deploy Worker (21 files). |

---

## Lịch sử Commit Git
- **BotWorker:** `c2f3eae` (`fix(worker): command timeout watchdog, lifecycle concurrency mutex, and bounded reconnects`)
- **Manager:** `4ec784b` (`fix(manager): atomic free trial allocation, link4m contract repair, giftcode hash lookup, expiration state machine, and discord account linking`)
