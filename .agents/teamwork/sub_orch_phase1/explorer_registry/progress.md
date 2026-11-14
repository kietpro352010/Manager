# Progress — Explorer 2 (Worker Registry & Storage)

- Last visited: 2026-11-14T05:15:15Z
- Status: Completed (Handoff Report Ready)
- Active Task: Report delivery to parent agent
- Items Investigated and Documented:
  - [x] WORKER-01: Promise truthiness bypass in `src/http/routes/auth-api.js` (lines 582–604)
  - [x] WORKER-02 / WKR-01: Secret cache TTL (60s) & programmatic `invalidateWorkerSecret` in `src/services/worker-registry.js` (lines 51, 166–184, 213–224)
  - [x] WORKER-03: Scoped global bot secret in `src/http/app.js` (lines 45–54) and `src/http/routes/worker-api.js` (lines 83–100) with `GLOBAL_BOT_SECRET_USED` audit log
  - [x] WORKER-04: Atomic bot sequence number generation in `src/storage/supabase-worker-store.js` (lines 67–77) using `AsyncKeyLock`
  - [x] WORKER-05: Prevent `addEvent` when worker is non-existent or disabled in `src/services/worker-registry.js` (lines 328–358) and `src/http/routes/worker-api.js` (lines 28–44)
  - [x] WORKER-06: Prevent `rotateSecret` when worker is disabled in `src/services/worker-registry.js` (lines 186–193)
  - [x] WORKER-07: Non-silent RPC error handling in `src/storage/supabase-worker-store.js` (lines 67–77, 93–108, 110–123, 131–139) with `isRpcUnavailableError` classification
  - [x] WORKER-08: Strict schema validation for Worker status payload in `src/services/worker-registry.js` (lines 230–288) via canonical `validateWorkerStatus`
- Test Verification:
  - Baseline tests (`npm test`): 37/37 PASSED 100%
  - Test Suite Design: Defined test architecture for `tests/worker-registry-audit.test.js`
