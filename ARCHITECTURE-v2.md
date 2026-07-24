# ARCHITECTURE-v2.md — FGBMFI Nigeria Events Management System

## Version 2.0 Architecture & Roadmap

**Document Status:** Planning | **Target Framework:** Next.js 15 (post Phase 1)
**Current Baseline:** React 19 + Vite 6 SPA (v1.1 — Regional)

---

## 1. Purpose & Scope

### Vision
A centralized platform for planning, registration, accreditation, attendance management, finance capture, reporting, and post-event analysis for all FGBMFI Nigeria events — from chapter meetings to National Conventions — using a single, scalable codebase.

### Supported Event Types
- National Convention
- Regional Council Meetings (RCM)
- District Conferences
- Leadership Retreats
- National Executive Meetings
- National Training Programmes
- Special Events

### Strategic Positioning
FGBMFI Nigeria Events Management System (EMS) — positioned as a national ICT asset, not a "regional registration system."

---

## 2. Architectural Principles

| Principle | Description |
|-----------|-------------|
| **Supabase-first** | PostgreSQL + Auth + Realtime as the core backend. No custom API server until v2 migration. |
| **Offline-tolerant** | Check-in operations must degrade gracefully with poor connectivity (local queue, retry, sync). |
| **Progressive enhancement** | v1 features port forward to v2. No rewrites from scratch — generalize existing patterns. |
| **No vendor lock-in** | Supabase SDK can be abstracted behind a data-access layer for future portability. |
| **Single delegate repository** | One `delegates` table for all events — reuse across events, no duplicate records. |
| **Event lifecycle governance** | `is_active` flag controls write access. Locked events are immutable. |

---

## 3. v1 → v2 Evolution Map

### Current Architecture (v1.1)
```
Browser (React SPA)
  ↕ HashRouter
Pages (React Components)
  ↕ AppContext (State)
  ↕ supabaseService.ts
  ↕ Supabase SDK (direct DB + Auth)
supabase.co
 ├── PostgreSQL (8 tables)
 ├── Auth (email/password)
 └── Realtime
```

### Phase 1 Target (v1.5 — Optimized SPA)
```
Browser (React SPA)
  ↕ HashRouter
Pages (React Components)
  ↕ AppContext + TanStack Query (caching, dedup)
  ↕ supabaseService.ts (paginated, optimized)
  ↕ Supabase SDK
supabase.co
 ├── PostgreSQL (8 tables + indexes + RPCs)
 ├── Auth (email/password)
 ├── Realtime (scoped by event_id)
 └── Storage (QR codes, badges)
```

### Phase 2–4 Target (v2.0 — Next.js)
```
Browser (Next.js App Router)
  ↕ Server Components / Client Components
  ↕ TanStack Query (data fetching)
  ↕ Server Actions / API Routes
  ↕ Prisma ORM + Supabase Auth
supabase.co
 ├── PostgreSQL (30+ tables)
 ├── Auth (email/password, 2FA)
 ├── Realtime (scoped subscriptions)
 └── Storage (QR, badges, certificates, photos)
```

---

## 4. Module Registry

The system comprises 13 modules (A–M). Each is classified by implementation status and roadmap phase.

| Module | v1 Status | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|--------|-----------|---------|---------|---------|---------|
| **A. Event Administration** | ✅ Core CRUD | Multi-event, clone, archive, calendar | Event templates | — | — |
| **B. Delegate Management** | ✅ Core CRUD | Pagination, QR UUID, membership numbers | Online registration portal | — | — |
| **C. QR Code Management** | ⚠️ 4-digit hash | UUID migration, badge print, reprint | — | — | — |
| **D. Arrival Registration & Accreditation** | ✅ Core check-in | Scoped realtime, connection health UI | Walk-in registration | — | — |
| **E. Session Attendance** | ✅ Sessions CRUD | Session-scoped check-in | — | — | — |
| **F. Finance Management** | ✅ Offerings + Pledges | Batch CSV export | Payment gateway integration | — | — |
| **G. Accommodation Management** | ❌ Not started | — | Schema design | Full assignment + tracking | — |
| **H. Transportation** | ❌ Not started | — | Schema design | Trip scheduling + tracking | — |
| **I. Committee Management** | ❌ Not started | — | — | Committee CRUD + assignments | — |
| **J. Vendor & Exhibition** | ❌ Not started | — | — | Booth allocation + payments | — |
| **K. Communication Centre** | ❌ Not started | — | SMS/Email/WhatsApp broadcast | — | — |
| **L. Digital Certificates** | ❌ Not started | — | — | Auto-generation + download | — |
| **M. Reports & Analytics** | ⚠️ PDF-only | Summary PDF, CSV export, dashboard stats RPC | Excel export, drill-down | Historical cross-event analytics | AI-powered forecasting |

**Legend:** ✅ Done | ⚠️ Partial/Needs work | ❌ Not started

---

## 5. Database Architecture

### Current Tables (8) — Preserved and Extended

| Table | v1 Purpose | v2 Extensions |
|-------|-----------|---------------|
| `events` | Event catalog | Add: venue, state, max_delegates, registration_window, event_type |
| `delegates` | Single repository | Add: membership_no, qr_hash (UUID), gender, zone, delegate_type, badge_status |
| `sessions` | Event sub-events | Add: session_type, location |
| `checkins` | Arrival + session | Add: accreditation_status, device_id, sync_id |
| `pledges` | Financial pledges | Add: payment_status, payment_date |
| `financial_entries` | Offerings + redemptions | Add: payment_method, receipt_number, payment_gateway_ref |
| `app_users` | User profiles | Extend role system (see RBAC section) |
| `system_settings` | Global config | Migrate to normalized tables for districts, zones, chapters |

### Planned Tables (24+)

#### People & Organization
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `districts` | Official district registry | id, name, code, region_id |
| `regions` | Geographic regions | id, name, code |
| `zones` | Zones within districts | id, name, code, district_id |
| `chapters` | Local chapters | id, name, code, zone_id, district_id |
| `delegate_types` | Delegate classification | id, name, description |
| `members` | Membership tracking | id, membership_no, status, join_date |
| `volunteers` | Volunteer registry | id, delegate_id, skills, availability |

#### Logistics
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `accommodation` | Delegate-housing assignment | id, event_id, delegate_id, facility_id, room_id, check_in, check_out |
| `facilities` | Hotels, guest houses, host families | id, name, type, address, capacity |
| `rooms` | Room inventory | id, facility_id, room_number, capacity |
| `transport_trips` | Airport/bus schedules | id, event_id, type, route, vehicle_id, driver_id, departure, arrival |
| `vehicles` | Vehicle registry | id, plate_number, type, capacity, driver_id |
| `committees` | Event committees | id, event_id, name, chairman_id |
| `committee_members` | Committee assignments | id, committee_id, delegate_id, role |

#### Finance (Extended)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `donations` | Individual/corporate donations | id, event_id, donor_name, amount, type, anonymous |
| `payment_methods` | Payment channels | id, name (CASH/POS/BANK_TRANSFER/CARD) |
| `receipts` | Generated receipts | id, financial_entry_id, receipt_number, generated_at |

#### Communication & Certification
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `notifications` | Notification log | id, event_id, type (SMS/EMAIL/WHATSAPP/PUSH), recipient, status |
| `notification_templates` | Message templates | id, type, content, variables |
| `certificates` | Generated certificates | id, delegate_id, event_id, type, issued_at, download_url |

#### Vendors & Exhibitors
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `vendors` | Vendor/exhibitor registry | id, name, type, contact, booth_number |
| `vendor_payments` | Vendor payments | id, vendor_id, event_id, amount, status |

#### Audit & Security
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `audit_logs` | Immutable event audit trail | id, user_id, action, table_name, record_id, old_values, new_values, ip_address |
| `roles` | Role definitions | id, name, description |
| `permissions` | Granular permissions | id, role_id, resource, action |
| `user_sessions` | Active session tracking | id, user_id, device_id, ip_address, started_at, last_active_at |

### Index Strategy (v2)
```sql
-- All FK columns MUST be indexed
CREATE INDEX idx_delegates_name_gin ON delegates USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);
CREATE INDEX idx_delegates_phone ON delegates(phone);
CREATE INDEX idx_delegates_membership_no ON delegates(membership_no);
CREATE INDEX idx_delegates_qr_hash ON delegates(qr_hash);
CREATE INDEX idx_checkins_event_delegate ON checkins(event_id, delegate_id);
CREATE INDEX idx_checkins_event_session ON checkins(event_id, session_id);
CREATE INDEX idx_checkins_checked_in_at ON checkins(checked_in_at);
CREATE INDEX idx_financials_event ON financial_entries(event_id);
CREATE INDEX idx_pledges_event ON pledges(event_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(created_at);
```

---

## 6. Tech Stack Comparison

### Detailed v1 vs v2

| Layer | v1 (Current — Regional) | v2 (Target — National) | Rationale |
|-------|-------------------------|------------------------|-----------|
| **Framework** | React 19 + Vite 6 (SPA) | Next.js 15 (App Router) | SSR for SEO (public pages), API Routes eliminate need for service abstraction layer, file-based routing |
| **Language** | TypeScript 5.8 | TypeScript 5.8+ | Same — strict mode in v2 |
| **Database** | PostgreSQL (Supabase) | PostgreSQL (Supabase) | Same — connection pooler required for Prisma |
| **ORM** | Direct Supabase JS | Prisma 5.x | Typed queries, migration management, removes raw SQL risk |
| **Auth** | Supabase Auth + `app_users` table | Supabase Auth + Prisma `User` model | Sync pattern: DB trigger `auth.users` → `public.users` |
| **UI** | Tailwind CSS 3.x | Tailwind CSS + shadcn/ui | shadcn/ui standardizes 14+ pages, reduces custom CSS |
| **State** | React Context | React Context + TanStack Query | Query dedup, caching, background refetch, prevents re-render storms |
| **QR Codes** | 4-digit deterministic hash | UUID (crypto.randomUUID) stored in DB | Eliminates collision risk at >10K delegates |
| **QR Scan** | Manual entry | html5-qrcode / ZXing | Native camera scan support |
| **PDF** | html2pdf.js (client-side DOM capture) | pdf-lib / jsPDF (server-side) | Client-side DOM→canvas fails at 25K rows |
| **Charts** | Recharts 3.5 | Chart.js or Recharts | Either works — no strong preference |
| **Exports** | PDF-only | CSV, Excel (SheetJS), JSON, PDF | Multi-format for national aggregation |
| **Realtime** | Supabase Realtime (full table) | Supabase Realtime (scoped by event_id) | Reduces channel payload at 50 concurrent officers |
| **Storage** | Not used | Supabase Storage | QR badge images, certificates, delegate photos |
| **Mobile** | None | PWA → Android/iOS (Phase 4) | Responsive web app first, native later |
| **Payments** | None | Paystack/Flutterwave (Phase 2–3) | Nigerian payment gateways |
| **AI** | None | OpenRouter (Phase 4) | Attendance forecasting, automated reporting |
| **Hosting** | Vercel (SPA) | Vercel (Next.js) | Same platform, different preset |

### What Stays the Same (No Migration Needed)
- Supabase as the cloud backend
- PostgreSQL 15 as the database
- Vercel as the hosting provider
- Event lifecycle pattern (`is_active` + `ensureEventActive()`)
- District scoping as tenant-isolation pattern
- Deduplication and harmonization business logic

---

## 7. Phased Roadmap

### Phase 1 — Core Event Management (6–8 weeks)

**Objective:** Deliver a stable, scalable system for a 25K-delegate event with 50 concurrent accreditation officers, using the existing React/Vite codebase.

| Sprint | Focus | Deliverables |
|--------|-------|-------------|
| **Sprint 1** | Database & Search | pg_trgm indexes, pagination infrastructure, search optimization, scoped realtime subscriptions |
| **Sprint 2** | QR & Import | UUID-based QR migration, chunked bulk import (500-row batches), deduplication at insert |
| **Sprint 3** | Check-in Performance | TanStack Query integration, connection health UI, offline queue pattern |
| **Sprint 4** | Dashboard & Reports | RPC-based aggregate stats, summary PDF only, CSV/JSON export, 25K synthetic load test |
| **Sprint 5** | Hardening & Deployment | 50-concurrent-user load test, error recovery paths, operator training materials |

#### Phase 1 Effort Estimate

| Task | Hours |
|------|-------|
| Database indexes + RPCs | 8 |
| QR code migration (UUID) | 16 |
| Pagination refactor (all list views) | 32 |
| Bulk import chunking + progress | 8 |
| TanStack Query integration | 24 |
| Realtime optimization (scoped channels) | 8 |
| PDF/CSV export rework | 16 |
| Connection health UI | 4 |
| Load testing + fixes | 24 |
| **Total** | **~140 hours** |

### Phase 2 — Finance & Communications (4–6 weeks)

| Task | Effort |
|------|--------|
| Payment gateway integration (Paystack) | 40 |
| SMS/Email/WhatsApp notification module | 32 |
| Communication Centre UI (broadcast, templates) | 24 |
| Enhanced reporting (Excel export, drill-down) | 16 |
| Accommodation & Transportation schema design | 8 |
| Donations module (individual/corporate) | 16 |
| **Total** | **~136 hours** |

### Phase 3 — Logistics & Operations (6–8 weeks)

| Task | Effort |
|------|--------|
| Accommodation management (assignment, room tracking) | 40 |
| Transportation scheduling (airport pickup, bus allocation) | 32 |
| Committee management (CRUD, assignments, attendance) | 24 |
| Vendor & Exhibition management (booth allocation, payments) | 24 |
| Digital certificate generation (auto PDF) | 16 |
| Next.js framework migration begins | 40 |
| **Total** | **~176 hours** |

### Phase 4 — Enterprise & Scale (ongoing)

| Task | Effort |
|------|--------|
| Next.js App Router migration completion | 80 |
| Mobile applications (Android + iOS) | 120 |
| Self-service delegate portal | 40 |
| Online registration + payment | 40 |
| Historical cross-event analytics | 32 |
| AI-powered dashboards + forecasting | 40 |
| **Total** | **~352 hours** |

---

## 8. Performance & Scaling Strategy

### 25K Delegate Benchmarks

| Scenario | Current (v1) | Phase 1 Target | v2 Target |
|----------|-------------|----------------|-----------|
| Delegate name search | 3–8s (seq scan) | <200ms (trgm index) | <100ms |
| Dashboard load | 5–15s (fetch all) | <1s (RPC aggregate) | <500ms |
| Check-in write | 500ms | <200ms | <100ms |
| Realtime event broadcast | All clients receive all events | Scoped by event_id | Scoped + batched |
| PDF export (full list) | Browser OOM @ 5K | Summary only (aggregated) | Server-side, 25K rows |
| List view render (DOM) | 25K nodes → browser hang | 50 rows + pagination | 50 rows + virtual scroll |
| Bulk import (25K rows) | Single request → timeout | 500-row batches, ~60s total | 500-row batches, ~30s |

### Phase 1 Optimization Strategy

| Optimization | Approach | Impact |
|-------------|----------|--------|
| **Indexes** | pg_trgm GIN on first_name + last_name, B-tree on phone, email | Search <200ms at 25K |
| **Pagination** | All list views use `.range(start, end)` with 25–50 page size | DOM stays under 1K nodes |
| **Aggregate RPCs** | Dashboard stats computed in DB via RPC, not client-side iteration | Dashboard load <1s |
| **TanStack Query** | Cache/duplicate queries from 50 concurrent officers | 50x fewer DB round-trips |
| **Scoped Realtime** | Filter channel by `event_id=eq.{id}` | 50x fewer notifications |
| **Connection Health** | Persistent indicator + local queue for failed writes | Officers know state instantly |
| **Batch Import** | `Promise.allSettled()` with 500-row chunks + progress bar | 25K import <60s |

### Connection Pool Planning (Supabase)
- Supabase free tier: 15 connections
- Supabase Pro: 60 connections (recommended for 50 concurrent officers)
- Supabase Team: 120 connections
- **Recommendation:** Start Pro tier during Phase 1 events. The TanStack Query cache reduces concurrent DB hits significantly below 50 simultaneous connections.

---

## 9. Security Architecture

### RBAC Matrix (14 Roles — v2 Target)

| Role | Scope | Key Permissions |
|------|-------|-----------------|
| `system_admin` | Global | Full system access, user management, all events |
| `national_ict` | Global | Event creation, system config, reports |
| `event_admin` | Per event | Event edit, delegate mgmt, finance mgmt |
| `registration_manager` | Per event | Bulk import, delegate editing, badge management |
| `district_registrar` | Per district | District-scoped CRUD, check-in |
| `accreditation_officer` | Per event session | Check-in only, QR scan |
| `finance_officer` | Per event | Financial entries, pledges, reports |
| `committee_chairman` | Per committee | Committee mgmt, member assignments |
| `transport_officer` | Per event | Transport scheduling |
| `accommodation_officer` | Per event | Room assignment |
| `media_officer` | Per event | Certificate generation, communications |
| `report_viewer` | Read-only | Dashboard, reports, exports |
| `auditor` | Read-only + logs | All data + audit trail |
| `volunteer` | Self | Own profile, own committee assignments |

### RLS Policy Design (v2)
```sql
-- Example: Delegates table
CREATE POLICY "District-scoped access" ON delegates FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM app_users 
      WHERE role = 'district_registrar' 
        AND district = delegates.district
    )
  );
```

### v2 Security Features
| Feature | Status | Phase |
|---------|--------|-------|
| Role-based access control (RLS + client) | ✅ v1 baseline | v1 |
| Write guard (event lifecycle) | ✅ v1 baseline | v1 |
| Audit logging (new table) | ❌ | Phase 1 |
| Two-factor authentication | ❌ | Phase 2 |
| Session timeout + device logging | ❌ | Phase 2 |
| Encrypted QR validation | ❌ | Phase 2 |
| Activity logging per user session | ❌ | Phase 2 |
| Daily automated backups | ✅ Supabase managed | v1 |

---

## 10. Migration Strategy

### Option A (Recommended for Phase 1) — Stay on React/Vite

**Rationale:** The close-event timeline (25K delegates) makes a framework migration the #1 schedule risk. Phase 1 optimizes the existing SPA.

```
Phase 1: React + Vite + TanStack Query + Optimizations
                        ↓
Phase 2: Same stack, add payment + communication modules
                        ↓
Phase 3: Begin Next.js migration in parallel with logistics modules
                        ↓
Phase 4: Complete Next.js migration, add mobile apps + AI
```

### Migration Path: React/Vite → Next.js

| Step | What | Risk | When |
|------|------|------|------|
| 1 | Add TanStack Query to Vite app | Low | Phase 1 Sprint 3 |
| 2 | Extract data fetching from pages into custom hooks | Low | Phase 1 Sprint 3 |
| 3 | Create Next.js app alongside Vite app | Medium | Phase 3 |
| 4 | Port hooks → Next.js Server Actions / API routes | Medium | Phase 3 |
| 5 | Port pages → App Router (file-based) | Medium | Phase 3–4 |
| 6 | Replace HashRouter with Next.js `<Link>` | Low | Phase 4 |
| 7 | Add Prisma + DB trigger for auth sync | High | Phase 4 |
| 8 | Decommission Vite app | Low | Phase 4 |

### File-by-File Migration Guide

| v1 File | v2 Target | Migration Complexity |
|---------|-----------|---------------------|
| `App.tsx` | `src/app/layout.tsx` + `src/app/page.tsx` | Medium |
| `pages/LoginPage.tsx` | `src/app/login/page.tsx` | Low |
| `pages/AdminDashboard.tsx` | `src/app/(dashboard)/page.tsx` | Medium |
| `pages/CheckInPage.tsx` | `src/app/checkin/page.tsx` | Low |
| `services/supabaseService.ts` | `src/lib/db.ts` (Prisma queries) | High |
| `services/supabaseClient.ts` | `src/lib/supabase.ts` | Low |
| `context/AppContext.ts` | `src/lib/contexts/app-context.tsx` | Low |
| `components/Layout.tsx` | `src/app/(dashboard)/layout.tsx` | Medium |
| `pages/ReportsPage.tsx` | `src/app/reports/page.tsx` | Medium |
| `types.ts` | `src/types/` (split by domain) | Medium |
| `services/utils.ts` | `src/lib/utils.ts` | Low |

### Backward Compatibility Guarantee
- All v1 legacy routes (`#/admin/*`, `#/checkin`, `#/login`) will redirect to v2 equivalents during migration
- Existing Supabase tables remain unchanged until Phase 4 migration
- The `supabaseService.ts` API surface is preserved as adapter layer until Prisma migration completes

---

## Appendix A: Risk Register

| Risk | Severity | Mitigation | Phase |
|------|----------|------------|-------|
| 4-digit QR collisions at 25K | CRITICAL | Migrate to UUID-based QR in Sprint 2 | Phase 1 |
| getAllDelegates() OOM at 25K | CRITICAL | Paginate all list views | Phase 1 |
| Realtime channel overload | HIGH | Scope subscriptions by event_id | Phase 1 |
| Supabase connection pool exhaustion | HIGH | TanStack Query dedup + Pro tier connection pool | Phase 1 |
| Context re-render storms | HIGH | TanStack Query removes need for context data fetches | Phase 1 |
| No audit trail for non-repudiation | MEDIUM | Add audit_logs table | Phase 2 |
| Single-row settings write conflicts | MEDIUM | Normalize system_settings to separate tables | Phase 2 |
| Payment gateway integration delays | MEDIUM | Start Paystack integration early in Phase 2 | Phase 2 |
| Prisma + Supabase Auth sync complexity | HIGH | Prototype DB trigger pattern in Phase 3 | Phase 3 |
| Mobile app timeline slip | MEDIUM | Deliver PWA first, native apps second | Phase 4 |

## Appendix B: Design Decisions Log

| Decision | Date | Rationale |
|----------|------|-----------|
| Phase 1 stays on React/Vite | Planned | Framework change is highest risk for close-event timeline |
| UUID-based QR replaces 4-digit hash | Planned | 10K code slots insufficient for 25K delegates |
| TanStack Query over manual context | Planned | Prevents re-render storms, deduplicates 50 concurrent requests |
| Scoped realtime by event_id | Planned | Reduces channel payload from 50x to 1x per officer |
| Summary PDF + full CSV export | Planned | html2canvas cannot render 25K DOM nodes |
| Next.js migration deferred to Phase 3–4 | Planned | Allows event delivery without framework risk |
| Prisma + Supabase Auth sync via DB trigger | Tentative | Subject to prototype validation in Phase 3 |
| 14 consolidated roles | Planned | Covers all FGBMFI operational tiers without over-engineering |
| Single delegate repository across all events | Planned | Prevents duplicate records, enables cross-event analytics |

---

*This document is a living architecture guide. Update as decisions change and phases progress.*
