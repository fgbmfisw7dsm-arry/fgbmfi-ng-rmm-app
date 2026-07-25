# FGBMFI Nigeria EMS — Implementation Plan

**Project:** FGBMFI Nigeria Events Management System
**Version:** 1.5 (Phase 1) → 2.0 (Target)
**Last Updated:** July 24, 2026

---

## Session Summary (July 24, 2026)

### What Was Delivered

| Item | Type | Status |
|------|------|--------|
| `AGENTS.md` | AI operational context | ✅ Committed |
| `ARCHITECTURE-v2.md` | Target architecture & roadmap | ✅ Committed |
| `supabase_migration_sprint1.sql` | DB indexes + RPCs | ✅ Committed + Run |
| `sprint1_fix_function.sql` | RPC bug fix | ✅ Committed + Run |

### Database Migration Results

| Object | Status |
|--------|--------|
| pg_trgm extension | ✅ Created |
| Indexes (6): delegates GIN, phone, checkins composite x2, financials, pledges | ✅ Created |
| `get_event_dashboard_stats()` RPC | ✅ Created + Fixed |
| `search_delegates()` RPC | ✅ Created |
| `import_delegates_batch()` RPC | ✅ Created |

### Pending (Needs User Action)

| Action | Details |
|--------|---------|
| Push to GitHub | ✅ Done |
| Upgrade Supabase to Pro tier | For 50 concurrent officers (60 connections) |
| Apply Sprint 2+3 optimizations | QR UUID migration + TanStack Query |

---

## Phased Roadmap

### Phase 1 — Core Event Management (6–8 weeks) ← **Current**

Optimize the existing React/Vite SPA for 25K delegates and 50 concurrent officers.

| Sprint | Focus | Deliverables | Effort | Status |
|--------|-------|-------------|--------|--------|
| **Sprint 1** | Database & Search | pg_trgm indexes, pagination infra, scoped realtime, aggregate RPCs | 8 hrs | ✅ Done |
| **Sprint 2** | QR & Import | UUID-based QR migration, chunked bulk import, deduplication at insert | 24 hrs | ✅ Done | | ✅ Done |
| **Sprint 3** | Check-in Performance | TanStack Query integration, connection health UI, offline queue | 28 hrs | ✅ Done |
| **Sprint 4** | Dashboard & Reports | Summary PDF only, CSV/JSON export, RPC-based dashboard | 20 hrs | ⬜ |
| **Sprint 5** | Hardening & Deployment | 50-concurrent-user load test, error recovery, operator training | 24 hrs | ⬜ |
| **Total** | | | **~104 hrs** | |

### Phase 2 — Finance & Communications (4–6 weeks)

| Task | Effort |
|------|--------|
| Payment gateway integration (Paystack) | 40 hrs |
| SMS/Email/WhatsApp notification module | 32 hrs |
| Communication Centre UI (broadcast, templates) | 24 hrs |
| Enhanced reporting (Excel export, drill-down) | 16 hrs |
| Accommodation & Transportation schema design | 8 hrs |
| Donations module (individual/corporate) | 16 hrs |
| **Total** | **~136 hrs** |

### Phase 3 — Logistics & Operations (6–8 weeks)

| Task | Effort |
|------|--------|
| Accommodation management (assignment, room tracking) | 40 hrs |
| Transportation scheduling (airport pickup, bus allocation) | 32 hrs |
| Committee management (CRUD, assignments, attendance) | 24 hrs |
| Vendor & Exhibition management (booth allocation, payments) | 24 hrs |
| Digital certificate generation (auto PDF) | 16 hrs |
| Next.js framework migration begins | 40 hrs |
| **Total** | **~176 hrs** |

### Phase 4 — Enterprise & Scale (ongoing)

| Task | Effort |
|------|--------|
| Next.js App Router migration completion | 80 hrs |
| Mobile applications (Android + iOS) | 120 hrs |
| Self-service delegate portal | 40 hrs |
| Online registration + payment | 40 hrs |
| Historical cross-event analytics | 32 hrs |
| AI-powered dashboards + forecasting | 40 hrs |
| **Total** | **~352 hrs** |

---

## Sprint 2 — Detailed Plan (QR & Import)

**Goal:** Eliminate QR collision risk at 25K delegates + make bulk import reliable.

### Tasks

| # | Task | Effort | Dependencies | Status |
|---|------|--------|-------------|--------|
| 2.1 | Add `qr_hash TEXT UNIQUE` column to delegates table | 1 hr | Sprint 1 (done) | ✅ Done |
| 2.2 | Generate UUID-based QR hashes for all existing delegates | 2 hrs | 2.1 | ✅ Done |
| 2.3 | Rewrite `generateCodeFromId()` in utils.ts to use UUID + keep 4-digit fallback | 4 hrs | 2.2 | ✅ Done |
| 2.4 | Update CheckInPage to scan/paste UUID QR codes | 6 hrs | 2.3 | ✅ Done |
| 2.5 | Add badge reprint + lost badge replacement UI | 4 hrs | 2.4 | ✅ Done |
| 2.6 | Chunk `importDelegates()` into 500-row batches with progress bar | 4 hrs | — | ✅ Done |
| 2.7 | Use `import_delegates_batch` RPC for server-side dedup | 3 hrs | 2.6 | ✅ Done |

### Acceptance Criteria
- No two delegates share the same QR hash
- 4-digit fallback codes still work for offline/backup check-in
- Bulk import of 25K rows completes in <60s with visible progress
- Duplicate delegates (same name + phone) are silently skipped during import

---

## Sprint 3 — Detailed Plan (Check-in Performance)

**Goal:** Prevent 50 concurrent officers from overwhelming the database.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 3.1 | Install `@tanstack/react-query` | 1 hr | — |
| 3.2 | Wrap Supabase queries with `useQuery` hooks | 12 hrs | 3.1 |
| 3.3 | Add query dedup + stale-time configuration | 3 hrs | 3.2 |
| 3.4 | Scope Realtime subscriptions by `event_id=eq.{id}` | 4 hrs | — |
| 3.5 | Build connection health indicator component | 3 hrs | — |
| 3.6 | Build offline check-in queue with retry logic | 5 hrs | 3.5 |

### Acceptance Criteria
- 50 officers searching simultaneously generate <5 DB queries/second
- Realtime subscriptions only fire for the active event
- Officers see a persistent green/red connection indicator
- Failed check-ins are queued locally and retried automatically

---

## Sprint 4 — Detailed Plan (Dashboard & Reports)

**Goal:** Dashboard loads in <1s at 25K, exports don't crash the browser.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 4.1 | Replace `getStats()` client-side logic with RPC call | 4 hrs | Sprint 1 (done) |
| 4.2 | Add pagination to MasterListModule (50 rows/page) | 6 hrs | — |
| 4.3 | Add pagination to CheckInPage search results | 4 hrs | — |
| 4.4 | Rewrite PDF export to render summary-only (aggregated by district) | 4 hrs | — |
| 4.5 | Add CSV/JSON export for full data download | 4 hrs | 4.4 |
| 4.6 | Remove `getAllDataForExport()` usage from all pages | 2 hrs | 4.1–4.5 |

### Acceptance Criteria
- Dashboard loads in <1s regardless of event size
- List views show 50 rows per page with pagination controls
- PDF export renders summaries, not full data tables
- CSV export produces a valid spreadsheet of all 25K rows

---

## Sprint 5 — Detailed Plan (Hardening & Deployment)

**Goal:** System survives 50 concurrent officers with grace.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 5.1 | Synthetic load test: 50 concurrent virtual officers | 8 hrs | Sprints 1–4 |
| 5.2 | Error recovery: auto-retry on failed writes | 4 hrs | 5.1 |
| 5.3 | Operator training materials (quick reference guide) | 6 hrs | — |
| 5.4 | Supabase Pro tier upgrade + connection pool monitoring | 2 hrs | — |
| 5.5 | Production deployment verification on Vercel | 4 hrs | 5.1–5.4 |

### Acceptance Criteria
- 50 concurrent check-in operations complete with <200ms average latency
- System recovers gracefully from network interruptions
- Operators can be trained in <30 minutes
- Supabase connection pool stays below 80% utilization

---

## Critical Path Dependencies

```
Sprint 1 (Indexes + RPCs) ✅ Done
        ↓
Sprint 2 (QR + Import) ✅ Done
        ↓
Sprint 3 (TanStack Query + Realtime) ✅ Done
        ↓
Sprint 4 (Dashboard + Reports) ← You are here
        ↓
Sprint 5 (Load Test + Hardening)
        ↓
           25K Delegate Event
```

## Infrastructure Requirements

| Resource | Current | Target | Action |
|----------|---------|--------|--------|
| Supabase plan | Free (15 connections) | Pro (60 connections) | Upgrade before event |
| Vercel plan | Hobby | Pro | For 50 concurrent users |
| Custom domain | fgbmfi-ng-rmm-app.vercel.app | events.fgbmfi-nigeria.org.ng | Configure DNS |

---

## Risk Watchlist

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| QR collisions at 25K | Certain (10K slots) | Critical | UUID migration (Sprint 2) | Dev |
| Dashboard OOM at 25K | High | Critical | RPC aggregation (Sprint 4) | Dev |
| Search timeout at 25K | High | High | pg_trgm indexes (✅ Done) | Dev |
| Connection pool exhaustion | Medium | High | TanStack Query + Pro tier (Sprint 3) | DevOps |
| Officer training gaps | Medium | Medium | Quick reference guide (Sprint 5) | Product |

---

*This is a living document. Update completion status and adjust estimates as sprints progress.*
