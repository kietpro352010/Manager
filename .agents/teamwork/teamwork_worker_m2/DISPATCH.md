## 2026-11-14T09:31:17Z
You are dispatched by the orchestrator (conversation ID: 0d86e0d0-41d7-4997-80d0-d77fba035dfc).

MANDATORY FIRST STEP:
Read ORIGINAL_REQUEST.md at:
C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\ORIGINAL_REQUEST.md

Read Survey Findings at:
C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_explorer_survey_1\handoff.md

Read PROJECT.md at:
C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\PROJECT.md

Working directory: D:\manager
Your state folder: C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_worker_m2\

ROLE & OBJECTIVE:
You are an implementation worker (`teamwork_worker`) for Milestone 2: Gate 3 - Access Control & Assignment Integrity (ACC-11-01 to ACC-11-04).
Your exclusive file ownership:
- `D:\manager\src\services\access-control.js`
- `D:\manager\src\discord\commands\bots.js`
- `D:\manager\src\discord\commands\logs.js`
- `D:\manager\src\discord\handlers\panel-handler.js`
- `D:\manager\src\storage\supabase-dashboard-store.js`
- Test files: `D:\manager\tests\gate3-m2-access-control.test.js`

REQUIREMENTS TO IMPLEMENT:
1. ACC-11-01: In `D:\manager\src\services\access-control.js#L87`, fix `isEntitled()` so that if `isPermanent === false`, `expiresAt === null` is treated as unentitled (return false), returning true only if `expiresAt && new Date(expiresAt).getTime() > Date.now()`.
2. ACC-11-02: In `D:\manager\src\discord\handlers\panel-handler.js`, `D:\manager\src\discord\commands\bots.js`, and `D:\manager\src\discord\commands\logs.js`, check `accessControl.isEntitled(user)` before displaying bot lists in `/bots` and bot logs in `/logs`. For non-admin expired or unentitled users, display an access denied/expired embed instead of sensitive bot data.
3. ACC-11-03: In `D:\manager\src\storage\supabase-dashboard-store.js` and worker removal workflows, synchronously clean up bot assignments from both the `ASSIGNMENTS` table and `manager_users.assigned_bot_ids` array when a worker is removed or disabled, eliminating empty catch blocks.
4. ACC-11-04: In `D:\manager\src\services\access-control.js`, verify that target bot/worker exists in `WorkerRegistry` before creating an assignment in `grant()`. Ensure `accessControl` accepts or can access `registry` (e.g. via constructor options `options.registry` or `this.registry`).

VERIFICATION REQUIREMENTS:
- Create comprehensive tests in `D:\manager\tests\gate3-m2-access-control.test.js` covering all 4 requirements.
- Run:
  `cmd /c "cd /d D:\manager && node tests/gate3-m2-access-control.test.js"`
  `cmd /c "cd /d D:\manager && npm test"`
- Record exact commands and outputs in `handoff.md`.
