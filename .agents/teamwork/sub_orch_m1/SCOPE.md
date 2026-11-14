# Scope: Milestone M1 — Auth & Session Hardening (AUTH-01 through AUTH-08)

## Architecture
- Module: Authentication & Session Lifecycle (`src/http/routes/auth-api.js`, `src/http/app.js`, `src/http/routes/user-api.js`, `src/storage/supabase-dashboard-store.js`, `src/storage/supabase-client.js`).
- Key utilities: `src/utils/secrets.js`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | AUTH-01 | Scrypt password hashing & auto-migration on login | M1 | ORIGINAL_REQUEST §R1 |
| 2 | AUTH-02 | Fail-closed DB session persistence in /register and /login | M1 | ORIGINAL_REQUEST §R1 |
| 3 | AUTH-03 | Session revocation & cookie clearing in /change-password | M1 | ORIGINAL_REQUEST §R1 |
| 4 | AUTH-04 | /logout DB revoke warning logs and dead-code cleanup | M1 | ORIGINAL_REQUEST §R1 |
| 5 | AUTH-05 | Rate limiter IP resolution via Express trust proxy | M1 | ORIGINAL_REQUEST §R1 |
| 6 | AUTH-06 | Bounded Map rate limiter with MAX_ENTRIES & cleanup | M1 | ORIGINAL_REQUEST §R1 |
| 7 | AUTH-07 | Explicit key redemption status reporting in /register | M1 | ORIGINAL_REQUEST §R1 |
| 8 | AUTH-08 | DB auth and RAM cache synchronization & bypassCache | M1 | ORIGINAL_REQUEST §R1 |

## Write Ownership
The worker for M1 exclusively owns:
- `src/http/app.js` (trust proxy setup only)
- `src/http/routes/auth-api.js` (AUTH-01..07)
- `src/http/routes/user-api.js` (AUTH-05 clientIp)
- `src/storage/supabase-dashboard-store.js` (AUTH-01 password handling, AUTH-08 bypassCache)
- `src/storage/supabase-client.js` (AUTH-01 scrypt preservation in userToDatabaseRows)

## Survey Inputs
Refer to the survey report prepared by Explorer 1 at:
`D:\manager\.agents\teamwork\explorer_survey_auth\handoff.md`
and baseline test findings at:
`D:\manager\.agents\teamwork\explorer_survey_test\handoff.md`.

## Requirements
Implement all 8 fixes in code. Verify with existing 37 tests to ensure zero regressions:
`cmd.exe /c "cd /d D:\manager && npm test"`
Deliver a verified handoff report with gate status.
