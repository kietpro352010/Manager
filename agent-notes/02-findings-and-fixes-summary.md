# 02 — Tổng hợp các lỗi đã phát hiện, đã sửa & các entrypoint `reset`

---

## 1. Bảng theo dõi các phát hiện P1/P2 liên quan đến `RESET` & RPC (tính tới `e3c94ec`)

| Mã / Vấn đề | Mức độ | Nguyên nhân gốc rễ trước khi sửa | Trạng thái tại `e3c94ec` | Tham chiếu mã nguồn |
|---|---|---|---|---|
| **Hết hạn lease khi sync RESET đang chạy** | **P1** | Trước `a5421ef`, `reportResult()` chỉ giữ lease 15s cố định. Nếu `registry.resetData()`, `commandStore.clearWorker()`, `registry.updateStatus()` chậm hơn 15s, background retry có thể claim lại và hai Manager instance cùng đồng bộ 1 lệnh RESET. | **Đã sửa trong code JS + SQL** | - Lease tự tính theo cấu hình (mặc định tối thiểu 45s hoặc `2 * commandResultTimeoutMs`) qua `getStateSyncLeaseConfig()` trong `src/services/command-broker.js`.<br>- Heartbeat gia hạn định kỳ mỗi `min(leaseMs / 3, 20000)` ms qua `renewStateSyncLease()` -> RPC `manager_renew_command_sync_lease`.<br>- Monotonic fencing token `state_sync_fencing_token` được kiểm tra trước từng bước (`ALL_RESET_SYNC_STEPS`) và bên trong `manager_finalize_command_sync` / `manager_mark_command_sync_pending`. |
| **Fallback non-atomic khi thiếu Postgres RPC** | **P2** | Khi thiếu RPC, `claimPendingStateSyncBatch()` có thể rơi về đọc-rồi-cập-nhật từng dòng (không phải `FOR UPDATE SKIP LOCKED`), gây nguy cơ 2 Manager instance claim trùng bản ghi. | **Đã sửa sang fail-closed** | - `src/storage/supabase-command-store.js`: định nghĩa `REQUIRED_STATE_SYNC_RPCS` (6 RPC). Khi RPC unavailable (`PGRST202` / `42883`...), ném lỗi `ATOMIC_STATE_SYNC_RPC_REQUIRED` (trừ khi test/explicit flag tắt fail-closed) và dừng vòng retry.<br>- `src/index.js` + `src/http/app.js`: phát log `command_reset_atomic_rpc_missing` và trả `503` tại `/ready` & `/api/ready`. |
| **Lỗi không đồng nhất kiểu `command_id` (`cmd_<UUID>` vs `uuid`)** | **P1** | App sinh `commandId = 'cmd_' + crypto.randomUUID()` (chuỗi `text`). `schema-sql.js` và `reset_and_setup.sql` khai báo `text`, nhưng `supabase/setup.sql` và migration `20261111120000_command_two_phase_sync.sql` lại khai báo `manager_commands.command_id` / `p_command_id` là `uuid`. PostgREST không ép kiểu `cmd_<UUID>` sang `uuid` -> toàn bộ luồng two-phase RESET sync sẽ crash trên DB tạo từ migration/setup! | **Đã sửa toàn diện tại `e3c94ec`** | - Chuyển toàn bộ `command_id` và `p_command_id` về `text` trong `20261108`, `20261111000000`, `20261111120000`, `setup.sql`, `reset_and_setup.sql`, `schema-sql.js`.<br>- Thêm `DROP FUNCTION IF EXISTS ...(uuid, ...)` trước khi `CREATE OR REPLACE FUNCTION ...(text, ...)` để tránh overload ambiguity.<br>- Thêm block `DO $$ ... ALTER COLUMN command_id TYPE text USING command_id::text` an toàn cho DB có sẵn.<br>- Test 6 trong `tests/storage-sql.test.js` kiểm tra từng signature RPC nhận `p_command_id text` và chạy thử tham số `cmd_<UUID>`. |
| **Migration & 6 RPC mới chưa có trên Supabase live** | **P2 / Ops** | SQL đã có trong repo nhưng **chưa chạy lên Supabase production**. Live DB phản hồi thiếu 6 RPC (`PGRST202` với `manager_claim_pending_command_syncs`), thiếu 19 bảng so với `SUPABASE_REQUIRED_TABLES`, và `manager_commands.command_id` đang ở dạng `uuid`. | **CHƯA ĐƯỢC ÁP DỤNG LÊN LIVE DB** | Cần quyết định giữ hay bỏ `reset` và chọn phương án chạy SQL (mục Decision A & B ở [`agent-notes/README.md`](README.md)). |

---

## 2. Bản đồ chính xác mọi vị trí liên quan đến `reset` trong repo

Vì người dùng đang cân nhắc *"bỏ chức năng reset data worker từ Discord"*, ChatGPT cần biết chính xác `reset` đang nằm ở đâu trong code thực tế:

1. **Discord (`src/discord/`)**:
   - Đã kiểm tra toàn bộ `src/discord/commands/*.js` và `src/discord/panels/renderer.js`:
   - **Không có slash command hay nút Discord Panel nào cho user bấm `reset` data worker.**
   - Các slash command hiện có chỉ gồm `/admin`, `/bots`, `/help`, `/login`, `/logout`, `/logs`.
   - Tuy nhiên, nếu dùng `CommandBroker` hoặc Web API gây thiếu 6 RPC, cảnh báo `command_reset_atomic_rpc_missing` vẫn được `AdminNotifier` bắn về **kênh Discord cảnh báo của Admin** lúc Manager khởi động (`src/index.js:68-74`).

2. **Web User HTTP API (`src/http/routes/user-api.js:634`)**:
   ```js
   const allowedActions = ['start', 'stop', 'restart', 'reconnect', 'respawn', 'inventory', 'look', 'toss', 'status', 'reset'];
   ```
   - `POST /api/user/bot/:id/reset` cho phép user đã đăng nhập gọi `broker.dispatch(workerId, 'reset', ...)`.
   - Đây chính là entrypoint kích hoạt lệnh `'reset'` đi xuống Worker và chạy cơ chế đồng bộ 2 pha (`execution_completed` -> `state_sync_pending`) trong `CommandBroker` (`src/services/command-broker.js`).

3. **Web Admin Handover Reset (`src/http/routes/admin-api.js:247-263` & `src/http/views/dashboard-html.js:4980, 11427`)**:
   - Nút trên giao diện Web Admin: `🧹 Reset Bàn Giao Khách Mới` (`resetCustomerBot()`).
   - Gọi `POST /api/manager/bot/:id/reset-customer` -> gọi `registry.resetData(worker.workerId)` và ghi audit `ADMIN_RESET_BOT_CUSTOMER`.
   - Ngoài ra trên Web Admin có nút `🧹 Dọn dẹp Reset Treo` (`resolveAllPendingResets()` gọi `/api/manager/pending-resets/all/resolve` tại `dashboard-html.js:13670`).

4. **Core Services & Storage**:
   - `src/services/worker-registry.js`: `ACTIONS.RESET = 'reset'` và `registry.resetData(workerId)` -> gọi `store.resetData(workerId)`.
   - `src/services/command-broker.js`: `ALL_RESET_SYNC_STEPS = ['registry.resetData', 'commandStore.clearWorker', 'registry.updateStatus']`, cùng vòng lặp lease extension, fencing token và retry `processPendingStateSyncs()`.
   - `src/storage/supabase-command-store.js`: `REQUIRED_STATE_SYNC_RPCS` (6 RPC) và kiểm tra khởi động `initialize()`.
