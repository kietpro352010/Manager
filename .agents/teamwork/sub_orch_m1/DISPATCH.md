## 2026-11-13T11:44:23Z
You are the Sub-Orchestrator for Milestone M1: Auth & Session Hardening (AUTH-01 through AUTH-08) in D:\manager.

Working directory: D:\manager
State folder: D:\manager\.agents\teamwork\sub_orch_m1\
Scope document: D:\manager\.agents\teamwork\sub_orch_m1\SCOPE.md
Original request: D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md
Parent conversation ID: 4a5b8de8-29ae-4933-a7c8-d6a0c5b9652d

MANDATORY FIRST STEP: Read D:\manager\.agents\teamwork\ORIGINAL_REQUEST.md and D:\manager\.agents\teamwork\sub_orch_m1\SCOPE.md.

Read the detailed technical survey report prepared for you:
`D:\manager\.agents\teamwork\explorer_survey_auth\handoff.md`

Your Scope (Milestone M1):
Implement and verify all 8 items in AUTH-01 through AUTH-08:
1. AUTH-01: Scrypt hash for new/changed passwords, auto-migrate legacy AES passwords on successful login.
2. AUTH-02: Fail-closed DB session persistence in /register and /login (HTTP 503 + clear RAM session).
3. AUTH-03: /change-password session revocation (revokeUserSessions, clear activeSessions, clear cookie).
4. AUTH-04: /logout warning log when DB revoke fails.
5. AUTH-05: Rate limiter IP resolution via Express trust proxy (req.ip).
6. AUTH-06: Bounded Map rate limiter (MAX_ENTRIES=5000, expired pruning, FIFO eviction).
7. AUTH-07: Explicit keyRedeemed and keyError response in /register.
8. AUTH-08: DB auth and RAM cache consistency (getUser bypassCache).

Workflow to execute:
Follow the Project Pattern iteration loop (2B):
- Spawn teamwork_worker to implement the changes according to the blueprint in `explorer_survey_auth\handoff.md`. Include the mandatory integrity warning.
- Have worker verify that existing 37 tests continue to pass 100%: `cmd.exe /c "cd /d D:\manager && npm test"`
- Spawn 2 teamwork_reviewer(s) to verify correctness, completeness, and non-regression.
- Spawn 2 teamwork_challenger(s) to empirically challenge the implementation.
- Spawn a teamwork_auditor to run forensic integrity checks.
- Gate the results in GATE_STATUS.md.
- When passed, write handoff.md in your state folder and send a completion message to your parent (4a5b8de8-29ae-4933-a7c8-d6a0c5b9652d).
