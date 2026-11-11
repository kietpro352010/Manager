# 04 — Bằng chứng kiểm thử đã chạy & Các khoảng trống chưa kiểm chứng

---

## 1. Các kiểm thử đã chạy và PASS sau lần sửa code cuối (`e3c94ec`)

Lưu ý môi trường thực thi: Trên Windows host hiện tại **chặn `npm.ps1` bởi PowerShell ExecutionPolicy**, nên lệnh chuẩn được chạy qua `cmd /c "npm test"` tại `D:\manager` (nơi chứa `node_modules/`), trong khi toàn bộ file nguồn/SQL/test giữa `D:\manager deploy` và `D:\manager` đã được xác minh giống nhau byte-by-byte (SHA-256).

| Bộ kiểm thử | Lệnh chạy | Kết quả gần nhất | Phạm vi bao phủ |
|---|---|---|---|
| **Syntax check toàn bộ JS** | `node --check` trên mọi file `.js` ở `src/`, `tests/`, `scripts/` | **PASS** | Không có lỗi cú pháp JavaScript ở bất kỳ file nào. |
| **Integration Tests** | `node tests/integration.test.js` | **15/15 PASS** | Actions parity (15 actions), AES-256-GCM secret, `AsyncKeyLock`, atomic numbering, command coalescing, readiness `503/200`, 6 Discord commands, isolation giữa tenant, Discord linking 1:1, Free Trial atomic allocation, Link4M, giftcode `code_hash`, expiration state machine (`active -> expiring -> expired`), reset transport parity. |
| **Services Wiring & CommandBroker Tests** | `node tests/services-wiring.test.js` | **13/13 PASS** | Link4M init & error surfacing, stop confirmation & cancellation guard, two-phase RESET splitting (`execution_completed -> state_sync_pending`), lease expiry + heartbeat renewal khi sync chậm hơn thời hạn lease, fencing token preemption giữa 2 broker cạnh tranh, fail-closed `ATOMIC_STATE_SYNC_RPC_REQUIRED` & `command_reset_atomic_rpc_missing`, HTTP `/health` & `/ready`. |
| **Storage SQL Contract Tests** | `node tests/storage-sql.test.js` | **6/6 PASS** | Kiểm tra định nghĩa RPC trong `schema-sql.js`, parity với `supabase-dashboard-store.js`, `supabase-command-store.js`, 6 migration files, `supabase/setup.sql`, `supabase/reset_and_setup.sql`, và **Test 6** xác thực chữ ký `p_command_id text` & giá trị `cmd_<UUID>` truyền qua cả 5 RPC + `manager_commands` + `manager_claim_pending_command_syncs`. |

> Tham khảo CI: Workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) chạy `node --check` + 3 file test trên trên Node 20 mỗi khi push/PR lên `main`.

---

## 2. Ranh giới Mock & Khoảng trống kiểm chứng thực tế (Rất quan trọng khi ra quyết định)

Người dùng và ChatGPT cần lưu ý trung thực các giới hạn dưới đây — **không được suy diễn rằng test PASS đồng nghĩa SQL chạy trơn tru 100% trên Postgres thật**:

1. **Test chạy bằng Supabase Mock Adapter, KHÔNG phải PostgreSQL thật**:
   - Trên máy Windows dev hiện tại **không có `psql`, `postgres`, `docker`, `pg`, hay `@electric-sql/pglite`**.
   - Do đó, các PL/pgSQL block trong `schema-sql.js`, `20261111120000_command_two_phase_sync.sql`, `supabase/setup.sql`, và `supabase/reset_and_setup.sql` được kiểm chứng về **cấu trúc tĩnh, signature tham số, ràng buộc `text` vs `uuid`, và mô phỏng hợp đồng hành vi trong JS**.
   - Chúng **chưa được thực thi end-to-end qua một SQL parser/engine PostgreSQL 15/16/17 thật** (ví dụ: test `FOR UPDATE SKIP LOCKED` đồng thời giữa 2 connection Postgres thật, test `ALTER TABLE ... ALTER COLUMN command_id TYPE text` trên bảng `manager_commands` đang có dữ liệu/constraint/foreign key thật, hoặc test chạy `reset_and_setup.sql` trong Supabase SQL Editor).
2. **Trạng thái Live Supabase Production chưa đổi**:
   - Tại thời điểm dừng sửa ở `e3c94ec`, người dùng chưa chốt có xóa toàn bộ DB để chạy `reset_and_setup.sql` hay bỏ tính năng `reset`, nên live Supabase vẫn chưa nhận migration/reset mới.
3. **Chưa test E2E nhiều instance `Manager` thật chạy song song trên Render + PostgreSQL thật**:
   - Đã mô phỏng 2 `CommandBroker` cùng dùng một mock store với fence preemption và lease renewal; chưa benchmark/chaos-test trực tiếp 2 process Node kết nối Supabase thật.
4. **Một điểm lệch nhỏ cần lưu ý nếu chạy `reset_and_setup.sql` nguyên bản**:
   - Tại [`src/http/routes/admin-api.js`](../src/http/routes/admin-api.js#L276-L285), endpoint `POST /api/manager/audit-logs/clear` gọi trực tiếp `await store.client.from('manager_audit').delete().neq('id', 0);` (không xóa `audit_logs`, và không kiểm tra `error` trả về từ `@supabase/supabase-js`). Trong khi đó, `reset_and_setup.sql` (theo `schema-sql.js`) xóa `manager_audit` ở Phần 1 và chỉ tạo bảng `audit_logs` ở Phần 2 (`SupabaseDashboardStore` có `AUDIT_LOGS = 'audit_logs'` và `AUDIT = 'manager_audit'` làm fallback). Đây là chi tiết ChatGPT cần lưu ý khi đánh giá mức độ đồng bộ giữa `admin-api.js` và `schema-sql.js`.
