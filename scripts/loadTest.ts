/**
 * v1.90 — Pre-event load test: N authenticated concurrent door scanners.
 *
 * Replaces the Sprint 5.1 stub (50 users, anon key, raw `checkins` insert).
 * What changed and why:
 *   - AUTHENTICATED. The old script used the anon key, so every insert failed
 *     RLS and the numbers were meaningless. We sign in once and run all workers
 *     on that session — exactly the shared-login model the venue uses.
 *   - REAL HOT PATH. Check-ins go through the `check_in_by_code` RPC (the code
 *     path the door actually executes), not a raw table insert.
 *   - NON-DESTRUCTIVE DUPLICATE PROOF. Instead of deleting rows first, we
 *     snapshot arrival counts for the delegate pool before the run and assert no
 *     delegate gained more than one arrival row afterwards.
 *   - SEPARATE THRESHOLDS per operation, and a p95 (not an average) gate.
 *
 * Usage
 *   npm run loadtest                       # real run (requires LOAD_CONFIRM=yes)
 *   npm run loadtest:selftest              # no network: validates the harness
 *
 * Required env for a real run
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY
 *   LOAD_EVENT_ID          staging event UUID (never auto-picked)
 *   LOAD_EMAIL             an account that may check delegates in
 *   LOAD_PASSWORD
 *   LOAD_CONFIRM=yes       explicit safety gate
 *
 * Optional env
 *   LOAD_CONCURRENCY        default 150
 *   LOAD_DURATION_S         default 180
 *   LOAD_POOL_SIZE          delegates hammered for check-ins, default 200
 *   LOAD_THINK_MIN_MS       default 400
 *   LOAD_THINK_MAX_MS       default 1600
 *   LOAD_SESSION_ID         if set, session check-ins are exercised too
 *   LOAD_ALLOW_ANY_EVENT=yes  bypass the staging-name guard
 *   LOAD_JSON_OUT           report path (default loadtest-report-<ts>.json)
 *
 * SAFETY
 *   This script WRITES check-ins and session responses. It refuses to run
 *   against an event whose name does not look like staging/test/load/sandbox
 *   unless LOAD_ALLOW_ANY_EVENT=yes is set explicitly.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SELF_TEST = process.argv.includes('--self-test');

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const CONCURRENCY = intEnv('LOAD_CONCURRENCY', 150);
const DURATION_S = intEnv('LOAD_DURATION_S', 180);
const POOL_SIZE = intEnv('LOAD_POOL_SIZE', 200);
const THINK_MIN_MS = intEnv('LOAD_THINK_MIN_MS', 400);
const THINK_MAX_MS = intEnv('LOAD_THINK_MAX_MS', 1600);

const EVENT_ID = (process.env.LOAD_EVENT_ID || '').trim();
const SESSION_ID = (process.env.LOAD_SESSION_ID || '').trim() || null;
const EMAIL = (process.env.LOAD_EMAIL || '').trim();
const PASSWORD = process.env.LOAD_PASSWORD || '';
const CONFIRM = (process.env.LOAD_CONFIRM || '').trim().toLowerCase();
const ALLOW_ANY_EVENT = (process.env.LOAD_ALLOW_ANY_EVENT || '').trim().toLowerCase() === 'yes';

// Thresholds for a 100+ concurrent event. Deliberately harsher than reality:
// 150 workers with 0.4-1.6s think time produce ~100 ops/s and ~55 check-ins/s,
// versus a real door of ~150 officers scanning every 8-20s (~12-19/s).
const THRESHOLDS = {
  overallP95Ms: 1500,
  checkinP95Ms: 2000,
  maxErrorRatePct: 1,
  duplicateArrivals: 0,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OpName = 'check_in_by_code' | 'search' | 'ministry_stats' | 'dashboard' | 'master_list';

interface OpResult {
  op: OpName;
  ok: boolean;
  ms: number;
  note?: string;
}

interface Metrics {
  samples: Record<OpName, number[]>;
  errors: Record<OpName, number>;
  counts: Record<OpName, number>;
  notes: Map<string, number>;
}

const OP_NAMES: OpName[] = ['check_in_by_code', 'search', 'ministry_stats', 'dashboard', 'master_list'];

function emptyMetrics(): Metrics {
  return {
    samples: OP_NAMES.reduce((a, k) => ({ ...a, [k]: [] as number[] }), {} as Record<OpName, number[]>),
    errors: OP_NAMES.reduce((a, k) => ({ ...a, [k]: 0 }), {} as Record<OpName, number>),
    counts: OP_NAMES.reduce((a, k) => ({ ...a, [k]: 0 }), {} as Record<OpName, number>),
    notes: new Map<string, number>(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

function summarize(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    avg: s.length ? sum / s.length : 0,
    p50: percentile(s, 0.5),
    p95: percentile(s, 0.95),
    p99: percentile(s, 0.99),
    max: s.length ? s[s.length - 1] : 0,
  };
}

function record(m: Metrics, r: OpResult) {
  m.counts[r.op]++;
  m.samples[r.op].push(r.ms);
  if (!r.ok) m.errors[r.op]++;
  if (r.note) m.notes.set(r.note, (m.notes.get(r.note) || 0) + 1);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

interface Pool {
  delegateIds: string[];
  qrHashes: string[];
  searchTerms: string[];
}

async function opCheckIn(
  supabase: SupabaseClient,
  registrarId: string,
  pool: Pool,
): Promise<OpResult> {
  const started = Date.now();
  try {
    const { data, error } = await supabase.rpc('check_in_by_code', {
      p_event_id: EVENT_ID,
      p_code: pick(pool.qrHashes),
      p_session_id: SESSION_ID,
      p_registrar_uid: registrarId,
      p_registrar_email: EMAIL || null,
      p_audit_enabled: true,
    });
    const ms = Date.now() - started;
    if (error) return { op: 'check_in_by_code', ok: false, ms, note: `rpc:${error.code || 'error'}` };

    const res = (data || {}) as any;
    if (res.locked) return { op: 'check_in_by_code', ok: false, ms, note: 'event_locked' };
    if (res.needs_parse) return { op: 'check_in_by_code', ok: true, ms, note: 'needs_parse' };
    // already_checked_in is a SUCCESS for a load test: it proves the unique
    // index rejected the duplicate rather than erroring.
    return { op: 'check_in_by_code', ok: !!res.ok, ms, note: res.already_checked_in ? 'already_checked_in' : undefined };
  } catch (e: any) {
    return { op: 'check_in_by_code', ok: false, ms: Date.now() - started, note: `throw:${String(e?.message || e).slice(0, 40)}` };
  }
}

async function opSearch(supabase: SupabaseClient, pool: Pool): Promise<OpResult> {
  const started = Date.now();
  try {
    const { error } = await supabase.rpc('search_delegates_v2', {
      p_event_id: EVENT_ID,
      p_query: pick(pool.searchTerms),
      p_limit: 25,
      p_offset: 0,
    });
    return { op: 'search', ok: !error, ms: Date.now() - started, note: error ? `rpc:${error.code}` : undefined };
  } catch (e: any) {
    return { op: 'search', ok: false, ms: Date.now() - started, note: 'throw' };
  }
}

async function opMinistryStats(supabase: SupabaseClient): Promise<OpResult> {
  const started = Date.now();
  try {
    const { error } = await supabase.rpc('get_session_ministry_stats', { p_event_id: EVENT_ID });
    return { op: 'ministry_stats', ok: !error, ms: Date.now() - started, note: error ? `rpc:${error.code}` : undefined };
  } catch {
    return { op: 'ministry_stats', ok: false, ms: Date.now() - started, note: 'throw' };
  }
}

async function opDashboard(supabase: SupabaseClient): Promise<OpResult> {
  const started = Date.now();
  try {
    const { error } = await supabase.rpc('get_event_dashboard_stats', {
      p_event_id: EVENT_ID,
      p_district: null,
      p_region: null,
    });
    return { op: 'dashboard', ok: !error, ms: Date.now() - started, note: error ? `rpc:${error.code}` : undefined };
  } catch {
    return { op: 'dashboard', ok: false, ms: Date.now() - started, note: 'throw' };
  }
}

async function opMasterList(supabase: SupabaseClient): Promise<OpResult> {
  const started = Date.now();
  try {
    // Exercises the v1.89b SECURITY INVOKER conversion under concurrency.
    const { error } = await supabase.rpc('get_paginated_delegates', {
      p_page: 1,
      p_page_size: 25,
      p_event_id: EVENT_ID,
    });
    return { op: 'master_list', ok: !error, ms: Date.now() - started, note: error ? `rpc:${error.code}` : undefined };
  } catch {
    return { op: 'master_list', ok: false, ms: Date.now() - started, note: 'throw' };
  }
}

/** Weighted operation mix — mirrors a door shift with an admin watching. */
const MIX: { op: OpName; weight: number }[] = [
  { op: 'check_in_by_code', weight: 55 },
  { op: 'search', weight: 30 },
  { op: 'ministry_stats', weight: 5 },
  { op: 'dashboard', weight: 5 },
  { op: 'master_list', weight: 5 },
];
const MIX_TOTAL = MIX.reduce((s, m) => s + m.weight, 0);

function nextOp(): OpName {
  let roll = Math.random() * MIX_TOTAL;
  for (const m of MIX) {
    roll -= m.weight;
    if (roll <= 0) return m.op;
  }
  return 'check_in_by_code';
}

// ---------------------------------------------------------------------------
// Duplicate-arrival measurement (non-destructive)
// ---------------------------------------------------------------------------

async function arrivalCounts(supabase: SupabaseClient, pool: Pool): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const CHUNK = 100;
  for (let i = 0; i < pool.delegateIds.length; i += CHUNK) {
    const ids = pool.delegateIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('checkins')
      .select('delegate_id')
      .eq('event_id', EVENT_ID)
      .is('session_id', null)
      .in('delegate_id', ids);
    if (error) throw new Error(`arrival snapshot failed: ${error.message}`);
    for (const row of (data || []) as { delegate_id: string }[]) {
      map.set(row.delegate_id, (map.get(row.delegate_id) || 0) + 1);
    }
  }
  return map;
}

function diffViolations(before: Map<string, number>, after: Map<string, number>): { delegateId: string; before: number; after: number }[] {
  const out: { delegateId: string; before: number; after: number }[] = [];
  for (const [id, afterCount] of after.entries()) {
    const beforeCount = before.get(id) || 0;
    if (afterCount - beforeCount > 1) out.push({ delegateId: id, before: beforeCount, after: afterCount });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface GateResult {
  label: string;
  actual: string;
  limit: string;
  pass: boolean;
}

function buildGates(m: Metrics, duplicates: number): GateResult[] {
  const all = OP_NAMES.flatMap((k) => m.samples[k]);
  const overall = summarize(all);
  const checkin = summarize(m.samples.check_in_by_code);
  const totalOps = OP_NAMES.reduce((s, k) => s + m.counts[k], 0);
  const totalErrors = OP_NAMES.reduce((s, k) => s + m.errors[k], 0);
  const errPct = totalOps ? (totalErrors / totalOps) * 100 : 0;

  return [
    {
      label: 'Overall p95',
      actual: `${overall.p95.toFixed(0)}ms`,
      limit: `<= ${THRESHOLDS.overallP95Ms}ms`,
      pass: overall.p95 <= THRESHOLDS.overallP95Ms,
    },
    {
      label: 'Check-in p95',
      actual: `${checkin.p95.toFixed(0)}ms`,
      limit: `<= ${THRESHOLDS.checkinP95Ms}ms`,
      pass: checkin.p95 <= THRESHOLDS.checkinP95Ms,
    },
    {
      label: 'Error rate',
      actual: `${errPct.toFixed(2)}%`,
      limit: `< ${THRESHOLDS.maxErrorRatePct}%`,
      pass: errPct < THRESHOLDS.maxErrorRatePct,
    },
    {
      label: 'Duplicate arrivals',
      actual: String(duplicates),
      limit: `= ${THRESHOLDS.duplicateArrivals}`,
      pass: duplicates === THRESHOLDS.duplicateArrivals,
    },
  ];
}

function printReport(
  m: Metrics,
  meta: { concurrency: number; durationS: number; elapsedS: number; eventName: string; duplicateViolations: { delegateId: string; before: number; after: number }[] },
) {
  const totalOps = OP_NAMES.reduce((s, k) => s + m.counts[k], 0);
  const totalErrors = OP_NAMES.reduce((s, k) => s + m.errors[k], 0);
  const all = OP_NAMES.flatMap((k) => m.samples[k]);
  const overall = summarize(all);

  const pad = (v: string, n: number) => v.padEnd(n);
  const padL = (v: string, n: number) => v.padStart(n);

  console.log('\n' + '='.repeat(94));
  console.log('FGBMFI EMS — PRE-EVENT LOAD TEST');
  console.log('='.repeat(94));
  console.log(`Event          : ${meta.eventName}`);
  console.log(`Concurrency    : ${meta.concurrency} virtual scanners`);
  console.log(`Planned window : ${meta.durationS}s   (elapsed ${meta.elapsedS.toFixed(1)}s)`);
  console.log(`Total ops      : ${totalOps}   (${(totalOps / Math.max(meta.elapsedS, 0.001)).toFixed(1)} ops/s)`);
  console.log(`Errors         : ${totalErrors} (${((totalErrors / (totalOps || 1)) * 100).toFixed(2)}%)`);
  console.log('-'.repeat(94));
  console.log(pad('OPERATION', 22) + padL('COUNT', 8) + padL('ERR', 6) + padL('AVG', 9) + padL('P50', 8) + padL('P95', 8) + padL('P99', 8) + padL('MAX', 8));
  console.log('-'.repeat(94));
  for (const op of OP_NAMES) {
    const s = summarize(m.samples[op]);
    console.log(
      pad(op, 22) +
      padL(String(m.counts[op]), 8) +
      padL(String(m.errors[op]), 6) +
      padL(`${s.avg.toFixed(0)}ms`, 9) +
      padL(`${s.p50.toFixed(0)}ms`, 8) +
      padL(`${s.p95.toFixed(0)}ms`, 8) +
      padL(`${s.p99.toFixed(0)}ms`, 8) +
      padL(`${s.max.toFixed(0)}ms`, 8),
    );
  }
  console.log('-'.repeat(94));
  console.log(
    pad('OVERALL', 22) +
    padL(String(totalOps), 8) +
    padL(String(totalErrors), 6) +
    padL(`${overall.avg.toFixed(0)}ms`, 9) +
    padL(`${overall.p50.toFixed(0)}ms`, 8) +
    padL(`${overall.p95.toFixed(0)}ms`, 8) +
    padL(`${overall.p99.toFixed(0)}ms`, 8) +
    padL(`${overall.max.toFixed(0)}ms`, 8),
  );

  if (m.notes.size > 0) {
    console.log('-'.repeat(94));
    console.log('Notable outcomes');
    for (const [note, count] of [...m.notes.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${pad(note, 28)} ${count}`);
    }
  }

  const gates = buildGates(m, meta.duplicateViolations.length);
  console.log('-'.repeat(94));
  console.log('ACCEPTANCE GATES');
  for (const g of gates) {
    console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${pad(g.label, 22)} ${padL(g.actual, 10)}   (limit ${g.limit})`);
  }

  if (meta.duplicateViolations.length > 0) {
    console.log('-'.repeat(94));
    console.log('DUPLICATE ARRIVALS — investigate immediately');
    for (const v of meta.duplicateViolations.slice(0, 20)) {
      console.log(`  delegate ${v.delegateId}: ${v.before} -> ${v.after} arrival rows`);
    }
    if (meta.duplicateViolations.length > 20) {
      console.log(`  ... and ${meta.duplicateViolations.length - 20} more`);
    }
  }

  const passed = gates.every((g) => g.pass);
  console.log('='.repeat(94));
  console.log(passed ? 'RESULT: PASSED — ready for 100+ concurrent users.' : 'RESULT: FAILED — do not run the event on this configuration.');
  console.log('='.repeat(94) + '\n');
  return { passed, gates, overall, totalOps, totalErrors };
}

// ---------------------------------------------------------------------------
// Self-test (no network) — proves the harness, its maths and its gates work
// ---------------------------------------------------------------------------

function runSelfTest() {
  console.log('\nSELF-TEST (no network, no database writes)\n');

  const m = emptyMetrics();
  const synth = (op: OpName, n: number, base: number, jitter: number) => {
    for (let i = 0; i < n; i++) {
      // log-normal-ish skew so p99 is meaningfully above p50
      const v = base + Math.abs(Math.random() - Math.random()) * jitter;
      record(m, { op, ok: Math.random() > 0.002, ms: v });
    }
  };
  synth('check_in_by_code', 4000, 120, 700);
  synth('search', 2200, 90, 400);
  synth('ministry_stats', 380, 140, 500);
  synth('dashboard', 380, 300, 900);
  synth('master_list', 360, 110, 500);
  m.notes.set('already_checked_in', 1200);

  const print = printReport(m, {
    concurrency: 150,
    durationS: 180,
    elapsedS: 180,
    eventName: '(self-test — synthetic data)',
    duplicateViolations: [],
  });

  // Assert the maths: monotonically non-decreasing percentiles.
  let ok = true;
  for (const op of OP_NAMES) {
    const s = summarize(m.samples[op]);
    if (!(s.p50 <= s.p95 && s.p95 <= s.p99 && s.p99 <= s.max)) {
      console.error(`SELF-TEST FAIL: percentile ordering broken for ${op}`);
      ok = false;
    }
  }

  // Assert the gate logic actually fails a bad run.
  const bad = emptyMetrics();
  for (let i = 0; i < 100; i++) record(bad, { op: 'check_in_by_code', ok: true, ms: 5000 });
  const badGates = buildGates(bad, 3);
  if (badGates.every((g) => g.pass)) {
    console.error('SELF-TEST FAIL: gates did not reject a deliberately bad sample');
    ok = false;
  }

  // Assert the duplicate diff catches a violation.
  const before = new Map([['d1', 0]]);
  const after = new Map([['d1', 2]]);
  if (diffViolations(before, after).length !== 1) {
    console.error('SELF-TEST FAIL: duplicate detector missed a violation');
    ok = false;
  }

  console.log(ok ? 'SELF-TEST PASSED — harness maths, report and gates verified.\n' : 'SELF-TEST FAILED.\n');
  console.log(`(Primary run would have ${print.passed ? 'PASSED' : 'FAILED'} on this synthetic distribution.)\n`);
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (SELF_TEST) return runSelfTest();

  // ---- configuration guards ------------------------------------------------
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL / VITE_SUPABASE_URL');
  if (!SUPABASE_KEY) missing.push('SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY');
  if (!EVENT_ID) missing.push('LOAD_EVENT_ID');
  if (!EMAIL) missing.push('LOAD_EMAIL');
  if (!PASSWORD) missing.push('LOAD_PASSWORD');
  if (missing.length) {
    console.error('ERROR: missing environment variables:\n  ' + missing.join('\n  '));
    console.error('\nRun `npm run loadtest:selftest` to validate the harness without a database.');
    process.exit(1);
  }
  if (CONFIRM !== 'yes') {
    console.error('ERROR: refusing to run. This test WRITES check-ins.');
    console.error('Set LOAD_CONFIRM=yes once you have confirmed LOAD_EVENT_ID points at a STAGING event.');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- authenticate --------------------------------------------------------
  console.log('Signing in...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (authError || !authData?.user) {
    console.error(`ERROR: sign-in failed: ${authError?.message || 'no user returned'}`);
    process.exit(1);
  }
  const registrarId = authData.user.id;
  console.log(`Signed in as ${EMAIL} (${registrarId})`);

  // ---- event guard ---------------------------------------------------------
  const { data: evRow, error: evErr } = await supabase
    .from('events')
    .select('event_id, name, is_active')
    .eq('event_id', EVENT_ID)
    .maybeSingle();
  if (evErr || !evRow) {
    console.error(`ERROR: event ${EVENT_ID} not found${evErr ? `: ${evErr.message}` : ''}`);
    process.exit(1);
  }
  const eventName = (evRow as any).name as string;
  const isActive = (evRow as any).is_active !== false;
  if (!isActive) {
    console.error(`ERROR: event "${eventName}" is LOCKED (is_active = false). Writes will be rejected.`);
    process.exit(1);
  }
  if (!ALLOW_ANY_EVENT && !/staging|stagetest|test|load|sandbox|dummy/i.test(eventName)) {
    console.error(`ERROR: event "${eventName}" does not look like a staging event.`);
    console.error('Rename it to contain "staging"/"test", or set LOAD_ALLOW_ANY_EVENT=yes if you are certain.');
    process.exit(1);
  }

  // ---- dataset -------------------------------------------------------------
  console.log(`Loading delegate pool (max ${POOL_SIZE})...`);
  const { data: delRows, error: delErr } = await supabase
    .from('delegates')
    .select('delegate_id, qr_hash, first_name, last_name')
    .eq('event_id', EVENT_ID)
    .not('qr_hash', 'is', null)
    .limit(POOL_SIZE);
  if (delErr) {
    console.error(`ERROR: could not read delegates: ${delErr.message}`);
    process.exit(1);
  }
  const rows = (delRows || []) as { delegate_id: string; qr_hash: string; first_name: string | null }[];
  if (rows.length < 5) {
    console.error(`ERROR: need at least 5 delegates with a qr_hash in this event; found ${rows.length}.`);
    process.exit(1);
  }

  const pool: Pool = {
    delegateIds: rows.map((r) => r.delegate_id),
    qrHashes: rows.map((r) => r.qr_hash),
    searchTerms: [...new Set(rows.map((r) => (r.first_name || '').trim()).filter((n) => n.length >= 2))].slice(0, 20),
  };
  if (pool.searchTerms.length === 0) pool.searchTerms.push('a');

  // ---- baseline snapshot for the duplicate assertion -----------------------
  console.log('Snapshotting arrival counts (duplicate baseline)...');
  const before = await arrivalCounts(supabase, pool);

  // ---- run -----------------------------------------------------------------
  console.log(`\nStarting ${CONCURRENCY} virtual scanners for ${DURATION_S}s...`);
  const metrics = emptyMetrics();
  const deadline = Date.now() + DURATION_S * 1000;

  const worker = async () => {
    while (Date.now() < deadline) {
      const op = nextOp();
      let result: OpResult;
      switch (op) {
        case 'check_in_by_code':
          result = await opCheckIn(supabase, registrarId, pool);
          break;
        case 'search':
          result = await opSearch(supabase, pool);
          break;
        case 'ministry_stats':
          result = await opMinistryStats(supabase);
          break;
        case 'dashboard':
          result = await opDashboard(supabase);
          break;
        default:
          result = await opMasterList(supabase);
      }
      record(metrics, result);
      await sleep(randInt(THINK_MIN_MS, THINK_MAX_MS));
    }
  };

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsedS = (Date.now() - startedAt) / 1000;

  // ---- duplicate proof -----------------------------------------------------
  console.log('Re-reading arrival counts (duplicate verification)...');
  const after = await arrivalCounts(supabase, pool);
  const duplicateViolations = diffViolations(before, after);

  // ---- report --------------------------------------------------------------
  const report = printReport(metrics, {
    concurrency: CONCURRENCY,
    durationS: DURATION_S,
    elapsedS,
    eventName,
    duplicateViolations,
  });

  const outPath =
    process.env.LOAD_JSON_OUT ||
    `loadtest-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        event: { id: EVENT_ID, name: eventName },
        concurrency: CONCURRENCY,
        durationS: DURATION_S,
        elapsedS,
        thresholds: THRESHOLDS,
        operations: OP_NAMES.map((op) => ({ op, count: metrics.counts[op], errors: metrics.errors[op], ...summarize(metrics.samples[op]) })),
        overall: { totalOps: report.totalOps, totalErrors: report.totalErrors, ...report.overall },
        notes: Object.fromEntries(metrics.notes),
        gates: report.gates,
        duplicateViolations,
        passed: report.passed,
      },
      null,
      2,
    ),
  );
  console.log(`JSON report written to ${outPath}\n`);

  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Load test crashed:', err);
  process.exit(2);
});
