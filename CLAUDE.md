# Manager project notes

## Stack and entry point
- Node.js 20+, CommonJS, discord.js v14, Express, Supabase Postgres.
- Runtime starts at `src/index.js`; slash commands and Supabase schema are synchronized at startup.
- The manager is the Discord control plane. It hosts worker APIs and Link4M callbacks, not a browser dashboard.

## Structure and conventions
- Add slash commands under `src/discord/commands/`; `command-registry.js` feeds both runtime routing and command registration.
- Put button/modal routing in `src/discord/handlers/panel-handler.js`, presentation in `src/discord/panels/renderer.js`, and domain rules in `src/services/`.
- Keep Worker actions synchronized across `src/services/worker-registry.js`, `src/services/command-broker.js`, `D:\worker\src\services\worker-runtime.js`, and the durable command SQL migration.
- Supabase persistence lives in `src/storage/`; schema source files are under `supabase/migrations/`. Refresh `supabase/setup.sql` when migrations change.
- Only this service receives `SUPABASE_SECRET_KEY`; keep RLS enabled, and keep worker/proxy secrets encrypted with `MANAGER_ENCRYPTION_KEY`.
- User/admin interactions must remain ephemeral and re-check role and worker assignment before each operation.

## Common commands
- Install: `npm ci`
- Run: `npm start`
- Manually register commands if needed: `npm run commands:register`
- Deploy blueprint: `render.yaml`
- Apply a new project schema: run `supabase/setup.sql` once in Supabase SQL Editor.

## Configuration and operations
- Use `.env.example`, `SETUP.md`, and `docs/architecture.md` as the configuration and data-flow references.
- Run a single manager instance: HTTP polls and pending Discord response waiters are process-local; durable worker commands are stored in Supabase.
- Secrets and external account setup are not committed. Do not inspect, print, or commit real `.env` values.
