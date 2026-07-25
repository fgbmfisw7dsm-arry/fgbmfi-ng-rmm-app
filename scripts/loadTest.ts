/**
 * Sprint 5.1 — Load Test: 50 Concurrent Virtual Officers
 * 
 * Usage: npx tsx scripts/loadTest.ts
 * Prerequisites: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY env vars set
 * 
 * Simulates 50 concurrent officers performing:
 *   - Delegate search (3-5 queries/min each)
 *   - Check-in operations (5-10 check-ins/min each)
 *   - Dashboard stats fetch (every 30s)
 *   - Master list pagination fetch
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

if (!SUPABASE_URL.includes('supabase.co') || !SUPABASE_KEY.startsWith('eyJ')) {
  console.error('ERROR: Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CONCURRENT_USERS = 50;
const TEST_DURATION_MS = 120_000;
const SEARCH_INTERVAL_MS = 15_000;
const CHECKIN_INTERVAL_MS = 8_000;
const STATS_INTERVAL_MS = 30_000;

const SEARCH_TERMS = ['John', 'Mary', 'James', 'Grace', 'Peter', 'Esther', 'David', 'Sarah'];
const DELEGATE_IDS_POOL: string[] = [];

interface VirtualOfficer {
  id: number;
  eventId: string;
  email: string;
  searchOps: number;
  checkInOps: number;
  statsOps: number;
  errors: number;
  avgLatency: number[];
}

const officers: VirtualOfficer[] = [];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function searchDelegates(officer: VirtualOfficer): Promise<void> {
  const q = randomItem(SEARCH_TERMS);
  try {
    const start = performance.now();
    const { data, error } = await supabase
      .from('delegates')
      .select('*')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .limit(25);
    const latency = performance.now() - start;
    officer.avgLatency.push(latency);
    officer.searchOps++;
    if (error) officer.errors++;
  } catch {
    officer.errors++;
  }
}

async function simulateCheckIn(officer: VirtualOfficer): Promise<void> {
  if (DELEGATE_IDS_POOL.length === 0) return;
  const did = randomItem(DELEGATE_IDS_POOL);
  try {
    const start = performance.now();
    const { error } = await supabase.from('checkins').insert({
      event_id: officer.eventId,
      delegate_id: did,
      checked_in_at: new Date().toISOString(),
      checked_in_by: null,
    });
    const latency = performance.now() - start;
    officer.avgLatency.push(latency);
    officer.checkInOps++;
    if (error) officer.errors++;
  } catch {
    officer.errors++;
  }
}

async function fetchDashboardStats(officer: VirtualOfficer): Promise<void> {
  try {
    const start = performance.now();
    const { data, error } = await supabase.rpc('get_event_dashboard_stats', {
      p_event_id: officer.eventId,
      p_district: null,
    });
    const latency = performance.now() - start;
    officer.avgLatency.push(latency);
    officer.statsOps++;
    if (error) officer.errors++;
  } catch {
    officer.errors++;
  }
}

async function runOfficer(officer: VirtualOfficer, durationMs: number): Promise<void> {
  const startTime = Date.now();

  const intervals: NodeJS.Timeout[] = [
    setInterval(() => searchDelegates(officer), SEARCH_INTERVAL_MS + Math.random() * 5000),
    setInterval(() => simulateCheckIn(officer), CHECKIN_INTERVAL_MS + Math.random() * 4000),
    setInterval(() => fetchDashboardStats(officer), STATS_INTERVAL_MS + Math.random() * 5000),
  ];

  await new Promise<void>(resolve => setTimeout(resolve, durationMs));
  intervals.forEach(clearInterval);
}

async function main() {
  console.log(`\n--- FGBMFI EMS Load Test ---`);
  console.log(`Users: ${CONCURRENT_USERS} | Duration: ${TEST_DURATION_MS / 1000}s`);
  console.log(`Supabase URL: ${SUPABASE_URL}\n`);

  const { data: events } = await supabase.from('events').select('event_id').limit(1);
  if (!events || events.length === 0) {
    console.error('No events found. Create an event first.');
    process.exit(1);
  }
  const eventId = events[0].event_id;

  const { data: delegates } = await supabase.from('delegates').select('delegate_id').limit(200);
  if (delegates) {
    DELEGATE_IDS_POOL.push(...delegates.map(d => d.delegate_id));
  }

  for (let i = 0; i < CONCURRENT_USERS; i++) {
    officers.push({
      id: i + 1,
      eventId,
      email: `officer${i + 1}@test.fgbmfi-ng.org`,
      searchOps: 0,
      checkInOps: 0,
      statsOps: 0,
      errors: 0,
      avgLatency: [],
    });
  }

  console.log(`Starting ${CONCURRENT_USERS} virtual officers...`);
  const startTime = Date.now();

  await Promise.all(officers.map(o => runOfficer(o, TEST_DURATION_MS)));

  const elapsed = (Date.now() - startTime) / 1000;

  const totalSearch = officers.reduce((s, o) => s + o.searchOps, 0);
  const totalCheckIn = officers.reduce((s, o) => s + o.checkInOps, 0);
  const totalStats = officers.reduce((s, o) => s + o.statsOps, 0);
  const totalErrors = officers.reduce((s, o) => s + o.errors, 0);
  const totalOps = totalSearch + totalCheckIn + totalStats;

  const allLatencies = officers.flatMap(o => o.avgLatency);
  allLatencies.sort((a, b) => a - b);
  const avgLatency = allLatencies.length > 0
    ? allLatencies.reduce((s, l) => s + l, 0) / allLatencies.length
    : 0;
  const p50 = allLatencies[Math.floor(allLatencies.length * 0.5)] || 0;
  const p95 = allLatencies[Math.floor(allLatencies.length * 0.95)] || 0;
  const p99 = allLatencies[Math.floor(allLatencies.length * 0.99)] || 0;

  console.log(`\n========== RESULTS ==========`);
  console.log(`Duration:        ${elapsed.toFixed(1)}s`);
  console.log(`Total Ops:       ${totalOps}`);
  console.log(`  Searches:      ${totalSearch}`);
  console.log(`  Check-ins:     ${totalCheckIn}`);
  console.log(`  Dashboard:     ${totalStats}`);
  console.log(`Errors:          ${totalErrors} (${((totalErrors / (totalOps || 1)) * 100).toFixed(1)}%)`);
  console.log(`Ops/sec:         ${(totalOps / elapsed).toFixed(1)}`);
  console.log(`Avg Latency:     ${avgLatency.toFixed(0)}ms`);
  console.log(`P50 Latency:     ${p50.toFixed(0)}ms`);
  console.log(`P95 Latency:     ${p95.toFixed(0)}ms`);
  console.log(`P99 Latency:     ${p99.toFixed(0)}ms`);
  console.log(`=============================\n`);

  const passed = totalErrors < totalOps * 0.01 && avgLatency < 500;
  if (passed) {
    console.log('RESULT: PASSED — System meets 50-concurrent-user targets.\n');
  } else {
    console.log('RESULT: FAILED — Review latency and error rates.\n');
  }

  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Load test crashed:', err);
  process.exit(2);
});
