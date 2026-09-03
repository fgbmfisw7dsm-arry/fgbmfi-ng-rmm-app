# AGENTS.md — FGBMFI Nigeria EMS AI Operational Context

## Project Overview
- **Name:** FGBMFI Nigeria Events Management System (FGBMFI-EMS)
- **Current Version:** 1.45 (Full-design portrait badges — 4-up-portrait + 6-up-portrait rework)
- **Domain:** FGBMFI Nigeria events — conventions, regional council meetings (RCM), district conferences, leadership retreats, trainings, special events
- **Stack:** React 19 + TypeScript 5.8 + Vite 6 + Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Deployment:** Vercel (SPA with hash-based routing — do NOT switch to browser router)
- **Repository:** `https://github.com/fgbmfisw7dsm-arry/fgbmfi-ng-rmm-app`
- **Live Site:** `https://fgbmfi-ng-rmm-app.vercel.app`
- **v2 Architecture Roadmap:** See `ARCHITECTURE-v2.md` in project root

## Technology Stack (v1 — Current)

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React (Vite SPA) | 19.2 |
| Language | TypeScript | 5.8 |
| Routing | React Router (HashRouter) | 7.11 |
| Database | PostgreSQL (Supabase) | 15 |
| Auth | Supabase Auth + custom `app_users` table | — |
| UI | Tailwind CSS | 3.x |
| State | React Context (AppContext) | — |
| Charts | Recharts | 3.5 |
| PDF | jsPDF (standalone CDN 2.5.1) + html2canvas 1.4.1 + Canvas 2D badge generation | — |
| QR Codes | Deterministic 4-digit hash (client-side) | — |
| Realtime | Supabase Realtime (Postgres Changes) | — |
| Build | Vite | 6.x |
| Hosting | Vercel (SPA) | — |

### Target Technology Stack (v2 — See ARCHITECTURE-v2.md for details)
| Layer | v1 (Current) | v2 (Target) |
|-------|-------------|-------------|
| Framework | React + Vite SPA | Next.js 15 (App Router) |
| ORM | Direct Supabase JS | Prisma + Supabase |
| UI | Tailwind CSS | Tailwind CSS + shadcn/ui |
| State | React Context | React Context + TanStack Query |
| PDF | html2pdf.js | pdf-lib / jsPDF |
| QR | 4-digit deterministic hash | UUID-based + ZXing scan |
| Auth | Supabase Auth + app_users | Supabase Auth + Prisma sync |

## System Architecture

### Current Architecture (v1)
```
Browser (React SPA)
    ↕ HashRouter
React Components (Pages)
    ↕ AppContext (State)
    ↕ supabaseClient.ts ←→ supabaseService.ts
    ↕ Supabase SDK
supabase.co
 ├── PostgreSQL (12 tables including badge batches, session ministry)
 ├── Auth (email/password)
 ├── Realtime (subscriptions)
 └── Storage (badge-pdfs bucket for printed batch PDFs)
```

### Key Architectural Decisions
1. **No custom API server** — all data access is direct Supabase JS from the browser
2. **Hash-based routing** — required for SPA deployment on Vercel (no server-side routing)
3. **Context-based state** — AppContext provides user, activeEvent, events globally; no Redux
4. **Service abstraction** — `supabaseService.ts` wraps all DB operations; pages never call Supabase directly
5. **Realtime sync** — dashboards subscribe to Postgres Changes channels for live updates
6. **Guard pattern** — `ensureEventActive()` blocks writes on locked events at the service layer
7. **Code-generation key** — 4-digit check-in codes are derived from `delegateId + eventId` hash, not stored

## Project Structure

```
fgbmfi-ng-rmm-app/
├── components/
│   ├── BadgePreview.tsx          # Badge layout preview grid (5 layouts)
│   ├── ConfigurationError.tsx    # Vite + Supabase config validation
│   ├── ErrorBoundary.tsx         # Class-based React error boundary
│   ├── Layout.tsx                # Shell: header, nav, active event selector
│   ├── Logos.tsx                 # FGBMFI SVG logo component
│   ├── QRScanner.tsx             # Native BarcodeDetector API (1080p) scanner
│   └── StatCard.tsx              # Reusable dashboard stat card
├── context/
│   └── AppContext.ts             # Global state: user, activeEvent, events (NOTE: 404 — may be inline in App.tsx)
├── hooks/
│   └── useMinistry.ts            # TanStack Query: session ministry mutations
├── pages/
│   ├── AdminDashboard.tsx        # Real-time dashboard with charts + activity feed
│   ├── BadgePrintingModule.tsx   # Badge generation: filters, 5 layouts, batches, storage, reprint
│   ├── CheckInPage.tsx           # QR code entry + delegate search + badge reprint (canvas-based)
│   ├── DataModule.tsx            # Data management: clear event, bulk delete, harmonize
│   ├── EventsModule.tsx          # CRUD events + sessions + lifecycle toggle
│   ├── FinancialsPage.tsx        # Offerings, pledges, redemptions (3-tab)
│   ├── ImportModule.tsx          # CSV bulk delegate import
│   ├── LoginPage.tsx             # Supabase Auth email/password login
│   ├── MasterListModule.tsx      # Full delegate list + inline editing + PDF export
│   ├── NewDelegatePage.tsx       # Single delegate registration form
│   ├── ReportsPage.tsx           # Attendance list, matrix, financial report, pledge summary, sessions
│   ├── SessionMinistryPage.tsx   # Alter call recording: QR scan + search + response types (FT/SLV/MI/HGB)
│   ├── SetupModule.tsx           # System settings: districts, ranks, offices, titles
│   ├── StorageModule.tsx         # Admin storage file management (badge-pdfs bucket)
│   ├── UserManualModule.tsx      # Static help/guide content
│   └── UsersModule.tsx           # CRUD app_users + role assignment
├── services/
│   ├── badgePdfGenerator.ts      # pdf-lib badge generation: 5 layouts, canvas QR, banner header
│   ├── mockSupabase.ts           # CLEARED — no longer used
│   ├── supabaseClient.ts         # Supabase client singleton + config check
│   ├── supabaseService.ts        # All DB operations: auth, delegates, checkins, finances, settings, badges, storage, session ministry
│   └── utils.ts                  # formatCurrency, generateCodeFromId, exportToPDF, downloadJSON
├── .gitignore
├── App.tsx                       # Root: ErrorBoundary → Auth init → AppContext → HashRouter → Routes
├── index.html                    # CDN scripts: Tailwind, html2pdf, html2canvas, jsPDF 2.5.1
├── index.tsx                     # Entry point (ReactDOM.createRoot)
├── metadata.json                 # Supabase metadata snapshot
├── package.json
├── supabase_schema.sql           # Full DDL + RLS + RPCs + seed data
├── tsconfig.json
├── types.ts                      # All interfaces, enums (UserRole, BadgeLayout, SessionResponseType, etc.)
└── vite.config.ts
```

## Database Design

### Current Tables (12)

| Table | Purpose | Key Columns | RLS |
|-------|---------|------------|-----|
| `events` | Event catalog | event_id, name, start_date, end_date, is_active, region | Authenticated |
| `delegates` | Single delegate repository | delegate_id, first_name, last_name, district, chapter, phone, email, rank, office, title, qr_hash, external_id, event_id | Authenticated |
| `sessions` | Event sessions (sub-events) | session_id, event_id (FK), title, start_time, end_time | Authenticated |
| `checkins` | Arrival + session attendance | checkin_id, event_id, delegate_id, session_id (nullable), checked_in_at, checked_in_by | Authenticated |
| `pledges` | Financial pledges | id, event_id, donor_name, district, amount_pledged, amount_redeemed, pledge_name | Authenticated |
| `financial_entries` | Offerings + redemptions | id, event_id, type (OFFERING/PLEDGE_REDEMPTION), amount, session_id, payer_name, pledge_id (FK), remarks | Authenticated |
| `app_users` | System user profiles | id (UUID, FK to auth.users), email, role, district | Authenticated |
| `system_settings` | Global config (single row) | id, titles (jsonb), districts (jsonb), ranks (jsonb), offices (jsonb), regions (jsonb), delegate_types (jsonb) | Authenticated |
| `badge_batches` | Badge PDF generation batches | batch_id, event_id, batch_number, badge_count, page_count, layout, sort_field, filters, status, pdf_url | Authenticated |
| `badge_print_logs` | Per-badge print audit trail | log_id, batch_id (FK cascade), delegate_id, event_id, printed_by, printed_at | Authenticated |
| `session_responses` | Alter call individual responses | response_id, event_id, delegate_id, session_id, response_type (FT/SLV/MI/HGB), recorded_by | Authenticated |
| `session_voice_distribution` | Voice distribution aggregates | id, event_id, session_id, count (integer) | Authenticated |

### Critical Indexes (Must Exist Before 25K Scale)
```sql
-- Required for search performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_delegates_name_gin ON delegates USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);
CREATE INDEX idx_delegates_phone ON delegates(phone);
CREATE INDEX idx_delegates_qr_hash ON delegates(qr_hash);          -- UNIQUE, critical for QR scan Pass 1
CREATE INDEX idx_checkins_event_delegate ON checkins(event_id, delegate_id);
CREATE INDEX idx_checkins_event_session ON checkins(event_id, session_id);
CREATE INDEX idx_financials_event ON financial_entries(event_id);
CREATE INDEX idx_pledges_event ON pledges(event_id);

-- Concurrent scanner safety (unique constraints)
CREATE UNIQUE INDEX idx_checkins_event_delegate_session_unique ON checkins(event_id, delegate_id, session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_checkins_event_delegate_arrival_unique ON checkins(event_id, delegate_id) WHERE session_id IS NULL;
CREATE UNIQUE INDEX idx_session_responses_delegate_session_unique ON session_responses(event_id, delegate_id, session_id, response_type);
```

### Supabase RPCs (9)
- `create_app_user(email, password, role, district)` — **LEGACY** — manual auth.users INSERT via RPC. Superseded by `db.createUser → signUp()` for new user creation. Still serves as a fallback/recovery mechanism for re-creating broken auth rows.
- `confirm_user_by_email(p_email)` — SECURITY DEFINER; auto-confirms a user created via `signUp()` and ensures an email identity row exists. Used by the new `createUser` flow (v1.6).
- `delete_app_user(user_id_to_delete)` — deletes from app_users + auth.users
- `reset_user_password(user_id, new_password)` — updates auth.users password (bcrypt cost 10, manual salt)
- `get_my_profile()` — returns the caller's `app_users` row
- `check_login_account(p_email, p_password)` — SECURITY DEFINER login diagnostics (works WITHOUT a session; reports malformed email, no account, wrong password, unconfirmed, missing identity, deactivated, AND bcrypt_cost from stored hash)
- `v_auth_integrity_check` (view) — audit view for broken user detection, includes `bcrypt_cost` column
- `get_event_dashboard_stats(p_event_id, p_district_filter)` — RPC-based aggregated dashboard counts
- `get_session_ministry_stats(p_event_id)` — RPC for session response counts + attendance
- `get_ministry_export_data(p_event_id, p_session_id)` — RPC for ministry CSV export data (includes attendance)
- `get_next_batch_number(p_event_id)` — RPC for badge batch sequential numbering

### Auth Row Integrity (v1.6 — signUp-based User Creation)

**Current approach (v1.6):** `db.createUser` no longer uses the `create_app_user` RPC. Instead, it calls `supabase.auth.signUp()` via a **temporary Supabase client** (`persistSession: false`, `autoRefreshToken: false`). This lets GoTrue handle all `auth.users` + `auth.identities` row creation natively, eliminating schema drift, bcrypt cost mismatches, and missing-column regressions permanently. After signUp, `confirm_user_by_email` RPC auto-confirms the user, and `app_users` is upserted.

**Legacy RPC (`create_app_user`) — kept as recovery fallback only.** Historical rewrites dropped the `aud`, `instance_id`, and `role` columns on `auth.users`, causing `signInWithPassword()` to silently fail. The `supabase_migration_2026_08_fix_auth_row_integrity.sql` is the reference implementation for this RPC. **Any future rewrite must:**
1. Always set `aud='authenticated'` and `role='authenticated'`
2. Pull `instance_id` from a healthy existing user (or omit if none exists)
3. Use `gen_random_uuid()` for `auth.identities.id` (not `new_user_id`) to avoid PK collision
4. Confirm the user via `email_confirmed_at` (NEVER) → `confirmed_at` (NEVER) → token-clear fallback
5. Use dynamic SQL (`EXECUTE`) for all UPDATE statements on `auth.users`
6. Build the SET clause dynamically using `information_schema.columns` checks

**bcrypt Cost Constraint:** GoTrue (Supabase Auth) requires bcrypt cost ≥ 10. `gen_salt('bf')` defaults to cost 6 and MUST NEVER be used — it causes HTTP 500 on login. Use the manual cost-10 salt construction: `'$2a$10$' || substring(translate(encode(decode(md5(random()::text), 'hex'), 'base64'), '+/', './'), 1, 22)`. The `signUp()`-based approach avoids this concern entirely.

## Authentication & Authorization

### Current Auth Flow
1. **Supabase Auth** handles email/password login via `supabase.auth.signInWithPassword()`
2. **Profile sync:** `auth.getOrCreateProfile()` ensures an `app_users` row exists after login
3. **Session persistence:** Supabase handles token refresh; localStorage fallback for `active_event_id`
4. **Logout:** `supabase.auth.signOut()` + `localStorage.clear()`
5. **Self-service Change Password (v1.11):** header account dropdown → **Change Password**; verifies current password (`signInWithPassword`) then `supabase.auth.updateUser({ password })` + `recordAuditLog('password_change')`. Keeps session; signs out other devices. All roles.

### Roles (Current — 11)
| Role | Access Scope | Pages |
|------|-------------|-------|
| `national_admin` / `regional_admin` / `district_admin` / `admin` (legacy) | Full access, event management, user management | All |
| `national_registrar` / `regional_registrar` / `district_registrar` / `registrar` (legacy) | District-scoped (data filtered by `user.district`), check-in ops | Dashboard, CheckIn, Session Details, New Delegate, Reports |
| `finance` | Financial operations | Dashboard, Financials, Reports |
| `event_admin` | **Global (unscoped)** — registrar modules + Badge Printing + Master List + Import Data (bulk only) + Financials | Dashboard, CheckIn, Session Details, New Delegate, Reports, Badge Printing, Master List, Import Data, Financials |
| `executive_admin` (v1.11) | **National Registrar access + Financial READ** — registrar modules (national scope) PLUS full Reports (incl. Financial/pledge tabs) + Dashboard financials | Dashboard, Reports (all tabs w/ financials), CheckIn, Session Details, New Delegate |

**Event Admin (v1.8) — access model:**
- **Inherits all registrar modules** (Dashboard, Check-In, Session Details, New Delegate, Reports) but is **global/unscoped** (no district/region field; `getScopeFilter` returns `{}`).
- **Plus:** Badge Printing, Master List, Import Data (Bulk Delegate Import), Financials.
- **Excluded (admin-only):** Events & Config, User Management, System Setup, Data Management, Storage, Audit Log, and Import Data's *Scrambled Import Recovery* (destructive delete).
- **Badge Printing removed from registrar** — now `admin + event_admin` only.
- Not added to `is_admin_user()` (DB) or `isAdminRole()` (client) — keeps admin-only modules locked; not added to `isRegistrarRole()` (avoids district scoping).
- RLS write grants (via `is_event_admin_user()`): delegates insert/update, checkins insert, session ministry inserts, badge_batches insert/update, badge_print_logs insert, pledges/financial_entries insert/update. Delete is admin-only.

**Executive Admin (v1.11) — access model:**
- **Registrar tier + national scope:** added to `isRegistrarRole()`/`isNationalRole()` (client) and the registrar write policies (checkins insert, session ministry insert/update) — behaves exactly like `national_registrar` for operations. NOT included in `is_admin_user()`/`isAdminRole()` → admin-only modules (Events, Users, Setup, Data, Storage, Audit, Badges, Master List, Import) stay locked.
- **Financial READ only:** `financials_select_all`/`pledges_select_all` RLS SELECT and the `get_event_dashboard_stats`/`get_report_aggregates`/`get_dashboard_stats` RPC financial gates include `executive_admin` so Reports financial tabs + Dashboard financials render.
- **Cannot write financials:** financial INSERT/UPDATE/DELETE stays `admin`/`event_admin`/`finance` only.
- Route guards: present in `ADMIN_AND_REGISTRAR`/`ADMIN_REGISTRAR_AND_EVENT_ADMIN` (CheckIn, Session Details, New Delegate, Reports) — absent from `ALL_ADMIN_ROLES`/`ADMIN_FINANCE_AND_EVENT_ADMIN`.
- **Role metadata sync (v1.11):** role edits flow through `update_app_user_role(user_id, role)` which atomically sets role in `app_users` **and** `auth.users.raw_user_meta_data`/`raw_app_meta_data`, so session/`get_auth_user_role`/login diagnostics never see a stale role. Re-login required after edit.

### Role Enforcement
- **Server-side:** RLS policies on Supabase tables (in `supabase_schema.sql`)
- **Client-side:** `user.role` checks in pages (e.g., admin-only buttons for event CRUD)
- **Data scoping:** `user.district` filters delegate/checkin queries for REGISTRAR role; `event_admin` is unscoped; `executive_admin` is national-scope (unscoped)
- **Write guard:** `ensureEventActive()` prevents writes on locked events regardless of role

### Auth Priority (Current)
1. `supabase.auth.getSession()` on mount
2. `supabase.auth.onAuthStateChange()` listener
3. 5-second auth timeout safety net before rendering login

## Routing & Navigation

### Route Map (HashRouter)
```
#/login                              — LoginPage (unauthenticated)
#/admin                              — AdminDashboard (default)
#/admin/reports                      — ReportsPage (including Sessions tab)
#/admin/financials                   — FinancialsPage (admin + finance + event_admin)
#/admin/delegates                    — MasterListModule (admin + event_admin)
#/admin/events                       — EventsModule (admin only)
#/admin/users                        — UsersModule (admin only)
#/admin/import                       — ImportModule (admin + event_admin — bulk import; Scrambled Recovery admin only)
#/admin/setup                        — SetupModule (admin only)
#/admin/data                         — DataModule (admin only)
#/admin/badges                       — BadgePrintingModule (admin + event_admin)
#/admin/storage                      — StorageModule (admin only)
#/admin/audit                        — AuditLogPage (admin only)
#/checkin                            — CheckInPage (admin + registrar + event_admin; includes badge reprint modal)
#/ministry                           — SessionMinistryPage (admin + registrar + event_admin)
#/register-new                       — NewDelegatePage (admin + registrar + event_admin)
#/help                               — UserManualModule
#/*                                  — Redirects to /login or /admin based on auth
```

### Navigation Pattern
- `Layout.tsx` renders nav bar with role-gated menu items
- Active event selector in header (dropdown of all events)
- No breadcrumbs, no nested layouts

## State Management

### Current Approach (Context)
```typescript
// AppContext provides:
{
  user: User | null;           // Current user profile
  events: Event[];             // All events
  activeEventId: string;       // Currently selected event
  activeEvent: Event | null;   // Full event object
  login: (user) => void;
  logout: () => void;
  onEventChange: (eventId) => void;
  refreshActiveEvent: () => Promise<void>;
  refreshEvents: () => Promise<void>;
}
```

### Performance Rules
- AppContext re-renders ALL children on any state change — **lightweight only**
- Search/pagination state stays local to components (NOT in context)
- Realtime subscriptions SHOULD be scoped by `event_id` to avoid channel overload
- Do NOT store fetched dataset in context — keep it local to the consuming page

### v2.0 Direction
TanStack Query (React Query) will be added in Phase 1 to:
- Cache/debounce Supabase queries for 50 concurrent officers
- Deduplicate in-flight requests
- Provide background refetch without re-render storms

## Key Feature Patterns

### 1. Event Lifecycle (`is_active` flag)
- `is_active = true` → read-write mode
- `is_active = false` → read-only (locked), watermark overlay on reports
- Guard: `ensureEventActive()` called in every write operation in supabaseService.ts
- Pattern extends to sessions: all write operations check parent event status

### 2. Check-In Codes (UUID-only since v1.10)
- The deterministic 4-digit `generateCodeFromId` code was **removed** (Sprint 19) — it had only 10K slots and collided at scale.
- Delegates are identified by `delegates.qr_hash` (UUID, `crypto.randomUUID()`), `external_id` (`CON26...`), or `delegate_id` (UUID). Badges encode `qr_hash`.
- `CheckInResult.code` / the `code` field on search results are gone; `checkInByCode` now performs **3 passes** (see §11).

### 3. District Scoping (Tenant Isolation)
- `user.role === REGISTRAR && user.district` → all queries filtered by `district`
- Normalization: `norm()` function trims + uppercases + collapses whitespace
- Applied in: search, stats, reports, pledges, financial views
- **This is the tenant-isolation pattern for the multi-tier national model**

### 4. Delegate Deduplication
```typescript
const key = `${norm(d.first_name)}|${norm(d.last_name)}|${norm(d.phone)}`.toUpperCase();
```
- Applied during bulk import and via admin DataModule
- v1 runs on up to 5K records at a time (Supabase `.limit(5000)`)

### 5. District Harmonization
- `db.harmonizeDistricts()` normalizes delegate districts against `system_settings.districts`
- Case-insensitive match, auto-corrects to official spelling
- v1 iterates all delegates — needs pagination at scale

### 6. Realtime Subscriptions
```typescript
supabase.channel('dashboard_sync')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, callback)
  .subscribe();
```
- Current implementation subscribes to ALL changes on the table
- **Performance risk at 25K scale:** should filter by `event_id=eq.{activeEventId}`

### 7. PDF Export
- `exportToPDF(element, filename, orientation, forceViewportWidth, documentType)` in `utils.ts`
- **Dual-mode:** `'report'` (default) — aggressive table sanitation via `pdf-export-mode` CSS class (oversized viewport, overflow flatten, Tailwind color fallbacks). `'document'` — lightweight capture preserving natural padding/max-width for prose content (User Manual, Training Guide).
- `index.html` CSS: `.print-mode` keeps layout-safe rules; `.pdf-export-mode` applies aggressive table-reset rules (max-width:none, padding:0, table float:left) only for reports.
- Clone-based capture: `requestAnimationFrame` → `setTimeout(500ms)` → html2canvas (scale=2) → jsPDF
- **Does not scale to 25K rows** — use summary-only PDF + full CSV export

### 8. Bulk Import (CSV Upload + Column Mapping)
- **File upload:** `<input type="file" accept=".csv,.txt">` with `FileReader` API, shows selected filename
- **Paste mode:** existing textarea kept as primary input; paste also triggers header detection
- **CSV header parsing:** first line auto-detected as header row, stripped whitespace + quotes
- **Fuzzy column matching:** 35+ alias variants mapped to 10 known fields (Title, First Name, Last Name, District, Chapter, Phone, Email, Rank, Office, DelegateType)
- **Column mapping UI:** toggle buttons for each detected column; auto-checked when matched to a known field
- **event_config awareness:** reads `activeEvent.event_config` — auto-unchecks Rank/Office/DelegateType if hidden for the event
- **Dynamic field order:** instruction grid and sample row adapt to active event's visible field count
- **Data transformation:** `mappedCsvData` useMemo reorders/reduces CSV columns before passing to `importDelegates()`
- `importDelegates()` handles the sanitized data; `activeEventId` scoped
- Clear button resets file + CSV + mapping state
- v2 fix: batch inserts of 500 rows with progress feedback

### 9. Badge Printing (pdf-lib generation)
- 7 layouts: `8-up` (90×60mm), `10-up` (80×55mm), `6-up-portrait` (65×91mm), `9-up-portrait` (55×80mm), `8-up-portrait` (63×90mm), `4-up-3x4` (76.2×101.6mm), `4-up-portrait` (100×140mm)
- Auto-detect paper orientation: if grid width > 210mm, switches to landscape A4 (`badgePdfGenerator.ts`)
- ZONES: header 17%, body 70%, band 13% (footer reduced from 17% to gain more text area)
- Full-width banner header: `fgbmfi badge banner-2.png` (1800×250px) replaces separate logo rendering
- Banner scaled to badge width with maroon (`#3a0007`) padding + gold accent line (`#c8960c`)
- **QR code: 30mm** on all layouts where physically possible (previously 19-28mm)
- Three-tier font sizing for portrait badges: Full (bh ≥ 92mm) → Name 12pt/Label 7.5pt/Value 8.5pt, Small (bw < 60mm or bh < 92mm) → 9/6.5/7.5pt, ExtraSmall (bh < 82mm) → 8/5.5/6pt/1.3× spacing
- Landscape font sizing: Name 12/9pt, Label 7.5/6.5pt, Value 8.5/7.5pt (large/small by 85mm width threshold)
- Long landscape names auto-wrap to two lines at space near midpoint with 1.05× tight stacking
- **All delegate details have labels:** District: X, Chapter: X, Office: X (if enabled), Rank: X (if enabled), ID: XXXXXXXX
- Portrait text area omits `Type` (redundant with color footer band); always renders District, Chapter, ID
- Landscape text area also omits Type; Rank/Office shown conditionally per `event_config.show_rank`/`show_office`
- `showRank` and `showOffice` params threaded from `event.event_config` through `generateBadgePDF` → `drawBadge`
- `drawBadge` no-banner portrait path fully synced with banner path — no font/QR regressions
- Backward compatible: falls back to original logo-based header when banner unavailable
- Color-coded delegate type stamp band at bottom (7% height) — same `BAND_COLORS` mapping; band type text 10pt normal / 9pt small badges (bumped +2pt)
- PDF generated client-side via `pdf-lib`; uploaded to `badge-pdfs` bucket with descriptive filename (see §14)
- PDF document metadata set: title "FGBMFI Delegate Badges", subject, creator
- Batch tracking: `badge_batches` + `badge_print_logs` tables with status lifecycle (pending→generating→ready→printed)
- Storage management: `/admin/storage` page for listing and deleting badge PDF files

### 10. Check-in Badge Reprint (Canvas 2D)
- **Canvas-based generation:** badge drawn programmatically on Canvas 2D at 3× scale (714×1020px)
- Produces a single PNG data URL reused by all 4 export modes (Print, PDF, Image, Share)
- 63×90mm portrait default (matching `8-up-portrait` layout)
- Layout: 29% banner header + 64% white body (QR + text) + 7% colored footer band
- QR code: 30mm (previously 19mm), generated via `QRCode.toCanvas(width: 400)` for sharp rendering
- **Text sizing (Canvas):** Name 14px bold, Fields 9px bold (District/Chapter/Office/Rank), ID 8px bold, Delegate Type (footer band) 9px bold
- **Text sizing (DOM):** Name `text-[14px]`, Fields `text-[9px]`, ID `text-[8px]`, Delegate Type (footer band) `11px`
- All delegate details are individually labeled lines: District: X, Chapter: X, Office: X (if enabled), Rank: X (if enabled), ID: XXXXXXXX
- Canvas badge respects `showRank`/`showOffice` from `event_config` — fields hidden when disabled for the event
- Line spacing: 18px gap between each text line, 16px gap between QR bottom and name (canvas)
- DOM badge: `marginTop: 1.5mm`, `lineHeight: 1.4`
- Banner fetched with 5s timeout + `encodeURI()` + graceful fallback (empty banner)
- **Never use `dangerouslySetInnerHTML` with SVG for QR** — html2canvas cannot render it
- **Never use `position:absolute` children with percentage heights for capture** — DOM clone collapses

### 11. QR Code Resolution (3-pass checkInByCode)
```typescript
// Pass order in checkInByCode():
1. UUID qr_hash lookup (> 10 chars, scoped to active event via event_id)
2. external_id lookup (> 4 chars, scoped to active event via event_id)
3. delegate_id lookup (> 4 chars, only when lookupId !== code, scoped to active event)
```
- All 3 passes scoped to active event: `.eq('event_id', eventId)` added to each lookup
- The 4th pass (4-digit deterministic code) was **removed** in v1.10 — UUID-only.
- `checkInDelegate` and `recordSessionResponse` both reject immediately if `delegateId` is falsy
- Duplicate inserts (23505) caught gracefully — returns "Already recorded" instead of throwing

### 12. Concurrent Scanner Safety
- DB-level unique constraints prevent duplicate checkins and session_responses at scale
- Partial unique indexes: separate constraints for null (`WHERE session_id IS NULL`) vs non-null session_id
- App-level graceful handling: 23505 errors treated as success (already recorded)

### 13. Dashboard Auto-Load on Login
- After login, `window.location.hash = '#/admin'` triggers instant navigation to AdminDashboard
- Auth flow: `supabase.auth.signInWithPassword()` → `login(user)` sets context → hash change → dashboard renders
- `activeEventId` restored from localStorage; `fetchEvents()` validates → dashboard fetches data via `useQuery`
- Dashboard auto-refetches when event is changed in the active event selector (query key includes `activeEventId`)
- Dashboard + MasterList both auto-select the first active event when `activeEventId` is empty (see §16)

### 14. Badge PDF Filename Convention
- Storage upload filename: `FGBMFI_Batch-{N}_{District}_{YYYY-MM-DD_HHmmss}.pdf`
- Example: `FGBMFI_Batch-3_South-West-7_2026-08-03_143025.pdf`
- `uploadBadgePDF` accepts optional `customFileName` parameter
- `BadgePrintingModule` constructs filename from batch number + active district filter + current timestamp
- District names sanitized: spaces/punctuation → hyphens, no leading/trailing dashes, multi-hyphen collapse
- "Download PDF" button uses `showSaveFilePicker` API (Chrome/Edge) for guaranteed filename, Blob URL fallback
- "Print PDF" button swaps `document.title` before `print()`, restores via `afterprint` + 15s timeout
- PDF document metadata set via pdf-lib: title "FGBMFI Delegate Badges", subject, creator
- `handleDownload` + `buildBatchFileName()` helper shared across Download/Print buttons

### 14a. Private Bucket + Authenticated Downloads (Sprint 16)
- The `badge-pdfs` bucket is **PRIVATE** (`public: false`). Public URLs (`getPublicUrl()`) do NOT work — they return "404: Bucket not found".
- Downloads must go through `db.getBadgePDFBlob(batch)` → `supabase.storage.from('badge-pdfs').download(fileName)` → client-side Blob + `a.download` (requires an authenticated session).
- `resolveBadgeFileName(batch)` derives the real storage filename from `badge_batches.pdf_url` (URL-decoded basename), falling back to `badge-batch-<batch_id>.pdf` — safe for legacy rows and prevents orphaned files.
- Storage RLS is required for deletes/downloads. Deploy `supabase_migration_sprint16_badge_storage_fix.sql` (idempotent): ensures the private bucket exists, adds `storage.objects` SELECT/INSERT/UPDATE/DELETE policies for `authenticated` scoped to `badge-pdfs`, and a SELECT policy on `storage.buckets`.
- Without those policies, `storage.remove()` is rejected and `listBadgePDFs()`/`uploadBadgePDF()` fail silently (upload previously "worked" only because it pre-created the bucket).
- `deleteStorageFile` returns `false` on failure — StorageModule must never show success when `deleted === 0`.

### 14b. Bulk Badge Operations (admin-only, event-scoped)
- `db.deleteBadgeBatches(ids)` → removes each real PDF from storage, deletes its `badge_print_logs` rows (`.in('batch_id', ids)`), then the `badge_batches` rows. Cascade is explicit at the service layer (FK is `ON DELETE SET NULL`).
- `db.deleteBadgePrintLogs(ids)` / `db.clearBadgePrintLogs(eventId)` — history scrub by id or by active event.
- BadgePrintingModule exposes admin-only bulk controls: Batches tab (Select All + Delete Selected/All) and History tab (Select All + Clear Selected/All), each with a `Set<string>` of selected ids, a `bulkDeleting` spinner, and confirm dialogs.
- StorageModule "Delete All/Selected" reconciles via `loadFiles()` and reports honest results: error when 0 deleted, error listing failed count on partial, success only when all were removed.

### 14c. Badge Printed Status + Staged Generation (v1.40)
- **Per-delegate high tide mark:** `delegates.badge_printed BOOLEAN NOT NULL DEFAULT false` + `delegates.badge_printed_at TIMESTAMPTZ` tracked per delegate (`supabase_migration_badge_printed_status.sql`, idempotent, includes `idx_delegates_badge_printed ON delegates(event_id, badge_printed)` for the 25K "Not Printed" filter). Additive `types.ts` fields on `Delegate`.
- **What is NOT the source of truth:** `badge_print_logs` records *generation* (`action='generated'`), not physical printing. Batch-level status (`badge_batches.status`) was never per-delegate. The flag is the per-delegate print record.
- **Mark Printed flow:** `db.markBadgeBatchPrinted(batchId)` fetches the batch's `event_id`, runs `ensureEventActive()`, then calls the **`mark_badge_batch_printed(p_batch_id)`** `SECURITY DEFINER` RPC (`supabase_migration_badge_mark_printed_rpc.sql`, admin/event_admin-gated) which flags every delegate in the batch via a server-side subquery on `badge_print_logs`, flips the batch to `printed`, and returns the count. Audit `recordAuditLog('badge_batch_printed')`. **Why RPC, not a client UPDATE:** the old client path used `.in('delegate_id', <1000 UUIDs>)` — PostgREST builds the filter into the URL (~38 KB for 1000), and Supabase rejects requests past ~32 KB with HTTP 400, so 1000-badge batches failed while 250/500 passed. The subquery has no URL-size limit and stays atomic at 25K. Deleting a batch keeps the flags (PDF removed frees storage; badges stay marked since they were physically printed).
- **Clear flags (testing/honeymoon reset):** `db.clearBadgePrintedFlags(eventId)` resets all event flags to false/null and returns the count; `recordAuditLog('badge_clear_printed_flags')`; admin-only button "Clear Badge Printed Flags" in the Batches tab header (amber), confirm dialog, disabled on locked events. Batch records are untouched.
- **Registration filter removed from Badge Printing:** `BadgeFilter.registrationStatus` (checked-in cross-query on `checkins`) replaced by `badgePrintedStatus: 'printed'|'not_printed'|'all'` — badges print BEFORE registration, so registration state was irrelevant. `getFilteredDelegates`/`getFilteredDelegateCount` now filter by the indexed `badge_printed` column directly (no `checkins` scan).
- **Skip/override guard (**v1.41 — behavior decoupled from the dropdown**):** "Skip Already Printed" toggle (default ON). It is now a **convenience shortcut that seeds the Badge Status dropdown** (`checked → not_printed`, `unchecked → all`) rather than a hard override — the `badgePrintedStatus: skipAlreadyPrinted ? 'not_printed' : ...` force-overrides in `handlePreviewCount`, `handleGenerate`, and the batch-filter block were removed (BadgePrintingModule.tsx). The **Badge Status dropdown is always enabled**, so `all` (full scope total) is reachable even with the toggle ON — this stopped "selecting a district shows a tiny unprinted remainder instead of the ~1000 total". Preview now also shows a **Scope Total** card (`N total · M already printed`) when the current status filters the scope, and the Generate button labels `Generate X Badges (of N total)`. Manual-selection chips show an amber warning that filters are ignored.
- **v1.42 — empty scope + 'all' status shows the count but keeps the scope rail:** unchecking the toggle seeds `badge_printed_status = 'all'`; with **All Districts** selected and no other scope, an old no-scope guard returned 0 (blank # and a grayed Generate) because "reprint everything" was flagged as unsafe. Removed the no-scope early-returns in `handlePreviewCount` (BadgePrintingModule.tsx) and `getFilteredDelegateCount` (supabaseService.ts) so "All Districts + All Statuses" now displays the real event total (and the Scope Total card). **Generate still requires a scope when status is `'all'`** — `handleGenerate`'s `hasFilters` check is unchanged, and the error message for that case now reads "Select a District or Chapter to Generate badges for All Statuses." Default `not_printed` + All Districts behavior (count all unprinted, Generate allowed) is untouched.
- **v1.43 — bad redesign image restricted to portrait layouts:** `badge-design.png` (2688×3570, portrait) is physically oversized for 8-up/10-up landscape badges — the `badgeDesign` branch scaled it to `imgW = bw, imgH = bw / 0.7529 ≈ 120 mm` for a 60 mm badge and vertically centered it, overflowing ~30 mm beyond every badge. The design's baked-in header banner/footer landed outside badge bounds → large transparent gaps and a footer visible only on the last row (footer band sat below each badge, bleeding into the next). **Fix:** `drawBadge` now enters the design block only when `isPortrait` (badgePdfGenerator.ts:276 `if (badgeDesign && isPortrait)`); 8-up/10-up fall through to the existing landscape path (full-width `badgeBanner` header + programmatic category-color footer band on every badge). Portrait layouts unchanged. **Revisit only when a proper landscape design asset is available.**
- **Staged rounds for storage:** "Batches Per Run" input (default 1). `handleGenerate` slices the candidate list to the first N sub-batches and creates only those PDFs; success message reports "Generated X of Y batches. Regenerate to continue — only unprinted badges will be included." Combined with Mark Printed + Delete Batch, this yields generate→download→mark printed→delete→continue without storage blow-up or duplicate production.
- **Workflow:** Generate (Not Printed, 1 batch/run) → Download/Batch tab → Mark Printed (flags delegates) → Delete batch (frees storage) → repeat. Clear Badge Printed Flags resets the whole event for re-production.

### 15. Event Data Isolation (v1.4 — Strict Per-Event Delegate Scoping)
- **Every delegate is tied to exactly one event** via `delegates.event_id`. There is no concept of global/unscoped delegates.
- All delegate-list queries use strict `eq('event_id', eventId)` — NO `OR event_id IS NULL` exceptions.
- All `checkInByCode` passes (1-4) are scoped to the active event via `.eq('event_id', eventId)`.
- `NewDelegatePage` explicitly sets `event_id: activeEventId` in the payload.
- `getPaginatedDelegates`, `getStats`, `searchDelegates`, `getAllDataForExport` — all cleaned of `event_id IS NULL` leakage.
- `getAllDelegates()` now accepts optional `eventId` parameter; passes `p_event_id` to RPC.

**Defense-in-depth layers for event isolation:**
1. **RPC-level filter:** `get_paginated_delegates(p_event_id)` and `get_event_dashboard_stats(p_event_id)` filter server-side.
2. **Hard gate:** `getPaginatedDelegates` and `getStats` return empty immediately if `!eventId` (prevents undefined/null/empty-string from hitting the database).
3. **Client-side post-filter:** After receiving data from RPC or fallback, `getPaginatedDelegates` strips any delegate whose `event_id !== eventId`. Logs a `[POST-FILTER]` warning if this fires (indicates upstream filtering gap).
4. **Auto-select:** Dashboard and Master List both auto-select the first active event when `activeEventId` is empty — prevents empty-event loads at page entry.

**Dashboard reconciliation:** Both the RPC path and client-side fallback in `getStats` validate `totalArrivals ≤ totalDelegates`. If arrivals exceed delegates, the delegate count is re-queried directly.

**RPCs updated (deploy `supabase_migration_sprint12_fix_masterlist_and_dashboard.sql`):**
| RPC | Change |
|-----|--------|
| `get_paginated_delegates` | Added `p_event_id UUID` parameter; `WHERE event_id = p_event_id` filter |
| `get_event_dashboard_stats` | `totalDelegates` now event-scoped; added `totalArrivals` and `totalSessionAttendance` fields; `recentActivity` deduplicated via `DISTINCT ON (delegate_id)` |

### 16. Diagnostic Logging
Browser console diagnostic logs use the `[functionName]` prefix convention:
- `[getPaginatedDelegates] BLOCKED` — hard gate fired (no eventId provided to service)
- `[getPaginatedDelegates] RPC success/failed` — which path executed and result count
- `[getPaginatedDelegates] POST-FILTER: stripped N delegates` — cross-event data caught and removed
- `[getStats] RPC success/failed` — which path executed for dashboard stats
- `[getStats] arrivals exceed delegates — re-counting` — dashboard self-correction fired
- `[auth.login] signInWithPassword error:` — full GoTrue error object (name, status, code, details, hint)
- `[auth.login] FATAL:` — complete serialized error dump for uncaught login exceptions
- `[diagnoseLoginFailure] RPC failed/exception:` — why the diagnostic RPC couldn't give results
- `[createUser] confirm_user_by_email ...:` — RPC success/failure during user creation auto-confirm
- `[createUser] app_users upsert failed:` — profile insertion failed after auth creation

### 17. Pledge Name (per-event categories)
- Pledge names are **configured per event** in EventsModule as `events.event_config.pledge_names` (a `string[]` JSONB array), edited via a chip editor in the "Delegate Form Fields" config box.
- Each chip supports **inline rename** (pencil → save/cancel, Enter/Escape keys) and **remove** (×). Add box at the top; duplicates are rejected.
- All `pledge_names` state updates use functional `setForm` to prevent stale-closure clobbering when multiple names are added quickly.
- The FinancialsPage **New Pledge form** shows a "Pledge Name" dropdown sourced from `activeEvent.event_config.pledge_names`; empty selection = "General".
- The selected value is stored on the pledge row as `pledges.pledge_name` (nullable, backward compatible — added by `supabase_migration_sprint15_pledge_name.sql`).
- `db.createPledge` passes through any `Partial<Pledge>` — no service-layer change needed.
- Display surfaces: Active Pledges table column, Reports Pledge Summary ("By Pledge Name" table), and Reports Pledge List column.
- **types.ts exception:** `Pledge.pledge_name?: string` and `Event.event_config?: Record<string, boolean | string[]>` were added to support this feature — a documented, additive exception to the "never modify types.ts" rule.

### 18. Login Account Validation & Diagnostics (v1.6)
- **New user creation uses `signUp()`.** `db.createUser` now calls `supabase.auth.signUp()` via an isolated client (`persistSession: false`, `autoRefreshToken: false`). GoTrue handles all `auth.users` + `auth.identities` creation. `confirm_user_by_email` RPC auto-confirms, then `app_users` is upserted. The admin's session is never affected.
- **New accounts require a valid email format.** `UsersModule.tsx` and `db.createUser` both validate `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (after trim/lowercase) and block creation otherwise.
- **`check_login_account(p_email, p_password DEFAULT NULL)`** is a SECURITY DEFINER RPC readable WITHOUT an active session. Reports: malformed email, no account, wrong password, unconfirmed, missing identity, deactivated, AND **bcrypt_cost** from the stored password hash. Used by `diagnoseLoginFailure` for both "Invalid login credentials" AND HTTP 500 errors.
- **HTTP 500 diagnostic path:** When `signInWithPassword` returns status ≥ 500, `diagnoseLoginFailure` runs and its output (including raw GoTrue error code/details) is appended to the user-visible error message.
- `diagnoseLoginFailure` no longer calls `get_my_profile()` (which requires `auth.uid()` and therefore always failed pre-login).

### 19. Session Ministry — Alter Call Recording Cascade (v1.6)
- **QR scan path:** `handleCodeSubmit` passes `selectedSessionId` to `checkInByCode`, which verifies both arrival AND session attendance before recording the alter call response.
- **Manual search path:** `handleRecord` → `recordSessionResponse` ensures a three-tier cascade:
  1. Check-in Arrival (checkins with `session_id IS NULL`) — auto-inserts if missing
  2. Session Attendance (checkins with `session_id = currentSession`) — auto-inserts if missing
  3. Alter Call Response (session_responses) — recorded only after both attendance layers exist
- Duplicate inserts caught via `23505` unique constraint errors — returns "Already recorded" instead of throwing.
- **Scanned vs Manual columns:** `_count` (individual per-delegate responses) and `_summary` (aggregate manual totals) are separate validation figures, NOT additive. Tables show `_count` in the primary column; manual summaries are available in the detailed Sessions Report tab for cross-validation.

### 20. Scrambled Import Recovery (v1.7)

- **Problem solved:** CSV bulk imports can misalign columns, scrambling delegate fields (first_name → district, surname → chapter, etc.). The recovery module detects, previews, repairs, or deletes scrambled records.
- **Four-tier recovery workflow in ImportModule:**
  1. **Analyze** — multi-field anomaly detection with confidence scoring (0-3+): compares district against `system_settings.districts`, checks first_name for district-code patterns, chapter for surname-like values, title for numeric zone values, phone for alphabetic content.
  2. **Backup JSON** — downloads a `.json` file of all scrambled records (original + proposed values) before any mutation.
  3. **Repair In-Place** — field remapping based on detected shift pattern: `first_name ← district`, `last_name ← chapter`, `district ← extracted code from first_name`, `title ← cleaned`. After repair, auto-harmonizes district abbreviations (e.g., `NC1` → `North Central 1`).
  4. **Delete All** — full cascade: `delegates` → `checkins` → `session_responses` → `badge_print_logs`.
- **UI:** ImportModule now has a dedicated red-bordered "Scrambled Import Recovery" section with a comparison table showing scrambled → repaired values side-by-side.
- **Service functions:** `analyzeScrambledDelegates(eventId)`, `applyScrambleRepairs(eventId, repairs)`, `backupScrambledDelegates(eventId)`, `deleteScrambledImportDelegates(eventId, dryRun?)`.

### 21. Master List Dual-Mode Per-District Pagination (v1.7)

- **All Official Districts mode:**
  - `getDistrictsWithDelegates(eventId)` fetches the full district list with delegate counts (one light query, no data payload).
  - Each district renders as an independent section with its own header, 25 rows via `getPaginatedDelegates(district=..., page=...)`, and its own pagination controls (First/Prev/Pg N/M/Next/Last).
  - All district sections load independently on mount — page 1 of every district fetched in parallel.
  - Scales to 20K delegates: each section only holds 25 rows in DOM; per-district pagination is server-side.
- **Specific district / search mode:** Single unified table with top-level district header and shared pagination controls — legacy behavior preserved.
- **Mode-aware loading guard:** `!selectedDistrict && !searchTerm ? districtListLoading : loading` — prevents spinner hang on initial "All Districts" load.
- **Client-side sort guarantee:** `getPaginatedDelegates` always sorts the returned array by `last_name → first_name` (case-insensitive) after both RPC and fallback paths. Spouses with matching surnames appear consecutively regardless of database state.
- **Service functions:** `getDistrictsWithDelegates(eventId)`, `fetchAllDelegatesForExport(eventId, district?, search?)`.
- **v1.35 fix — `getDistrictsWithDelegates` paginated:** the All Official Districts list did a single `.select('district')` with no `.range()`. Supabase returns at most 1,000 rows per request, so as soon as an event exceeded 1,000 delegates (SE1 hit 1,273 in the unified 2026 Lagos event), districts whose rows fell in the tail (e.g., `North Central 1`) never made the district list — the section vanished from "All Districts" while the specific-district dropdown (built from `system_settings`) still found it. Now paginated 1,000/page ordered by `delegate_id`, counts merged client-side.

### 22. Full-Dataset PDF & CSV Export (v1.7)

- **Problem solved:** Both export handlers previously exported only the current page's 25 delegates (in-memory state / DOM element).
- **PDF export:** `fetchAllDelegatesForExport` paginates through all matching delegates (500/page), builds a hidden full HTML table, renders via `html2canvas + jsPDF`, then cleans up the temp element.
- **CSV export:** Fetches full dataset via the same loop, passes to `exportToCSV` with context-aware column set (rank/office/type per `event_config`).
- **Filename includes district name:** `Delegate_Master_List_North-Central-1.pdf` or `All-Districts` when no district filter.
- **Buttons show loading state:** `Exporting PDF...` / `Exporting CSV...` while fetching; disabled during export to prevent duplicate clicks.

### 23. District Harmonization Auto-Registration (v1.7)

- **Problem solved:** `harmonizeDistricts` previously only resolved abbreviations (e.g., `NC1`) to full names (e.g., `North Central 1`) if the full name already existed in `system_settings.districts`. Missing districts silently failed (0 records).
- **Auto-registration:** When an abbreviation resolves to a valid full name not in the official list, the name is auto-appended to `system_settings.districts` and persisted.
- **Fuzzy fallback:** Strips non-alphanumeric characters on both sides for comparison — catches variants like `NorthCentral 1` → `North Central 1`.
- **Self-match:** Accepts the abbreviation itself if it appears verbatim in the official list.
- **Diagnostic logging:** Logs every official district, every resolved mapping, and unresolved abbreviations.

### 24. Audit Log Pagination & Clear (v1.8)
- **Pagination:** `AuditLogPage` renders 25 rows/page via `db.getAuditLogs({ eventId, systemOnly, actionFilter }, page, pageSize)`. Count is fetched with `.select('*', { count: 'exact' })`; rows via `.range(from, to)`. Page resets to 1 on filter/event change.
- **Clear-by-period (admin-only):** `db.clearAuditLogs(fromIso, toIso)` deletes all `audit_log` rows where `created_at` is within the selected date range (date pickers + confirm dialog). Records its own `audit_clear` entry afterward.
- **RLS fix (v1.8):** `audit_log` SELECT was `role = 'admin'` only (blocking national/regional/district admins) — now `is_admin_user()`; a DELETE policy for `is_admin_user()` was added, plus `idx_audit_created_at ON audit_log(created_at DESC)` for efficient range deletes.

### 25. Event Admin Role (v1.8)
- **New global role** `event_admin` (`UserRole.EVENT_ADMIN = 'event_admin'`) — see Roles table above for the full access model.
- **Client helpers:** `isEventAdminRole(role)` in `types.ts`; `getScopeFilter` returns `{}` (unscoped) for event admin.
- **Route guards (`App.tsx`):** `ADMIN_AND_EVENT_ADMIN`, `ADMIN_REGISTRAR_AND_EVENT_ADMIN`, `ADMIN_FINANCE_AND_EVENT_ADMIN` role lists.
- **DB migration (`supabase_migration_v1.8_event_admin.sql` + `_financials.sql`):** extends `app_users_role_check`, adds `is_event_admin_user()`, and adds `OR is_event_admin_user()` to registrar/finance write policies (delegates, checkins, session ministry, badge batches/logs, pledges, financial_entries). Delete policies remain admin-only.

### 26. Financial Payment Mode + Session Grouping + Export (v1.9)
- **Payment Mode:** new nullable `financial_entries.payment_mode TEXT` column (`supabase_migration_sprint17_financial_payment_mode.sql`). Offerings and Pledge Redemptions record a mode from `PAYMENT_MODES = ['Cash', 'POS', 'Bank Transfer', 'Cheque']` (in `types.ts`). `payer_name` is retained for Redemptions only (auto-filled donor name); Offerings no longer populate it.
- **Offerings grouped by session:** FinancialsPage "Offerings" tab groups entries by `session_id` (sessions in order, then "Full Event (Master)" for null/unknown session), rendering a title header row + highlighted subtotal per session and a Grand Total row in `<tfoot>`. Redemptions/Pledges remain flat lists but each gained a Grand Total row (Redemptions also gained a Payment Mode column).
- **Export:** PDF/CSV buttons on all three tabs. PDF builds a hidden print table via `buildPdfTable` and reuses `exportToPDF(..., 'report')`; CSV uses `exportToCSV`. Filenames: `FGBMFI_{Offerings|Redemptions|Pledges}_{Event}_{date}.{pdf|csv}`.
- **types.ts exception:** `FinancialEntry.payment_mode?: string` and `PAYMENT_MODES` / `PaymentMode` were added — additive, documented (mirrors the `pledge_name` precedent).
- **Audit log:** `addFinancialEntry` audit summary now reports `payment_mode` for Offerings and `payer_name` for Redemptions.

### 27. Scale Remediation for 25K Delegates (Sprint 18)
- **Check-in Pass 4 (4-digit legacy fallback):** removed entirely in v1.10 (Sprint 19) — `checkInByCode` is now 3-pass (UUID `qr_hash` → `external_id` → `delegate_id`). See §2/§11.
- **Realtime event scoping:** `FinancialsPage` realtime subscriptions now filter `event_id=eq.{activeEventId}` (already the case in `AdminDashboard` and `MasterListModule`).
- **`getStats` fallback bounded:** the client fallback no longer full-scans `checkins`; it uses indexed counts (`totalDelegates`, `totalArrivals`, `totalSessionAttendance`), `recentActivity` (latest 200 filtered → 10), and `financials` sum. Rank/district breakdown charts are omitted in the rare fallback mode (RPC `get_event_dashboard_stats` is the primary path).
- **Reports refactor:** `ReportsPage` no longer loads the full delegates+checkins tables via `getAllDataForExport`. New `get_report_aggregates(p_event_id, p_session_id)` RPC (`supabase_migration_sprint18_report_aggregates.sql`) returns `attendedDelegates` (arrival-or-session join), `sessionAttendance`, `financials`, `pledges` server-side. `db.getReportAggregates` wraps it with a bounded fallback. Attendance/summary tabs consume the new shape; identity dedup is preserved in `reportData`.
- **Silent `.limit(5000/10000)` truncation removed:** `harmonizeDistricts`, `deduplicateDelegates`, `deleteScrambledImportDelegates`, and `analyzeScrambledDelegates` now paginate their candidate fetches (1000/page).
- **FinancialsPage `paginate<T>`** is a module-level helper invoked with explicit type params (`paginate<FinancialEntry>` / `paginate<Pledge>`); generic inference from `useMemo`-derived arrays was unreliable under `tsc`.

### 28. UUID-Only QR + TanStack Query Adoption (v1.10 / Sprint 19)
- **UUID-only QR:** removed the 4-digit `generateCodeFromId` fallback (utils.ts, `checkInByCode` Pass 4, `checkInDelegate`/`searchDelegates` `code` emission, and its display in `CheckInPage`, `SessionMinistryPage`, `NewDelegatePage`). Manual entry auto-submits on 24/36-char inputs only. `CheckInResult.code?` remains in `types.ts` as an unused optional field (non-breaking).
- **TanStack Query on FinancialsPage:** `financial-entries`, `pledges`, `sessions` are now `useQuery`; writes still use the manual `loading` state but invalidate via `queryClient.invalidateQueries` (`refreshFinancials`). Realtime is event-scoped and invalidates instead of re-fetching directly.
- **TanStack Query on ReportsPage:** `report-aggregates`, `sessions`, `events`, `settings`, `ministry-export` are now `useQuery`; district/region scoping moved into the `reportData` `useMemo` (recomputed on user change). `loading` state removed.
- **Deferred:** MasterListModule (3.3C) kept its manual `useCallback` + server-side pagination + realtime flow — already paginated/deduped; a `useQuery` rewrite there is high-risk for marginal gain.

### 29. CSV Import Hardening: District Short Codes + WhatsApp Phone (v1.12 / Sprint 20)
- **Problem solved:** bulk CSV imports carried district short codes (`NC1`, `SS2`, `SW 2`, `NC1-0116`) in the District column (and sometimes in a Title/banner row above the real header), plus phone data in `WhatsApp`/`WHA`/`N PHONE`/`Phone No` columns that were either unmapped, dropped, or not normalized.
- **Shared helpers in `services/utils.ts`:** `resolveDistrictShortCode(raw)` (cleans `NC1-0116` → `NC1`, expands any `NC/NE/NW/SE/SS/SW` + digits into official names, e.g., `SW 2` → `South West 2`, via `REGION_PREFIXES`) and `normalizePhone(raw)` (`2348…` / `+2348…` → `08…`, 10-digit `8…` → `08…`, keeps `0…` 11-digit). Imports to canonical district names at input time; `harmonizeDistricts` remains a safety net.
- **Robust header detection (`detectHeaderRow` in ImportModule.tsx):** scans the first 10 rows, picks the first row with ≥2 "strong" matches (known-field headers excluding ambiguous title-value keys like `mr`/`mrs`), and captures a **banner district** from preceding title/junk rows (e.g., `SOUTH WEST 2 DISTRICT` → applied to rows missing a District). Headerless data pastes (strong < 2) now import every line as a data row instead of silently skipping the first record.
- **Column aliases expanded:** district-code headers (`district code`, `short district code`, `shortdistrictcode`, `zone code`, …) map to District; phone headers (`phone no`, `phoneno`, `mobile number`, `contact number`, `n phone`, `whatsapp number`, `wa`, …) map to Phone. `normalizeKey` now collapses repeated whitespace so `N     PHONE` matches.
- **District column priority:** when both ZONE and DISTRICT headers map to District, a `district*`/`short code`/`chapter code`-named column is preferred over generic zone/region columns (prevents numeric zone values filling District).
- **District aliases (v1.31):** manual-reg files sometimes code districts as `SED 1` (region + `D` + number) or by state name (`Anambra`). `resolveDistrictShortCode` in `utils.ts` now accepts an optional `D` in the region code and consults the exported `DISTRICT_ALIASES` map (`ANAMBRA → South East 1`, extend as new labels appear). `harmonizeDistricts` (DataModule → Harmonize Districts) resolves both via `resolveDistrictAlias` (auto-registering the target when missing), so running **Harmonize Districts** on the event corrects existing `SED 1`/`Anambra` rows to `South East 1`. Scramble analysis (`isOfficial`/`isOfficialDistrict`) also treats alias districts as official so SE1/Anambra rows are never mis-flagged as scrambled.
- **v1.32 quoted-field CSV parser + full 'REGION DISTRICT N' spelling:** the SE1 file surfaced two more root causes behind "South East 1 lists 1200 of 1260". (1) `mappedCsvData`/`importDelegates`/`extractRepairRows` split lines on raw `,`, so a quoted **DATE OF BIRTH containing a comma** (`"7th June,1958"`) shifted every column — reading `ANAMBRA` (STATE) into District, garbling chapter, and dropping phone/email for ~31 rows. New `parseCsvLine()` (utils.ts, quote-aware, handles `""`) + `csvEscape()` for the mapped output are used at every parse site. (2) The file actually carries 8 district spellings: `SED 1` (1150), `SED1` (51), `SOUTH EAST DISTRICT 1` (54), plus 5 anomalies. `resolveDistrictAlias` now also matches the full `REGION...DISTRICT N` spelling (`SOUTHEAST DISTRICT 1 → South East 1`) via `FULL_REGION_PREFIXES`, so harmonization pulls those 54 into `South East 1`. Verified: SE1 → 1254 under `South East 1` (1260 − 1 merged duplicate − 5 genuine anomalies); NC3 parses to exactly its claimed 306 records.
- **Phone fallback:** per-row extraction scans all Phone columns — true phone-like columns first, WhatsApp columns as fallback — then normalizes. Import feedback reports rows filled from banner district, short codes resolved, and WhatsApp-supplied phones.

### 30. Zero-Tolerance Duplicate Prevention (v1.13 / Sprint 21)
- **Root cause fixed:** the bulk-import merge matched `phone` by EXACT string, so `234803…`/`803…`/`0803-…` were treated as different numbers → duplicate person-records once import phone normalization went live. No DB constraint existed on any person identity (only `qr_hash`).
- **Identity model:** one person = `(event_id, title_key, name_first_key, name_last_key, phone_normalized)`. `phone_normalized` = canonical `0XXXXXXXXXX` (digits-only, `00`/`234`→`0`, prepend `0` to 10-digit non-`0`). `title_key`/`name_first_key`/`name_last_key` = `UPPER`, whitespace-collapse, punctuation-strip. **TITLE is part of the identity** — `Mr A` vs `Mrs A` sharing phone+email are TWO delegates, never merged. Email is a fallback identifier ONLY when the incoming phone is blank.
- **Schema (`supabase_migration_sprint21_dedup_schema.sql`):** adds the 4 identity columns + `normalize_phone_sql()`/`normalize_name_key()` SQL helpers + `trg_delegates_identity_norm` BEFORE INSERT/UPDATE trigger + backfills existing rows (normalizes phone, defaults empty title→`Mr`); rewrites `import_delegates_batch_merge` to match on the identity (phone-primary / email-fallback) with a `unique_violation` handler so the backstop can never abort a batch.
- **Cleanup (`supabase_migration_sprint21_dedup_cleanup.sql`):** runs AFTER schema migration — backs up duplicate rows + their checkins/session_responses/badge_print_logs, `merge_delegate_duplicates()` keeps the most-complete row, re-parents attendance/history to the survivor, deletes the rest, THEN installs the partial UNIQUE index `idx_delegates_same_person(event_id,title_key,name_first_key,name_last_key,COALESCE(phone_normalized,''))` (`WHERE phone_normalized IS NOT NULL`). Index MUST be created only after dupes are cleared.
- **Client (`supabaseService.ts`):** `registerDelegate` normalizes phone + pre-checks identity (clear duplicate error); the `importDelegates` fallback path dedupes via `phone_normalized`/email identity; `deduplicateDelegates` (DataModule) now MERGES clusters (re-homing checkins/session_responses/badge_print_logs) instead of delete-only, honoring the title-differentiates-people rule.
- **Operational runbook:** `RUNBOOK_DELEGATE_DEDUP.md` — migration order (A schema → B cleanup → backstop index), verification queries, duplicate preview query, re-import behavior, and rollback/restore steps.

### 31. Surname-First Full-Name Parsing + Repair Imported Names (v1.14 / Sprint 22)
- **Problem solved:** district "Formatted" manual-reg files (`Combined_NC2_Registrations_Formatted.csv` etc.) store `FULL NAME` as **surname-first with the title mid-string** (`Achizue Engr Kenneth`, `EZE ARC. DR. JC`, `Mrs. Magaji Mrs. Martha`). The old `parseFullName` only looked for titles at the start (given-first), so `Achizue Engr Kenneth` landed as first=`Achizue`, last=`Engr Kenneth`, title=`Mr`.
- **`parseFullName(fullName, order)` (ImportModule.tsx):** order-aware (`given-first` | `surname-first`) with **title-anywhere** detection. Tokenizes on whitespace **and** `.`/`,`/`;`/`:` (splits `Mr.Daniel`, `PROF.AYO`, `Engr.Joshua`, `Odinakachukwu: Mrs`), strips leading junk, preserves single-letter initials (`Joy H.`). Handles 2+ title clusters (surname trapped between) and multi-token titles (`PROF MRS`, uses the **first** title token as primary). Title-less rows split by the chosen order.
- **Name-order control:** per-file `auto` detection in `mappedCsvData` (mid-string title signal vs leading-title signal) + a **Surname First / Given First toggle** and a live 5-row parse preview in the mapping panel. Default `given-first` for portal exports, `surname-first` for manual-reg files.
- **District zone-label fix:** when a banner district exists and the district cell matches `/^(ZONE|AREA)\s*\d+$/i`, the banner district wins (were importing `ZONE 1` as a district).
- **Junk-row guard:** skips `NUMBER: 45`-style data rows.
- **Repair Imported Names (admin, ImportModule):** pastes `FULL NAME, PHONE [, DISTRICT]`, matches existing delegates by `phone_normalized` + current `first_name==file surname`, warns on already-correct/spouse-shared-phone rows, downloads a JSON backup, then updates `title/first_name/last_name/district` **in place** via `db.repairNamesFromFile` (no duplicates, attendance preserved). `db.getDelegatesByPhones` supports the candidate lookup.

### 32. Existing-Row Name Normalization — Auto-Detect Scrambled Names (v1.15 / Sprint 23)
- **Problem solved:** rows imported from surname-first files BEFORE the Sprint 22 parser landed stayed scrambled — `Achizue Engr Kenneth` still stored as title=`Mr`, first=`Achizue`, last=`Engr Kenneth`.
- **Parser relocated** to `services/utils.ts` (`KNOWN_TITLES`, `NameOrder`, `normalizeTitleToken`, `tokenizeFullName`, `parseFullName`, new `canonicalTitle`): single source shared by ImportModule + service. `canonicalTitle` maps shorthand to the app-standard titles (`Evang/Evng→Evangelist`, `Arc/Arch/Archt→Arch`, `Pst→Pastor`, `Eld→Elder`, `Engr/Prof/Mr/Mrs/…` canonicalized).
- **`db.autoRepairScannedNames(eventId, districtOverride?)`** — scans the event's delegates (paginated) and proposes normalization **from stored values alone (no file needed)**. Rebuilds `first_name + ' ' + last_name`, re-parses `surname-first`, and marks a record a candidate **only when all hold**: the rebuilt name contains a real title with a given-name after it, `normNameKey(parsed.lastName) === normNameKey(stored.firstName)` (stored first name was really the surname), and the parse changes something. Skips untitled rows (`Agabi Kennedy`), already-correct rows, and false positives (title-word surnames like `Justice`, portal rows). Optionally rewrites `ZONE/AREA \d+` districts to the override.
- **Repair panel "Auto-Detect Scrambled Names" button** seeds the before/after preview from the scan; existing **Backup JSON → Apply Repairs** flow writes via `db.repairNamesFromFile`.
- **Self-healing with duplicates:** after normalization, any previously re-imported duplicate rows share the Sprint 21 identity, so the next import or DataModule `deduplicateDelegates` merges them automatically.
- **v1.16 coverage fix:** the paste/file repair path previously derived its name order from the MAIN import textarea (`effectiveNameOrder()`); when that was empty it defaulted to `given-first`, silently failing to match surname-first files. Now the Repair panel has its own **Surname First / Given First toggle** (default `surname-first`) + **file upload**, and **Auto-Detect & Normalize** runs the FILE-BASED full re-derive when rows are pasted/uploaded. The repair input is also **column-aware** like the main import: `extractRepairRows` runs header/banner detection on the pasted/uploaded content and maps `FULL NAME` / `PHONE*` / `DISTRICT` columns — so the raw district **Formatted CSVs (`S/N, FULL NAME, PHONE NUMBER, EMAIL, DISTRICT, CHAPTER`) can be loaded as-is** (previously col0 (S/N) was read as the name, so every row dropped → "nothing changed"). Falls back to `col0=name, col1=phone` for headerless pastes. Matches delegates by `phone_normalized` + surname token (first OR last), flags already-correct/ambiguous/no-match. Verified on the 205-row NC2 file: 197 candidates (97.5% of rows with phone) vs ~35% for the titled-only scan; `Dr.`/`DR`, `Mrs.`/`Mrs` forms parse identically. Without a file it falls back to the safe titled-only `autoRepairScannedNames` scan.
- **v1.19 one-click repair + persistence verification:** "3. Backup & Apply Now" auto-runs the analysis when no preview exists and **downloads the backup JSON automatically before updating** (no multi-step friction); `db.repairNamesFromFile` now **re-reads the updated rows afterward and reports how many changes actually persisted** (`verified`), logging per-row update errors to console. A build label (`IMPORT_BUILD_LABEL`, shown in the page header) plus a live **file-read echo** in the Repair panel (header detection result + first 3 name/phone pairs) make it obvious which build is loaded and that the CSV columns were parsed.
- **v1.20 merge-on-duplicate (re-upload conflicts):** when a person was re-imported after the name fix, the DB can hold BOTH a stale scrambled row (`Mr ABIODUN DR. MOSES`) AND a corrected row (`Dr MOSES ABIODUN`) as separate identities. `repairNamesFromFile` now, on a `unique_violation` (23505) during the in-place update, **finds the corrected sibling** (same `phone_normalized` + normalized title/first/last) and **merges**: re-homes the stale row's `checkins`/`session_responses`/`badge_print_logs` to the sibling and deletes the stale row. `analyzeRepairCsv` now prefers the **scrambled** record among multiple same-phone matches (so the pair is proposed, not flagged ambiguous), and the result message reports `N stale duplicates merged`.
- **v1.21 auto-apply:** "Auto-Detect & Normalize NOW" now **applies immediately** (analyze → auto-download backup → write updates → report updated/merged/verified) so a preview-without-save can't happen again. The manual "1. Analyze" path adds a loud **"Preview only — not saved yet"** banner above the table. Shared `runApply(items)` + `handleRepairBackup(items?)` unify both flows.
- **v1.22 blank title when there is no clear title:** imported/parsed delegates no longer default `title` to `'Mr'`. `parseFullName`/`canonicalTitle` return `''` when no title token exists; the import RPC (`supabase_migration_sprint26_blank_title.sql`) stores `COALESCE(TRIM(title),'')` instead of `'Mr'` — blank stays blank (also for files with a blank Title column). **Intentional non-change:** `title_key` identity still normalizes blank→`'Mr'` so dedup keeps treating `John Doe` and `Mr John Doe` as the same person; `external_id` fallback + gap-fill untouched. The Repair tool now includes **title** in its already-correct/needs-change comparison and `repairNamesFromFile` writes an explicit blank title, so re-running **Auto-Detect & Normalize NOW** on NC2 clears the stale `'Mr'` from title-less rows (explicit-`Mr` file rows are preserved). `delegates.title` is `TEXT NOT NULL` with no CHECK/default — blank is stored as `''`; badges/Master List already filter it. Template sample Title set to blank; manual forms/dropdowns unchanged.
- **v1.23 repair guidance:** "Auto-Detect & Normalize NOW" now reports the active-event name and explains why 0 results occurred. With no file loaded, a `0` scan shows: **blanks to clear require the source CSV** (a stored `'Mr'` is indistinguishable from an explicit one without the file). With a file loaded but 0 actionable, it reports the parsed/no-phone/skipped breakdown to distinguish "already clean" from "wrong event / phone mismatch".
- **v1.24 repair event picker:** the Repair Imported Names panel gained an **"Event to repair"** dropdown (all events, defaults to the active event). Every repair operation (analyze, auto-detect, apply, backup, verification) now targets `targetEventId = repairEventId || activeEventId` instead of always the active event — fixing the case where the NC2 delegates live in a different event than the currently-selected one (e.g., active = "2026 Lagos National Convention" while NC2 data is in its own event → "0 records found"). Messages and result lines state which event was targeted.
- **v1.25 reuse the top-loaded import file:** when a single event holds all data and the user loads the NC2 CSV via the **Bulk Delegate Import** upload at the top (not the Repair panel's own file input), the repair previously ran with an empty `repairCsv` and reported the misleading "No trapped-title records… LOAD the source CSV below". Repair now derives `repairSourceCsv = repairCsv || csv` (falling back to the file loaded in the import section), so analyze/auto-detect/apply and the file-read echo work with either upload. The echo labels it **"Using the file from the Bulk Delegate Import section above"** when appropriate. Name order stays the Repair panel's own `repairOrder` (no re-coupling to the import order).
- **v1.27 clear default 'Mr' + no-contact/transposed dedup (Sprint 27):**
  - **"Clear Default 'Mr' Titles" button** in the Repair panel: explicit one-click path that blanks the Title on rows whose source CSV has no readable title (the ladies included), and the success message now reports **how many titles it cleared to blank**. It requires the CSV loaded in the Repair panel (the top Import section clears its file after a successful import — re-load in the panel).
  - **No-contact duplicate multiplication (root cause):** `EZE MRS EDITH` (row 64 of the NC2 file) has no phone AND no email; dedup keys on phone then email, so **every import pass INSERTED a fresh row** (12 identical records). `import_delegates_batch_merge` now has a names-only fallback (match `event_id + title_key + first/last keys` where the existing row is ALSO contact-less) → repeated imports gap-fill instead of multiply (`supabase_migration_sprint27_no_contact_dedup.sql`). Optional commented DB backstop index for contact-less rows (create after in-app dedup).
  - **Transposed duplicates (root cause):** `Bolarinwa Mr.Daniel` / `Daniel Mr Bolarinwa` (same phone `8032492675`) are the same person recorded with first/last swapped → two different identity keys. `deduplicateDelegates` now also merges **contact-less exact duplicates** and **transposed pairs** (same phone + same email + same title + swapped names). Verified: EZE 12→1, Bolarinwa transposed merged, spouse phone-sharers (`Haruna`/`Edinoh`) untouched.
  - `registerDelegate` also blocks contact-less duplicates on manual entry.
- **v1.33 repair-flow chapter correction:** the old comma splitter left ~31 SE1 rows with their chapter equal to the ZONE value. The Repair Imported Names flow now extracts CHAPTER and ZONE columns (`extractRepairRows` reads split FIRST NAME/LAST NAME columns too, so the Formatted files work without a combined FULL NAME), and `analyzeRepairCsv` proposes a chapter fix only when the stored chapter is blank or equals the row's file ZONE (the corruption signature — correct chapters are never touched). `repairNamesFromFile` accepts/updates `chapter` and verifies it; the preview table shows chapter before/after; apply reports `N chapters corrected from the file`.
- **v1.34 junk cleanup catches mangled column-shift rows:** legacy comma-splitter imports left odd rows like district=`Nigeria` (COUNTRY), chapter=`SED1` (DISTRICT cell), name=`Male Chukwuma` (GENDER as first name). `junkReasonOf` now also flags gender-as-name (`MALE`/`FEMALE`), country-as-district (COUNTRY_NAMES set), and district-code-as-chapter (`^[A-Z]{2}D?\d+$` like `SED1`); `junkRowReason` (import gate) added gender-as-name so re-imports never recreate them. DataModule **Junk Row Cleanup** picks all these up for one-click delete (district="" rows that died in the count are covered too). Offline fallback `supabase_migration_nc3_junk_rows_cleanup.sql` updated to v3; new read-only `supabase_diagnostic_se1_rows.sql` enumerates the SE1 event's district distribution + mangled rows.

## 32. CSV Import Junk-Row Guard + Master List Save State Fix (v1.29 / Sprint 28)

- **Problem solved (NC3 import, Aug 2026):** `Combined_NC3_Registrations_Formatted.csv` trails its data with a summary block (`Zone Summary`, `ZONE,Adults,Teens,Children,Total,Amount (N)`, `UPZ I,78,2,5,85,"321,000"`, `GRAND TOTAL,293,2,9,304,...`, `Notes:`) that was imported as delegates with **numeric or blank** first/last names. They render at the TOP of the Master List because digits (`0`–`9`, ASCII 48–57) sort before letters in the `last_name → first_name` ordering in `getPaginatedDelegates`.
- **Root cause:** `mappedCsvData`'s old junk guard was far too weak — it skipped only all-empty lines, `/NUMBER:\s*\d+/` lines, and lines with ≥3 "known header" tokens; the final gate accepted any row with at least one non-empty cell. The summary rows have ≤1 known-header token and numeric name cells, so they passed. `importDelegates` (filter `p.length >= 3`) and the `import_delegates_batch_merge` RPC inserted them verbatim with zero name validation.
- **Client gate (`ImportModule.tsx`):** module-level `hasAlpha`/`normCell`/`JUNK_MARKERS`/`HEADER_FIRST_CELLS`/`isRepeatedHeaderRow`/`junkRowReason`/`isJunkDataRow`. `mappedCsvData` now skips rows whose first+last names are both empty, either name is purely non-alphabetic, the first cell is a known summary/marker (`TOTAL`, `GRAND TOTAL`, `SUBTOTAL`, `ZONE SUMMARY`, `SUMMARY`, `REGISTRATION RECORDS`, `NOTES:`), or the row looks like a repeated header (first cell ∈ `HEADER_FIRST_CELLS`). The repair path (`extractRepairRows`) also drops repeated-header and non-alphabetic-name rows.
- **Import preview panel:** the mapping UI now shows "first records to import" + a live list of rows that will be skipped as junk (with reason + raw snippet), so garbage is visible **before** clicking PROCEED.
- **Service gate (`supabaseService.ts`):** `importDelegates` mirrors the guard for the raw/no-mapping paste path (blank/numeric first+last at positions 2/3, summary-marker first cell).
- **In-app cleanup for already-imported junk (DataModule "Junk Row Cleanup"):** admin-only card in the System Danger Zone (`/admin/data`). `db.findJunkDelegates(eventId)` scans the **active event** (paginated) for junk rows by data signature — blank names, purely non-alphabetic names, header-word names (ZONE/CAT/ADULTS/TEENS/CHILDREN/TOTAL/GRAND TOTAL/ZONE SUMMARY/NOTES:), and `<>`-laced note fragments — returning each row with a `junkReason`. Workflow: **1. Scan** (review table), **2. Backup JSON** (`downloadJSON`), **3. Delete** (`db.deleteJunkDelegates` → `checkins`/`session_responses`/`badge_print_logs` cascade delete then `delegates`, after `ensureEventActive`). No SQL editor needed — same pattern as the Scrambled Import Recovery / district purge flows. Falls back to the manual-run `supabase_migration_nc3_junk_rows_cleanup.sql` (v2, event-name agnostic) as an alternative.
- **DB backstop (`supabase_migration_import_row_guard.sql`):** `import_delegates_batch_merge` (sprint27 base) now increments `skipped` and `CONTINUE`s for items with blank or purely-numeric first/last names — junk can never be inserted or gap-fill a real record, regardless of client path.
- **Master List save fix (Issue 2):** `MasterListModule` shared `loading` flag was initialized `true` and only ever reset in `loadData`/`handleUpdate` — the default **All Official Districts** view loads via `loadAllDistricts` (which only toggled `districtListLoading`), so `loading` stayed `true` forever and the Edit dialog's Save button rendered "SAVING…" the moment it opened. Split into `listLoading` (table refetch; also reset in `loadAllDistricts` finally) and `saving` (init `false`, used ONLY by the Save button + `handleUpdate`). After a successful save in All-Districts mode, the affected district section is reloaded (`loadDistrictPage`) + district counts refreshed via `getDistrictsWithDelegates`, instead of the wasted full `loadData()`. In specific/search mode the previous `loadData()` refresh is unchanged.
- **v1.30 note-row coverage (guard v2):** manual-reg trailer NOTES rows that carry letters slipped through the v1 signature (`92 (children per notes) marked as CAT=C.`, `Combined = 306 records.`). `junkReasonOf` (service), `junkRowReason` (ImportModule gate), `importDelegates`, and the `import_delegates_batch_merge` RPC guard were all strengthened to also skip names that **start with a digit**, **contain `=`/`<`/`>`**, or contain a summary/note token (`RECORDS`, `SOURCE:`, `MARKED AS`, `PER NOTES`, `AS AT`, `DATE OF BIRTH`, `NAIRA`, `DELIVERABLES`, `ADULTS/TEENS/CHILDREN`, `CAT=`, `GRAND TOTAL`, `ZONE SUMMARY`, `SUBTOTAL`, `NOTES:`, `TOTAL`). The DataModule **Junk Row Cleanup** scan uses the same signature, so re-running Scan after redeploy picks up these rows for one-click delete. Re-run `supabase_migration_import_row_guard.sql` (now v2) to apply the DB backstop.
- **Cleanup for already-imported junk (`supabase_migration_nc3_junk_rows_cleanup.sql`):** **v2 is event-name agnostic** (v1 filtered by `name ILIKE '%NC3%'` and matched zero events when the delegates lived in an event named otherwise — backup table stayed empty). It scans ALL events by the same data signature, backs up to `_junk_backup`, previews, then deletes (dependents cascade via `ON DELETE CASCADE`). **The in-app DataModule "Junk Row Cleanup" (§32 above) is now the recommended path** — this SQL remains only as an offline alternative.

## 33. SE District "Name-only + Zone" Formatted Files (v1.35)

- **Problem solved (SE2 import, Aug 2026):** `Combined_SE2 Registrations_Formatted - (as at 15-08-26).csv` is structurally different from the other districts' Formatted files — it has **no `District` column (only `Zone`)** and **no separate `Last Name` column (single `Name` field)**. The prior import read `Zone` as the district and left every surname blank: of the 292 rows, 290 got an empty `last_name` and ~all landed under zone names (`ENUGU METROPOLITAN`, `EBONYI NORTH`, `ENUGU WEST`, `ENUGU NORTH`, `ENUGU EAST`, `EBONYI SOUTH`, `ENUGU SOUTH`, `EBONYI NORTH ZONE`, `NSUKKA`) instead of `South East 2` — so only the ~2 rows with a blank Zone surfaced under "South East 2", appearing as "only 1 delegate imported". Parser fixes previously applied to other districts (which DO have First/Last/District columns) could not fix SE2 because its file simply lacks those columns.
- **Mapper hardening (`ImportModule.tsx`, `mappedCsvData` + `importPreview` + `detectNameOrder` + `namePreview`):**
  - **Name-source fallback:** when there is no separate `Last Name` column, a single `Name`/`First Name` column is treated as a combined full name and parsed via `parseFullName` into First/Last (`nameSourceIdx`), so surnames are no longer blank. The separate `Title` column is preserved when the name carries no title (`parsed.title || TitleColumn`).
  - **Banner-district fallback:** a genuine DISTRICT column is detected via `hasExplicitDistrict` (district-named / short-code / chaptercode headers, NOT bare `zone`/`region`). When no explicit District column exists AND a banner district is present (e.g. "South East 2"), the banner district is applied to **every** row instead of the Zone value being read as the district. Zone remains available as chapter/zone reference.
- **Preprocessor (`preprocess_se2_csv.py`, outside the repo, mirrors `preprocess_nc1_csv.py`):** converts the SE2 Formatted CSV into the canonical `RegId,Title,First Name,Last Name,District,Chapter,Phone,Email,Rank,Office,DelegateType` import file (`SE2_Registrations_Canonical.csv`), splitting the `Name` field into First/Last via the source file's own convention (last word = surname), setting `District = South East 2` for all rows, normalizing phone, and dropping `-` email placeholders. This is the precise recommended path for the SE2 batch; the mapper hardening is the general safety net for future files with the same shape.
- **Remediation (`supabase_diagnostic_se2_rows.sql`, read-only + optional UPDATE/DELETE):** identity the SE2 host event, list the district distribution, enumerate the mis-filed rows (zone-as-district / blank-surname), and provides optional re-file or delete statements before re-importing the canonical CSV. Runbook: delete mis-filed rows (or re-file), confirm the event is `is_active`, re-import `SE2_Registrations_Canonical.csv`, then verify the SE2 Master List count.

## 34. SW5 Blank-First-Header Column Shift (v1.36)

- **Problem solved (SW5 import, Aug 2026):** `Combined_SW5_Registrations_Formatted - (as at 15-08-26).csv` has a **blank first header cell** (` ,Chapter,Gender,Title,First name,Surmame,Email,Phone,...`) while every **data row carries a serial number in column 0** (`1,Prime,Male,"Arc. Dr,",Taiwo,...`). `parseHeaders()` dropped empty cells, so the header array was 12 elements with `Chapter` at index 0 — but data rows have 13 columns with `SN` at index 0. `mappedCsvData`/`getEnabledColumnIndices` reads data using header indices, so **every mapped column read the value one column to its left**: Chapter→SN, Title→Gender (`Male`), Email→Surname, Phone→Email, etc. Junk in Title/Chapter/Email/Phone exactly as reported. Only SW5 was affected because every other district Formatted file begins its header with a non-empty cell (`S/N`,`SN`,`TITLE`,`Timestamp`...), keeping header and data column counts aligned.
- **Fix (`ImportModule.tsx`):** `parseHeaders` now returns `parseCsvLine(headerLine)` **without** the `.filter(h => h.length > 0)` — preserving raw header positions so header indices match the data-row columns. Empty header cells are filtered only when populating `detectedColumns` (mapping UI toggle buttons) so no blank button renders; `columnMap`/`getEnabledColumnIndices` still use the full (unfiltered) header array for correct indices. This also fixes the same latent shift in the **Repair Imported Names** path (`extractRepairRows`). No regression for files with non-empty first header cells (empty-cell filter was a no-op there). Empirically verified: SW5 row 1 now maps Chapter=`Prime`, Title=`Arc. Dr,`, Email=`yomtea1@yahoo.com`, Phone=`0805 605 0531`.
- **Preprocessor (`preprocess_sw5_csv.py`, outside repo, mirrors the SE2/NC1 pattern):** emits `SW5_Registrations_Canonical.csv` (39 rows, all `District = South West 5`, Title/First/Last from their own columns, phones normalized, WhatsApp used as phone fallback). Clean re-import path.
- **Remediation (`supabase_diagnostic_sw5_cleanup.sql`):** finds the already-imported mis-aligned SW5 rows (junk signature: Title=`Male`/`Female`, numeric `chapter`, non-numeric phone, or title-word `first_name`) and provides a guarded DELETE so the corrected canonical CSV can be re-imported cleanly.

## 35. SE1 Count Reconciliation (1,258 vs 1,260) — STOPPED, handed to district officers

- **Symptom (Aug 2026):** SE1 Master List showed 1,283 against a source file of exactly **1,260** rows (+23). Investigation confirmed the file is authoritative at 1,260 and the +23 came from SE1 being **imported more than once** (batches at `2026-08-23 23:24`, `2026-08-24 00:40`, and `2026-08-24 12:42`). A re-import carried the SE `Surname, Initial` convention (e.g. `ANTHONY , O.`, `EKENE, I.`, `SUNDAY, C.`); because the DB/first-last split of those forms differed from the originals, their identity keys never matched, so they inserted as NEW rows instead of updating → bloat.
- **⚠️ Over-deletion mistake (lesson learned):** a coarse base-key regex (non-alpha stripped + trailing-initial removal) collapsed many **different** people into shared two-letter keys (e.g. `Chinedu Oranye`/`Chizoba Okoye`/`Charlse Orajiaka` → `CO`). A bulk DELETE on those collapsed groups removed **25 rows** — 23 true duplicates + **2 legitimate rows** — dropping the total to 1,258. The precise per-person set from query F was 23; the loose group-delete overshot. **Rule: when deduping by fuzzy normalized keys, delete ONLY the individual rows explicitly enumerated (by delegate_id array from a reviewed SELECT), never by a shared group key derived from aggressive normalization.**
- **Current state & decision:** DB = **1,258** (file = 1,260 → 2 short). Further fuzzy matching could not reliably identify the 2 missing (the `Surname, Initial` field-split differs between DB and file, so name-key joins are unreliable; section-B "extra" rows are mangled real people, not junk). **Resolution: stopped automated fixes and handed to district officers to reconcile the 2-row gap** against their records. No further automated deletes.
- **Artifacts:** `supabase_diagnostic_se1_rows.sql` (bloat locate), `supabase_diagnostic_se1_cleanup.sql` (the delete used — kept for reference/audit). Throwaway investigation scripts (`bloat`, `bloat2`, `find_missing`, `diff`) were removed — they embed fuzzy keys known to be unreliable and should not be reused.

## 36. District Portal CSV Reconcile + Gap-Fill (v1.37)

- **Problem solved (SW7 portal import, Aug 2026):** district portal exports (e.g. `SW7 Portal reg.csv`) carry a **combined `Full Name`** with an embedded title (`Mrs. Ngozi Nwosu`, `ENGR UCHE PHIL`), a `Delegates` column (Member/Dependant), and the **same person often recorded under different title/name-order between rows** (`Uto-Dieu Jair` vs `Mr. Jair Uto-Dieu`). The standard `import_delegates_batch_merge` matches on exact, order-sensitive `title_key + first + last` + phone/email, so such people fail to unify into one record and missing phone/email are not filled.
- **Reconcile flow (`ImportModule.tsx`, `supabaseService.ts`, `supabase_migration_reconcile_delegate_fill.sql`):** when a portal-shaped file is detected (`Full Name` + `Phone` + `Email` + `Chapter`), an admin-only **"Reconcile District Portal CSV"** panel appears with its own **event picker** (defaults to active event — matching never leaks across events). Workflow: **1. Preview (dry run)** → **2. Backup & Apply** (auto-downloads a JSON backup, then writes). Per row: match an existing delegate in the target event by (a) `phone_normalized`, (b) a **word-sorted, title/order-insensitive name key** (`canonical_name_key` — `Jair Uto-Dieu` == `UTO DIEU JAIR`), (c) lowercased email; then **gap-fill ONLY blank** title/phone/email/district/chapter/rank/office/delegate_type — **never overwrites** a non-blank value; insert as a new delegate when unmatched.
- **New headers:** `Delegates`/`Membership`/`Delegate Membership`/`Membership type` now fuzzy-map to `DelegateType`, so portal Member/Dependant rows land on the correct type.
- **Trailer block:** the existing junk guard (empty `Full Name` → `'no name'`) already drops the portal export `Total` row and the quoted multi-line `Applied filters / Event Status / IsActive / ...` trailer block — no new guard was needed.
- **RPC:** `reconcile_delegate_matches(p_delegates JSONB, p_event_id UUID, p_dry_run BOOLEAN DEFAULT FALSE)` — SECURITY DEFINER, admin/event_admin gate only, strict `event_id` scoping, per-record SELECT-then-gap-fill (never blanket overwrite, mirrors §35 lesson). Client wrapper `db.reconcileDistrictPortal(csv, eventId, dryRun)` batches 500 rows.
- **Deploy note:** apply `supabase_migration_reconcile_delegate_fill.sql` (idempotent `CREATE OR REPLACE`) before using the panel.
- **v1.37b timeout fix (`supabase_migration_reconcile_timeout_fix.sql`):** the v1 RPC's name fallback did `WHERE canonical_name_key(first_name, last_name) = v_name_key` — an unindexed full scan over the event for every input row → **"canceling statement due to statement timeout"** on large reconcile runs. Fix: persist the word-sorted key as `delegates.name_key` (extended the identity trigger + one-time backfill) with `idx_delegates_event_name_key(event_id, name_key)` so the fallback is an index probe, and raise the in-RPC `statement_timeout` to 120s via `set_config` so big batches complete. Re-apply this migration before retrying Preview/Apply.
- **Q: run "Proceed with Bulk Import" before Preview?** No — the Reconcile panel operates on the same mapped CSV data (`mappedCsvData`) the Bulk Import button uses, so run Preview/Apply directly; a prior bulk import is not required.
- **v1.37c registration_source CHECK fix (`supabase_migration_reconcile_registration_source_fix.sql`):** reconcile inserts initially used `registration_source='reconcile'`, which violates the `delegates` CHECK constraint (`IN ('import','manual','qr_scan')`) → Apply failed with `delegates_registration_source_check` (Preview/dry-run passes because it never inserts). Fix: reconcile inserts now use the allowed `'import'` value (matches the bulk-import path; no constraint change). Applies to the RPC and the client wrapper `db.reconcileDistrictPortal`.

## 37. Title-Variant Duplicates — Dependant-Aware Reconcile (v1.37d)

- **Problem solved (SW7, Aug 2026):** after the SW7 portal reconcile, Master List showed **628 SW7** vs the CSV's **605**. Reconcile's old name key (`canonical_name_key`, whitespace/hyphen only) could not match double titles trapped in the name field — `Dr|(Mrs). Cefort|Ige` ≠ `Dr|Cefort|Ige`, `|Esv Benjamin|Chika` ≠ `ESV|Benjamin|Chika`, `Mr|Uto-Dieu Jair` ≠ `Mr.|Jair Uto-Dieu` — so the CSV twin was **inserted** instead of **updated**. Diagnosis (read-only SQL, punctuation-stripped key) found **30 duplicate pairs** in SW7, each one contact-bearing row + one NO-PHONE/NO-EMAIL row (both `registration_source='import'`). Merge → 628 − 30 = **598**; ~7 residual rows need CSV-vs-DB reconciliation (per-row MERGE/KEEP verdict) before further action.
- **Root causes:** (1) `Amb/Master/Mst/Mstr/Esv/Pharm/Supt/Drs` were missing from `KNOWN_TITLES`/`canonicalTitle` (added in `services/utils.ts`), so they were trapped into `first_name` and never parsed as titles. (2) The reconcile name key stripped no punctuation or title tokens.
- **Dependant guard (critical):** `Master`/`Mst`/`Miss` denote a **dependant (son/daughter)** who may legitimately share a parent's full name. Name matching is now **family-gated** via `delegate_match_key(title, first, last)` = `FAMILY|canonical-name-key`, family resolved `DEP` (master/mst/mstr/miss) > `PRO` (any professional title, incl. `Dr (Mrs)` → PRO) > `M` (mr) > `F` (mrs/ms) > `P` (blank). A DEP row and an adult row produce different buckets → **can never name-match/merge**; `Mr X` vs `Mrs X` (couples) also never merge.
- **New SQL migration (`supabase_migration_reconcile_dependant_family.sql`):** redefines `canonical_name_key` (punctuation+title stripped, word-sorted), adds `delegate_family_code` + `delegate_match_key`, re-backfills `delegates.name_key`, rewrites the trigger + `reconcile_delegate_matches` name fallback to use the family-aware key. Deploy **before** re-running any reconcile. (Also includes the v1.37c `registration_source='import'` fix in the rewritten RPC.)
- **Service (`supabaseService.ts`):** `familyOfName`/`canonicalNameKeyStr`/`familyAwareNameKey` imported from utils; new `db.analyzeTitleVariants(eventId)` (event-scoped, groups by family key, flags `dependantInvolved` + `autoMerge` — auto-merge only when NOT dependant AND ≤1 contact-bearing row) and `db.mergeTitleVariants(eventId, clusters, approvedKeys)` (re-homes `checkins`/`session_responses`/`badge_print_logs`, keeps most-complete survivor, deletes loser).
- **UI (DataModule.tsx "Reconcile Title Variants"):** admin, event-scoped. **1. Scan** (lists each cluster with KEEP/DEL rows + family badge) → **2. Backup JSON** → **3. Apply Merges**. Dependant clusters render on amber and are **approve-to-merge, default SKIP**; professional/job-title clusters self-approve. Mirrors Scrambled Recovery / Junk Cleanup workbook pattern.
- **§35 lesson respected:** merges target only clusters whose identity keys collide; never bulk-deletes on fuzzy keys; per-cluster KEEP/DEL enumeration is explicit and reviewed before Apply.
- **v1.37e district scoping + different-phone skip:** the national event hosts ALL districts, so clustering by name alone surfaces false positives (same name, different district = different people). `analyzeTitleVariants` now clusters by `normKey(district) | familyAwareNameKey(...)`, so duplicates are resolved **per district** only. New `differentPhone` flag: a cluster whose members carry **more than one distinct phone** is never auto-merged and renders "DIFFERENT PHONE — SKIPPED (likely different people)"; `mergeTitleVariants` refuses them unconditionally. The reconcile RPC name-key **and** email fallbacks are now district-guarded (`lower(btrim(district))` match) so a single-district portal file (e.g. SW7) never reconciles a row into a same-name delegate in another district. Re-deploy `supabase_migration_reconcile_dependant_family.sql` (now v1.37e) and re-scan before Apply.
- **SW7 final outcome (Aug 2026):** after Reconcile + Title-Variant merge, SW7 = **596**. The CSV "605" was never the distinct-person count — the portal file contains **5 internal duplicate rows** (Chinyere Obialor ×2, TOLUWA JOSEPH ×2, Ikenna Obaba ×2, NDUDIRUM NJOKU ×2, and `Uto-Dieu Jair`/`Mr. Jair Uto-Dieu`), so true distinct ≈ **600**; 596 is 4 below that and consistent with the §35 residual-gap rule (hand residual row differences to district officers; do not chase with fuzzy keys). Shared-family phones (`08057084372`, `08023135462`, `08023217360`) are correctly different people. Read-only close-out check: `supabase_diagnostic_sw7_residual_dupcheck.sql` (SELECTs only: same-phone dupes, family-aware name-key dupes, diff-phone same-name informational list).

## 38. SW3 Portal Reconcile Outcome (Aug 2026)

- **Final SW3 count = 724** after Reconcile District Portal CSV (Preview → Backup → Apply), all inside the `2026 Lagos National Convention` event.
- **Composition:** 503 pre-existing **manual registrations** (from `Combined_SW3 Registrations_Formatted – (as at 15-08-26).csv`, name-only rows with no phones/emails — already imported from the district manual-reg files) + **221 portal-unique** inserts from `SW3 Portal Reg.csv` (240 distinct portal identities; 260 raw rows minus 20 CSV-internal duplicate rows like `Engr. Adebayo Adelakun` ×4). The two source channels share only ~15 name-key matches, so 724 = the *union* of two legitimate registration channels, NOT a bug (cf. §37 SW7: 596 ≠ the CSV row count).
- **Title Variants review:** DataModule **Reconcile Title Variants** scan listed sensible KEEP/DEL cross-channel pairs (same person registered via both portal and manual). **Decision: apply the merge** to collapse cross-channel pairs (keeps most-complete portal copy + phone/email, re-homes history). Expected post-merge SW3 ≈ 714.
- **Intentional skip (different-phone guard):** `Esv Lanre Taiwo` exists twice with identical title+name but **different phones** (08026…127110 vs 08036…127110 — same trailing 7 digits, differing only in the 08/03 network-prefix digit) and different email/chapter. This is a **documented intentional double-registration** (the delegate paid twice, registered with two emails/chapters). Per the v1.37e different-phone rule it is **not auto-merged** and is deliberately **SKIPPED** — **any similar different-phone same-name cluster is also skipped by design**. Rule: two records for a double-paying intentional registration is defensible; merging on ambiguous phone/email evidence is not (§35). If a skipped pair is later confirmed the same person, resolve via a manual Master List edit+delete (rows have 0 checkins → clean) — never via the title-variant merge.
- **Close-out:** run `supabase_diagnostic_sw3_residual_dupcheck.sql` — Q0 expect `South West 3 | ~714` (or 724 if merge not applied), Q1 = 0 rows (no same-phone dupes), Q2 = 0 rows (clean), Q3 informational (families + the skipped intentional pair). Query 3A (`base_key = 'lanre taiwo'`) confirms the skipped pair's full detail.

## 39. Registrar Free Guest Restriction (v1.38)

- **Problem solved:** registrars previously could register *any* delegate type on the New Delegate form; district officers needed a per-event control to limit registrar-created records to `Free Guest` (walk-ins / uncharged visitors) while keeping full control to admins.
- **Config:** new per-event flag `events.event_config.restrict_registrar_to_free_guest` (boolean, default absent/false). Toggled in **Events & Config** → new **"Registrar Restrictions"** box (amber) next to "Delegate Form Fields". Existing `event_config` JSONB used — **no new column**. Persisted/audited through the existing `createEvent`/`updateEvent` flow.
- **Scope (three layers, defense-in-depth):**
  1. **UI (`NewDelegatePage.tsx`):** when `freeGuestLocked` (caller is `isRegistrarRole` **and** flag on) the Delegate Type dropdown is replaced by a locked "FREE GUEST" chip, the stored value is force-set on submit, the post-success reset defaults to `Free Guest`, and an amber banner explains the restriction. Applies even when `show_delegate_type` is OFF (no silent `Member` defaults).
  2. **Service (`supabaseService.ts`):** `registerDelegate` rejects non-`Free Guest` payloads from a restricted registrar with a clear `PERMISSION:` error. Guard helper `isRegistrarFreeGuestRestricted(eventId)` reads `events.event_config` + caller role (`supabase.auth.getUser()` → `app_users.role`).
  3. **RLS (`delegates_insert_scoped`):** new `is_registrar_user()` SQL helper (roles `national_registrar`/`regional_registrar`/`district_registrar`/`registrar`/`executive_admin`, `is_active`-guarded, SECURITY DEFINER like `is_admin_user`); policy blocks a manual insert (`registration_source = 'manual'`) with a non-`Free Guest` type on a restricted event — un-bypassable even from a hacked client.
- **Roles restricted:** registrar-tier via `isRegistrarRole()` + the SQL set (incl. `executive_admin`). **Admins and `event_admin` are exempt** (unchanged writes).
- **Open paths (intentional):** the QR-scan check-in submission path (`registerDelegateFromQR`, `registration_source='qr_scan'`) stays open so door officers can still store pre-badged delegates not yet in the DB (existing/legit types like `Member`), and bulk import remains admin/event_admin-only. Discriminator = `registration_source` (already stored, no migration of data needed).
- **Deploy:** apply `supabase_migration_v1.38_registrar_free_guest.sql` (idempotent: `CREATE OR REPLACE FUNCTION is_registrar_user()` + `DROP POLICY IF EXISTS / CREATE POLICY delegates_insert_scoped`). `supabase_schema.sql` reconciled (helper + policy block in §12g).
- **v1.39 Free Guest field lock:** Free Guest records are always filed under **District = `National/External`** and **Chapter = `Guest`**. When `freeGuestLocked`, `NewDelegatePage` locks both fields to those values (amber chips, label "District (Free Guest)"), forces them on submit and reset, and the service `registerDelegate` force-sets `delegate_type/district/chapter` for restricted registrars (defense-in-depth). **RLS implication:** the v1.38 policy still required district-scoped registrars to insert into their own district, which would reject `National/External`. `supabase_migration_v1.39_free_guest_field_lock.sql` rewrites `delegates_insert_scoped` so that on a restricted event, register‑role **manual** inserts succeed ONLY as `FREE GUEST` + district `National/External` (the district-scoped manual path is disabled entirely on restricted events; QR/import sources keep normal district scoping — every scenario verified below). Apply v1.39 (supersedes v1.38's policy; v1.38 file kept as history).

## 40. Per-Event Delegate Delete Toggle (Master List)

- **Problem solved:** the admin Delete action added to the Master List was always on. Operators needed a per-event safety switch so destructive single-row deletes can be disabled per convention, independently of event lifecycle (`is_active`).
- **Config:** new per-event flag `events.event_config.delegate_deletion_enabled` (boolean, default absent/false = **off**). Toggled in **Events & Config** → new **"Destructive Controls"** box (red) below "Registrar Restrictions". Persisted/audited through the existing `createEvent`/`updateEvent` flow — **no new column, no migration**.
- **UI (`MasterListModule.tsx`):** `canDelete = isAdminRole(role) && activeEvent.event_config?.delegate_deletion_enabled === true`. Both Master List Delete buttons (district-section + unified table) render for admins but are **disabled + grayed** (`Delete (off)`) when the flag is off, with a hover tooltip pointing to Events & Config. `handleDelete` also early-guards with a friendly alert. Merge-on-duplicate (`mergeDelegatePair`) is **not** gated — it preserves attendance/badge history and remains available regardless of the flag.
- **Service (`supabaseService.ts`):** `deleteDelegate` re-reads `events.event_config` and throws a clear error when `delegate_deletion_enabled !== true` — defense-in-depth so a hacked client cannot bypass the toggle. District purge / junk cleanup / scrambled recovery / global purge in DataModule are separate functions and unaffected.
- **Deploy:** frontend-only; no SQL migration required (existing `event_config` JSONB used).

## 41. Portal vs Manual Registration Source (Master List filter + export + reclassify)

- **Problem solved:** delegates enter the system through two channels — FGBMFI Portal exports (CSV rows carry a real **RegId**, e.g. `CON26…`) and manual registration outside the portal (no RegId). Both were collapsed to `registration_source='import'` on bulk import (`supabaseService.ts:1164,1177`) and every row received a generated `CON26` `external_id`, so the Master List could not distinguish the channels for filtering or CSV/PDF export. `registration_source='manual'` (New Delegate form) and `'qr_scan'` (door QR) were already distinct.
- **Discriminator (confirmed decision):** `delegates.registration_source` now supports `'portal'`. **Portal** = `registration_source='portal'`; **Manual** = everything else (`import` | `manual` | `qr_scan`, i.e. `registration_source <> 'portal'`). Chosen over a new boolean column to keep a single source-of-truth column that is already filterable/queries and covered by RLS.
- **Deploy order — migration first:** run `supabase_migration_add_portal_source.sql` (idempotent) before importing portal CSVs. It (1) drops/re-adds the `delegates_registration_source_check` CHECK to `IN ('import','manual','qr_scan','portal')`, and (2) rebuilds `get_paginated_delegates` with a trailing `p_registration_source TEXT DEFAULT NULL` (server-side filter, correct COUNT/pagination at 25K). ⚠️ The implementer confirmed the **live** signature includes `p_region` (`supabaseService.ts:792`); the migration drops prior overloads and creates the full 7-arg signature — re-verify `\df get_paginated_delegates` before deploy if the live shape differs.
- **Import tagging (`supabaseService.ts`):** `importDelegates` now marks a row `registration_source='portal'` when the canonical CSV row carries a non-empty RegId (`hasRegId = !!(p[0]||'').trim()`), else `'import'`. `reconcileDistrictPortal` (portal-only panel) now sends `registration_source:'portal'` + `external_id` (RegId) passthrough.
- **Service filters:** `getPaginatedDelegates`/`fetchAllDelegatesForExport` gained a trailing `source?: 'portal' | 'manual'` param — RPC path passes `p_registration_source`; fallback path applies `.eq('registration_source','portal')` / `.neq('registration_source','portal')`.
- **Master List (`MasterListModule.tsx`):** new **Source dropdown** (All / Portal / Manual) in the filter bar. Setting a source acts like search: switches from the All-Districts sections to the unified paginated table (mode guard `!selectedDistrict && !searchTerm && !sourceFilter`). Table + PDF + CSV gained **Source** (badge) + **Reg ID** (`external_id`) columns; export filenames include the source (`Delegate_Master_List_Portal_…`).
- **Reclassify tool (`DataModule.tsx` — admin):** "Delegate Registration Source" card (teal, before Global Purge). Workbook pattern: **1. Scan** (`db.getSourceDistribution(eventId)` — paginated counts per source) → **2. Backup JSON** → **3. Mark All as Portal / Manual** (`db.reclassifyDelegateSource(eventId, mode, ids?)` — `ensureEventActive()` + audit `delegate_source_reclassify`). Reclassifying an existing event to Portal tags its mixed `import` bucket; use only when you know the event's files were portal exports.
- **types.ts exception (documented):** `Delegate.registration_source` union widened additively to `'import' | 'manual' | 'qr_scan' | 'portal'` — mirrors the `Pledge.pledge_name`/`Event.event_config` precedent.
- **Import feedback (`ImportModule.tsx`):** success banner reports "N rows carry a RegId — tagged for the Portal filter".
- **Non-disruption:** fully additive — new CHECK value, additively-defaulted RPC param, no data deletes. `import_delegates_batch_merge` / reconcile RPCs / badge printing / reports / dedup all read/write `registration_source` independently and remain valid for the new value. Registrar free-guest RLS (`registration_source='manual'` on INSERT) is unaffected.

## 42. Reg Type (Manual / Portal / Web) — user-facing registration classification (v1.44)

- **Problem solved:** every delegate pays for a system-generated `CON26` external_id, so the Master List "Reg ID" column displayed a fabricated ID on manual registrations and there was no first-class "Web" (international/guest) category. Upload tagging also auto-detected `portal` by sniffing "does col 0 start with `CON26`?" — wrong for any portal/web file whose IDs use a different prefix.
- **Design decision:** a **separate `delegates.reg_type` column** (`'manual' | 'portal' | 'web'`, `NOT NULL DEFAULT 'manual'`, CHECK) was chosen over widening `registration_source`, because `registration_source` is the deep-routed operational channel (import/manual/qr_scan/portal) that RLS (free-guest), import tagging, reconcile and dedup branch on. `reg_type` is a pure user-facing classification; the operational channel stays authoritative for auth/RLS. `registerDelegate` (New Delegate form) always stores `manual`; QR-scan rows default to `manual` via the column default; bulk uploads, portal reconcile and reclassify set it explicitly.
- **Upload-time tagging replaces RegId sniffing:** `importDelegates(csv, eventId, regType, onProgress?)` takes the operator's explicit choice. Per row: `reg_type = regType`; `registration_source = regType==='portal' ? 'portal' : 'import'`; `external_id = (regType !== 'manual' && file col 0 non-empty) ? fileRegId : generateRegId()` — real portal/web IDs (any prefix) are preserved; manual serials are ignored.
- **Migration `supabase_migration_reg_type.sql` (idempotent):** add `reg_type` + CHECK; backfill `UPDATE ... SET reg_type='portal' WHERE registration_source='portal'`; rebuild `get_paginated_delegates` with trailing `p_reg_type TEXT DEFAULT NULL` (`manual` = `COALESCE(reg_type,'manual') NOT IN ('portal','web')`); rebuild `import_delegates_batch_merge` to accept `reg_type` — SET on INSERT, **FILL-BLANK-ONLY on the merge UPDATE** (re-imports never clobber a corrected tag; use DataModule Reclassify to change it).
- **Master List:** Source dropdown is now All / Portal / Web / Manual and filters `reg_type` server-side (RPC `p_reg_type` + fallback `.eq('reg_type',...)` / `.neq('portal').neq('web')` for manual). Badges: Portal emerald, Web blue, Manual gray. **Reg ID column shows `external_id` ONLY when `reg_type IN ('portal','web')`, else `-`**, uniformly in the sections table, the unified table, and PDF export; CSV exports the raw `external_id` + `reg_type`. The unified (specific-district/search) table body was **missing the Source + Reg ID cells** (headers declared them but `<tbody>` never rendered them) — added, so both table modes now render the same columns (this was also why All Districts + source "suddenly showed Reg IDs" after the v1.43 §21 fix routed those views onto the sections table).
- **ImportModule:** "Upload Source / Reg Type" selector (Manual · Portal · Web, default Manual) above the PROCEED button; button label echoes the choice; success banner reports "N rows carry a RegId — upload classified as X".
- **DataModule reclassify:** distribution + "Mark All as" now cover Manual / Portal / Web on `reg_type` (`reclassifyDelegateSource(eventId, mode: RegType, ids?)`; portal mode also syncs `registration_source='portal'`).
- **types.ts additive exception:** `export type RegType = 'manual' | 'portal' | 'web'` + `Delegate.reg_type?: RegType`.
- **Deploy order:** run `supabase_migration_reg_type.sql` BEFORE importing/tagging — without the column the RPC rebuild is a no-op against an existing deployment, but the frontend's `reg_type` inserts fail on a missing column.
- **Backward compat:** existing rows default to `'manual'` (correct: current DB is all manual); previously `registration_source='portal'` rows are backfilled to `'portal'`.

## 43. Full-Design Portrait Badges (v2 design – 4-up-portrait + 6-up-portrait) (v1.45)

- **New transparent badge design (`public/badge-design-v2.png`, 1207×1686, aspect 0.716):** a full-bleed branded tag — solid navy header (`#003040` + orange accents) at the top ~28%, a translucent white content panel (y 0.38–0.90), and sparse bottom branding on white (y 0.90–1.00). The design already includes a **slanted navy rectangle in the top-right header** where the delegate type is printed in white text.
- **Layouts:** added **`4-up-portrait` (100×140mm, 2×2)** and resized **`6-up-portrait` from 63×95mm → 65×91mm** — both match the design aspect 0.716 exactly so the branding fills the card with zero cropping. 4-up is *near-A6* (true 105×148 can't fit 2-across on A4 — zero gap; 100×140 leaves 3.5mm cut margins); 6-up keeps the design aspect by scaling width+height together, so the small bump adds height without rebalancing the card. Because badge fonts are point-based, the larger cards retain the same type sizes with more room. `9-up-portrait` / `8-up-portrait` / `4-up-3x4` keep the legacy `badge-design.png` rendering path (v1.43). Requires `supabase_migration_add_4up_portrait_layout.sql` (widen `badge_batches` layout CHECK) before any `4-up-portrait` batch is created.
- **New draw path (`badgePdfGenerator.ts`):** `drawBadge` now accepts `badgeDesignV2` (embedded PNG). When present + `isPortrait`, it draws the design full-bleed then renders content from the **tunable `V2_ZONES` fraction table** (measured from the top of the badge): white auto-fit delegate-type text centered in the navy rect (typeY0/typeY1/typeX0/typeX1); name block centered at the top of the white panel (nameTop/nameBottom); then a side-by-side body row — detail lines (District/Chapter/ID + Rank/Office per `event_config`) in a left column (`detailsX`..`qrX0`) using `fitPriorityFields`, and the QR square right-aligned (`qrX0`/`qrX1`/`qrCX`, ≤30mm). Font tiers scale by badge width (`isLarge = bw ≥ 70mm`).
- **Plumbing:** `generateBadgePDF(..., badgeDesignV2Bytes, onProgress)` embeds and threads the new asset; `BadgePrintingModule` fetches `/badge-design-v2.png` alongside the legacy assets; dropdown + `BadgePreview` updated (7 layouts). `types.ts` additive exception: `BadgeLayout` += `'4-up-portrait'`.
- **Calibration note:** because the design geometry can't be self-verified visually, `V2_ZONES` fractions are centralized for quick re-tuning against a printed sample (compare to `Tag TEMPLATE.png`). v1.45-rev: name block lowered ~1 line (nameTop 0.462/nameBottom 0.577, details band 0.587–0.895) and the ID row renders at −0.5pt (large)/−1.0pt (small) with a width-fit cap. Check-In reprint canvas badge (CheckInPage / badgeImageGenerator) is intentionally NOT yet synced to this design — follow-up.

## Code Conventions

### Naming
- Files: PascalCase for components/pages (`AdminDashboard.tsx`), camelCase for services (`supabaseClient.ts`)
- Exports: named exports for utilities, default exports for pages/components
- Routes: `/admin/events`, `/checkin`, `/help` (kebab-case, no version prefix)
- Types: defined in `types.ts` with PascalCase interfaces, CAPS_CASE enums

### Error Handling
- `handleSupabaseError()` wrapper in `supabaseService.ts` — centralizes network/auth error translation
- Pages catch errors in try/catch blocks, display via alert() or local state
- No centralized notification/toast system yet (v2 feature)

### Types (types.ts)
```typescript
enum UserRole { NATIONAL_ADMIN, REGIONAL_ADMIN, DISTRICT_ADMIN, ADMIN, NATIONAL_REGISTRAR, REGIONAL_REGISTRAR, DISTRICT_REGISTRAR, REGISTRAR, FINANCE, EVENT_ADMIN }
enum FinancialType { OFFERING = 'OFFERING', PLEDGE_REDEMPTION = 'PLEDGE_REDEMPTION' }
// Key interfaces: Event, Delegate, User, Session, CheckIn, Pledge, FinancialEntry, 
//                 DashboardStats, CheckInResult, SystemSettings
```

### Avoid
- Adding Redux or Zustand — Context + TanStack Query is sufficient
- Browser routing (history.pushState) — must stay HashRouter for Vercel SPA
- Direct `supabase.from().select()` in page components — always go through `supabaseService.ts`
- Server-side rendering until Next.js migration (v2)
- Comments unless explaining non-obvious logic
- **Using `gen_salt('bf')` in any auth RPC** — defaults to bcrypt cost 6, GoTrue requires ≥ 10. Causes HTTP 500 on login. Always use the manual cost-10 salt, or (preferred) use `signUp()` which avoids manual password hashing.
- **Manually INSERTing into `auth.users`** — fragile, breaks on GoTrue schema updates. Use `supabase.auth.signUp()` via isolated client instead. The legacy `create_app_user` RPC is a recovery fallback only.

## Deployment

### Vercel (Current)
- **Build:** `npm run build` (Vite output → `/dist`)
- **Framework preset:** Other / SPA
- **Env vars required:**
  - `VITE_SUPABASE_URL` — Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` — Supabase anon/public key
- **No server-side config** — fully client-side SPA
- **HashRouter required** — Vercel redirects all paths to index.html, hash-based routing works without server config

### Environment Variables
| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL (e.g., `https://xxxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key (starts with `eyJ...`) |

### Local Development
```
npm install
npm run dev     # Vite dev server on port 5173
npm run build   # Production build to /dist
```

## Security Constraints

### MUST
- Filter all Supabase queries by `event_id` where applicable — use strict `.eq('event_id', eventId)`, NEVER `OR event_id IS NULL`
- Call `ensureEventActive()` before any database write
- Use `handleSupabaseError()` to translate Supabase errors consistently
- Validate role (`user.role`) before admin operations (event CRUD, user management)
- Scope registrar queries to `user.district`
- Normalize district names before comparison (`norm()`)
- Guard `getPaginatedDelegates()` and `getStats()` callers: `activeEventId` must be truthy before calling these functions
- Each delegate belongs to exactly one event; `event_id` must be set on every `delegates.insert()` call
- Do NOT add `OR event_id IS NULL` to any delegate query — it breaks event isolation

### MUST NOT
- Store `VITE_SUPABASE_ANON_KEY` in code (use env vars)
- Trust client-side role checks alone — RLS policies must enforce on server side
- Allow SQL injection (use Supabase SDK parameterized queries, never raw SQL)
- Expose `app_users` password hashes in responses
- Rely on 4-digit QR codes as sole check-in method above 10K delegates
- Create delegates without `event_id` — every delegate INSERT must include `event_id`
- Add `event_id.is.null` or `OR event_id IS NULL` to any Supabase query
- Use `gen_salt('bf')` in any auth password function — defaults to bcrypt cost 6, GoTrue requires ≥ 10
- Manually INSERT into `auth.users` — always use `supabase.auth.signUp()` (v1.6+)

### Known Vulnerabilities
1. ~~**4-digit QR code collisions** at >10K delegates — deterministic hash, only 10K slots~~ — **RESOLVED v1.10**: 4-digit code removed; UUID-only QR (`qr_hash`).
2. **Audit log retention** — **PARTIALLY RESOLVED v1.11**: `audit_log_archive` table + weekly pg_cron job (Sat 03:00 UTC) archives rows older than 180 days; live-table manual clear-by-period still available in Admin Audit Log.
3. **`getAllDelegates()` + `getAllDataForExport()`** — fetch entire table into memory, will fail at 25K (paginated variants exist; `get_event_export_data` RPC not deployed — service falls back to bounded `fetchAll`).
4. **Context re-render storms** — all context consumers re-render on any state change
5. **No rate limiting** — 50 concurrent officers could exhaust Supabase connection pool (Pass-1 locked most RPCs to `authenticated`/`service_role`; anon attack surface removed).
6. **Event data isolation is client-enforced** — RLS policies on `delegates` do not enforce `event_id` scoping; isolation relies on application-level queries, hard gates, post-filters, and scoped RPCs. A bypass of the service layer could leak cross-event data. (Pass 2C hardened `search_delegates*`/`get_dashboard_stats` to require `event_id` server-side.)

### Security Hardening (v1.11)
- **Pass 1 (`supabase_hardening_pass1.sql`):** revoke anon/PUBLIC EXECUTE on all public functions → re-grant to `authenticated`+`service_role`; `check_login_account` → service_role-only (kills the login oracle / "Exposed Auth Users" warning); in-RPC `is_admin_user()` guards on admin/management RPCs; financial gates on `get_event_dashboard_stats` + `get_report_aggregates`; RLS fixes (`app_users` self-insert admin block, financials/pledges SELECT scoping, `deleted_users` RLS, chapters admin-write).
- **Pass 2A/2B/2C (`pass2a_drop_orphan`, schema reconcile, `pass2c_live_fixes`):** dropped orphans `public.financials` + `public.event_delegate_codes` (both RLS-disabled) + quarantined any remaining; sealed `v_auth_integrity_check` (auth-users view) to service_role; scoped `srs_update`/`svd_update`; guarded `update_auth_user_email`/`update_pledge_redemption`; event-scoped `search_delegates*`/`get_dashboard_stats`; `badge_batches` writes to admin+event_admin; `supabase_schema.sql` reconciled to live DB.
- **Pass 2D (`pass2d_audit_archive`):** immutable `audit_log_archive` + weekly pg_cron archive job (needs `CREATE EXTENSION pg_cron` first).
- **Executive Admin role (`supabase_migration_executive_admin.sql`)** — see Roles above.
- **Role sync (`supabase_migration_fix_role_sync.sql`):** `update_app_user_role(user_id, new_role)` atomically syncs role in `app_users` + `auth.users.raw_user_meta_data`/`raw_app_meta_data`; backfills diverged users. **Never edit role via raw `app_users` update alone** — always go through `update_app_user_role`.

### QR Scanner Camera Behavior (v1.11)
- **Auto camera selection by device class:** mobile/tablet → **rear (back) camera** via `facingMode: 'environment'`; PC/laptop → **front (built-in) camera** via `facingMode: 'user'`.
- Both engines (native BarcodeDetector + html5-qrcode fallback) request `facingMode` declaratively; on `Overconstrained/NotFound`, a label-aware `pickCameraForFacing()` fallback resolves a deviceId (mobile prefers `back/rear/environment`, desktop prefers `front/user/built-in/face`, virtual cameras denied).
- **Manual front/back camera dropdown removed** — no user camera selection; `qr-camera-device-id` preference no longer persisted.
- Kept: BD/html5 engine toggle, low-light Boost, active-camera label badge.

## Known Technical Debt

| Item | Description | Priority | Target |
|------|-------------|----------|--------|
| QR code collisions | 4-digit hash → 10K codes for 25K delegates | RESOLVED | v1.10 (UUID-only QR) |
| No connection health UI | Officers don't know if writes failed silently | HIGH | Phase 1 |
| Context performance | Every AppContext change re-renders entire tree | HIGH | Phase 1 |
| Realtime subscription scope | Subscribes to entire table, not filtered by event | HIGH | Phase 1 |
| Single-row settings | `system_settings` is single-row JSONB — potential write conflicts | MEDIUM | Phase 2 |
| No audit log | No immutable record of operations | RESOLVED | v1.6/v1.8 |
| Audit log retention | Now automatic: `audit_log_archive` + weekly pg_cron job (Sat 03:00 UTC) archives >180 days; manual clear-by-period retained | RESOLVED | v1.11 |
| No Executive Admin tier | New `executive_admin` role: national-registrar access + financial READ (Reports + Dashboard financials); financial write stays admin/event_admin/finance | RESOLVED | v1.11 |
| Role metadata drift | `db.updateUser` wrote app_users only; now `update_app_user_role` syncs app_users + auth.users metadata atomically | RESOLVED | v1.11 |
| Exposed auth-users view | `v_auth_integrity_check` SELECT revoked from anon/authenticated → service_role only | RESOLVED | v1.11 |
| Orphan RLS-off tables | `public.financials` + `public.event_delegate_codes` dropped (unreferenced, RLS-disabled) | RESOLVED | v1.11 |
| Client-side role enforcement | RLS is fallback, but UI gates are purely client-side | LOW | Phase 2 |
| No TypeScript strict mode | `any` used in several service functions | LOW | Phase 3 |
| Gemini API key in env | Referenced in README but no AI feature implemented | LOW | Phase 4 |
| `getDistinctDelegateDistricts` event-scoped | BadgePrintingModule now uses master `system_settings.districts` instead | RESOLVED | v1.2 |
| PDF blank with html2pdf wrapper | Switched to direct jsPDF.addImage from pre-rendered canvas | RESOLVED | v1.2 |
| SVG QR in html2canvas fails | Switched to canvas PNG via QRCode.toCanvas() | RESOLVED | v1.2 |
| Badge reprint PDF/Print broken | Canvas 2D generation bypasses all DOM layout issues | RESOLVED | v1.2 |
| Small badge fonts & QR | Fonts increased 50-133% per professional print spec; QR enlarged to 30mm on all layouts | RESOLVED | v1.3 |
| Badge missing Type/ID management | Type removed from text area (redundant with footer); ID always last field; extraSmall tier for 55×80mm | RESOLVED | v1.3 |
| Badge no labels on fields | All fields now prefixed: District:, Chapter:, Office:, Rank:, ID: — across canvas, DOM, and all 5 pdf-lib layouts | RESOLVED | v1.3 |
| No CSV file upload | FileReader CSV upload with fuzzy header matching and column toggle mapping UI | RESOLVED | v1.3 |
| Import not event_config-aware | Reads activeEvent.event_config; auto-unchecks Rank/Office/DelegateType if hidden | RESOLVED | v1.3 |
| Dashboard doesn't auto-load on login | window.location.hash = '#/admin' after login triggers instant dashboard render | RESOLVED | v1.3 |
| Opaque badge PDF filenames | Descriptive convention: FGBMFI_Batch-{N}_{District}_{Timestamp}.pdf; showSaveFilePicker API | RESOLVED | v1.3 |
| Cross-event delegate leakage | Removed all `OR event_id IS NULL` from TS queries; 4 RPCs updated (p_event_id); 3-layer defense (hard gate → RPC filter → post-filter); checkInByCode event-scoped; NewDelegatePage event_id set | RESOLVED | v1.4 |
| Dashboard delegates vs arrivals divergence | RPC counts event-scoped delegates; dashboard reconciliation auto-corrects; recentActivity deduplicated via DISTINCT ON | RESOLVED | v1.4 |
| PDF report overflow clip | `onclone` callback + CSS removes `overflow-hidden` on cloned document; inline background-color fallback for html2canvas rendering | RESOLVED | v1.4 |
| Sessions report no session demarcation | Individual records sub-headers now show session name before response type label | RESOLVED | v1.4 |
| Badge download "404 Bucket not found" | Bucket is private; downloads now use authenticated `storage.download()` blob instead of public URL; `resolveBadgeFileName` derives real filename | RESOLVED | v1.5 |
| Storage/batch deletes fail silently | `storage.objects` RLS policies added (sprint16); `deleteBadgeBatch`/`deleteBadgeBatches` remove the real filename + cascade logs; StorageModule reports honest failure counts | RESOLVED | v1.5 |
| Manual auth.users INSERT breaks login | Rewrote `createUser` to use `supabase.auth.signUp()` via isolated client (`persistSession: false`). GoTrue handles all auth internals. Eliminates bcrypt cost mismatches (cost 6→10), missing columns, and schema drift permanently | RESOLVED | v1.6 |
| PDF export clips left side on prose docs | Added `'document'` mode to `exportToPDF`: preserves padding/max-width, skips aggressive table CSS. `.print-mode` / `.pdf-export-mode` split in `index.html` | RESOLVED | v1.6 |
| Scanned + Manual columns summed together | Sessions Report, SessionMinistryPage stats/table/tfoot/CSV now use `_count` only (individual scanned responses). Manual summaries shown as separate cross-validation column, not added to total | RESOLVED | v1.6 |
| Alter call recording missing session attendance | `recordSessionResponse` now performs three-tier cascade: Arrival → Session Attendance → Response. QR path passes `selectedSessionId` to `checkInByCode` for upfront verification | RESOLVED | v1.6 |
| bcrypt cost 6 in auth migration files | All `gen_salt('bf')` replaced with manual cost-10 salt. Recovery SQL deployed. `check_login_account` and `v_auth_integrity_check` now report `bcrypt_cost`. Preventative comments in `supabase_schema.sql` | RESOLVED | v1.6 |
| Login HTTP 500 no diagnostics | `diagnoseLoginFailure` now runs for 500 errors; raw GoTrue error code/details/message appended to visible error. `check_login_account` returns `bcrypt_cost` with recommendation | RESOLVED | v1.6 |
| No pagination — MasterList + reports fetch ALL rows | Dual-mode Master List: per-district independent pagination with 25-row pages, server-side paginated via RPC/fallback. Each district has its own controls | RESOLVED | v1.7 |
| MasterList export only exports current page | `fetchAllDelegatesForExport` paginates through full dataset (500/page). PDF builds hidden full table; CSV exports full array. District name in filename | RESOLVED | v1.7 |
| No CSV data export | Full CSV export with event_config-aware columns (rank/office/type). `fetchAllDelegatesForExport` → `exportToCSV` | RESOLVED | v1.7 |
| District harmonization fails for missing entries | Auto-registration appends any valid abbreviation resolution to `system_settings.districts`. Fuzzy fallback catches whitespace/punctuation variants | RESOLVED | v1.7 |
| `harmonizeDistricts` silent failures | Diagnostic logging: logs official districts, every resolved mapping, and unresolved abbreviations | RESOLVED | v1.7 |
| Scrambled CSV import column misalignment | Comprehensive recovery module: multi-field anomaly detection (confidence scoring), in-place repair (field remapping + auto-harmonization), JSON backup, cascading delete | RESOLVED | v1.7 |
| Delegates sorted by first_name (spouses apart) | Client-side sort in `getPaginatedDelegates`: `last_name → first_name` case-insensitive. Guarantees spouse grouping regardless of RPC server state | RESOLVED | v1.7 |
| Master List spinner hangs on initial All Districts load | Mode-aware loading guard: `!selectedDistrict && !searchTerm ? districtListLoading : loading` | RESOLVED | v1.7 |
| Audit log unbounded + no pagination | AuditLogPage paginated 25/page (count + range) with First/Prev/Next/Last; admin clear-by-date-range via date pickers | RESOLVED | v1.8 |
| Audit log SELECT blocked non-`admin` admins | Policy rewritten to `is_admin_user()`; DELETE policy added; `idx_audit_created_at` index for range deletes | RESOLVED | v1.8 |
| Badge Printing exposed to registrars | Removed from registrar role; now `admin + event_admin` only | RESOLVED | v1.8 |
| No Event Admin tier | New global `event_admin` role: registrar modules + Badge Printing + Master List + Import (bulk) + Financials; `is_event_admin_user()` RLS | RESOLVED | v1.8 |

## v2.0 Evolution

See **`ARCHITECTURE-v2.md`** in the project root for the complete target architecture, module registry, phased roadmap, and scaling strategy.

### Key v2 Architectural Changes
- **Framework:** React + Vite → Next.js 15 (App Router)
- **ORMAuth:** Direct Supabase → Prisma + Supabase Auth
- **UI System:** Tailwind CSS → Tailwind CSS + shadcn/ui
- **Data Fetching:** Manual useEffect → TanStack Query
- **QR Codes:** 4-digit deterministic hash → UUID-based stored QR
- **PDF:** Client-side html2pdf → server-side pdf-lib
- **Database:** 8 tables → 30+ tables

All v1 business logic (event lifecycle, district scoping, deduplication, harmonization) port forward to v2.

## AI Agent Operational Rules

### Before Writing Code
1. Read relevant existing files first
2. Check AGENTS.md for project conventions
3. Verify role required for the operation
4. Confirm event lifecycle guard (`ensureEventActive()`) is applied
5. Confirm district scoping is applied for REGISTRAR role
6. Verify every delegate query uses strict `event_id` scoping (no `OR event_id IS NULL`)
7. Check for existing patterns in similar pages/services

### After Each Session
- Update file headers or this AGENTS.md if architecture decisions change
- Record key decisions, blockers, and next steps

### File Modification Priority
1. **Never modify:** `supabaseClient.ts` (client singleton), `types.ts` (foundational types) — EXCEPT additive field extensions explicitly required by a feature (e.g., `Pledge.pledge_name`, `Event.event_config` widening in v1.5). Document the exception when it occurs.
2. **Prefer modifying:** Page components, `supabaseService.ts` methods, utility functions
3. **Create new files:** Only when a new module/page is required (keep `pages/`, `components/`, `services/` structure)

### Code Style
- TypeScript: explicit types on function params; avoid `any` in new code
- Imports: relative paths within the project
- Error handling: try/catch → `handleSupabaseError()` → user-facing message
- No comments unless explaining non-obvious logic
- Tailwind: utility classes only, no CSS modules or styled-components

### Security Checklist
- [ ] Write guard: `ensureEventActive()` called before DB write
- [ ] District scope: REGISTRAR queries filtered by `user.district`
- [ ] Role check: admin-only operations guarded by `user.role`
- [ ] Event scope: all delegate queries use strict `.eq('event_id', eventId)` — no `event_id IS NULL` bypasses
- [ ] New delegate INSERT includes `event_id: activeEventId`
- [ ] No secrets in code or responses
- [ ] Input validation before Supabase insert/update
- [ ] Supabase RLS policies cover the operation (check `supabase_schema.sql`)
- [ ] User creation: use `db.createUser` (signUp via isolated client) — never manually INSERT into `auth.users`
- [ ] Auth RPCs: never use `gen_salt('bf')` — always use cost-10 manual salt construction
- [ ] New users: verify login works via `check_login_account` + `v_auth_integrity_check` (bcrypt_cost ≥ 10, all flags green)
- [ ] Session attendance: `recordSessionResponse` auto-cascades Arrival + Session Attendance before alter call response
