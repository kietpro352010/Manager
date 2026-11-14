# Manager features

## Discord access and panels

- `DISCORD_GUILD_ID` restricts slash commands, buttons, menus and modals to one server; startup removes old global commands.
- Admin/User role IDs are initialized through `/setup` and stored in Supabase `manager_settings`, pinned to the host-locked `DISCORD_GUILD_ID`. A member without either role is denied. User access also requires an active Supabase entitlement and assigned worker.
- `/bot` shows a compact private dashboard; `/bot number` opens one worker. `/panel` provides Overview, Workers, Members and Activity pages according to role.
- Panel replies are ephemeral and refresh only when opened or when a user acts. Worker details show at most five recent event/chat lines.
- Admin manages users/grants, access keys, workers, audit, fleet stop/reconnect/cleanup and Render service actions.

## Worker controls

- One host process supports up to two independent Minecraft bot slots with unique IDs/secrets and accounts.
- Render uses a shared HTTPS host URL and per-slot authenticated endpoints. Wispbyte uses one outbound authenticated poll per worker.
- Worker panel keeps start/stop/restart/resume, chat input, account, AFK mode, SOCKS5 proxy and reset data.
- AFK modes: `still`, `look`, `sneak`. Daily maintenance pause is locked to 04:30–05:30 `Asia/Ho_Chi_Minh` (UTC+7); reconnect is blocked during that window.
- Inventory, container/GUI/hotbar controls, auto-chat and user-editable schedules are removed.
- Detail status retains TPS, ping, uptime, reconnect counts, process CPU/RAM and actual Minecraft socket byte rates. It does not display host or Minecraft IP/hostname.
- The packet filter drops selected Mineflayer events and disables unnecessary plugins after protocol parsing. This reduces local event/world processing; it cannot retroactively reduce received network bytes.
- Worker secrets, Minecraft credentials and manager-controlled proxy URLs are encrypted in Supabase.

## Entitlements, persistence and operations

- Codes grant duration and fixed or automatically assigned workers. Codes are hashed, expiring/use-limited and displayed once.
- Optional Link4M reward flow uses Supabase-backed quotas, expiry, cooldown and duplicate-claim protection.
- Supabase stores worker registry, status/events, encrypted credentials/settings, user grants/assignments, keys, audit and durable Wispbyte commands.
- RLS is enabled and client roles have no table access; only the server manager uses its service-role secret.
- Worker reset clears account credentials, recent events and reconnect counters only after the worker acknowledges; AFK/proxy settings and registration remain.
- Fleet actions: Stop All, reconnect reachable workers in error state without restriction holds, and clean only Render registrations confirmed missing by HTTP 404. There is no Run All, Restart All, broadcast, alert, tag or backup UI.
- There is no web dashboard or web login. Render helpers can use an integration key configured privately through `/setup` and encrypted in Supabase. Manager and workers auto-detect Render/Wispbyte platform markers and host ports where provided.
