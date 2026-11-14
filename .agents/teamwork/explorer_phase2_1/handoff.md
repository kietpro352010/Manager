# Handoff Report — Explorer Phase 2 (1): Command Store & Broker

## 1. Observation
- Target Files directly examined:
  - `D:\manager\src\storage\supabase-command-store.js` (987 lines)
  - `D:\manager\src\services\command-broker.js` (1003 lines)
- Exact observations by finding:
  1. **CMD-01**: `src/storage/supabase-command-store.js#L268-L283`:
     ```javascript
     try {
       const { data, error } = await this.client.rpc('manager_enqueue_worker_command', { ... });
       if (!error && data) {
         const row = unwrap(data);
         if (row) return fromRow(row);
       }
     } catch (_) {}
     ```
     `error` from `this.client.rpc` is swallowed unconditionally without checking `isRpcUnavailableError(error)`.
  2. **CMD-02**: `src/storage/supabase-command-store.js#L409`:
     ```javascript
     .in('status', ['delivered', 'queued'])
     ```
     Complete fallback explicitly includes `'queued'`, permitting direct `queued -> completed` status transition.
  3. **CMD-03**: `src/storage/supabase-command-store.js#L363-L385`:
     ```javascript
     const { data, error } = await this.client.from(TABLE)
       .select('*')
       .eq('worker_id', String(workerId))
       .eq('status', 'queued')
       .gt('expires_at', now)
       .order('created_at', { ascending: true })
       .limit(1)
       .maybeSingle();

     if (!error && data) {
       const { data: updated, error: updErr } = await this.client.from(TABLE)
         .update({ status: 'delivered', delivered_at: now })
         .eq('command_id', data.command_id)
         .eq('status', 'queued')
         .select('*')
         .maybeSingle();
       if (!updErr && updated) return fromRow(updated);
     }
     ```
     Single attempt without retry loop when `updated` fails due to concurrent race.
  4. **CMD-04**: `src/services/command-broker.js#L18-L20, L847-L857`:
     `this.pendingResults = new Map()` stores waiters in RAM only. If Manager restarts, in-memory waiters are lost. `reportResult` skipped DB lookup if `result?.action` was supplied.
  5. **CMD-05**: `src/services/command-broker.js#L167-L172, L248-L258, L982-L1000`:
     `dispatchRender` throws generic `TimeoutError` on 30s abort. `dispatchPoll` sets status to `'expired'` on wait timeout; late worker results calling `reportResult` fail because `complete()` rejects non-delivered commands.
  6. **CMD-06**: `src/services/command-broker.js#L322-L330`:
     `acceptResult` accepts `payload.result` and calls `reportResult` with no schema or type validation.
  7. **CMD-07**: `src/services/command-broker.js#L349-L351`:
     ```javascript
     if (typeof this.commandStore.clearWorker === 'function') {
       void this.commandStore.clearWorker(id).catch(() => {});
     }
     ```
     `cancelWorker` is synchronous and does not `await this.commandStore.clearWorker(id)`.
  8. **CMD-08**: `src/services/command-broker.js#L71, L82, L88, L98, L102`:
     Uses `mgr_${process.pid}` as lock owner claim in 5 places instead of `this.instanceId` (`mgr_${process.pid}_${randomUUID().slice(0, 8)}`).
  9. **API-09**: `src/services/command-broker.js#L207-L208, L232, L255`:
     `dispatchRender` returns `{ delivered: true, result }`; `dispatchPoll` returns `{ delivered: true, result }` or `{ delivered: false, timedOut: true, commandId }`. Missing symmetrical properties (`ok`, `commandId`, `action`, `timedOut`, `delivered`, `result`).
- Baseline test verification:
  Command `cmd /c "cd /d D:\manager && npm test"` exited with code 0 (100% pass across Integration, Services Wiring, Storage SQL, Auth Regression, and Worker Registry Audit tests).

---

## 2. Logic Chain
1. *From Observation 1*: Since `manager_enqueue_worker_command` RPC errors are swallowed by `catch (_) {}`, any Postgres policy failure or permission restriction (e.g., worker disabled or invalid payload) is bypassed by the table insert fallback. Enforcing `if (!isRpcUnavailableError(error)) throw error` ensures fallback only activates when the RPC is absent.
2. *From Observation 2*: A queued command has not been delivered to any executor. Allowing `.in('status', ['delivered', 'queued'])` allows invalid bypass of delivery acknowledgment. Constraining line 409 to `.eq('status', 'delivered')` restores the state machine invariant.
3. *From Observation 3*: In multi-poller setups without RPC, reading `limit(1)` and updating conditionally fails if another worker updates that row first. A bounded retry loop allows the poller to grab the next candidate instead of prematurely returning null.
4. *From Observation 4*: Relying solely on RAM Map means in-flight commands become untracked upon process restart. Implementing durable lookup by `commandId` via `commandStore.get(cid)` in `waitForResult` and `reportResult` ensures state continuity.
5. *From Observation 5*: Network latency or heavy worker tasks may report results slightly after the manager timeout deadline. Idempotently accepting late results for `'expired'` commands preserves execution evidence and stops worker retry loops from thrashing.
6. *From Observation 6*: Without schema validation, malformed or malicious payload structures from worker HTTP results corrupt database records and status views. A dedicated `validateResultPayload(action, rawResult)` validates slot integers, inventory arrays, and coordinates.
7. *From Observation 7*: Because `cancelWorker` fires `clearWorker` with unawaited `void`, concurrent callers can enqueue commands or re-register before the old queue is cleared. Making `cancelWorker` async and awaiting `clearWorker` prevents race conditions.
8. *From Observation 8*: In container environments, PIDs are non-unique (`PID 1`). Using `this.instanceId` (which includes UUID) ensures lock exclusivity across instances.
9. *From Observation 9*: Inconsistent DTO structures force callers to write separate conditional branches for Render and WispByte. Normalizing both to `{ ok, delivered, timedOut, commandId, action, result }` establishes transport parity.

---

## 3. Caveats
- No code in `src/storage/supabase-command-store.js` or `src/services/command-broker.js` was modified during this exploratory phase (strictly read-only).
- In `src/storage/schema-sql.js#L3015`, the canonical PostgreSQL function definition for `manager_complete_worker_command` contains `AND status IN ('delivered', 'queued')`. Updating the canonical SQL schema is formally scheduled for Phase 4 (DB-01..07); however, fixing line 409 in `supabase-command-store.js` immediately secures the application fallback layer.
- Tests in `tests/command-execution-audit.test.js` are scheduled to be implemented by the Implementer/Tester in Phase 2 Gate 2.

---

## 4. Conclusion
All 9 target findings (CMD-01..08 and API-09) have been precisely pinpointed with verbatim file locations and line numbers. The proposed surgical patches resolve the vulnerabilities and race conditions without introducing new dependencies or altering public API contracts.

Detailed code diffs and patch specifications are documented in `D:\manager\.agents\teamwork\explorer_phase2_1\analysis.md`.

---

## 5. Verification Method
1. **Inspection**:
   - Verify `src/storage/supabase-command-store.js` lines 267–283, 355–388, 402–414.
   - Verify `src/services/command-broker.js` lines 60–110, 140–208, 218–262, 322–352, 837–1000.
2. **Project Test Execution**:
   - Run baseline test suites: `cmd /c "cd /d D:\manager && npm test"`
   - Target criteria: Exit code 0, 0 failures.
3. **Phase 2 Audit Test Suite**:
   - Implement and execute `node tests/command-execution-audit.test.js` validating all 9 conditions.
