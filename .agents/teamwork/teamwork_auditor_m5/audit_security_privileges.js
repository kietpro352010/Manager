'use strict';
const fs = require('fs');

const sources = [
  ['schema-sql.js', require('D:/manager/src/storage/schema-sql.js')],
  ['reset_and_setup.sql', fs.readFileSync('D:/manager/supabase/reset_and_setup.sql', 'utf8')],
  ['setup.sql', fs.readFileSync('D:/manager/supabase/setup.sql', 'utf8')],
  ['reconcile_full_manager_schema.sql', fs.readFileSync('D:/manager/supabase/migrations/20261112000000_reconcile_full_manager_schema.sql', 'utf8')]
];

for (const [name, sql] of sources) {
  // Extract all CREATE TABLE IF NOT EXISTS public.<tbl>
  const tables = [...new Set([...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-z0-9_]+)/gi)].map(m => m[1]))];
  const funcs = [...new Set([...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map(m => m[1]))];

  console.log(`\n=== [${name}] ===`);
  console.log(`Tables: ${tables.length}, Functions: ${funcs.length}`);

  // Check RLS on tables
  const unhandledRls = [];
  const unhandledTableRevoke = [];
  for (const t of tables) {
    if (!sql.match(new RegExp(`ALTER\\s+TABLE\\s+public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'))) {
      unhandledRls.push(t);
    }
    // Check if table is in a REVOKE statement
    if (!sql.match(new RegExp(`REVOKE\\s+ALL\\s+(?:ON\\s+(?:TABLE\\s+)?[\\s\\S]*?\\bpublic\\.${t}\\b[\\s\\S]*?FROM\\s+PUBLIC)`, 'i'))) {
      unhandledTableRevoke.push(t);
    }
  }

  console.log(`Missing RLS: ${unhandledRls.length ? unhandledRls.join(', ') : 'NONE'}`);
  console.log(`Missing Table Revoke: ${unhandledTableRevoke.length ? unhandledTableRevoke.join(', ') : 'NONE'}`);

  // Check functions
  const missingSecDefiner = [];
  const missingSearchPath = [];
  const missingFnRevoke = [];

  for (const f of funcs) {
    // Check function definition block
    const fnDefRegex = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\s+public\\.${f}\\s*\\([\\s\\S]*?AS\\s+\\$`, 'i');
    const match = sql.match(fnDefRegex);
    if (!match) {
      console.log(`  Cannot find fn definition for ${f}`);
      continue;
    }
    if (!match[0].includes('SECURITY DEFINER')) {
      missingSecDefiner.push(f);
    }
    if (!match[0].includes('SET search_path = public, pg_temp')) {
      missingSearchPath.push(f);
    }
    // Check REVOKE
    const revokeRegex = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${f}\\b[\\s\\S]*?FROM\\s+PUBLIC`, 'i');
    if (!sql.match(revokeRegex)) {
      missingFnRevoke.push(f);
    }
  }

  console.log(`Missing SECURITY DEFINER: ${missingSecDefiner.length ? missingSecDefiner.join(', ') : 'NONE'}`);
  console.log(`Missing search_path: ${missingSearchPath.length ? missingSearchPath.join(', ') : 'NONE'}`);
  console.log(`Missing Function Revoke: ${missingFnRevoke.length ? missingFnRevoke.join(', ') : 'NONE'}`);
}
