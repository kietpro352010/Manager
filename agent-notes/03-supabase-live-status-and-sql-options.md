# 03 — Đối chiếu Supabase thực tế & Các nguồn SQL trong Repo

---

## 1. Phát hiện kiến trúc SQL: Vì sao repo có 2 nhóm file SQL khác nhau?

Kiểm tra trực tiếp bằng công cụ phân tích AST/regex trên repo tại commit `e3c94ec` cho thấy sự bất đối xứng rất quan trọng giữa hai bộ SQL trong repo:

| Nguồn SQL trong Repo | Số bảng `CREATE TABLE` | Số hàm `CREATE OR REPLACE FUNCTION` | Kiểu `command_id` | Ghi chú |
|---|---:|---:|---|---|
| [`src/storage/schema-sql.js`](../src/storage/schema-sql.js) | **26 bảng** | **50 hàm** | `text` | Chứa đầy đủ schema Web Dashboard + Bot Registry + Chat/Event/Position logs + Sessions + Link4M + Trial + Two-Phase Command Sync. |
| [`supabase/reset_and_setup.sql`](../supabase/reset_and_setup.sql) | **26 bảng** | **50 hàm** | `text` | Phần 2 khớp **100%** tên bảng & danh sách 50 hàm của `schema-sql.js`. Phần 1 chạy **`DROP ... CASCADE`** để xóa sạch bảng/view/sequence/hàm cũ thuộc `manager_*` / `bot_*`. |
| [`supabase/setup.sql`](../supabase/setup.sql) + [`supabase/migrations/`](../supabase/migrations) (6 file) | **10 bảng** | **21 hàm duy nhất** *(23 định nghĩa do 3 hàm được nâng cấp ở `20261111120000`)* | `text` *(đã sửa từ `uuid` ở `e3c94ec`)* | Schema tối giản cho luồng migration; **thiếu 21 bảng** mà `schema-sql.js` và `SupabaseDashboardStore` / `SupabaseWorkerStore` sử dụng! |
| `SUPABASE_REQUIRED_TABLES` trong [`src/storage/supabase-client.js`](../src/storage/supabase-client.js) | **23 bảng** bắt buộc | — | — | Toàn bộ 23 bảng đều nằm trong `schema-sql.js` (26 bảng); 3 bảng còn lại trong `schema-sql.js` không có trong list check là `manager_assignments`, `manager_discord_links`, `manager_settings`. |

### Chi tiết bảng có trong `schema-sql.js` (26) nhưng THIẾU trong `supabase/setup.sql` (10)
21 bảng sau có trong `schema-sql.js` / `reset_and_setup.sql` nhưng **không hề tồn tại trong `supabase/setup.sql` hay `supabase/migrations/`**:
- `manager_users`, `manager_assignments`, `manager_discord_links`, `manager_migration_entitlement_undo`, `bot_registry`, `manager_sessions`, `bot_settings`, `audit_logs`, `bot_chat_logs`, `bot_event_logs`, `bot_position_state`, `bot_position_logs`, `manager_backups`, `manager_locks`, `manager_key_usage_transactions`, `bot_log_clear_cutoffs`, `manager_user_state`, `manager_users_write_transactions`, `manager_session_revocations`, `manager_outbox_queue`, `manager_pending_allocations`.

Ngược lại, `supabase/setup.sql` có 5 bảng cũ (`manager_schema_migrations`, `manager_counters`, `manager_access`, `manager_worker_assignments`, `manager_audit`) và 2 hàm (`manager_consume_key`, `manager_release_consumed_key`) không nằm trong `schema-sql.js` (lưu ý `SupabaseDashboardStore` vẫn có fallback đọc `manager_access` / `manager_audit` và `admin-api.js` dòng 279 có xóa `manager_audit` khi admin xóa log).

---

## 2. Trạng thái thực tế của Supabase Production lúc điều tra sự cố

Kiểm tra read-only trên Supabase production trước khi đẩy `reset_and_setup.sql` / `e3c94ec` cho thấy:
1. Supabase REST endpoint phản hồi `openapiStatus: 200`, nhưng DB live lúc đó mới chỉ có **10 bảng kiểu cũ** và **14 RPC**.
2. Cột `manager_commands.command_id` trên live DB lúc kiểm tra đang có kiểu **`format: "uuid"`** (và bảng có 0 dòng).
3. Kiểm tra `testConnection()` trong `supabase-client.js` trả về **`ok: false`** do thiếu 19 bảng so với danh sách `SUPABASE_REQUIRED_TABLES` (23 bảng).
4. Kiểm tra `commandStore.health()` trả về **`degraded: true`** với mã `ATOMIC_STATE_SYNC_RPC_REQUIRED` vì thiếu cả 6 two-phase RESET RPC:
   - `manager_record_command_execution`
   - `manager_renew_command_sync_lease`
   - `manager_verify_command_sync_lease`
   - `manager_mark_command_sync_pending`
   - `manager_finalize_command_sync`
   - `manager_claim_pending_command_syncs`

> [!IMPORTANT]
> Trong phiên làm việc tính tới `e3c94ec`, **chưa có bất kỳ câu lệnh SQL nào được thực thi lên Supabase production** (toàn bộ thao tác vừa qua chỉ dừng ở đọc chẩn đoán read-only và cập nhật mã nguồn/SQL file trong Git).

---

## 3. Các phương án xử lý Supabase để ChatGPT & Người dùng chọn

### Phương án 1 — Dựng sạch từ đầu bằng `supabase/reset_and_setup.sql` (Phá hủy dữ liệu cũ!)
- **Khi nào chọn**: Môi trường mới, staging, hoặc DB production hiện chỉ chứa bảng test/rác/lệch schema và bạn **chấp nhận xóa sạch toàn bộ dữ liệu hiện có** trong các bảng `manager_*`, `bot_*`, `audit_logs`, `backups`, `system_settings`.
- **Cách thực hiện**:
  1. Nếu cần giữ dữ liệu nào (users/keys/workers), **export/backup trước khi chạy**!
  2. Tạm dừng service `Manager` trên Render (hoặc bật maintenance) để tránh traffic ghi dở dang trong lúc schema đang reset.
  3. Mở **Supabase SQL Editor** -> copy toàn bộ [`supabase/reset_and_setup.sql`](../supabase/reset_and_setup.sql) -> Run.
  4. Khởi động lại `Manager` -> kiểm tra `GET /ready` & `GET /api/ready` phải trả HTTP `200`, `commandStore.health().degraded === false`, và `testConnection().ok === true`.

### Phương án 2 — Nâng cấp tại chỗ (Non-destructive) nếu muốn bảo toàn dữ liệu hiện có
- **Khi nào chọn**: Production đã có dữ liệu thật trong `manager_users`, `manager_keys`, `manager_workers`... không được phép xóa.
- **Cách thực hiện (cẩn trọng)**:
  1. Backup snapshot database trên Supabase Dashboard trước.
  2. Chạy phần DDL tương thích/bổ sung từ `schema-sql.js` (**KHÔNG** copy Phần 1 `DROP ... CASCADE` của `reset_and_setup.sql`).
  3. Chạy [`supabase/migrations/20261111120000_command_two_phase_sync.sql`](../supabase/migrations/20261111120000_command_two_phase_sync.sql) (file này có `DO $$ ... ALTER COLUMN command_id TYPE text` và `DROP FUNCTION IF EXISTS ...(uuid, ...)` nên nâng cấp `manager_commands` và 6+3 RPC sang `text` an toàn).
  4. Kiểm tra lại `manager_commands` nếu trước đó bị lỗi dữ liệu hoặc chạy `NOTIFY pgrst, 'reload schema';`.
  5. Kiểm tra `/ready` và `testConnection()` xem còn thiếu bảng legacy nào (`manager_audit`, `manager_access`...) nếu code vẫn đụng tới chúng.

### Phương án 3 — Nếu quyết định bỏ hoàn toàn `reset` action (Decision A2)
Nếu người dùng và ChatGPT quyết định xóa action `reset` qua Worker/CommandBroker:
- Vẫn cần quyết định xử lý các bảng đang thiếu trên live DB (19/23 bảng `SUPABASE_REQUIRED_TABLES` còn thiếu!), tức là vấn đề **đồng bộ 26 bảng của `schema-sql.js` lên Supabase live** vẫn tồn tại độc lập với việc có giữ two-phase `reset` hay không!
- Nếu giữ lại `POST /api/manager/bot/:id/reset-customer` (nút bàn giao khách cho Admin trên Web Dashboard), vẫn nên kiểm tra kỹ xem việc bàn giao bot đang `online` có cần tự gửi `stop` xuống Worker trước khi `registry.resetData(workerId)` hay không.
