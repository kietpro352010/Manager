# Handoff Report: Challenger 1 (Gate 3 - Concurrency & Network Security)

**Challenger**: `teamwork_challenger_m1_1`  
**Working Directory**: `D:\manager`  
**State Folder**: `C:\Users\kietp\.gemini\antigravity\scratch\teamwork\6242db72-e099-40d9-9962-cb0de56ae2b0\.agents\teamwork\teamwork_challenger_m1_1\`  
**Date**: 2026-11-14T09:10:00Z  
**Verdict**: **REJECT**

---

## 1. Observation

### Observation 1: AsyncKeyLock Queue Tail Severing on Wait Timeout
- **File**: `D:\manager\src\services\async-key-lock.js`
- **Lines**: 86–97
- **Source Code**:
  ```javascript
  86:   decrementCount(key, tail) {
  87:     const current = (this.counts.get(key) || 1) - 1;
  88:     if (current <= 0) {
  89:       this.counts.delete(key);
  90:       this.tails.delete(key);
  91:     } else {
  92:       this.counts.set(key, current);
  93:       if (this.tails.get(key) === tail) {
  94:         this.tails.delete(key);
  95:       }
  96:     }
  97:   }
  ```
- **Observed Behavior via Empirical Probe**:
  When a queued task at the tail of the waiting chain encounters a `waitTimeoutMs` timeout while previous tasks are still executing or queued:
  1. The timed-out task calls `this.decrementCount(key, tail)` from its `catch (waitErr)` handler (lines 41–44).
  2. Because this task was the most recently queued task, `this.tails.get(key) === tail` evaluates to `true`.
  3. Lines 93–95 call `this.tails.delete(key)`, removing the tail promise from `this.tails` even though `current > 0` and prior tasks are actively running in the critical section!
  4. When a new task arrives later, line 14 evaluates:
     `const previous = this.tails.get(key) || Promise.resolve();`
     Because `this.tails.get(key)` was deleted, `previous` is `Promise.resolve()`.
  5. The new task immediately enters the critical section concurrently while the earlier task is STILL executing!

- **Verbatim Test Execution**:
  Under a 50-task workload structured into 10 rounds where a tail waiting task times out before a subsequent task arrives:
  ```
  Total rounds: 10
  Rounds with mutual exclusion violations: 10
  Max concurrent critical section executions: 2
  AssertionError: Lock must NEVER allow more than 1 task in critical section (2 !== 1)
  ```
  Execution output trace:
  ```
  [T1] enter
  [T3] timeout: tails.has("g") = false counts = 2
  At t=40ms: tails.has("g") = false counts = 2
  [T4] enter
  [T4] exit
  [T1] exit
  ```
  `T4` entered the critical section at `t=40ms` while `T1` was actively running, breaking the fundamental mutual exclusion invariant of `AsyncKeyLock`.

- **Interaction with Execution Timeout**:
  If Task 1 suffers an execution timeout (holding the lock until settled in background), and Task 2 waiting in queue times out on `waitTimeoutMs`:
  Task 2's timeout deletes `this.tails.get(key)`. A subsequent Task 3 immediately executes concurrently with Task 1 while Task 1 is still settling in the background.

### Observation 2: EntitlementService Key Serialization
- **File**: `D:\manager\src\services\entitlement-service.js`
- **Lines**: 170–178
- **Source Code**:
  ```javascript
  170:   async redeem(userId, rawCode, discordRole = 'user') {
  171:     const run = () => this.redeemLocked(userId, rawCode, discordRole);
  172:     if (!this.userLock) return run();
  173:     const codeHash = hashCode(rawCode);
  174:     return this.userLock.run(`key:${codeHash}`, () =>
  175:       this.userLock.run('global:bot_allocation', () =>
  176:         this.userLock.run(userId, run)
  177:       )
  178:     );
  179:   }
  ```
- **Observed Behavior via Empirical Probe**:
  1. In a test simulating 20 concurrent parallel redemptions of the exact same key code (`KM-STRESS-20-CONCURRENT-KEY`) under normal lock parameters:
     - Fulfilled: 1 (5%)
     - Rejected: 19 (95%)
     - Key consumed count: exactly 1
     - Concurrent store calls: 1 (strictly serialized)
  2. In a test simulating 50 concurrent parallel redemptions of the exact same key code:
     - Fulfilled: 1 (2%)
     - Rejected: 49 (98%)
     - Key consumed count: exactly 1
     - Concurrent store calls: 1 (strictly serialized)
  3. However, because `EntitlementService` uses `AsyncKeyLock` as its concurrency engine, any queue timeout affecting `global:bot_allocation` or `key:${codeHash}` is subject to the tail deletion bug identified in Observation 1.

---

## 2. Logic Chain

1. **Step 1**: An asynchronous key lock's sole invariant is that at most one task may execute in the critical section for a given key at any point in time (`concurrent <= 1`).
2. **Step 2**: In `D:\manager\src\services\async-key-lock.js`, lines 93–95 unconditionally delete `this.tails.get(key)` whenever `this.tails.get(key) === tail`, regardless of whether `current > 0`.
3. **Step 3**: When any task waiting at the tail of the queue times out (`waitTimeoutMs`), it is by definition the latest tail (`this.tails.get(key) === tail`), causing line 94 to delete `key` from `this.tails`.
4. **Step 4**: Any task dispatched after that moment sees `this.tails.get(key)` as `undefined`, resolving `previous` immediately via `Promise.resolve()`.
5. **Step 5**: As observed in the empirical probe, the subsequent task enters the critical section concurrently while the previous task is still running, yielding `maxConcurrent = 2` (10 out of 10 rounds).
6. **Step 6**: Therefore, `AsyncKeyLock` fails to guarantee mutual exclusion under realistic mixed timeout and concurrent queuing workloads.

---

## 3. Caveats

- In the absence of queue wait timeouts (e.g. when all queued tasks either execute to completion or wait indefinitely without timing out), `AsyncKeyLock` and `EntitlementService` maintain mutual exclusion.
- The 20-concurrent redemption test for `EntitlementService` with default timeouts passed (1 succeeded, 19 failed) because the queue did not suffer a tail timeout.
- The failure mode in `AsyncKeyLock` is deterministic and 100% reproducible when a tail task times out waiting.

---

## 4. Conclusion

**Verdict: REJECT**

Milestone 1 cannot be approved because `AsyncKeyLock` contains a critical concurrency regression:
- In `D:\manager\src\services\async-key-lock.js:93-95`, deleting the tail when `this.tails.get(key) === tail` while `current > 0` causes subsequent tasks to jump ahead and execute concurrently in the critical section with running tasks.
- **Recommended Remediation**:
  In `D:\manager\src\services\async-key-lock.js`, delete lines 93–95 so that `this.tails.delete(key)` is ONLY invoked when `current <= 0` (lines 88–90). The chained promise `tail` already resolves automatically upon `previous` completion because the timed-out task called `release()`. Retaining `tail` ensures incoming tasks continue to wait in FIFO order behind all active tasks.

---

## 5. Verification Method

### How to Reproduce the Concurrency Defect

Run the following isolated probe script using PowerShell and Node.js:

```powershell
$probeDir = Join-Path ([IO.Path]::GetTempPath()) "teamwork_probe_$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $probeDir -Force | Out-Null
$probeScript = @'
const assert = require('node:assert');
const AsyncKeyLock = require('D:/manager/src/services/async-key-lock.js');

async function reproduce() {
  const lock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;

  // Task 1: long running task (100ms)
  const t1 = lock.run('k', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(r => setTimeout(r, 100));
    concurrent--;
  });

  // Task 2: queued behind Task 1 (normal wait)
  const t2 = lock.run('k', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(r => setTimeout(r, 20));
    concurrent--;
  });

  // Task 3: queued at tail with short wait timeout (20ms)
  const t3 = lock.run('k', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(r => setTimeout(r, 20));
    concurrent--;
  }, { waitTimeoutMs: 20 }).catch(() => {});

  // Wait 40ms: Task 3 times out waiting and deletes the tail!
  await new Promise(r => setTimeout(r, 40));

  // Task 4 arrives at t=40ms while Task 1 is still running (40ms / 100ms)
  const t4 = lock.run('k', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(r => setTimeout(r, 20));
    concurrent--;
  });

  await Promise.allSettled([t1, t2, t3, t4]);
  console.log('Max concurrent executions:', maxConcurrent);
  assert.strictEqual(maxConcurrent, 1, 'MUTUAL EXCLUSION VIOLATED!');
}

reproduce().catch(err => {
  console.error('PRODUCED ERROR:', err.message);
  process.exit(1);
});
'@
Set-Content -Path (Join-Path $probeDir "reproduce.js") -Value $probeScript
node (Join-Path $probeDir "reproduce.js")
Remove-Item -Path $probeDir -Recurse -Force
```

**Observed Result**:
Exit code 1.
`Max concurrent executions: 2`
`PRODUCED ERROR: MUTUAL EXCLUSION VIOLATED!`

### Invalidation Conditions
- Once lines 93–95 in `D:\manager\src\services\async-key-lock.js` are removed, the above test script exits with code 0 (`Max concurrent executions: 1`), confirming the fix.
