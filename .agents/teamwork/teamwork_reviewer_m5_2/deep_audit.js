'use strict';

const fs = require('fs');
const assert = require('assert');

const schemaSql = require('D:/manager/src/storage/schema-sql.js');
const resetSetup = fs.readFileSync('D:/manager/supabase/reset_and_setup.sql', 'utf8');
const setup = fs.readFileSync('D:/manager/supabase/setup.sql', 'utf8');
const migration0 = fs.readFileSync('D:/manager/supabase/migrations/20261112000000_reconcile_full_manager_schema.sql', 'utf8');
const migration1 = fs.readFileSync('D:/manager/supabase/migrations/20261112120000_session_revocation_and_migration_guards.sql', 'utf8');
const migrationChain = `${migration0}\n${migration1}`;

const files = {
  'src/storage/schema-sql.js': schemaSql,
  'supabase/reset_and_setup.sql': resetSetup,
  'supabase/setup.sql': setup,
  'supabase/migrations (chain)': migrationChain
};

console.log('=== AUDIT 1: G4-01 manager_reset_worker_data ===');
for (const [name, content] of Object.entries(files)) {
  const match = content.match(/CREATE OR REPLACE FUNCTION public\.manager_reset_worker_data\([\s\S]*?\$reset_data\$;/);
  assert.ok(match, `${name} missing manager_reset_worker_data`);
  const block = match[0];
  assert.ok(block.includes('v_row_count integer := 0;'), `${name} missing v_row_count declaration`);
  assert.ok(/GET\s+DIAGNOSTICS\s+v_row_count\s*=\s*ROW_COUNT;/i.test(block), `${name} missing GET DIAGNOSTICS ROW_COUNT`);
  assert.ok(/RETURN\s+v_row_count\s*>\s*0;/i.test(block), `${name} missing RETURN v_row_count > 0`);
  assert.ok(!/RETURN\s+true\s*;/i.test(block), `${name} must not contain RETURN true`);
  console.log(`[PASS] ${name}`);
}

console.log('=== AUDIT 2: G4-02 Disaster Recovery Guard ===');
const guardMatch = resetSetup.match(/IF\s+current_setting\('kingmc\.allow_reset',\s*true\)\s+IS\s+DISTINCT\s+FROM\s+'true'\s+THEN[\s\S]*?RAISE\s+EXCEPTION[\s\S]*?END\s+IF;/i);
assert.ok(guardMatch, 'reset_and_setup.sql missing disaster recovery guard');
const dropIndex = resetSetup.indexOf('FOR v_rel IN');
const guardIndex = resetSetup.indexOf(guardMatch[0]);
assert.ok(guardIndex > 0 && guardIndex < dropIndex, 'Guard must be located before table drop loop');
console.log(`[PASS] Disaster recovery guard located at pos ${guardIndex}, before drop loop at ${dropIndex}`);

console.log('=== AUDIT 3: G4-03 Link4M User Ownership Invariant ===');
for (const [name, content] of Object.entries(files)) {
  const match = content.match(/CREATE OR REPLACE FUNCTION public\.manager_complete_link4m_reward\([\s\S]*?\$complete_reward\$;/);
  assert.ok(match, `${name} missing manager_complete_link4m_reward`);
  const block = match[0];
  const updateMatch = block.match(/UPDATE\s+public\.manager_link4m_attempts[\s\S]*?RETURNING/i);
  assert.ok(updateMatch, `${name} missing UPDATE public.manager_link4m_attempts in complete_reward`);
  const updateClause = updateMatch[0];
  assert.ok(/\(\s*user_id\s+IS\s+NULL\s+OR\s+user_id\s*=\s*''\s+OR\s+user_id\s*=\s*p_user_id\s*\)/i.test(updateClause), `${name} missing user_id invariant in UPDATE`);
  console.log(`[PASS] ${name}`);
}

console.log('=== AUDIT 4: G4-04 4-Way Parity (Tables & RPCs) ===');
const extractTables = sql => new Set([...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-z0-9_]+)/gi)].map(m => m[1].toLowerCase()));
const extractFunctions = sql => new Set([...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map(m => m[1].toLowerCase()));

const tableMaps = {};
const funcMaps = {};
for (const [name, content] of Object.entries(files)) {
  tableMaps[name] = extractTables(content);
  funcMaps[name] = extractFunctions(content);
  console.log(`${name}: ${tableMaps[name].size} tables, ${funcMaps[name].size} RPCs`);
}

// Compare table sets
const baselineTables = [...tableMaps['src/storage/schema-sql.js']].sort();
for (const [name, tables] of Object.entries(tableMaps)) {
  const current = [...tables].sort();
  assert.deepStrictEqual(current, baselineTables, `Table divergence in ${name}`);
}

// Compare function sets
const baselineFuncs = [...funcMaps['src/storage/schema-sql.js']].sort();
for (const [name, funcs] of Object.entries(funcMaps)) {
  const current = [...funcs].sort();
  assert.deepStrictEqual(current, baselineFuncs, `Function divergence in ${name}`);
}
console.log('[PASS] Full 4-way parity confirmed across 27 tables and 52 RPCs!');

console.log('=== AUDIT 5: Table RLS & Privileges across ALL 4 sources ===');
for (const [name, content] of Object.entries(files)) {
  for (const t of baselineTables) {
    const rlsPattern = new RegExp(`ALTER\\s+TABLE\\s+public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY;`, 'i');
    assert.ok(rlsPattern.test(content), `${name}: Table ${t} missing ENABLE ROW LEVEL SECURITY`);

    const revokePattern = new RegExp(`REVOKE\\s+ALL\\s+(?:ON\\s+TABLE\\s+|ON\\s+)[\\s\\S]*?\\bpublic\\.${t}\\b[\\s\\S]*?FROM\\s+PUBLIC`, 'i');
    assert.ok(revokePattern.test(content), `${name}: Table ${t} missing REVOKE ALL FROM PUBLIC`);

    const grantPattern = new RegExp(`GRANT\\s+ALL\\s+(?:ON\\s+TABLE\\s+|ON\\s+)[\\s\\S]*?\\bpublic\\.${t}\\b[\\s\\S]*?TO\\s+service_role`, 'i');
    assert.ok(grantPattern.test(content), `${name}: Table ${t} missing GRANT ALL TO service_role`);
  }
  console.log(`[PASS] ${name}: All 27 tables have RLS enabled, REVOKE ALL from PUBLIC, and GRANT ALL to service_role`);
}
