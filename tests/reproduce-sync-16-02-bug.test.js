'use strict';

const assert = require('node:assert');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');

let row = { worker_id: 'w1', events: [], last_event: null };
const mockClient = {
  rpc: async () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } }),
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    update: (updates) => ({ eq: () => ({ select: () => ({ maybeSingle: async () => { Object.assign(row, updates); return { data: row, error: null }; } }) }) })
  })
};

const store = new SupabaseWorkerStore(mockClient);

async function testBug() {
  console.log('Testing SYNC-16-02 false deduplication on events with distinct IDs but missing message/occurredAt...');
  
  // Event 1: Player joins
  await store.addEvent('w1', { id: 'evt_join_1', type: 'player_join' });
  
  // Event 2: A different player joins with a distinct event ID
  await store.addEvent('w1', { id: 'evt_join_2', type: 'player_join' });
  
  console.log('Actual events in store:', row.events);
  console.log('Events length:', row.events.length);
  
  // They have different event IDs! They should BOTH be in row.events!
  assert.strictEqual(row.events.length, 2, 'Both distinct events must be recorded!');
  console.log('✅ TEST PASSED: No bug');
}

testBug().catch((err) => {
  console.error('❌ BUG CONFIRMED REPRODUCIBLE:', err.message);
  process.exit(1);
});
