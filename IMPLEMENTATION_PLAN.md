# FGBMFI Nigeria EMS — Implementation Plan

**Project:** FGBMFI Nigeria Events Management System
**Version:** 1.7 (Phase 1) → 2.0 (Target)
**Last Updated:** July 31, 2026 (Session Ministry Tracking Complete)

---

## Session Summary (July 25, 2026) — Convention Accreditation

### What Was Delivered

| # | Item | Type | Commit |
|---|------|------|--------|
| 1 | Native BarcodeDetector API scanner (replaces html5-qrcode) | Component | `1e97fc4` → `f902600` |
| 2 | Event-scoped delegates (`event_id`, `external_id`, `registration_source`) | Schema | `e3e0da7` |
| 3 | 4-pass QR code resolution (qr_hash → external_id → delegate_id → 4-digit) | Service | `e3e0da7` |
| 4 | Multi-format QR parser (JSON, CSV, multi-line text) | Service | `deaec03` |
| 5 | Auto-registration flow with confirmation form | UI + Service | `e3e0da7` |
| 6 | Event-scoped queries (search, master list, dashboard, reports, import) | Service + Pages | `f6fad49` |
| 7 | Dashboard delegates count scoped to current event only | Service | `61c0f74` |
| 8 | Reports — actual district names instead of "Legacy / Uncategorized" | Page | `5cfde00` |
| 9 | Master list — renamed + district grouping fix | Page | `c56c25e` |
| 10 | Backfill SQL for orphan delegates → legacy event | Migration | `61c0f74` |

### Database Migration Results (User Ran)

| Migration | Content | Status |
|-----------|---------|--------|
| `supabase_migration_sprint2.sql` | `qr_hash` UUID column, backfill, unique index | ✅ Run |
| `supabase_migration_convention.sql` | `event_id`, `external_id`, `registration_source` columns + indexes | ✅ Run |
| `supabase_backfill_legacy.sql` | Reassigns orphan delegates to Legacy/Past Events | ✅ Run |

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| BarcodeDetector API over html5-qrcode | Native Chrome API, same tech as dedicated scanner apps. No canvas-based JS decoder issues on Android |
| `event_id` on delegates | Independent per event. Clean archiving by event. QR codes carry delegate identity across events |
| 4-pass QR resolution | Backward compatible (4-digit + UUID) + external badge support (external_id) |
| `needsRegistration` instead of silent auto-register | Operator confirms data before creating records — prevents phantom delegates |

---

## Session Summary (July 31, 2026) — Session Ministry Tracking

### What Was Delivered

| # | Item | Type | Commit |
|---|------|------|--------|
| 1 | `session_responses` table (FT, SLV, MI, HGB per-delegate) | Schema | `af0785d` |
| 2 | `session_response_summaries` table (manual bulk totals) | Schema | `af0785d` |
| 3 | `session_voice_distribution` table (VD aggregate) | Schema | `af0785d` |
| 4 | `get_session_ministry_stats` + `get_ministry_export_data` RPCs | RPC | `af0785d` → `3677ced` |
| 5 | Session Details page (`#/ministry`) — CheckInPage-style workflow | Page | `af0785d` → `03e0c46` |
| 6 | QR scan, 4-digit code, and manual search for alter call recording | UI | `03e0c46` |
| 7 | Manual totals entry modal for open-air sessions (MPO/FTO) | UI | `3e7ed24` |
| 8 | Voice Distribution per-session number input | UI | `af0785d` |
| 9 | Sessions Summary table with ATT attendance column | UI + RPC | `3677ced` |
| 10 | Sessions Report tab on Reports Center with Alter Call filter | Page | `af0785d` → `3677ced` |
| 11 | Individual alter call respondent CSV export | Page | `03e0c46` |
| 12 | Sessions Summary PDF + Excel export with professional headings | Page | `03e0c46` → `3e7ed24` |
| 13 | Badge reprint: 60×70mm badge, 25-28mm QR, actual-size print | Page | `68a8d6e` |
| 14 | Badge PDF download, PNG image download, native share (e-badge) | Page | `ae17a0e` |
| 15 | User manual update: QR, Session Details, Sessions Report, E-Badge | Docs | `7cc248d` |
| 16 | `html2canvas` CDN for badge image capture | Infra | `ae17a0e` |

### Database Migration Results

| Migration | Content | Status |
|-----------|---------|--------|
| `supabase_migration_sprint10_ministry.sql` | 3 new tables + indexes + RLS + 2 RPCs | To run by user |
| `supabase_migration_sprint10_attendance.sql` | Updated RPCs with attendance column | To run by user |

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Separate `session_responses` table from `checkins` | Different business semantics — alter call response ≠ session attendance. Clean UNIQUE constraint per delegate per type per session |
| `session_response_summaries` for manual totals | Open-air sessions (MPO/FTO) track only aggregate headcounts. Separate table avoids polluting individual records with summary data |
| 4 response types (FT, SLV, MI, HGB) as `CHECK` enum | Fixed taxonomy for FGBMFI Nigeria events. Extensible by adding new CHECK values |
| Voice Distribution as separate table | VD is always aggregate (no per-delegate tracking). Single UNIQUE constraint per session |
| CheckInPage-style workflow on Session Details page | Proven battle-tested pattern: search bar + QR scanner + manual code + new delegate registration. Operators already trained on this UX |
| 60×70mm badge with 25-28mm QR | Fits standard badge holders. QR at 25mm prints clearly and scans reliably from phone screens at arm's length |
| Native Web Share API for e-badge distribution | Zero-save workflow: officer taps Share → native sheet opens → WhatsApp → delegate receives instantly — no intermediate file management |

### Key Files Changed

| File | Changes |
|------|---------|
| `types.ts` | Added `SessionResponseType` enum, `SessionResponse`, `SessionResponseSummary`, `VoiceDistribution`, `SessionMinistryDashboard`, `MinistryExportData` |
| `services/supabaseService.ts` | Added 10 new methods: record/min/get for all session tables, dashboard + export fallbacks, `getSessionResponseIds` |
| `hooks/useMinistry.ts` | TanStack Query hook: dashboard, recordResponse, recordSummary, recordVD mutations |
| `pages/SessionMinistryPage.tsx` | Full page: session selector, response type tabs, QR scan + code entry + search bar, results with Record buttons, registration form, Sessions Summary table, VD input, PDF/CSV export |
| `pages/ReportsPage.tsx` | Renamed to "Reports Center", added Sessions tab with ATT column, Alter Call filter dropdown, CSV export per individual records list |
| `pages/CheckInPage.tsx` | Badge modal: Print + PDF + Image + Share buttons (4 export options, 60×70mm badge) |
| `components/Layout.tsx` | Added "Session Details" nav link under Operations |
| `pages/UserManualModule.tsx` | Sections 6A (Session Details), 8A (Badge Management), updated 04/06/08, 5 new training scenarios, 4 new troubleshooting items |
| `index.html` | Added `html2canvas` CDN script |
| `supabase_migration_sprint10_ministry.sql` | 3 new tables, indexes, RLS, 2 RPCs |
| `supabase_migration_sprint10_attendance.sql` | Updated RPCs with attendance JOIN |

### Route Additions

| Route | Page | Roles |
|-------|------|-------|
| `#/ministry` | SessionMinistryPage | admin, registrar |

### Dashboard Data Flow

```
SessionMinistryPage
    ↕ useMinistry() TanStack Query hook
    ↕ supabaseService.ts
        ├── recordSessionResponse()    → session_responses table
        ├── recordSessionResponseSummary() → session_response_summaries table
        ├── recordVoiceDistribution()  → session_voice_distribution table
        ├── getSessionMinistryDashboard()  → RPC get_session_ministry_stats (with ATT)
        ├── getMinistryDataForExport()    → RPC get_ministry_export_data (with ATT)
        └── getSessionResponseIds()       → direct query (for duplicate check)
    ↕ Report display
        ├── Sessions tab (Reports Center)
        │   ├── Summary table with ATT column
        │   ├── Per-session response type breakdown
        │   ├── Individual delegate lists per call type
        │   ├── Alter Call filter dropdown (All / FT / SLV / MI / HGB)
        │   └── CSV export per individual records list
        └── Sessions Summary table (Session Details page)
            ├── PDF export with FGBMFI header
            └── Excel (CSV) export with metadata
```

---

## Phased Roadmap

### Phase 1 — Core Event Management (6–8 weeks) ← **Current**

Optimize the existing React/Vite SPA for 25K delegates and 50 concurrent officers.

| Sprint | Focus | Deliverables | Effort | Status |
|--------|-------|-------------|--------|--------|
| **Sprint 1** | Database & Search | pg_trgm indexes, pagination infra, scoped realtime, aggregate RPCs | 8 hrs | ✅ Done |
| **Sprint 2** | QR & Import | UUID-based QR migration, chunked bulk import, deduplication at insert | 24 hrs | ✅ Done | | ✅ Done |
| **Sprint 3** | Check-in Performance | TanStack Query integration, connection health UI, offline queue | 28 hrs | ✅ Done |
| **Sprint 4** | Dashboard & Reports | Summary PDF only, CSV/JSON export, RPC-based dashboard | 20 hrs | ✅ Done |
| **Sprint 5** | Hardening & Deployment | 50-concurrent-user load test, error recovery, operator training | 24 hrs | ✅ Done |
| **Sprint 6** | Convention Accreditation | Native QR scanner, event-scoped delegates, 4-pass code resolution, multi-format QR parser, auto-registration flow, event isolation queries, report/master list fixes | 32 hrs | ✅ Done |
| **Sprint 10** | Session Ministry Tracking | session_responses/summaries/VD tables, Session Details page (#/ministry) with CheckInPage workflow, alter call recording (FT/SLV/MI/HGB), manual totals for MPO/FTO, Voice Distribution tracking, Sessions Summary with ATT column, Sessions Report tab with Alter Call filter + CSV export, badge reprint (60×70mm), e-badge PDF/PNG/Share, user manual update | 48 hrs | ✅ Done |
| **Total** | | | **~184 hrs** | |

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

## Sprint 6 — Detailed Plan (Convention Accreditation)

**Goal:** Enable QR-based check-in for conventions with badges from external portals. Isolate delegates per event.

### Tasks

| # | Task | Effort | Dependencies | Status |
|---|------|--------|-------------|--------|
| 6.1 | Replace html5-qrcode with native BarcodeDetector API scanner | 6 hrs | — | ✅ Done |
| 6.2 | Full-screen scanner UI with high camera resolution (1080p) | 2 hrs | 6.1 | ✅ Done |
| 6.3 | Add `event_id`, `external_id`, `registration_source` to delegates | 3 hrs | — | ✅ Done |
| 6.4 | 4-pass QR code resolution (qr_hash → external_id → delegate_id → 4-digit) | 4 hrs | 6.3 | ✅ Done |
| 6.5 | Multi-format QR parser (JSON, CSV, multi-line text) with `nullnull` stripping | 5 hrs | 6.4 | ✅ Done |
| 6.6 | Auto-registration flow: parsed QR data → confirmation form → register + check-in | 4 hrs | 6.5 | ✅ Done |
| 6.7 | Event-scoped queries everywhere (search, master list, dashboard, reports, import) | 4 hrs | 6.3 | ✅ Done |
| 6.8 | Dashboard delegate count strictly scoped to current event | 1 hr | 6.7 | ✅ Done |
| 6.9 | Fix Reports + MasterList district grouping (remove "Legacy / Uncategorized") | 2 hrs | — | ✅ Done |
| 6.10 | SQL backfill script for orphan delegates → legacy event | 1 hr | 6.3 | ✅ Done |

### Acceptance Criteria
- QR scanning via native BarcodeDetector API on Android Chrome (zero library issues)
- External badge QR codes (CSV format with `CON26...` IDs) parse automatically from BarcodeDetector.rawValue
- Unknown delegates auto-register with operator confirmation (single-click)
- Second scan of same badge matches instantly via `external_id` (no duplicate records)
- Each event's delegates are scoped — past event data does not pollute current event
- Districts not in official list appear under their actual name in reports and master list
- 4-digit legacy codes still work as fallback

### Key Files Changed

| File | Changes |
|------|---------|
| `components/QRScanner.tsx` | Full rewrite: native BarcodeDetector API, full-screen, 1080p, debug overlay |
| `services/supabaseService.ts` | 4-pass checkInByCode, parseQRData (JSON/CSV/text), registerDelegateFromQR, event-scoped queries |
| `pages/CheckInPage.tsx` | Registration form, code display, auto-submit at 24 chars, sessionId wiring |
| `pages/ReportsPage.tsx` | District grouping: actual names instead of "Legacy / Uncategorized" |
| `pages/MasterListModule.tsx` | Renamed heading, identical district grouping fix, event-scoped pagination |
| `pages/ImportModule.tsx` | Passes `activeEventId` to importDelegates |
| `types.ts` | Added `event_id`, `external_id`, `registration_source` to Delegate; `needsRegistration`, `scannedCode`, `parsedData` to CheckInResult |
| `supabase_migration_convention.sql` | event_id, external_id, registration_source columns + indexes + backfill notes |
| `supabase_backfill_legacy.sql` | Creates legacy event + reassigns orphan delegates |

---

## Critical Path Dependencies

```
Sprint 1 (Indexes + RPCs) ✅ Done
        ↓
Sprint 2 (QR + Import) ✅ Done
        ↓
Sprint 3 (TanStack Query + Realtime) ✅ Done
        ↓
Sprint 4 (Dashboard + Reports) ✅ Done
        ↓
Sprint 5 (Load Test + Hardening) ✅ Done
        ↓
Sprint 6 (Convention Accreditation) ✅ Done
        ↓
Sprint 10 (Session Ministry Tracking) ✅ Done
        ↓
        READY FOR CONVENTION ✅
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
| QR collisions at 25K | ~~Certain~~ Resolved | Critical | UUID migration (Sprint 2) — ✅ Done | Dev |
| Confusion between alter call records and session attendance | Medium | High | Separate tables + UI labels, individual CSV exports clearly marked per response type — ✅ Done | Dev |
| Manual totals conflated with individual scans | Low | Medium | Separate `session_response_summaries` table, reports show Scanned vs Manual columns distinctly — ✅ Done | Dev |
| E-badge QR scan reliability on mobile | Low | Medium | 28mm QR at 3x retina capture (~1130px), tested ≤400px display equivalent | Product |
| Dashboard OOM at 25K | High | Critical | RPC aggregation (Sprint 4) | Dev |
| Search timeout at 25K | High | High | pg_trgm indexes (✅ Done) | Dev |
| Connection pool exhaustion | Medium | High | TanStack Query + Pro tier (Sprint 3) | DevOps |
| Officer training gaps | Medium | Medium | Quick reference guide + updated manual (✅ Done) | Product |

---

*This is a living document. Update completion status and adjust estimates as sprints progress.*
