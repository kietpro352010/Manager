> [!WARNING]
> **[HISTORICAL SNAPSHOT — PRE-e3c94ec]**: Bản ghi lịch sử từ phiên làm việc trước (08/11–10/11/2026). KHÔNG phản ánh trạng thái hiện tại ở e3c94ec. Xem trạng thái mới nhất tại [\gent-notes/README.md\](../README.md).

# Master Task Plan: 100% Optimization & System Polish (Manager & BotWorker)

## 1. Goal
Execute deep micro-optimizations, visual polish, lifecycle resilience, and security hardening across all existing modules in `Manager` and `BotWorker` without changing existing directory trees, public contracts, or adding out-of-scope features. Verify 100% syntax and behavioral compliance, and synchronize all changes across the 8 GitHub repositories.

## 2. Subsystems & Target Modules

### Phase 1: Manager UI/UX & Web Engine Polish
- Target: `src/http/views/dashboard-html.js`, `src/http/views/login-html.js`, `src/discord/panels/renderer.js`, `src/utils/text-format.js`
- Objectives:
  - Selective DOM diff/update to prevent full reload flickers and preserving scroll position.
  - Form protection (`data-dirty="true"` and active focus element guard).
  - SVG Sparkline hardening: avoid `NaN` coordinates when series is empty or has single point, smooth path geometry.
  - Tabular numbers (`tabular-nums`) for real-time counters, responsive mobile modal & card clamps.
  - Immediate tactile button feedback with optimistic state and double-click prevention.
  - Discord limit clamps (256/1024/4096 / 25 menu options) and Vietnamese error diagnostics.

### Phase 2: Manager Services, Orchestration & Security Hardening
- Target:
  - Security & Locks: `src/utils/secrets.js`, `src/services/async-key-lock.js`, `src/services/proxy-validation.js`, `src/utils/http.js`
  - Lifecycle & Entitlements: `src/services/entitlement-service.js`, `src/services/link4m-service.js`
  - Fleet & Command Dispatch: `src/services/worker-registry.js`, `src/services/fleet-operations.js`, `src/services/command-broker.js`
  - Infrastructure Services: `src/services/admin-notifier.js`, `src/services/manager-runtime-settings.js`, `src/services/render-api.js`, `src/services/wispbyte-keepalive.js`
  - Data Layer: `src/storage/schema-sql.js`, `src/storage/supabase-client.js`, `src/storage/supabase-dashboard-store.js`, `src/storage/supabase-worker-store.js`, `src/storage/supabase-command-store.js`
  - HTTP Routes & Discord Handlers: `src/http/middleware/worker-auth.js`, `src/http/routes/auth-api.js`, `src/http/routes/user-api.js`, `src/http/routes/admin-api.js`, `src/http/routes/worker-api.js`, `src/discord/handlers/interaction-handler.js`, `src/discord/handlers/panel-handler.js`, `src/discord/commands/*`

### Phase 3: BotWorker 512MB RAM & Engine Optimization
- Target:
  - Packet & Memory: `src/game/packet-optimization.js`, `src/domain/worker-state.js`, `src/utils/logger.js`
  - Session & Proxy Teardown: `src/game/minecraft-session.js`, `src/config/proxy.js`, `src/services/maintenance-window.js`
  - Game Behaviors: `src/game/server-auth.js`, `src/game/lobby-navigator.js`, `src/game/afk-controller.js`, `src/game/server-monitor.js`
  - Runtime & Transport: `src/services/worker-runtime.js`, `src/services/worker-fleet.js`, `src/transports/manager-reporter.js`, `src/transports/wispbyte-poller.js`, `src/http/auth.js`, `src/http/routes.js`

### Phase 4: Rigorous Verification & Multi-Repo Deployment
- Syntax: `node --check` across 100% of files in Manager & Worker (source and deploy).
- Functional Verification: Run and verify all unit, integration, and security test suites.
- Multi-Repo Git Sync: Push to Manager and all 7 BotWorker instances on GitHub, confirm commit hashes via `git ls-remote`.

## 3. Measurable Acceptance Criteria
1. Zero syntax errors in any `.js` file (`node --check` 100% PASS).
2. Zero placeholders, stubs, or `// ... existing code ...` anywhere.
3. DOM selective updates preserve input focus and dirty forms across poll intervals.
4. SVG sparkline generates valid SVG paths with 0, 1, or N points without `NaN`.
5. SSRF validation strictly blocks IPv4/IPv6 private ranges, 127.0.0.1, 169.254.169.254, metadata, and invalid hostnames.
6. Worker memory stays strictly under 512MB with packet optimization, circular buffers, and deterministic socket teardown.
7. All 8 GitHub repos match latest commit SHAs.
