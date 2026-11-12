'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Pool, Client } = require('pg');

const schemaSql = require('../src/storage/schema-sql');
const { SUPABASE_REQUIRED_TABLES, SupabaseAdapter } = require('../src/storage/supabase-client');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const { createApp } = require('../src/http/app');
const { PUBLIC_LOGIN_HTML } = require('../src/http/views/login-html');
const { HTML: DASHBOARD_HTML } = require('../src/http/views/dashboard-html');
const { encryptUserPassword } = require('../src/utils/secrets');

const REPO_ROOT = path.resolve(__dirname, '..');
const CMD_UUID_RE = /^cmd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
  });
}

async function loadEmbeddedPostgresClass() {
  const candidates = [];
  if (process.env.EMBEDDED_PG_MODULE) {
    candidates.push(process.env.EMBEDDED_PG_MODULE);
  }
  candidates.push('embedded-postgres');

  for (const modPath of candidates) {
    try {
      const loaded = require(modPath);
      return loaded.default || loaded;
    } catch (_) {
      // Fallback to ESM import for directory / ESM exports paths
    }
    try {
      let target = modPath;
      if (fs.existsSync(modPath) && fs.statSync(modPath).isDirectory()) {
        const pkgFile = path.join(modPath, 'package.json');
        let entry = 'index.js';
        if (fs.existsSync(pkgFile)) {
          const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
          const exp = typeof pkg.exports === 'string' ? pkg.exports : pkg.main;
          if (exp) entry = exp;
        }
        target = path.resolve(modPath, entry);
      }
      const urlOrSpec = fs.existsSync(target) ? pathToFileURL(target).href : target;
      const loaded = await import(urlOrSpec);
      return loaded.default || loaded;
    } catch (_) {
      // Try next candidate
    }
  }
  return null;
}

async function ensureSupabaseRoles(client) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END $$;
  `);
}

async function grantPublicSchema(client) {
  await client.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;');
}

async function startPostgresHarness() {
  if (process.env.DATABASE_URL) {
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const probe = await adminPool.connect();
    try {
      await ensureSupabaseRoles(probe);
    } finally {
      probe.release();
    }
    const baseUrl = new URL(process.env.DATABASE_URL);
    return {
      mode: 'external',
      createDatabase: async (suffix) => {
        const dbName = `mgr_real_${suffix}_${crypto.randomBytes(4).toString('hex')}`;
        await adminPool.query(`CREATE DATABASE "${dbName}"`);
        const dbUrl = new URL(baseUrl.toString());
        dbUrl.pathname = `/${dbName}`;
        const pool = new Pool({ connectionString: dbUrl.toString(), max: 12 });
        await grantPublicSchema(pool);
        return {
          dbName,
          pool,
          close: async () => {
            await pool.end().catch(() => {});
            await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
          }
        };
      },
      shutdown: async () => {
        await adminPool.end().catch(() => {});
      }
    };
  }

  const EmbeddedPostgres = await loadEmbeddedPostgresClass();
  if (!EmbeddedPostgres) {
    throw new Error(
      'Real Postgres test suite requires DATABASE_URL (CI postgres:16 service) or EMBEDDED_PG_MODULE / embedded-postgres.'
    );
  }

  const port = await getFreePort();
  const dbDir = path.join(os.tmpdir(), `manager-pg-real-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.rmSync(dbDir, { recursive: true, force: true });
  const pgPassword = 'mgr_test_pg_password';
  const embedded = new EmbeddedPostgres({
    databaseDir: dbDir,
    user: 'postgres',
    password: pgPassword,
    port,
    persistent: false,
    initdbFlags: ['-E', 'UTF8', '--no-locale']
  });
  await embedded.initialise();
  await embedded.start();

  const adminPool = new Pool({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: pgPassword,
    database: 'postgres',
    max: 6
  });
  await ensureSupabaseRoles(adminPool);

  return {
    mode: 'embedded',
    createDatabase: async (suffix) => {
      const dbName = `mgr_real_${suffix}_${crypto.randomBytes(4).toString('hex')}`;
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      const pool = new Pool({
        host: '127.0.0.1',
        port,
        user: 'postgres',
        password: pgPassword,
        database: dbName,
        max: 12
      });
      await grantPublicSchema(pool);
      return {
        dbName,
        pool,
        close: async () => {
          await pool.end().catch(() => {});
          await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
        }
      };
    },
    shutdown: async () => {
      await adminPool.end().catch(() => {});
      await embedded.stop().catch(() => {});
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  };
}

function toPgError(err) {
  return {
    code: err?.code || 'P0001',
    message: err?.message || String(err),
    details: err?.detail || null,
    hint: err?.hint || null
  };
}

function createPgSupabaseClient(pool, role = 'service_role') {
  const ALLOWED_ROLES = new Set(['service_role', 'anon', 'authenticated', 'postgres']);
  if (!ALLOWED_ROLES.has(role)) throw new Error(`Unsupported PG role: ${role}`);

  const tableColCache = new Map();

  async function getColumnTypes(conn, tableName) {
    if (tableColCache.has(tableName)) return tableColCache.get(tableName);
    const { rows } = await conn.query(
      `SELECT column_name, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    const map = new Map(rows.map((r) => [r.column_name, r.udt_name]));
    if (map.size > 0) tableColCache.set(tableName, map);
    return map;
  }

  function serializeParamValue(val, udtName) {
    if (val === undefined) return { value: null, cast: '' };
    if (val === null) return { value: null, cast: '' };
    const type = String(udtName || '').toLowerCase();
    if (type === 'jsonb' || type === 'json') {
      return { value: typeof val === 'string' ? val : JSON.stringify(val), cast: '::jsonb' };
    }
    if (type === '_text') {
      return { value: Array.isArray(val) ? val.map(String) : [String(val)], cast: '::text[]' };
    }
    if (type === 'timestamptz') {
      return { value: val instanceof Date ? val.toISOString() : String(val), cast: '::timestamptz' };
    }
    if (type === 'uuid') {
      return { value: String(val), cast: '::uuid' };
    }
    if (type === 'int4' || type === 'integer') {
      return { value: Number(val), cast: '::integer' };
    }
    if (type === 'int8' || type === 'bigint') {
      return { value: String(val), cast: '::bigint' };
    }
    if (type === 'float8' || type === 'double precision') {
      return { value: Number(val), cast: '::double precision' };
    }
    if (type === 'bool' || type === 'boolean') {
      return { value: Boolean(val), cast: '::boolean' };
    }
    return {
      value: typeof val === 'object' ? JSON.stringify(val) : val,
      cast: type === 'text' ? '::text' : ''
    };
  }

  function quoteIdent(ident) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
      throw new Error(`Invalid SQL identifier: ${ident}`);
    }
    return `"${ident}"`;
  }

  async function withRoleTx(fn) {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      if (role !== 'postgres') {
        await conn.query(`SET LOCAL ROLE ${role}`);
      }
      const res = await fn(conn);
      await conn.query('COMMIT');
      return res;
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }

  return {
    async rpc(fnName, params = {}) {
      try {
        return await withRoleTx(async (conn) => {
          const { rows: metaRows } = await conn.query(
            `SELECT p.proretset,
                    p.proargnames,
                    COALESCE(
                      ARRAY(
                        SELECT pg_catalog.format_type(t, NULL)
                        FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) AS t
                      ),
                      '{}'::text[]
                    ) AS arg_types
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = $1
             LIMIT 1`,
            [fnName]
          );

          if (!metaRows.length) {
            return {
              data: null,
              error: { code: 'PGRST202', message: `Could not find function public.${fnName} in schema cache` }
            };
          }

          const meta = metaRows[0];
          const argNames = meta.proargnames || [];
          const argTypes = meta.arg_types || [];
          const namedParts = [];
          const bindValues = [];

          for (const [key, rawVal] of Object.entries(params || {})) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
              throw new Error(`Invalid RPC param name: ${key}`);
            }
            const idx = argNames.indexOf(key);
            const declaredType = idx >= 0 ? String(argTypes[idx] || '').toLowerCase() : '';
            let udt = '';
            if (declaredType.includes('jsonb') || declaredType.includes('json')) udt = 'jsonb';
            else if (declaredType.includes('text[]') || declaredType.includes('character varying[]')) udt = '_text';
            else if (declaredType.includes('timestamp')) udt = 'timestamptz';
            else if (declaredType === 'uuid') udt = 'uuid';
            else if (declaredType === 'bigint') udt = 'int8';
            else if (declaredType === 'integer') udt = 'int4';
            else if (declaredType === 'double precision') udt = 'float8';
            else if (declaredType === 'boolean') udt = 'bool';
            else if (declaredType === 'text') udt = 'text';

            const serialized = serializeParamValue(rawVal, udt);
            bindValues.push(serialized.value);
            namedParts.push(`${key} => $${bindValues.length}${serialized.cast}`);
          }

          const callExpr = `public.${quoteIdent(fnName)}(${namedParts.join(', ')})`;
          const sql = meta.proretset ? `SELECT * FROM ${callExpr}` : `SELECT ${callExpr} AS __rpc_result`;
          const res = await conn.query(sql, bindValues);
          const data = meta.proretset ? res.rows : (res.rows[0]?.__rpc_result ?? null);
          return { data, error: null };
        });
      } catch (err) {
        return { data: null, error: toPgError(err) };
      }
    },

    from(tableName) {
      const state = {
        op: 'select',
        selectCols: '*',
        wantReturning: false,
        headOnly: false,
        countMode: null,
        payload: null,
        upsertOpts: null,
        filters: [],
        orders: [],
        limitCount: null,
        singleMode: null
      };

      const buildWhere = (colTypes, params) => {
        if (!state.filters.length) return '';
        const clauses = state.filters.map((f) => {
          if (f.type === 'or') {
            const orParts = String(f.expr || '')
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part) => {
                const m = part.match(/^([a-zA-Z0-9_]+)\.eq\.(.*)$/);
                if (!m) throw new Error(`Unsupported .or() clause: ${part}`);
                const [, col, val] = m;
                const s = serializeParamValue(val, colTypes.get(col));
                params.push(s.value);
                return `${quoteIdent(col)} = $${params.length}${s.cast}`;
              });
            return `(${orParts.join(' OR ')})`;
          }
          if (f.type === 'in') {
            const arr = Array.isArray(f.val) ? f.val : [];
            if (!arr.length) return 'FALSE';
            const placeholders = arr.map((v) => {
              const s = serializeParamValue(v, colTypes.get(f.col));
              params.push(s.value);
              return `$${params.length}${s.cast}`;
            });
            return `${quoteIdent(f.col)} IN (${placeholders.join(', ')})`;
          }
          if (f.type === 'not_in') {
            const arr = Array.isArray(f.val) ? f.val : [];
            if (!arr.length) return 'TRUE';
            const placeholders = arr.map((v) => {
              const s = serializeParamValue(v, colTypes.get(f.col));
              params.push(s.value);
              return `$${params.length}${s.cast}`;
            });
            return `${quoteIdent(f.col)} NOT IN (${placeholders.join(', ')})`;
          }
          if (f.type === 'contains') {
            const s = serializeParamValue(f.val, colTypes.get(f.col));
            params.push(s.value);
            return `${quoteIdent(f.col)} @> $${params.length}${s.cast}`;
          }
          if (f.val === null && f.op === '=') return `${quoteIdent(f.col)} IS NULL`;
          if (f.val === null && f.op === '<>') return `${quoteIdent(f.col)} IS NOT NULL`;
          const s = serializeParamValue(f.val, colTypes.get(f.col));
          params.push(s.value);
          return `${quoteIdent(f.col)} ${f.op} $${params.length}${s.cast}`;
        });
        return ` WHERE ${clauses.join(' AND ')}`;
      };

      const execute = async () => {
        try {
          return await withRoleTx(async (conn) => {
            const colTypes = await getColumnTypes(conn, tableName);
            const params = [];
            let sql = '';

            if (state.op === 'select') {
              const colsSql = state.selectCols === '*'
                ? '*'
                : state.selectCols.split(',').map((c) => quoteIdent(c.trim())).join(', ');
              sql = `SELECT ${colsSql} FROM public.${quoteIdent(tableName)}${buildWhere(colTypes, params)}`;
              if (state.orders.length) {
                sql += ' ORDER BY ' + state.orders.map((o) => `${quoteIdent(o.col)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ');
              }
              if (Number.isInteger(state.limitCount) && state.limitCount >= 0) {
                sql += ` LIMIT ${state.limitCount}`;
              }
            } else if (state.op === 'insert' || state.op === 'upsert') {
              const items = Array.isArray(state.payload) ? state.payload : [state.payload];
              const cols = [...new Set(items.flatMap((row) => Object.keys(row || {})))];
              const colSql = cols.map(quoteIdent).join(', ');
              const rowTuples = items.map((row) => {
                const placeholders = cols.map((col) => {
                  const s = serializeParamValue(row[col], colTypes.get(col));
                  params.push(s.value);
                  return `$${params.length}${s.cast}`;
                });
                return `(${placeholders.join(', ')})`;
              });
              sql = `INSERT INTO public.${quoteIdent(tableName)} (${colSql}) VALUES ${rowTuples.join(', ')}`;
              if (state.op === 'upsert') {
                const conflictCols = String(state.upsertOpts?.onConflict || 'id')
                  .split(',')
                  .map((c) => quoteIdent(c.trim()))
                  .join(', ');
                if (state.upsertOpts?.ignoreDuplicates) {
                  sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
                } else {
                  const updates = cols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`);
                  sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates.join(', ')}`;
                }
              }
              if (state.wantReturning) sql += ' RETURNING *';
            } else if (state.op === 'update') {
              const setParts = Object.entries(state.payload || {}).map(([col, val]) => {
                const s = serializeParamValue(val, colTypes.get(col));
                params.push(s.value);
                return `${quoteIdent(col)} = $${params.length}${s.cast}`;
              });
              sql = `UPDATE public.${quoteIdent(tableName)} SET ${setParts.join(', ')}${buildWhere(colTypes, params)}`;
              if (state.wantReturning) sql += ' RETURNING *';
            } else if (state.op === 'delete') {
              sql = `DELETE FROM public.${quoteIdent(tableName)}${buildWhere(colTypes, params)}`;
              if (state.wantReturning) sql += ' RETURNING *';
            }

            const res = await conn.query(sql, params);
            if (state.singleMode === 'maybeSingle') {
              return { data: res.rows[0] || null, error: null, count: res.rowCount };
            }
            if (state.singleMode === 'single') {
              if (!res.rows.length) {
                return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
              }
              return { data: res.rows[0], error: null, count: res.rowCount };
            }
            return { data: state.headOnly ? null : res.rows, error: null, count: res.rowCount };
          });
        } catch (err) {
          return { data: null, error: toPgError(err) };
        }
      };

      const builder = {
        select(cols = '*', opts = {}) {
          if (state.op === 'select') {
            state.selectCols = String(cols || '*').trim() || '*';
            if (opts?.head) state.headOnly = true;
            if (opts?.count) state.countMode = opts.count;
          } else {
            state.wantReturning = true;
          }
          return builder;
        },
        insert(payload) {
          state.op = 'insert';
          state.payload = payload;
          return builder;
        },
        upsert(payload, opts = {}) {
          state.op = 'upsert';
          state.payload = payload;
          state.upsertOpts = opts;
          return builder;
        },
        update(payload) {
          state.op = 'update';
          state.payload = payload;
          return builder;
        },
        delete() {
          state.op = 'delete';
          return builder;
        },
        eq(col, val) { state.filters.push({ type: 'cmp', col, op: '=', val }); return builder; },
        neq(col, val) { state.filters.push({ type: 'cmp', col, op: '<>', val }); return builder; },
        gt(col, val) { state.filters.push({ type: 'cmp', col, op: '>', val }); return builder; },
        gte(col, val) { state.filters.push({ type: 'cmp', col, op: '>=', val }); return builder; },
        lt(col, val) { state.filters.push({ type: 'cmp', col, op: '<', val }); return builder; },
        lte(col, val) { state.filters.push({ type: 'cmp', col, op: '<=', val }); return builder; },
        in(col, vals) { state.filters.push({ type: 'in', col, val: vals }); return builder; },
        contains(col, vals) { state.filters.push({ type: 'contains', col, val: vals }); return builder; },
        or(expr) { state.filters.push({ type: 'or', expr }); return builder; },
        not(col, op, expr) {
          if (String(op).toLowerCase() === 'in') {
            const inner = String(expr || '').replace(/^\(|\)$/g, '');
            const vals = inner.split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
            state.filters.push({ type: 'not_in', col, val: vals });
          }
          return builder;
        },
        order(col, opts = {}) {
          state.orders.push({ col, ascending: opts?.ascending !== false });
          return builder;
        },
        limit(n) { state.limitCount = Number(n); return builder; },
        maybeSingle() { state.singleMode = 'maybeSingle'; return execute(); },
        single() { state.singleMode = 'single'; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); }
      };

      return builder;
    }
  };
}

async function inspectPublicCatalog(pool) {
  const tablesRes = await pool.query(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  const viewsRes = await pool.query(`
    SELECT c.relname AS name, c.reloptions
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
    ORDER BY c.relname
  `);
  const seqRes = await pool.query(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
    ORDER BY c.relname
  `);
  const trgRes = await pool.query(`
    SELECT t.tgname AS name, c.relname AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY t.tgname
  `);
  const fnRes = await pool.query(`
    SELECT p.proname AS name,
           p.prosecdef,
           p.proconfig,
           has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname
  `);
  return {
    tables: tablesRes.rows.map((r) => r.name),
    views: viewsRes.rows,
    sequences: seqRes.rows.map((r) => r.name),
    triggers: trgRes.rows,
    functions: fnRes.rows
  };
}

const LEGACY_BACKUP_TABLES = new Set(['manager_access', 'manager_worker_assignments', 'manager_counters']);

function assertCanonicalCatalog(catalog, label, { allowLegacyTables = false } = {}) {
  const canonicalTables = allowLegacyTables
    ? catalog.tables.filter((t) => !LEGACY_BACKUP_TABLES.has(t))
    : catalog.tables;
  assert.strictEqual(canonicalTables.length, 27, `${label}: expected 27 canonical base tables, got ${canonicalTables.length}`);
  if (allowLegacyTables) {
    for (const legacyTbl of LEGACY_BACKUP_TABLES) {
      assert.ok(catalog.tables.includes(legacyTbl), `${label}: expected preserved legacy table ${legacyTbl}`);
    }
  }
  for (const tbl of SUPABASE_REQUIRED_TABLES) {
    assert.ok(canonicalTables.includes(tbl), `${label}: missing required table ${tbl}`);
  }
  assert.ok(canonicalTables.includes('manager_schema_migrations'), `${label}: missing manager_schema_migrations`);

  assert.strictEqual(catalog.views.length, 4, `${label}: expected 4 views`);
  for (const v of catalog.views) {
    const opts = Array.isArray(v.reloptions) ? v.reloptions : [];
    assert.ok(opts.includes('security_invoker=true'), `${label}: view ${v.name} missing security_invoker=true`);
  }

  assert.deepStrictEqual(catalog.sequences, ['manager_bot_number_seq'], `${label}: unexpected sequences`);
  assert.strictEqual(catalog.triggers.length, 5, `${label}: expected 5 triggers`);
  assert.strictEqual(catalog.functions.length, 52, `${label}: expected 52 functions`);

  for (const fn of catalog.functions) {
    assert.strictEqual(fn.prosecdef, true, `${label}: ${fn.name} must be SECURITY DEFINER`);
    const cfg = Array.isArray(fn.proconfig) ? fn.proconfig : [];
    assert.ok(
      cfg.some((item) => item === 'search_path=public, pg_temp'),
      `${label}: ${fn.name} must set search_path = public, pg_temp (got ${JSON.stringify(cfg)})`
    );
    assert.strictEqual(fn.public_exec, false, `${label}: ${fn.name} must NOT be executable by PUBLIC`);
    assert.strictEqual(fn.anon_exec, false, `${label}: ${fn.name} must NOT be executable by anon`);
    assert.strictEqual(fn.auth_exec, false, `${label}: ${fn.name} must NOT be executable by authenticated`);
  }
  return canonicalTables;
}

// ----------------------------------------------------------------------------
// SUITE A: Fresh Install Parity & Catalog Verification
// ----------------------------------------------------------------------------
async function runSuiteAFreshInstalls(harness) {
  console.log('A. Testing fresh SQL installs (schema-sql.js, setup.sql, reset_and_setup.sql, ordered migrations) on real PG 16...');
  const migDir = path.join(REPO_ROOT, 'supabase/migrations');
  const orderedMigrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  assert.strictEqual(orderedMigrations.length, 8, 'Expected 8 SQL files in supabase/migrations');

  const cases = [
    ['schema-sql.js', [schemaSql]],
    ['setup.sql', [fs.readFileSync(path.join(REPO_ROOT, 'supabase/setup.sql'), 'utf8')]],
    ['reset_and_setup.sql', [fs.readFileSync(path.join(REPO_ROOT, 'supabase/reset_and_setup.sql'), 'utf8')]],
    ['ordered_migrations', orderedMigrations.map((f) => fs.readFileSync(path.join(migDir, f), 'utf8'))]
  ];

  let baselineTables = null;
  let baselineFuncs = null;

  for (const [label, scripts] of cases) {
    const db = await harness.createDatabase(`suite_a_${label.replace(/[^a-z0-9]/gi, '_')}`);
    try {
      for (const sqlText of scripts) {
        await db.pool.query(sqlText);
      }
      const catalog = await inspectPublicCatalog(db.pool);
      const canonicalTables = assertCanonicalCatalog(catalog, label, {
        allowLegacyTables: label === 'ordered_migrations'
      });

      if (!baselineTables) {
        baselineTables = canonicalTables;
        baselineFuncs = catalog.functions.map((f) => f.name);
      } else {
        assert.deepStrictEqual(canonicalTables, baselineTables, `${label}: table catalog diverges from schema-sql.js`);
        assert.deepStrictEqual(catalog.functions.map((f) => f.name), baselineFuncs, `${label}: function catalog diverges from schema-sql.js`);
      }

      if (label !== 'schema-sql.js') {
        const migRes = await db.pool.query('SELECT version FROM public.manager_schema_migrations ORDER BY version');
        assert.strictEqual(migRes.rows.length, 8, `${label}: expected 8 migration records`);
      }

      // Idempotent re-execution check
      await db.pool.query(scripts[scripts.length - 1]);
      if (label === 'schema-sql.js') {
        await db.pool.query(schemaSql);
      }
    } finally {
      await db.close();
    }
  }
  console.log('✅ Suite A: All 4 fresh installs & idempotent re-runs match PG 16 catalog identically (27 tables, 4 views, 1 seq, 5 triggers, 52 fns).');
}

// ----------------------------------------------------------------------------
// SUITE B: Legacy 10-Table + UUID command_id Upgrade (Zero Data Loss)
// ----------------------------------------------------------------------------
async function runSuiteBLegacyUpgrade(harness) {
  console.log('B. Testing zero-data-loss convergence migration from legacy 10-table & UUID schemas...');
  const migDir = path.join(REPO_ROOT, 'supabase/migrations');
  const db = await harness.createDatabase('suite_b_legacy');
  try {
    // 1. Apply legacy 20261107..20261111120000 baseline migrations first
    const legacyMigs = [
      '20261107_manager_schema.sql',
      '20261108000000_durable_worker_commands.sql',
      '20261109000000_atomic_entitlement_rewards.sql',
      '20261110000000_atomic_worker_settings.sql',
      '20261111000000_worker_reset_data.sql',
      '20261111120000_command_two_phase_sync.sql'
    ];
    for (const file of legacyMigs) {
      await db.pool.query(fs.readFileSync(path.join(migDir, file), 'utf8'));
    }

    // Seed pre-convergence rows into legacy structures (matching 20261107 constraints)
    const legacyKeyHash = 'a'.repeat(64);
    const legacyTokenHash = 'b'.repeat(64);
    await db.pool.query(`
      INSERT INTO public.manager_workers (worker_id, bot_number, name, provider, secret_ciphertext)
      VALUES ('01', 1, 'Legacy Bot 01', 'render', 'enc_secret_legacy');

      INSERT INTO public.manager_access (user_id, role, status, expires_at, plan_name, note, username)
      VALUES ('111222333444555666', 'user', 'active', '2026-12-31T00:00:00Z', 'PRO', 'legacy owner', 'legacy_user');

      INSERT INTO public.manager_worker_assignments (worker_id, user_id, assigned_by)
      VALUES ('01', '111222333444555666', 'admin_legacy');

      INSERT INTO public.manager_keys (key_id, code_hash, code_suffix, status, days, is_permanent, bot_count, max_uses, used_count, used_users)
      VALUES ('legacy_k1', '${legacyKeyHash}', '1234', 'unused', 30, false, 1, 2, 1, ARRAY['usr_alpha']);

      INSERT INTO public.manager_audit (actor_id, action, target, details, created_at)
      VALUES ('admin_legacy', 'LEGACY_ACTION', '01', '{"botId":"01"}'::jsonb, '2026-11-01T00:00:00Z');

      INSERT INTO public.manager_link4m_attempts (attempt_id, user_id, token_hash, reward_hours, status, created_at, expires_at, purge_at, daily_date)
      VALUES ('att_legacy_1', '111222333444555666', '${legacyTokenHash}', 12, 'rewarded', '2026-11-07T00:00:00Z', '2026-11-08T00:00:00Z', '2026-11-14T00:00:00Z', '2026-11-07'::date);

      INSERT INTO public.manager_commands (command_id, worker_id, action, payload, status, created_at, expires_at)
      VALUES ('cmd_00000000-0000-4000-8000-000000000001', '01', 'status', '{}'::jsonb, 'completed', now(), now() + interval '1 hour');
    `);

    // 2. Apply convergence migration 20261112000000
    const reconcileSql = fs.readFileSync(path.join(migDir, '20261112000000_reconcile_full_manager_schema.sql'), 'utf8');
    await db.pool.query(reconcileSql);

    // Seed stale orphaned & disabled sessions pre-20261112120000 to verify upgrade cleanup
    const orphanHash = '1'.repeat(64);
    const disabledUserHash = '2'.repeat(64);
    await db.pool.query(`
      INSERT INTO public.manager_users (id, username, role, status)
      VALUES ('usr_disabled_pre', 'disabled_pre', 'user', 'disabled');
      INSERT INTO public.manager_sessions (token_hash, user_id, username, role, expires_at, status)
      VALUES
        ('${orphanHash}', 'usr_deleted_pre', 'deleted_pre', 'user', (extract(epoch FROM now()) * 1000)::bigint + 600000, 'active'),
        ('${disabledUserHash}', 'usr_disabled_pre', 'disabled_pre', 'user', (extract(epoch FROM now()) * 1000)::bigint + 600000, 'active');
    `);

    // 3. Apply session revocation & guard migration 20261112120000 + idempotent re-run
    const sessionMigSql = fs.readFileSync(path.join(migDir, '20261112120000_session_revocation_and_migration_guards.sql'), 'utf8');
    await db.pool.query(sessionMigSql);
    await db.pool.query(reconcileSql);
    await db.pool.query(sessionMigSql);

    const remainingStale = await db.pool.query(
      `SELECT token_hash FROM public.manager_sessions WHERE token_hash = ANY($1::text[])`,
      [[orphanHash, disabledUserHash]]
    );
    assert.strictEqual(remainingStale.rows.length, 0, '20261112120000 must purge pre-existing orphaned/disabled sessions');
    const revokedPre = await db.pool.query(
      `SELECT token_hash FROM public.manager_session_revocations WHERE token_hash = ANY($1::text[])`,
      [[orphanHash, disabledUserHash]]
    );
    assert.strictEqual(revokedPre.rows.length, 2, '20261112120000 must record revoked stale hashes');

    const catalog = await inspectPublicCatalog(db.pool);
    assertCanonicalCatalog(catalog, 'legacy_upgraded', { allowLegacyTables: true });

    // Verify legacy audit row moved into audit_logs and readable via manager_audit view
    const auditRows = await db.pool.query('SELECT id, actor_username, action FROM public.audit_logs');
    assert.strictEqual(auditRows.rows.length, 1);
    assert.strictEqual(auditRows.rows[0].actor_username, 'admin_legacy');
    const viewRows = await db.pool.query('SELECT actor_username, action FROM public.manager_audit');
    assert.strictEqual(viewRows.rows.length, 1);
    assert.strictEqual(viewRows.rows[0].actor_username, 'admin_legacy');

    // Verify legacy manager_access & manager_worker_assignments preserved AND backfilled
    const usersRes = await db.pool.query(
      `SELECT id, username, discord_user_id, plan_name FROM public.manager_users WHERE id <> 'usr_disabled_pre'`
    );
    assert.strictEqual(usersRes.rows.length, 1);
    assert.strictEqual(usersRes.rows[0].discord_user_id, '111222333444555666');

    const assignRes = await db.pool.query('SELECT worker_id, user_id FROM public.manager_assignments');
    assert.strictEqual(assignRes.rows.length, 1);
    assert.strictEqual(assignRes.rows[0].worker_id, '01');

    const discordRes = await db.pool.query('SELECT discord_user_id, manager_user_id FROM public.manager_discord_links');
    assert.strictEqual(discordRes.rows.length, 1);

    // Verify manager_keys id PK and used_users JSONB array preservation
    const keyRes = await db.pool.query(`
      SELECT id, key_id, pg_typeof(used_users)::text AS col_type, used_users
      FROM public.manager_keys WHERE code_hash = $1
    `, [legacyKeyHash]);
    assert.strictEqual(keyRes.rows[0].col_type, 'jsonb');
    assert.deepStrictEqual(keyRes.rows[0].used_users, ['usr_alpha']);

    // Verify manager_link4m_attempts daily_date text + web user_id allowed
    const linkCol = await db.pool.query(`
      SELECT pg_typeof(daily_date)::text AS dt, daily_date
      FROM public.manager_link4m_attempts WHERE attempt_id = 'att_legacy_1'
    `);
    assert.strictEqual(linkCol.rows[0].dt, 'text');
    await db.pool.query(`
      INSERT INTO public.manager_link4m_attempts (attempt_id, user_id, token_hash, status, daily_date, reward_hours, expires_at)
      VALUES ('att_web_new', 'usr_web_alice', 'tok_web_1', 'pending', '2026-11-12', 12, now() + interval '1 hour')
    `);

    // Verify legacy manager_commands row + orphaned worker command insert both work
    const cmdRes = await db.pool.query(`SELECT command_id FROM public.manager_commands WHERE command_id LIKE 'cmd_%'`);
    assert.strictEqual(cmdRes.rows.length, 1);
  } finally {
    await db.close();
  }

  // Sub-case B2: Pre-fix UUID command_id table -> 20261112000000 conversion preserving rows & dropping FK
  const db2 = await harness.createDatabase('suite_b2_uuid_cmd');
  try {
    const legacyUuid = '11111111-2222-4333-8444-555555555555';
    await db2.pool.query(`
      CREATE TABLE public.manager_workers (
        worker_id text PRIMARY KEY,
        bot_number integer NOT NULL UNIQUE,
        name text NOT NULL,
        provider text NOT NULL DEFAULT 'render',
        service_url text,
        render_service_id text,
        secret_ciphertext text,
        enabled boolean NOT NULL DEFAULT true,
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        status jsonb NOT NULL DEFAULT '{}'::jsonb,
        events jsonb NOT NULL DEFAULT '[]'::jsonb,
        last_event jsonb,
        last_heartbeat timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.manager_commands (
        command_id uuid PRIMARY KEY,
        worker_id text NOT NULL REFERENCES public.manager_workers(worker_id),
        action text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'queued',
        result jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        delivered_at timestamptz,
        completed_at timestamptz,
        expires_at timestamptz NOT NULL
      );
      INSERT INTO public.manager_workers (worker_id, bot_number, name) VALUES ('01', 1, 'Bot 01');
      INSERT INTO public.manager_commands (command_id, worker_id, action, status, expires_at)
      VALUES ('${legacyUuid}'::uuid, '01', 'status', 'completed', now() + interval '1 hour');
    `);
    const reconcileSql = fs.readFileSync(path.join(migDir, '20261112000000_reconcile_full_manager_schema.sql'), 'utf8');
    const sessionMigSql = fs.readFileSync(path.join(migDir, '20261112120000_session_revocation_and_migration_guards.sql'), 'utf8');
    await db2.pool.query(reconcileSql);
    await db2.pool.query(sessionMigSql);

    const existing = await db2.pool.query(`SELECT command_id, pg_typeof(command_id)::text AS col_type FROM public.manager_commands`);
    assert.strictEqual(existing.rows.length, 1);
    assert.strictEqual(existing.rows[0].col_type, 'text');
    assert.strictEqual(existing.rows[0].command_id, legacyUuid);

    const nextCmdId = `cmd_${crypto.randomUUID()}`;
    await db2.pool.query(`
      INSERT INTO public.manager_commands (command_id, worker_id, action, status, expires_at)
      VALUES ($1, 'unregistered_worker_99', 'reset', 'queued', now() + interval '5 minutes')
    `, [nextCmdId]);
    const check = await db2.pool.query(`SELECT command_id FROM public.manager_commands WHERE command_id = $1`, [nextCmdId]);
    assert.strictEqual(check.rows.length, 1);
  } finally {
    await db2.close();
  }
  console.log('✅ Suite B: Legacy 10-table & UUID command_id upgrades verified with zero data loss.');
}

// ----------------------------------------------------------------------------
// SUITE C: Store Methods, RPC Functional Contracts & Triggers on Real PG 16
// ----------------------------------------------------------------------------
async function runSuiteCStoreAndRpcContracts(harness) {
  console.log('C. Testing Store methods, RPC contracts, triggers & data truncation on real PG 16...');
  const db = await harness.createDatabase('suite_c_contracts');
  try {
    await db.pool.query(schemaSql);
    const client = createPgSupabaseClient(db.pool, 'service_role');
    const workerStore = new SupabaseWorkerStore(client);
    const commandStore = new SupabaseCommandStore(client, { allowUnsafeSingleInstanceFallback: false });
    const dashboardStore = new SupabaseDashboardStore(client);

    // 1. WorkerStore: nextBotNumber, create, patchSettings, addEvent (>100 trim), resetData
    assert.strictEqual(await workerStore.nextBotNumber(), 1);
    assert.strictEqual(await workerStore.nextBotNumber(), 2);
    await workerStore.create({
      workerId: '01',
      botNumber: 1,
      name: 'Alpha Bot',
      provider: 'render',
      enabled: true,
      settings: { host: 'mc.old', reconnect: true },
      status: { state: 'running', online: true },
      events: []
    });
    const patched = await workerStore.patchSettings('01', { host: 'mc.new', port: 25565 });
    assert.strictEqual(patched.host, 'mc.new');
    assert.strictEqual(patched.reconnect, true);

    for (let i = 1; i <= 105; i++) {
      await workerStore.addEvent('01', { seq: i, msg: `evt_${i}` });
    }
    const wAfterEvents = await workerStore.get('01');
    assert.strictEqual(wAfterEvents.events.length, 100);
    assert.strictEqual(wAfterEvents.events[0].seq, 6);
    assert.strictEqual(wAfterEvents.events[99].seq, 105);

    await workerStore.resetData('01');
    const wAfterReset = await workerStore.get('01');
    assert.deepStrictEqual(wAfterReset.settings, {});
    assert.deepStrictEqual(wAfterReset.events, []);
    assert.strictEqual(wAfterReset.lastEvent, null);

    // 2. CommandStore: enqueue cmd_<UUID>, take, complete (success + failed), expire, clearWorker
    const cmd1 = await commandStore.enqueue({ workerId: '01', action: 'status', payload: { ping: 1 } });
    assert.match(cmd1.commandId, CMD_UUID_RE);
    const taken1 = await commandStore.take('01');
    assert.strictEqual(taken1.commandId, cmd1.commandId);
    assert.strictEqual(taken1.status, 'delivered');
    assert.strictEqual(await commandStore.complete('01', cmd1.commandId, { ok: false, error: 'timeout' }), true);
    const row1 = await commandStore.get(cmd1.commandId);
    assert.strictEqual(row1.status, 'failed');

    const cmd2 = await commandStore.enqueue({ workerId: '01', action: 'chat', payload: { message: 'hello' } });
    await commandStore.expire(cmd2.commandId);
    assert.strictEqual((await commandStore.get(cmd2.commandId)).status, 'expired');

    // 3. DashboardStore: setAccess, assignments, audit logs, linkDiscord/unlinkDiscord, removeAccess
    const revBefore = Number((await db.pool.query('SELECT revision FROM public.manager_user_state WHERE singleton = true')).rows[0].revision);
    await dashboardStore.setAccess('usr_alice', {
      role: 'user',
      status: 'active',
      username: 'alice',
      planName: 'VIP',
      workerIds: ['01'],
      expiresAt: '2027-01-01T00:00:00Z'
    }, 'admin_root');
    const revAfter = Number((await db.pool.query('SELECT revision FROM public.manager_user_state WHERE singleton = true')).rows[0].revision);
    assert.ok(revAfter > revBefore, 'Expected manager_users_revision_after_write trigger to bump revision');

    assert.deepStrictEqual(await dashboardStore.assignedWorkerIds('usr_alice'), ['01']);
    const linked = await dashboardStore.linkDiscord('998877665544332211', 'alice', 'usr_alice');
    assert.strictEqual(linked.ok, true);
    assert.strictEqual((await dashboardStore.getUserByDiscordId('998877665544332211')).username, 'alice');

    // Revoked session rejection trigger
    const tokHash = crypto.createHash('sha256').update('sess_secret_1').digest('hex');
    const revRes = await client.rpc('revoke_manager_session', { p_token_hash: tokHash });
    assert.strictEqual(revRes.data, true);
    await db.pool.query(
      `INSERT INTO public.manager_sessions (token_hash, username, expires_at) VALUES ($1, 'alice', $2)`,
      [tokHash, Date.now() + 3600000]
    );
    const sessCheck = await db.pool.query(`SELECT token_hash FROM public.manager_sessions WHERE token_hash = $1`, [tokHash]);
    assert.strictEqual(sessCheck.rows.length, 0, 'Expected revoked session insert trigger to block row');

    // Audit logs directly against audit_logs
    await dashboardStore.addAudit({ actorId: 'admin_root', action: 'TEST_AUDIT', target: { workerId: '01' }, details: 'pg real' });
    const logs = await dashboardStore.listAudit(10);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].action, 'TEST_AUDIT');
    await dashboardStore.clearAuditLogs();
    assert.strictEqual((await dashboardStore.listAudit(10)).length, 0);

    // Key redeem + removeAccess cascades cleanly
    await dashboardStore.createKey({
      id: 'key_c1',
      keyId: 'key_c1',
      codeHash: 'hash_c1',
      days: 7,
      botCount: 1,
      maxUses: 1,
      status: 'unused'
    });
    const redeemed = await dashboardStore.redeemKeyWithAccess('hash_c1', 'usr_alice', {
      username: 'alice',
      role: 'user',
      status: 'active',
      workerIds: ['01'],
      planName: 'PRO',
      expiresAt: '2027-02-01T00:00:00Z'
    }, 'usr_alice');
    assert.ok(redeemed);

    assert.strictEqual(await dashboardStore.removeAccess('usr_alice'), true);
    assert.deepStrictEqual(await dashboardStore.assignedWorkerIds('usr_alice'), []);
    assert.strictEqual(await dashboardStore.getDiscordLink('998877665544332211'), null);

    // 4. Locks, Outbox, Pending Allocations & Link4M RPCs
    const lockRes = await client.rpc('acquire_manager_lock', { p_lock_key: 'test_lock', p_owner_id: 'mgr_A', p_lease_seconds: 30 });
    assert.strictEqual(lockRes.data.ok, true);
    assert.ok(Number(lockRes.data.fencing_token) >= 1);
    assert.strictEqual((await client.rpc('renew_manager_lock', { p_lock_key: 'test_lock', p_owner_id: 'mgr_A', p_lease_seconds: 30 })).data, true);
    assert.strictEqual((await client.rpc('release_manager_lock', { p_lock_key: 'test_lock', p_owner_id: 'mgr_A' })).data, true);

    await db.pool.query(
      `INSERT INTO public.manager_outbox_queue (id, bot_id, type, event_type, aggregate_type, aggregate_id, payload)
       VALUES ('out_1', 1, 'auth_sync', 'NOTIFY', 'user', 'bob', '{}'::jsonb)`
    );
    const outBatch = await client.rpc('claim_manager_outbox_batch', { p_worker_id: 'mgr_A', p_limit: 5, p_lease_seconds: 60 });
    assert.strictEqual(outBatch.data.length, 1);

    await db.pool.query(
      `INSERT INTO public.manager_pending_allocations (id, username, target_bot_count, current_assigned, missing_bot_count)
       VALUES ('alloc_1', 'bob', 2, 1, 1)`
    );
    const allocBatch = await client.rpc('claim_manager_pending_allocations', { p_worker_id: 'mgr_A', p_limit: 5, p_lease_seconds: 60 });
    assert.strictEqual(allocBatch.data.length, 1);

    await dashboardStore.setAccess('usr_bob', {
      role: 'user',
      status: 'active',
      username: 'bob',
      planName: 'FREE',
      workerIds: [],
      expiresAt: '2027-01-01T00:00:00Z'
    }, 'admin_root');

    const attStart = await client.rpc('start_manager_link4m_attempt', {
      p_attempt_id: 'att_rpc_1',
      p_token_hash: 'tok_rpc_1',
      p_username: 'bob',
      p_vietnam_date: '2026-11-12',
      p_daily_limit: 2,
      p_reward_hours: 12
    });
    assert.strictEqual(attStart.data.ok, true);
    assert.strictEqual((await client.rpc('set_manager_link4m_short_url', { p_attempt_id: 'att_rpc_1', p_short_url: 'https://link4m.test/abc' })).data, true);
    const claimAtt = await dashboardStore.claimLinkAttempt('att_rpc_1', 'tok_rpc_1');
    assert.strictEqual(claimAtt.status, 'processing');
  } finally {
    await db.close();
  }
  console.log('✅ Suite C: All core Store methods, RPC contracts & triggers verified on PG 16.');
}

// ----------------------------------------------------------------------------
// SUITE D: Real Concurrent Multi-Connection Contention & Fencing Races
// ----------------------------------------------------------------------------
async function runSuiteDConcurrencyRaces(harness) {
  console.log('D. Testing real multi-connection PG 16 concurrency (SKIP LOCKED, trial/key races, lease fencing)...');
  const db = await harness.createDatabase('suite_d_concurrency');
  try {
    await db.pool.query(schemaSql);
    const c1 = createPgSupabaseClient(db.pool, 'service_role');
    const c2 = createPgSupabaseClient(db.pool, 'service_role');

    // Seed single available worker '01'
    await new SupabaseWorkerStore(c1).create({
      workerId: '01',
      botNumber: 1,
      name: 'Race Bot 01',
      provider: 'render',
      enabled: true,
      settings: {},
      status: { state: 'offline', online: false },
      events: []
    });

    // D1: Two concurrent manager_take_worker_command callers racing on 1 queued command
    const store1 = new SupabaseCommandStore(c1, { allowUnsafeSingleInstanceFallback: false });
    const store2 = new SupabaseCommandStore(c2, { allowUnsafeSingleInstanceFallback: false });
    await store1.enqueue({ workerId: '01', action: 'status', payload: {} });
    const [take1, take2] = await Promise.all([store1.take('01'), store2.take('01')]);
    const claimedTakes = [take1, take2].filter(Boolean);
    assert.strictEqual(claimedTakes.length, 1, 'Expected exactly 1 manager to take the single queued command');

    // D2: Concurrent command coalescing (two managers enqueue coalesceable action concurrently)
    const [enqA, enqB] = await Promise.all([
      store1.enqueue({ workerId: '01', action: 'set-afk-mode', payload: { enabled: true } }),
      store2.enqueue({ workerId: '01', action: 'set-afk-mode', payload: { enabled: false } })
    ]);
    assert.match(enqA.commandId, CMD_UUID_RE);
    assert.match(enqB.commandId, CMD_UUID_RE);
    assert.strictEqual(enqB.commandId, enqA.commandId, 'Coalesced concurrent commands must reuse the same command_id');
    const queuedCoalesced = await db.pool.query(
      `SELECT command_id FROM public.manager_commands WHERE worker_id = '01' AND action = 'set-afk-mode' AND status = 'queued'`
    );
    assert.strictEqual(queuedCoalesced.rows.length, 1, 'Concurrent coalesced commands must yield single queued row');
    await db.pool.query(`DELETE FROM public.manager_commands WHERE worker_id = '01'`);

    // D3: Concurrent manager_register_trial_user racing for 1 remaining bot
    const [t1, t2] = await Promise.all([
      c1.rpc('manager_register_trial_user', {
        p_user_id: 'usr_trial_1',
        p_username: 'trial1',
        p_password: 'pw1',
        p_trial_days: 1,
        p_plan_name: 'FREE TRIAL'
      }),
      c2.rpc('manager_register_trial_user', {
        p_user_id: 'usr_trial_2',
        p_username: 'trial2',
        p_password: 'pw2',
        p_trial_days: 1,
        p_plan_name: 'FREE TRIAL'
      })
    ]);
    const trialWins = [t1, t2].filter((r) => !r.error && r.data && r.data.ok === true);
    const trialRejects = [t1, t2].filter(
      (r) => (r.error && /NO_WORKERS_AVAILABLE/i.test(String(r.error.message || ''))) || (r.data && r.data.ok === false)
    );
    assert.strictEqual(trialWins.length, 1, `Expected 1 trial winner for single bot, got ${JSON.stringify([t1, t2])}`);
    assert.strictEqual(trialRejects.length, 1, `Expected 1 NO_WORKERS_AVAILABLE rejection, got ${JSON.stringify([t1, t2])}`);

    // D4: Concurrent single-use manager_redeem_code_with_access race
    const dStore1 = new SupabaseDashboardStore(c1);
    await dStore1.createKey({
      keyId: 'key_race_1',
      codeHash: 'hash_race_1',
      days: 7,
      botCount: 1,
      maxUses: 1,
      status: 'unused'
    });
    const [r1, r2] = await Promise.all([
      c1.rpc('manager_redeem_code_with_access', {
        p_code_hash: 'hash_race_1',
        p_user_id: 'usr_r1',
        p_access_values: { username: 'race_u1', role: 'user', status: 'active' },
        p_worker_ids: [],
        p_actor_id: 'usr_r1'
      }),
      c2.rpc('manager_redeem_code_with_access', {
        p_code_hash: 'hash_race_1',
        p_user_id: 'usr_r2',
        p_access_values: { username: 'race_u2', role: 'user', status: 'active' },
        p_worker_ids: [],
        p_actor_id: 'usr_r2'
      })
    ]);
    const keyWinCount = [r1, r2].filter((r) => !r.error && Array.isArray(r.data) && r.data.length === 1).length;
    assert.strictEqual(keyWinCount, 1, 'Expected single winner for single-use giftcode race');

    // D5: Concurrent SKIP LOCKED claim of 2 pending command syncs across mgr_1 & mgr_2
    const resetA = `cmd_${crypto.randomUUID()}`;
    const resetB = `cmd_${crypto.randomUUID()}`;
    await db.pool.query(`
      INSERT INTO public.manager_commands (command_id, worker_id, action, status, result, expires_at)
      VALUES
        ($1, '01', 'reset', 'state_sync_pending', '{"ok":true,"_stateSync":{"pending":true,"attempts":1,"nextRetryAt":"2020-01-01T00:00:00Z"}}'::jsonb, now() + interval '1 hour'),
        ($2, '02', 'reset', 'state_sync_pending', '{"ok":true,"_stateSync":{"pending":true,"attempts":1,"nextRetryAt":"2020-01-01T00:00:00Z"}}'::jsonb, now() + interval '1 hour')
    `, [resetA, resetB]);

    const [batch1, batch2] = await Promise.all([
      c1.rpc('manager_claim_pending_command_syncs', { p_lease_owner: 'mgr_1', p_limit: 1, p_lease_seconds: 60 }),
      c2.rpc('manager_claim_pending_command_syncs', { p_lease_owner: 'mgr_2', p_limit: 1, p_lease_seconds: 60 })
    ]);
    assert.strictEqual(batch1.data.length, 1);
    assert.strictEqual(batch2.data.length, 1);
    assert.notStrictEqual(batch1.data[0].command_id, batch2.data[0].command_id, 'SKIP LOCKED must assign disjoint rows');

    // D6: Lease expiry takeover + fencing rejection against real PG timestamps
    const resetC = `cmd_${crypto.randomUUID()}`;
    await store1.enqueue({ workerId: '01', commandId: resetC, action: 'reset', payload: {} });
    await store1.take('01');
    const rec = await store1.recordExecutionCompleted('01', resetC, { ok: true, state: 'stopped' }, {
      leaseOwner: 'mgr_slow',
      leaseSeconds: 1
    });
    assert.strictEqual(rec.ok, true);
    assert.strictEqual(rec.fencingToken, 1);

    // Wait 1.25s for 1s lease to expire in real Postgres clock
    await new Promise((r) => setTimeout(r, 1250));

    // Fresh manager mgr_fast takes over via pending batch (must bump fencingToken to 2)
    await store1.markStateSyncPending('01', resetC, {
      result: { ok: true, state: 'stopped' },
      syncState: {
        pending: true,
        attempts: 1,
        nextRetryAt: new Date(Date.now() - 1000).toISOString(),
        leaseOwner: 'mgr_slow',
        leaseUntil: new Date(Date.now() - 100).toISOString(),
        fencingToken: 1
      },
      leaseOwner: 'mgr_slow',
      fencingToken: 1
    });

    const fastBatch = await store2.claimPendingStateSyncBatch('mgr_fast', 1, 60);
    assert.strictEqual(fastBatch.length, 1);
    assert.strictEqual(fastBatch[0].result._stateSync.fencingToken, 2);

    // Stale holder mgr_slow (fencingToken=1) must fail verify, renew, and finalize!
    const slowVerify = await store1.verifyStateSyncLease('01', resetC, 'mgr_slow', { fencingToken: 1 });
    assert.strictEqual(slowVerify.ok, false);
    const slowRenew = await store1.renewStateSyncLease('01', resetC, 'mgr_slow', 60, { fencingToken: 1 });
    assert.strictEqual(slowRenew.ok, false);
    const slowFinalize = await store1.finalizeCompleted('01', resetC, { ok: true }, { leaseOwner: 'mgr_slow', fencingToken: 1 });
    assert.strictEqual(slowFinalize, false);

    // Fast holder (fencingToken=2) finalizes cleanly
    const fastFinalize = await store2.finalizeCompleted('01', resetC, { ok: true, state: 'stopped' }, { leaseOwner: 'mgr_fast', fencingToken: 2 });
    assert.strictEqual(fastFinalize, true);
  } finally {
    await db.close();
  }
  console.log('✅ Suite D: Multi-connection races, SKIP LOCKED & fencing takeover verified on real PG 16.');
}

// ----------------------------------------------------------------------------
// SUITE E: Two-Phase RESET Full Crash/Restart Recovery on Real PG 16
// ----------------------------------------------------------------------------
async function runSuiteETwoPhaseResetRecovery(harness) {
  console.log('E. Testing full two-phase RESET crash/restart lifecycle against real PG 16...');
  const db = await harness.createDatabase('suite_e_reset');
  try {
    await db.pool.query(schemaSql);
    const mgr1Client = createPgSupabaseClient(db.pool, 'service_role');
    const mgr2Client = createPgSupabaseClient(db.pool, 'service_role');

    const wStore1 = new SupabaseWorkerStore(mgr1Client);
    const cmdStore1 = new SupabaseCommandStore(mgr1Client, { allowUnsafeSingleInstanceFallback: false });
    const wStore2 = new SupabaseWorkerStore(mgr2Client);
    const cmdStore2 = new SupabaseCommandStore(mgr2Client, { allowUnsafeSingleInstanceFallback: false });

    await wStore1.create({
      workerId: '01',
      botNumber: 1,
      name: 'Reset Target 01',
      provider: 'render',
      enabled: true,
      settings: { host: 'play.example.com', accounts: ['steve'] },
      status: { state: 'running', online: true },
      events: [{ msg: 'joined' }],
      lastEvent: { msg: 'joined' }
    });

    // Manager 1 enqueues RESET, delivers to worker, records execution_completed, then crashes before resetData
    const enq = await cmdStore1.enqueue({ workerId: '01', action: 'reset', payload: {} });
    const delivered = await cmdStore1.take('01');
    assert.strictEqual(delivered.commandId, enq.commandId);

    const rec = await cmdStore1.recordExecutionCompleted('01', enq.commandId, { ok: true, state: 'stopped' }, {
      leaseOwner: 'mgr_crashed',
      leaseSeconds: 1
    });
    assert.strictEqual(rec.fencingToken, 1);

    // Wait for lease to lapse (simulates Manager 1 process crash mid-sync)
    await new Promise((r) => setTimeout(r, 1250));

    // Note execution_completed with lapsed lease should ALSO be reclaimable by claimPendingStateSyncBatch!
    const claimedByRestarted = await cmdStore2.claimPendingStateSyncBatch('mgr_restarted', 5, 60);
    assert.strictEqual(claimedByRestarted.length, 1);
    assert.strictEqual(claimedByRestarted[0].commandId, enq.commandId);
    assert.strictEqual(claimedByRestarted[0].result._stateSync.fencingToken, 2);

    // Pre-step ownership check + perform state sync + finalize
    const verifyOk = await cmdStore2.verifyStateSyncLease('01', enq.commandId, 'mgr_restarted', { fencingToken: 2 });
    assert.strictEqual(verifyOk.ok, true);
    await wStore2.resetData('01');
    const finalized = await cmdStore2.finalizeCompleted('01', enq.commandId, { ok: true, state: 'stopped' }, {
      leaseOwner: 'mgr_restarted',
      fencingToken: 2
    });
    assert.strictEqual(finalized, true);

    const finalCmd = await cmdStore2.get(enq.commandId);
    const finalWorker = await wStore2.get('01');
    assert.strictEqual(finalCmd.status, 'completed');
    assert.strictEqual(finalCmd.result._stateSync, undefined, 'finalizeCompleted must strip _stateSync metadata from result');
    assert.deepStrictEqual(finalCmd.result, { ok: true, state: 'stopped' });
    assert.deepStrictEqual(finalWorker.settings, {});
    assert.deepStrictEqual(finalWorker.events, []);
  } finally {
    await db.close();
  }
  console.log('✅ Suite E: Two-phase RESET mid-flight crash & restart recovery verified on real PG 16.');
}

// ----------------------------------------------------------------------------
// SUITE F: Role Privileges, Direct Table Protection, pg_temp Hijack & Tenant Isolation
// ----------------------------------------------------------------------------
async function runSuiteFSecurityAndIsolation(harness) {
  console.log('F. Testing role privileges, search_path pg_temp defense & multi-tenant isolation...');
  const db = await harness.createDatabase('suite_f_security');
  try {
    await db.pool.query(schemaSql);

    // 1. anon & authenticated denied direct SELECT on sensitive tables and EXECUTE on RPCs
    for (const restrictedRole of ['anon', 'authenticated']) {
      const client = createPgSupabaseClient(db.pool, restrictedRole);
      for (const tbl of ['manager_users', 'manager_keys', 'manager_workers', 'manager_commands', 'audit_logs', 'manager_audit']) {
        const res = await client.from(tbl).select('*').limit(1);
        assert.ok(res.error && res.error.code === '42501', `Expected 42501 for ${restrictedRole} on ${tbl}, got ${JSON.stringify(res.error)}`);
      }
      const rpcRes = await client.rpc('manager_next_bot_number', {});
      assert.ok(rpcRes.error && rpcRes.error.code === '42501', `Expected 42501 for ${restrictedRole} on RPC, got ${JSON.stringify(rpcRes.error)}`);
    }

    // 2. service_role cannot directly mutate manager_users, MUST use SECURITY DEFINER RPCs
    const svc = createPgSupabaseClient(db.pool, 'service_role');
    const directInsert = await svc.from('manager_users').insert({ id: 'usr_x', username: 'x', role: 'user', status: 'active' });
    assert.ok(directInsert.error && directInsert.error.code === '42501', 'Direct INSERT on manager_users must be blocked for service_role');

    const rpcInsert = await svc.rpc('manager_set_user_access', {
      p_user_id: 'usr_sec_1',
      p_values: { username: 'secuser1', role: 'user', status: 'active', planName: 'FREE', workerIds: [] },
      p_worker_ids: ['01'],
      p_actor_id: 'admin'
    });
    assert.strictEqual(rpcInsert.error, null);
    assert.strictEqual(rpcInsert.data.length, 1);

    // 3. pg_temp object shadowing / search_path hijack resistance
    const conn = await db.pool.connect();
    try {
      await conn.query(`
        CREATE TEMP TABLE manager_users (
          id text,
          username text,
          role text,
          status text
        );
        INSERT INTO pg_temp.manager_users VALUES ('spoof', 'spoof', 'admin', 'active');
      `);
      const setRes = await conn.query(
        `SELECT * FROM public.manager_set_user_access('usr_sec_2', '{"username":"secuser2","role":"user","status":"active"}'::jsonb, '{}'::text[], 'admin')`
      );
      assert.strictEqual(setRes.rows.length, 1);
      const realUsers = await conn.query(`SELECT count(*)::int AS cnt FROM public.manager_users WHERE id IN ('usr_sec_1', 'usr_sec_2')`);
      assert.strictEqual(realUsers.rows[0].cnt, 2, 'Hardened function must hit public.manager_users, never pg_temp.manager_users');
      const spoofCheck = await conn.query(`SELECT count(*)::int AS cnt FROM public.manager_users WHERE id = 'spoof'`);
      assert.strictEqual(spoofCheck.rows[0].cnt, 0);
    } finally {
      conn.release();
    }

    // 4. Multi-tenant isolation: unique Discord link & single-owner worker assignment
    const dash = new SupabaseDashboardStore(svc);
    await dash.linkDiscord('777777777777777777', 'secuser1', 'usr_sec_1');
    await assert.rejects(
      () => dash.linkDiscord('777777777777777777', 'secuser2', 'usr_sec_2'),
      /liên kết với một tài khoản Web khác/i
    );

    // Worker '01' currently assigned to usr_sec_1 -> reassigning via setAccess to usr_sec_2 should move ownership uniquely (never 2 owners)
    await dash.setAccess('usr_sec_2', { role: 'user', status: 'active', username: 'secuser2', workerIds: ['01'] }, 'admin');
    const ownersOf01 = await db.pool.query(`SELECT user_id FROM public.manager_assignments WHERE worker_id = '01'`);
    assert.strictEqual(ownersOf01.rows.length, 1);
    assert.strictEqual(ownersOf01.rows[0].user_id, 'usr_sec_2');

    // Delete via RPC succeeds even though direct DELETE is blocked for service_role
    assert.strictEqual(await dash.removeAccess('usr_sec_2'), true);
    assert.strictEqual(await dash.removeAccess('usr_sec_1'), true);

    // 5. Real PG 16 Atomic Session Revocation & Dual-Manager Multi-Process Enforcement
    for (const restrictedRole of ['anon', 'authenticated']) {
      const restricted = createPgSupabaseClient(db.pool, restrictedRole);
      const revRpc = await restricted.rpc('revoke_manager_user_sessions', { p_user_id: 'usr_sec_3' });
      assert.ok(revRpc.error && revRpc.error.code === '42501', `Expected 42501 for ${restrictedRole} on revoke_manager_user_sessions`);
    }

    // Wire real SupabaseAdapter RPC layer directly onto PG 16 client
    const pgAdapter = new SupabaseAdapter({ url: 'https://pg-real.local', key: 'sb_secret_pg_real' });
    pgAdapter.callRpc = async (fnName, params) => {
      const res = await svc.rpc(fnName, params);
      if (res.error) throw Object.assign(new Error(res.error.message || fnName), { code: res.error.code });
      return res.data;
    };
    pgAdapter.fetchUserAuthorization = async (userId, username) => {
      const q = svc.from('manager_users').select('*');
      const { data, error } = userId
        ? await q.eq('id', String(userId)).limit(2)
        : await q.eq('username', String(username || '').toLowerCase()).limit(2);
      if (error || !Array.isArray(data) || data.length !== 1) return { ok: false };
      const row = data[0];
      return {
        ok: true,
        user: {
          id: row.id,
          userId: row.id,
          username: row.username,
          password: row.password,
          role: row.role || 'user',
          status: row.status || 'active',
          assignedBotIds: Array.isArray(row.assigned_bot_ids) ? row.assigned_bot_ids.map(Number) : [],
          expiresAt: row.expires_at,
          planName: row.plan_name || 'VIP',
          isPermanent: Boolean(row.is_permanent),
          allowAccountChange: row.allow_account_change !== false,
          botCount: row.bot_count || 1
        }
      };
    };
    svc.adapter = pgAdapter;

    const dashA = new SupabaseDashboardStore(svc);
    const dashB = new SupabaseDashboardStore(svc);
    const seedUsersRes = await svc.rpc('insert_manager_users_if_absent', {
      p_users: [
        {
          id: 'usr_sec_3',
          username: 'secuser3',
          password: encryptUserPassword('secuser3-pass'),
          role: 'user',
          status: 'active',
          assigned_bot_ids: ['01'],
          is_permanent: true,
          plan_name: 'VIP'
        },
        {
          id: 'usr_sec_4',
          username: 'secuser4',
          password: encryptUserPassword('secuser4-pass'),
          role: 'user',
          status: 'active',
          assigned_bot_ids: [],
          is_permanent: false,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          plan_name: 'PRO'
        },
        {
          id: 'usr_sec_5',
          username: 'secuser5',
          password: encryptUserPassword('secuser5-pass'),
          role: 'user',
          status: 'active',
          assigned_bot_ids: [],
          is_permanent: true,
          plan_name: 'FREE'
        }
      ]
    });
    assert.strictEqual(seedUsersRes.error, null);
    assert.strictEqual(seedUsersRes.data.ok, true, `Failed seeding test users: ${JSON.stringify(seedUsersRes.data)}`);

    const mockRegistry = {
      store: {},
      list: async () => [],
      getBots: () => [],
      getAdminPassword: () => null,
      verifyBotSecretSync: () => false
    };
    const appA = createApp({
      store: dashA,
      registry: mockRegistry,
      broker: {},
      config: { adminUsername: 'admin', adminPassword: 'pg-admin-password', discordToken: '' },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });
    const appB = createApp({
      store: dashB,
      registry: mockRegistry,
      broker: {},
      config: { adminUsername: 'admin', adminPassword: 'pg-admin-password', discordToken: '' },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    const srvA = http.createServer(appA);
    const srvB = http.createServer(appB);
    await new Promise((resolve) => srvA.listen(0, resolve));
    await new Promise((resolve) => srvB.listen(0, resolve));
    try {
      const urlA = `http://127.0.0.1:${srvA.address().port}`;
      const urlB = `http://127.0.0.1:${srvB.address().port}`;

      // Admin logs into Manager B
      const adminBLogin = await (await fetch(`${urlB}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pg-admin-password' })
      })).json();
      assert.strictEqual(adminBLogin.ok, true);

      // secuser3 logs into Manager A (warms activeSessions A & persists session into PG manager_sessions)
      const u3Login = await (await fetch(`${urlA}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'secuser3', password: 'secuser3-pass' })
      })).json();
      assert.strictEqual(u3Login.ok, true);
      const u3TokenHash = crypto.createHash('sha256').update(u3Login.token).digest('hex');

      assert.strictEqual((await fetch(`${urlA}/api/auth/me`, {
        headers: { authorization: `Bearer ${u3Login.token}` }
      })).status, 200);
      assert.strictEqual(await (await fetch(`${urlA}/`, {
        headers: { authorization: `Bearer ${u3Login.token}` }
      })).text(), DASHBOARD_HTML);

      // Delete secuser3 via Manager B -> must revoke PG session & Manager A must immediately deny
      const delResp = await fetch(`${urlB}/api/manager/users/usr_sec_3`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${adminBLogin.token}` }
      });
      assert.strictEqual(delResp.status, 200);

      const sessAfterDel = await db.pool.query(`SELECT token_hash FROM public.manager_sessions WHERE token_hash = $1`, [u3TokenHash]);
      assert.strictEqual(sessAfterDel.rows.length, 0, 'manager_delete_user_access must remove manager_sessions rows');
      const revAfterDel = await db.pool.query(`SELECT token_hash FROM public.manager_session_revocations WHERE token_hash = $1`, [u3TokenHash]);
      assert.strictEqual(revAfterDel.rows.length, 1, 'manager_delete_user_access must record hash in manager_session_revocations');

      const rpcAuthDel = await svc.rpc('read_manager_authorization', { p_token_hash: u3TokenHash });
      assert.strictEqual(rpcAuthDel.data.session, null);
      assert.strictEqual(rpcAuthDel.data.user, null);

      assert.strictEqual((await fetch(`${urlA}/api/auth/me`, {
        headers: { authorization: `Bearer ${u3Login.token}` }
      })).status, 401, 'Manager A must reject deleted user session immediately even if activeSessions had cached it');
      assert.strictEqual((await fetch(`${urlA}/api/manager/bots`, {
        headers: { authorization: `Bearer ${u3Login.token}` }
      })).status, 401);
      assert.strictEqual(await (await fetch(`${urlA}/`, {
        headers: { authorization: `Bearer ${u3Login.token}` }
      })).text(), PUBLIC_LOGIN_HTML);

      // secuser4 logs into Manager A; expired non-disabled keeps working; disabling via Manager B revokes PG + Manager A denies
      const u4Login = await (await fetch(`${urlA}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'secuser4', password: 'secuser4-pass' })
      })).json();
      assert.strictEqual(u4Login.ok, true);
      const u4TokenHash = crypto.createHash('sha256').update(u4Login.token).digest('hex');

      await dashB.setAccess('usr_sec_4', { status: 'expired', expiresAt: new Date(Date.now() - 60_000).toISOString() }, 'admin');
      const u4ExpiredMe = await fetch(`${urlA}/api/auth/me`, { headers: { authorization: `Bearer ${u4Login.token}` } });
      assert.strictEqual(u4ExpiredMe.status, 200, 'Non-disabled expired account must keep session for Link4M/key renewal');
      assert.strictEqual((await u4ExpiredMe.json()).user.status, 'expired');

      const disableResp = await fetch(`${urlB}/api/manager/users/usr_sec_4`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminBLogin.token}` },
        body: JSON.stringify({ status: 'disabled' })
      });
      assert.strictEqual(disableResp.status, 200);

      const sessAfterDisable = await db.pool.query(`SELECT token_hash FROM public.manager_sessions WHERE token_hash = $1`, [u4TokenHash]);
      assert.strictEqual(sessAfterDisable.rows.length, 0);
      const rpcAuthDisabled = await svc.rpc('read_manager_authorization', { p_token_hash: u4TokenHash });
      assert.strictEqual(rpcAuthDisabled.data.session, null);
      assert.strictEqual((await fetch(`${urlA}/api/auth/me`, {
        headers: { authorization: `Bearer ${u4Login.token}` }
      })).status, 401, 'Manager A must reject disabled user session immediately');

      // secuser5 logs in -> POST /api/auth/logout calls deleteSession without ReferenceError & revokes in PG
      const u5Login = await (await fetch(`${urlA}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'secuser5', password: 'secuser5-pass' })
      })).json();
      assert.strictEqual(u5Login.ok, true);
      const u5TokenHash = crypto.createHash('sha256').update(u5Login.token).digest('hex');
      const logoutResp = await fetch(`${urlA}/api/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${u5Login.token}` }
      });
      assert.strictEqual(logoutResp.status, 200);
      const revAfterLogout = await db.pool.query(`SELECT token_hash FROM public.manager_session_revocations WHERE token_hash = $1`, [u5TokenHash]);
      assert.strictEqual(revAfterLogout.rows.length, 1, 'POST /api/auth/logout must revoke tokenHash via PG RPC without ReferenceError');
      assert.strictEqual((await fetch(`${urlA}/api/auth/me`, {
        headers: { authorization: `Bearer ${u5Login.token}` }
      })).status, 401);
      assert.strictEqual(await dashB.removeAccess('usr_sec_4'), true);
      assert.strictEqual(await dashB.removeAccess('usr_sec_5'), true);
    } finally {
      await new Promise((resolve) => srvA.close(resolve));
      await new Promise((resolve) => srvB.close(resolve));
    }
  } finally {
    await db.close();
  }
  console.log('✅ Suite F: Role privileges, search_path pg_temp defense, tenant isolation & PG 16 session revocation verified.');
}

(async () => {
  const harness = await startPostgresHarness();
  console.log(`--- [REAL POSTGRESQL 16 INTEGRATION SUITE (${harness.mode})] ---`);
  try {
    await runSuiteAFreshInstalls(harness);
    await runSuiteBLegacyUpgrade(harness);
    await runSuiteCStoreAndRpcContracts(harness);
    await runSuiteDConcurrencyRaces(harness);
    await runSuiteETwoPhaseResetRecovery(harness);
    await runSuiteFSecurityAndIsolation(harness);
    console.log('🎉 ALL REAL POSTGRESQL 16 SUITES (A–F) PASSED 100%!');
  } finally {
    await harness.shutdown();
  }
})().catch((err) => {
  console.error('❌ REAL POSTGRES TEST FAILED:', err);
  process.exitCode = 1;
});
