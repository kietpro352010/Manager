# KingMC Worker Manager (`Manager`)

Control plane và hệ thống quản trị trung tâm cho KingMC AFK Workers.

---

## Cấu trúc dự án

| Thành phần | Đường dẫn | Mô tả |
|---|---|---|
| Entrypoint & Runtime | [`src/index.js`](src/index.js) | Khởi động Storage, Runtime Settings, Discord Bot, CommandBroker, Entitlement/Link4M, Memory Sweeper, HTTP Server |
| Cấu hình & Host | [`src/config/`](src/config) | [`env.js`](src/config/env.js), [`host-runtime.js`](src/config/host-runtime.js) (validate `SUPABASE_URL`, keys, `DISCORD_*`, Render/Wispbyte port) |
| Discord Bot UI | [`src/discord/`](src/discord) | 6 slash commands (`/admin`, `/bots`, `/help`, `/login`, `/logout`, `/logs`), panel renderer & interaction handlers |
| Web Dashboard & REST API | [`src/http/`](src/http) | Express app ([`app.js`](src/http/app.js)), `/health`, `/ready`, `/api/auth`, `/api/manager`, `/api/user`, `/api/v1/workers`, SPA views |
| Domain Services | [`src/services/`](src/services) | `CommandBroker`, `WorkerRegistry`, `FleetOperations`, `EntitlementService`, `Link4mService`, `AccessControl`, `ManagerRuntimeSettings` |
| Storage & SQL Contracts | [`src/storage/`](src/storage) | [`schema-sql.js`](src/storage/schema-sql.js), [`supabase-client.js`](src/storage/supabase-client.js), worker/dashboard/command stores |
| Utilities | [`src/utils/`](src/utils) | `http.js`, `logger.js`, `secrets.js` (AES-256-GCM, Scrypt), `text-format.js` |
| Supabase Migrations | [`supabase/`](supabase) | DDL schema và migrations định kỳ đồng bộ RPC |
| Test Suite & CI | [`tests/`](tests), [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Unit, integration & real PostgreSQL 16 CI workflow |
| Deploy Manifest | [`package.json`](package.json), [`render.yaml`](render.yaml) | Render Web Service manifest (`/health`), `npm start`, `npm test` |

---

## Hướng dẫn cài đặt & Kiểm thử

```bash
npm ci
npm test
```

## Khởi động Production

```bash
npm start
```
