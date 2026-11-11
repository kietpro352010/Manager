# KingMC Worker Manager (`Manager`)

Repository này được chia thành **2 phần tách biệt rõ ràng** theo yêu cầu vận hành & đánh giá kiến trúc:

1. **Phần 1 — Dự án chính (Production Code, SQL & Tests)**: toàn bộ mã nguồn chạy thật trên Render/Node.js, schema Supabase, migration và bộ kiểm thử.
2. **Phần 2 — Ghi chú của Agent (`agent-notes/`)**: tài liệu tổng hợp trạng thái thực tế, lịch sử phát hiện/khắc phục lỗi, đối chiếu Supabase thực tế, các khoảng trống kiểm thử và các lựa chọn đang mở để người dùng & ChatGPT đọc và ra quyết định (không ảnh hưởng runtime của ứng dụng).

---

## Phần 1 — Dự án chính (Project Code & Database)

| Thành phần | Đường dẫn | Mô tả ngắn |
|---|---|---|
| Entrypoint & Runtime | [`src/index.js`](src/index.js) | Khởi động Storage, Runtime Settings, Discord Bot, CommandBroker, Entitlement/Link4M, Adaptive Memory Sweeper, HTTP Server |
| Cấu hình & Host | [`src/config/`](src/config) | [`env.js`](src/config/env.js), [`host-runtime.js`](src/config/host-runtime.js) (validate `SUPABASE_URL`, secret/encryption key, `DISCORD_*`, Render/Wispbyte port) |
| Discord Bot UI | [`src/discord/`](src/discord) | 6 slash commands (`/admin`, `/bots`, `/help`, `/login`, `/logout`, `/logs`), panel renderer & button/modal handlers |
| Web Dashboard & REST API | [`src/http/`](src/http) | Express app ([`app.js`](src/http/app.js)), `/health`, `/ready`, `/api/ready`, `/api/auth`, `/api/manager`, `/api/user`, `/api/v1/workers/:workerId`, `/api/worker`, SPA views (`login-html.js`, `dashboard-html.js`) |
| Domain & Orchestration Services | [`src/services/`](src/services) | `CommandBroker`, `WorkerRegistry` (15 unified actions), `FleetOperations`, `EntitlementService`, `Link4mService`, `AccessControl`, `ManagerRuntimeSettings`, `RenderApi`, `WispbyteKeepAlive`, `AdminNotifier`, `AsyncKeyLock`, `proxy-validation` |
| Storage & SQL Contracts | [`src/storage/`](src/storage) | [`schema-sql.js`](src/storage/schema-sql.js) (full 26 tables, 50 functions), [`supabase-client.js`](src/storage/supabase-client.js) (`SUPABASE_REQUIRED_TABLES` = 23 tables), `supabase-worker-store.js`, `supabase-dashboard-store.js`, `supabase-command-store.js` |
| Utilities | [`src/utils/`](src/utils) | `http.js`, `logger.js`, `secrets.js` (AES-256-GCM & key rotation), `text-format.js` |
| Supabase SQL Scripts & Migrations | [`supabase/`](supabase) | [`migrations/`](supabase/migrations) (6 file từ `20261107` đến `20261111120000`), [`setup.sql`](supabase/setup.sql) (gộp migrations), [`reset_and_setup.sql`](supabase/reset_and_setup.sql) (script xóa & dựng lại toàn bộ schema chuẩn — có cảnh báo phá hủy dữ liệu) |
| Test Suite & CI | [`tests/`](tests), [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | [`integration.test.js`](tests/integration.test.js), [`services-wiring.test.js`](tests/services-wiring.test.js), [`storage-sql.test.js`](tests/storage-sql.test.js); CI Node 20 chạy `node --check` + cả 3 test suite |
| Deploy & Scripts | [`package.json`](package.json), [`render.yaml`](render.yaml), [`.env.example`](.env.example), [`scripts/register-commands.js`](scripts/register-commands.js) | Lệnh chạy `npm start`, `npm test`, Render Web Service manifest (`/health`) |

### Chạy kiểm thử cục bộ

```bash
npm ci
npm test
```

> Lưu ý: Hệ thống test hiện tại sử dụng mock Supabase REST/RPC adapter trong Node.js (chưa chạy đối chứng trực tiếp trên một instance PostgreSQL thật trong CI). Xem chi tiết giới hạn trong [`agent-notes/04-test-verification-and-gaps.md`](agent-notes/04-test-verification-and-gaps.md).

---

## Phần 2 — Ghi chú của Agent & Bối cảnh ra quyết định (`agent-notes/`)

Thư mục [`agent-notes/`](agent-notes/README.md) **không chứa mã chạy trong production**. Đây là khu vực tổng hợp cho **người dùng & ChatGPT** nắm đúng trạng thái thực tế của repo tại commit hiện tại (đặc biệt tránh nhầm lẫn với các file tài liệu cũ ở máy local chưa từng được cập nhật).

| Tài liệu Agent Notes | Nội dung chính |
|---|---|
| [`agent-notes/README.md`](agent-notes/README.md) | Điểm bắt đầu cho ChatGPT: tóm tắt tình huống hiện tại và **3 quyết định kiến trúc/vận hành đang mở** |
| [`agent-notes/01-project-state-and-git-timeline.md`](agent-notes/01-project-state-and-git-timeline.md) | Kiến trúc thực tế đang có trong `src/` + lịch sử commit từ `4ec784b` đến `e3c94ec` |
| [`agent-notes/02-findings-and-fixes-summary.md`](agent-notes/02-findings-and-fixes-summary.md) | Toàn bộ các lỗi đã sửa (`execution_completed` / `state_sync_pending`, lease fencing, fail-closed RPC, `command_id text`) + vị trí thật của mọi luồng `reset` |
| [`agent-notes/03-supabase-live-status-and-sql-options.md`](agent-notes/03-supabase-live-status-and-sql-options.md) | Đối chiếu sự lệch nhau giữa `schema-sql.js` (26 bảng / 50 RPC) vs `supabase/setup.sql` (10 bảng) vs `reset_and_setup.sql`, và trạng thái DB thực tế lúc cảnh báo |
| [`agent-notes/04-test-verification-and-gaps.md`](agent-notes/04-test-verification-and-gaps.md) | Kết quả test đã chạy thật (`15/15`, `13/13`, `6/6`), ranh giới mock và những gì còn thiếu trước khi rollout production |
| [`agent-notes/legacy-session-artifacts/`](agent-notes/legacy-session-artifacts/README.md) | Lưu trữ các bản ghi lịch sử trước commit `e3c94ec` (được gắn nhãn `[HISTORICAL SNAPSHOT]`, chỉ dùng để tham khảo bối cảnh quá khứ) |
