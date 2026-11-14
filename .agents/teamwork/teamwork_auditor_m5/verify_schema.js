'use strict';
const fs = require('fs');

const schemaSql = require('D:/manager/src/storage/schema-sql.js');

function extractFunctionBlock(sql, fnName) {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}(`;
  const start = sql.indexOf(marker);
  if (start === -1) throw new Error(`Not found ${fnName}`);
  const endGrant = sql.indexOf(`GRANT EXECUTE ON FUNCTION public.${fnName}`, start);
  const endSemi = sql.indexOf(';', endGrant);
  return sql.slice(start, endSemi + 1);
}

console.log('=== manager_reset_worker_data in schema-sql.js ===');
console.log(extractFunctionBlock(schemaSql, 'manager_reset_worker_data'));

console.log('\n=== manager_complete_link4m_reward in schema-sql.js (WHERE clause) ===');
const link4m = extractFunctionBlock(schemaSql, 'manager_complete_link4m_reward');
const updateAttempt = link4m.match(/UPDATE\s+public\.manager_link4m_attempts[\s\S]*?RETURNING/i);
console.log(updateAttempt ? updateAttempt[0] : 'NOT FOUND');
