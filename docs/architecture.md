# Manager and worker architecture

## Trust and data flow

```text
Discord user/admin
    │ private slash commands, buttons, menus, modals
    ▼
Discord manager ── Supabase Postgres (durable source of truth)
    │ HTTPS, one secret per worker slot
    ├──────────────────────────────► Render worker API
    ◄─────────────────────────────── Wispbyte worker long-poll API
```

The manager is the only component holding the Supabase server key. `DISCORD_GUILD_ID` stays in the host environment as the single hard server boundary and is enforced at command registration and runtime. Admin/User role IDs are initialized by `/setup`, stored in Supabase `manager_settings`, and cannot be changed by a Supabase user grant. A User must additionally have an active Supabase grant and an assignment to each worker. Admin can access all workers. Every private panel action repeats the role/worker check.

Each worker host runs one or two isolated Minecraft sessions in a shared Node process. A slot has a stable worker ID and its own secret. Render uses one public host URL with per-slot control endpoints. Wispbyte opens one outbound poll per slot. Workers never connect directly to Supabase.

## Manager modules

| File/folder | Purpose |
|---|---|
| `src/index.js` | Validates environment, connects Supabase stores, wires services, registers guild commands, starts HTTP + Discord and handles graceful shutdown. |
| `src/config/env.js`, `src/config/host-runtime.js` | Validates boot secrets and locked guild ID; detects Render/Wispbyte platform, port and public URL from host markers. |
| `src/discord/commands/*.js` | One module per slash command: bot/dashboard, worker, user, keys, Link4M, Render and diagnostics. `command-registry.js` discovers modules. |
| `src/discord/handlers/interaction-handler.js` | Denies other guilds and members without a Discord role; sends all command replies privately. |
| `src/discord/handlers/panel-handler.js` | Rechecks roles/assignments for every button/modal, dispatches actions, records audit and rerenders the current ephemeral panel. |
| `src/discord/panels/renderer.js` | Builds Overview, Workers, worker detail, Members and Activity embeds/components. Recent event/chat display is capped at five. |
| `src/services/access-control.js`, `src/services/manager-runtime-settings.js` | Maps live Discord roles, validates user expiry/status/worker assignments, and stores runtime integration secrets encrypted in Supabase. Supabase grants never create Admin. |
| `src/services/worker-registry.js` | Allocates stable bot numbers, validates IDs/settings, encrypts worker secrets/account/password/proxy, prepares bootstrap and sanitizes status/events. |
| `src/services/command-broker.js` | Authenticates and dispatches Render requests or queues Wispbyte commands; handles heartbeat status and worker results. |
| `src/services/fleet-operations.js` | Serial Stop All, reconnect of reachable error-state workers, and conservative cleanup of Render workers returning 404. |
| `src/services/entitlement-service.js` | Creates/uses hashed access codes, assigns fixed or available workers and extends user expiry. |
| `src/services/link4m-service.js` | Optional reward workflow and limits. |
| `src/services/render-api.js` | Render service list/status/deploy and service-existence checks. |
| `src/storage/*` | Supabase client and adapters for worker, user/audit/key, and durable command data. |
| `src/http/*` | Health, Link4M callbacks and worker-authenticated bootstrap/heartbeat/events/poll/result endpoints; no web UI/login. |
| `supabase/setup.sql` | Fresh schema bootstrap: RLS, grants, indexes, secured RPCs, and current command action constraints. |
| `supabase/migrations/` | Ordered additive upgrades for existing Supabase projects. Apply every missing migration by filename. |

## Worker modules

| File/folder | Purpose |
|---|---|
| `src/index.js` | Loads config, creates a two-slot `WorkerFleet`, starts Render HTTP or Wispbyte poll transport and graceful shutdown. |
| `src/config/env.js` | Validates 1–2 unique worker IDs/secrets, manager HTTPS URL, shared/per-slot Minecraft, AFK and proxy options. Account passwords do not come from host variables. |
| `src/services/worker-fleet.js` | Owns sessions, per-slot reporters/pollers, startup spacing, heartbeat and shared process CPU/RAM sampler. |
| `src/services/worker-runtime.js` | Serializes manager actions and enforces action/payload/rate limits. |
| `src/game/minecraft-session.js` | One Mineflayer lifecycle: account auth, start/stop/reconnect, AFK, chat, proxy, restrictions, metrics and fixed maintenance boundary. |
| `src/game/packet-optimization.js` | Disables selected optional Mineflayer plugins and drops selected parsed events; prunes far loaded chunks. Does not filter raw network bytes. |
| `src/game/afk-controller.js` | Configurable low-activity AFK behavior, `still` by default. |
| `src/game/server-auth.js` | Handles server account prompts and blocks account-sensitive commands from remote chat. |
| `src/game/lobby-navigator.js` | Optional one-time join command after spawn; no GUI/menu/window interaction. |
| `src/game/server-monitor.js` | Samples in-game TPS and ping. |
| `src/services/maintenance-window.js` | Calculates the locked 04:30–05:30 Asia/Ho_Chi_Minh (UTC+7) boundary. |
| `src/transports/manager-reporter.js` | HTTPS bootstrap, heartbeat and event reporting for a Render worker. |
| `src/transports/wispbyte-poller.js` | Outbound long poll, executes one command at a time and posts result. |
| `src/http/*` | Health and worker-secret-protected Render endpoints. |

## Supabase data map

| Table | Records |
|---|---|
| `manager_workers` | Stable worker identity/number, encrypted secret, encrypted account/proxy settings, sanitized status, event history and heartbeat. The old user-editable schedule column is removed by migration 11. |
| `manager_access`, `manager_worker_assignments` | User grant status, expiry/plan and one-worker/one-user assignment rows. Discord Admin/User roles remain in Discord. |
| `manager_keys` | Hashed redeem codes, grant duration, worker allocation, use limit and expiry. |
| `manager_audit` | User/admin actions; old records are pruned after 180 days at startup. |
| `manager_settings` | Optional Link4M runtime settings. |
| `manager_link4m_attempts` | Hashed claims, provider callback state, cooldown/quota and expiry. |
| `manager_commands` | Durable Wispbyte command, payload, status, result and deadline. Terminal rows are pruned after 30 days. |
| `manager_counters` | Monotonic numeric bot IDs. |
| `manager_schema_migrations` | Schema versions required by manager startup. |

Every table has RLS enabled; client roles receive no table grants/policies. RPC functions use `security definer`, empty `search_path`, and service-role-only execute grants. The manager uses one server-only secret key. AES-256-GCM protects the worker secret, Minecraft account JSON and SOCKS5 URLs with `MANAGER_ENCRYPTION_KEY`.

The reset action is durable for Wispbyte: the command-completion RPC clears saved account credentials and event history only after a successful worker ACK. Render applies the reset RPC only after its HTTP command returns a successful worker result. Both preserve worker registration, secret, proxy and AFK settings.

## Worker API and supported actions

Worker-to-manager paths are `/api/v1/workers/:workerId/bootstrap`, `heartbeat`, `events`, `poll`, and `result`, each with `x-worker-secret`. Render control paths are `/api/v1/bots/:workerId/status` and `/command`. Wispbyte poll requests claim a durable command; results are checked against worker ID and command ID.

Supported actions are `start`, `stop`, `restart`, `resume`, `status`, `reset`, `chat`, `set-afk-mode`, and `set-proxy`. Inventory/container/GUI/hotbar actions and user-defined schedules have been removed. When an action changes, update both the manager allow-list and worker runtime allow-list, transport/command schema as needed, and this contract.

The fixed maintenance scheduler belongs to the worker process: it stops a running session at 04:30 and reconnects at 05:30 if it was active and not manually stopped or restriction-held. The manager does not schedule worker sessions.
