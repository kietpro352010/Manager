# Agent Notes — Bối cảnh & Câu hỏi ra quyết định (Dành cho Người dùng & ChatGPT)

> [!NOTE]
> Toàn bộ thư mục `agent-notes/` là **Phần 2 (Ghi chú kỹ thuật & bối cảnh quyết định)**, tách biệt hoàn toàn khỏi mã nguồn thực thi ở Phần 1 (`src/`, `supabase/`, `tests/`). Mọi sự kiện, tên file, tên hàm, tên bảng và kết quả test trong đây được đối chiếu từ mã nguồn và đầu ra công cụ thực tế tính tới ngay sau commit `e3c94ec`.

---

## 1. Bức tranh ngắn gọn trong 60 giây

1. **Nguyên nhân sự cố ban đầu**: Hệ thống cảnh báo trên Discord báo lỗi `command_reset_atomic_rpc_missing` lúc `Manager` khởi động (`src/index.js`), do `SupabaseCommandStore.initialize()` kiểm tra 6 Postgres RPC phục vụ cơ chế đồng bộ 2 pha cho lệnh `reset` nhưng **Supabase production lúc kiểm tra chưa có 6 RPC này** (cũng thiếu nhiều bảng khác so với `schema-sql.js`).
2. **Những gì code đã sửa xong và đang nằm trên nhánh `main` (tính tới `e3c94ec`)**:
   - Đã tách quy trình `reset` polling thành 2 pha (`execution_completed` -> `state_sync_pending` -> `completed` / `state_sync_failed`).
   - Đã gia cố lease với fencing token (`acquire/renew/verify`), tự động gia hạn lease định kỳ khi tác vụ sync kéo dài vượt thời hạn lease, kiểm tra fencing token trước từng bước (`registry.resetData`, `commandStore.clearWorker`, `registry.updateStatus`) và trước khi finalize.
   - Đã bật **fail-closed**: không cho phép fallback non-atomic đa instance; khi thiếu 1 trong 6 RPC sẽ báo `ATOMIC_STATE_SYNC_RPC_REQUIRED` ở log, `/ready` (`503`), `/api/ready`, và `/health`.
   - Đã đồng nhất kiểu dữ liệu `command_id` và tham số `p_command_id` thành `text` (tương thích ID dạng `cmd_<UUID>`) xuyên suốt `schema-sql.js`, tất cả file `supabase/migrations/`, `supabase/setup.sql`, `supabase/reset_and_setup.sql`, và bổ sung Test 6 trong `tests/storage-sql.test.js`.
3. **Những gì CHƯA được làm trên thực tế**:
   - **Chưa chạy SQL mới lên Supabase production** (Supabase live lúc kiểm tra vẫn đang ở schema cũ tối thiểu 10 bảng, `manager_commands.command_id` kiểu `uuid`, thiếu 6 RPC đồng bộ 2 pha và thiếu 19 bảng so với `SUPABASE_REQUIRED_TABLES`).
   - **Chưa chạy kiểm thử SQL/PLpgSQL trên PostgreSQL thật** (máy Windows dev không có `psql`, `postgres` hay `docker`, nên mới kiểm tra logic JS bằng mock adapter).
   - **Chưa cắt bỏ hoặc thay đổi các entrypoint `reset` hiện tại**, đang chờ quyết định cuối cùng của người dùng & ChatGPT.

---

## 2. 3 Quyết định đang mở cần ChatGPT & Người dùng chốt

### Quyết định A — Có nên giữ hay bỏ tính năng `reset` Worker?
Cần phân biệt **2 luồng `reset` khác nhau trong code** (chi tiết ở [`02-findings-and-fixes-summary.md`](02-findings-and-fixes-summary.md)):
1. **Discord (`/bots`, `/admin`, `/logs`, `/login`, `/logout`, `/help`)**: Hiện tại trên Discord **không có nút hay slash command nào để user tự reset data worker**. Cảnh báo `command_reset_atomic_rpc_missing` xuất hiện là do `Manager` tự kiểm tra RPC đồng bộ lúc boot (và do cơ chế `reset` ở Web User API).
2. **Web User API (`POST /api/user/bot/:id/reset`)**: Cho phép user gửi `action = 'reset'` qua `CommandBroker` xuống Worker — đây là luồng tạo ra nhu cầu two-phase `execution_completed` / `state_sync_pending` & 6 RPC nói trên.
3. **Web Admin Handover (`POST /api/manager/bot/:id/reset-customer` + nút `🧹 Reset Bàn Giao Khách Mới` trên Dashboard)**: API dành riêng cho Admin đặt lại dữ liệu bot trong Manager (`registry.resetData(worker.workerId)`).

**Câu hỏi cần chốt**:
- **Lựa chọn A1**: Giữ cả `reset` qua `CommandBroker` (sử dụng đầy đủ two-phase sync + 6 RPC đã gia cố ở `e3c94ec`).
- **Lựa chọn A2**: Bỏ `reset` khỏi User API (`POST /api/user/bot/:id/reset` và action `reset` qua Worker/Discord), chỉ giữ lại `POST /api/manager/bot/:id/reset-customer` phía Admin Web Dashboard (lưu ý xem Admin handover có cần dừng bot + xóa data worker đồng bộ hay không).

### Quyết định B — Nâng cấp Supabase production theo cách nào?
Hiện trong repo có **2 bộ schema SQL khác biệt lớn** (xem phân tích chi tiết ở [`03-supabase-live-status-and-sql-options.md`](03-supabase-live-status-and-sql-options.md)):
- **`supabase/setup.sql` + `supabase/migrations/`**: Chỉ định nghĩa **10 bảng** (schema tối giản kiểu mới/migration) và **21 hàm duy nhất** (`manager_next_bot_number`, `manager_commands`, ...). Trong khi code runtime (`SUPABASE_REQUIRED_TABLES`, `SupabaseDashboardStore`, `SupabaseWorkerStore`) thực tế đọc/ghi tới **23–26 bảng** (`manager_users`, `manager_sessions`, `bot_settings`, `audit_logs`, `bot_chat_logs`, `bot_event_logs`, v.v.).
- **`src/storage/schema-sql.js` và `supabase/reset_and_setup.sql`**: Định nghĩa đầy đủ toàn bộ **26 bảng** và **50 hàm RPC/trigger**. Đặc biệt Phần 1 của `supabase/reset_and_setup.sql` thực hiện **`DROP TABLE / VIEW / SEQUENCE / FUNCTION ... CASCADE` toàn bộ các bảng `manager_*` / `bot_*` trong `public`** trước khi tạo lại.

**Câu hỏi cần chốt**:
- **Lựa chọn B1 (Chấp nhận xóa trắng dữ liệu để đồng bộ sạch 100%)**: Backup thủ công (nếu cần), chạy [`supabase/reset_and_setup.sql`](../supabase/reset_and_setup.sql) trong Supabase SQL Editor -> toàn bộ 26 bảng & 50 RPC (gồm cả `command_id text` và 6 two-phase RPC) đồng bộ 100% với code runtime.
- **Lựa chọn B2 (Nâng cấp không xóa dữ liệu — Non-destructive)**: Chạy phần `CREATE ... IF NOT EXISTS` / `ALTER ...` của `schema-sql.js` + `20261111120000_command_two_phase_sync.sql` (cần chú ý bảng `manager_commands` nếu đang có dữ liệu cũ kiểu `uuid` chuyển sang `text`), KHÔNG chạy Phần 1 `DROP CASCADE` của `reset_and_setup.sql`.
- **Lựa chọn B3 (Hợp nhất nguồn sự thật SQL trong repo)**: Quyết định xem `supabase/migrations/` có cần được cập nhật để phản ánh đủ 26 bảng thay vì bị lệch với `schema-sql.js` như hiện nay hay không.

### Quyết định C — Triển khai test PostgreSQL thật trong CI/CD
- **Lựa chọn C1**: Giữ CI hiện tại (Node.js mock test + syntax check) và chỉ test thủ công trên Supabase staging/production.
- **Lựa chọn C2**: Thêm job PostgreSQL container (`postgres` service trong `.github/workflows/ci.yml`) chạy trực tiếp `reset_and_setup.sql` + `migrations/` + kiểm thử concurrency/PLpgSQL thật trước mỗi lần merge vào `main`.

---

## 3. Thứ tự đọc khuyến nghị cho ChatGPT

1. Đọc file này (`agent-notes/README.md`) để nắm 3 quyết định cần trả lời.
2. Đọc [`03-supabase-live-status-and-sql-options.md`](03-supabase-live-status-and-sql-options.md) để thấy ngay điểm bất đồng bộ SQL giữa `setup.sql` (10 bảng) và `schema-sql.js` / `reset_and_setup.sql` (26 bảng).
3. Đọc [`02-findings-and-fixes-summary.md`](02-findings-and-fixes-summary.md) để đánh giá chất lượng cơ chế lease/fencing/two-phase RESET hiện có và các entrypoint `reset`.
4. Đọc [`04-test-verification-and-gaps.md`](04-test-verification-and-gaps.md) để biết những gì đã được chứng minh bằng test và những gì mới chỉ là mock.
5. Nếu cần đối chiếu lịch sử xa hơn trước `e3c94ec`, xem [`legacy-session-artifacts/README.md`](legacy-session-artifacts/README.md).
