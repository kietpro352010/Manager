#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SUITE_MAP = {
  1: {
    id: 'tier1',
    name: 'Tier 1: Feature Coverage (Features 1-26)',
    file: path.join(__dirname, 'suites', 'tier1-feature-coverage.test.js')
  },
  2: {
    id: 'tier2',
    name: 'Tier 2: Boundary & Corner Cases (Features 1-26)',
    file: path.join(__dirname, 'suites', 'tier2-boundary-corner.test.js')
  },
  3: {
    id: 'tier3',
    name: 'Tier 3: Pairwise Cross-Feature Interactions',
    file: path.join(__dirname, 'suites', 'tier3-pairwise-cross-feature.test.js')
  },
  4: {
    id: 'tier4',
    name: 'Tier 4: Real-World Application Lifecycles',
    file: path.join(__dirname, 'suites', 'tier4-real-world-scenarios.test.js')
  },
  5: {
    id: 'tier5',
    name: 'Tier 5: Expiration Grace Period & Anti-Bot Multi-Account Protection',
    file: path.join(__dirname, 'suites', 'tier5-expiration-and-antibot.test.js')
  },
  6: {
    id: 'tier6',
    name: 'Tier 6: GUI Item Textures, Fallbacks & Theme Canvas',
    file: path.join(__dirname, 'suites', 'tier5-textures-and-themes.test.js')
  },
  7: {
    id: 'tier7',
    name: 'Tier 7: Full-Stack Optimization, Security & Modular UI',
    file: path.join(__dirname, 'suites', 'tier7-fullstack-optimization-and-security.test.js')
  }
};

const HARNESS_SELF_TEST_FILE = path.join(__dirname, 'harness', 'harness-self-test.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    tiers: new Set(),
    runAll: false,
    runHarness: false,
    tap: false,
    bail: false,
    verbose: false
  };

  for (const arg of args) {
    if (arg === '--all') {
      options.runAll = true;
      options.tiers.add(1).add(2).add(3).add(4).add(5).add(6).add(7);
    } else if (arg === '--harness' || arg === '--self-test') {
      options.runHarness = true;
    } else if (arg.startsWith('--tier=')) {
      const val = arg.substring('--tier='.length);
      const tierNums = val.split(',').map((v) => parseInt(v.trim(), 10));
      for (const t of tierNums) {
        if (SUITE_MAP[t]) options.tiers.add(t);
      }
    } else if (arg === '--tap') {
      options.tap = true;
    } else if (arg === '--bail') {
      options.bail = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (/^[1-7]$/.test(arg)) {
      options.tiers.add(parseInt(arg, 10));
    }
  }

  // Default behavior if no tier specified: run harness + any available suites
  if (options.tiers.size === 0 && !options.runHarness) {
    options.runHarness = true;
    options.runAll = true;
    options.tiers.add(1).add(2).add(3).add(4).add(5).add(6).add(7);
  }

  return options;
}

function runSubprocess(file, args = [], env = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const child = spawn(process.execPath, [file, ...args], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, ...env },
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      resolve({
        code: code === null ? 1 : code,
        stdout,
        stderr,
        durationMs
      });
    });

    child.on('error', (err) => {
      resolve({
        code: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        durationMs: Date.now() - startTime
      });
    });
  });
}

async function main() {
  const options = parseArgs();
  const overallStartTime = Date.now();

  console.log('TAP version 13');
  console.log('# KBOT End-to-End Central Test Runner');
  console.log(`# Node.js ${process.version} on ${process.platform}`);
  console.log(`# Time: ${new Date().toISOString()}\n`);

  let testIndex = 0;
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;
  const suiteResults = [];

  // 1. Run Harness Self-Test if requested
  if (options.runHarness) {
    testIndex++;
    if (fs.existsSync(HARNESS_SELF_TEST_FILE)) {
      process.stdout.write(`# Running Mock Harness Self-Verification...\n`);
      const res = await runSubprocess(HARNESS_SELF_TEST_FILE);
      if (res.code === 0) {
        passCount++;
        console.log(`ok ${testIndex} - Mock Test Harness Self-Verification passed (${res.durationMs}ms)`);
        if (options.verbose) {
          console.log(res.stdout.split('\n').map((l) => `# ${l}`).join('\n'));
        }
      } else {
        failCount++;
        console.log(`not ok ${testIndex} - Mock Test Harness Self-Verification failed (${res.durationMs}ms)`);
        console.error(res.stderr || res.stdout);
        if (options.bail) {
          console.log('Bail out! Harness self-test failure.');
          process.exit(1);
        }
      }
      suiteResults.push({ name: 'Harness Self-Test', code: res.code, durationMs: res.durationMs });
    } else {
      skipCount++;
      console.log(`ok ${testIndex} - Mock Test Harness # SKIP file not found`);
    }
  }

  // 2. Run Tier Suites
  const sortedTiers = Array.from(options.tiers).sort((a, b) => a - b);
  for (const tierNum of sortedTiers) {
    const suite = SUITE_MAP[tierNum];
    testIndex++;

    if (!fs.existsSync(suite.file)) {
      skipCount++;
      console.log(`ok ${testIndex} - ${suite.name} # SKIP file pending implementation (${path.basename(suite.file)})`);
      suiteResults.push({ name: suite.name, code: 0, skipped: true, durationMs: 0 });
      continue;
    }

    process.stdout.write(`# Executing ${suite.name}...\n`);
    const res = await runSubprocess(suite.file);

    // Parse TAP lines or test results from stdout
    const lines = res.stdout.split('\n');
    let subtestsRun = 0;
    for (const line of lines) {
      if (/^(ok|not ok)\s+\d+/.test(line.trim())) {
        subtestsRun++;
        console.log(line);
      }
    }

    if (res.code === 0) {
      passCount++;
      console.log(`ok ${testIndex} - ${suite.name} passed (${res.durationMs}ms)`);
      if (options.verbose && subtestsRun === 0) {
        console.log(lines.map((l) => `# ${l}`).join('\n'));
      }
    } else {
      failCount++;
      console.log(`not ok ${testIndex} - ${suite.name} failed (exit code ${res.code}, ${res.durationMs}ms)`);
      console.error(res.stderr || res.stdout);
      if (options.bail) {
        console.log(`Bail out! Failure in ${suite.name}`);
        process.exit(1);
      }
    }
    suiteResults.push({ name: suite.name, code: res.code, durationMs: res.durationMs });
  }

  const overallDuration = Date.now() - overallStartTime;
  console.log(`\n1..${testIndex}`);
  console.log(`# tests ${testIndex}`);
  console.log(`# pass  ${passCount}`);
  console.log(`# fail  ${failCount}`);
  console.log(`# skip  ${skipCount}`);
  console.log(`# duration ${overallDuration}ms\n`);

  // Summary Table
  console.log('----------------------------------------------------------------');
  console.log('Suite Summary:');
  for (const r of suiteResults) {
    const status = r.skipped ? 'PENDING' : r.code === 0 ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${r.name} (${r.durationMs}ms)`);
  }
  console.log('----------------------------------------------------------------');

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, SUITE_MAP };
