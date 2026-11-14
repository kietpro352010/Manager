## 2026-11-13T11:46:01Z
You are the Worker for Milestone M1: Auth & Session Hardening (AUTH-01 through AUTH-08) in D:\manager.

Working directory: D:\manager
State folder: D:\manager\.agents\teamwork\worker_m1_1\
Parent conversation ID: be33fb41-66b4-475f-8e6b-38214222a39f

MANDATORY FIRST STEPS:
1. Read D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md
2. Read D:\manager\.agents\teamwork\sub_orch_m1\SCOPE.md
3. Read D:\manager\.agents\teamwork\explorer_survey_auth\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP (do NOT touch other source files):
- `src/http/app.js` (trust proxy setup only)
- `src/http/routes/auth-api.js` (AUTH-01..AUTH-07)
- `src/http/routes/user-api.js` (AUTH-05 clientIp)
- `src/storage/supabase-dashboard-store.js` (AUTH-01 password handling, AUTH-08 bypassCache)
- `src/storage/supabase-client.js` (AUTH-01 scrypt preservation in userToDatabaseRows)
- `tests/auth-regression.test.js` (new test suite testing AUTH-01..08)
