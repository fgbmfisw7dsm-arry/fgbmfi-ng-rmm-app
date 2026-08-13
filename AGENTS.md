# AGENTS.md — FGBMFI Nigeria EMS AI Operational Context

## Project Overview
- **Name:** FGBMFI Nigeria Events Management System (FGBMFI-EMS)
- **Current Version:** 1.8 (Event Admin Role + Audit Log Pagination & Clear + Role/Module Access Refactor)
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

### Roles (Current — 10)
| Role | Access Scope | Pages |
|------|-------------|-------|
| `national_admin` / `regional_admin` / `district_admin` / `admin` (legacy) | Full access, event management, user management | All |
| `national_registrar` / `regional_registrar` / `district_registrar` / `registrar` (legacy) | District-scoped (data filtered by `user.district`), check-in ops | Dashboard, CheckIn, Session Details, New Delegate, Reports |
| `finance` | Financial operations | Dashboard, Financials, Reports |
| `event_admin` | **Global (unscoped)** — registrar modules + Badge Printing + Master List + Import Data (bulk only) + Financials | Dashboard, CheckIn, Session Details, New Delegate, Reports, Badge Printing, Master List, Import Data, Financials |

**Event Admin (v1.8) — access model:**
- **Inherits all registrar modules** (Dashboard, Check-In, Session Details, New Delegate, Reports) but is **global/unscoped** (no district/region field; `getScopeFilter` returns `{}`).
- **Plus:** Badge Printing, Master List, Import Data (Bulk Delegate Import), Financials.
- **Excluded (admin-only):** Events & Config, User Management, System Setup, Data Management, Storage, Audit Log, and Import Data's *Scrambled Import Recovery* (destructive delete).
- **Badge Printing removed from registrar** — now `admin + event_admin` only.
- Not added to `is_admin_user()` (DB) or `isAdminRole()` (client) — keeps admin-only modules locked; not added to `isRegistrarRole()` (avoids district scoping).
- RLS write grants (via `is_event_admin_user()`): delegates insert/update, checkins insert, session ministry inserts, badge_batches insert/update, badge_print_logs insert, pledges/financial_entries insert/update. Delete is admin-only.

### Role Enforcement
- **Server-side:** RLS policies on Supabase tables (in `supabase_schema.sql`)
- **Client-side:** `user.role` checks in pages (e.g., admin-only buttons for event CRUD)
- **Data scoping:** `user.district` filters delegate/checkin queries for REGISTRAR role; `event_admin` is unscoped
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

### 2. Check-In Codes (4-digit deterministic)
```typescript
const generateCodeFromId = (delegateId: string, eventId: string): string => {
  const salt = delegateId + eventId;
  let hash = 0;
  for (const char of salt) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  return (Math.abs(hash) % 9999 + 1).toString().padStart(4, '0');
};
```
- **Known limitation:** 10,000 possible codes — collisions at scale > 10K delegates
- **v2 fix:** UUID-based QR stored in DB as `delegates.qr_hash`

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
- 5 layouts: `8-up` (90×60mm), `10-up` (80×55mm), `6-up-portrait` (63×95mm), `9-up-portrait` (55×80mm), `8-up-portrait` (63×90mm)
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
- Color-coded delegate type stamp band at bottom (13% height) — same `BAND_COLORS` mapping
- PDF generated client-side via `pdf-lib`; uploaded to `badge-pdfs` bucket with descriptive filename (see §14)
- PDF document metadata set: title "FGBMFI Delegate Badges", subject, creator
- Batch tracking: `badge_batches` + `badge_print_logs` tables with status lifecycle (pending→generating→ready→printed)
- Storage management: `/admin/storage` page for listing and deleting badge PDF files

### 10. Check-in Badge Reprint (Canvas 2D)
- **Canvas-based generation:** badge drawn programmatically on Canvas 2D at 3× scale (714×1020px)
- Produces a single PNG data URL reused by all 4 export modes (Print, PDF, Image, Share)
- 63×90mm portrait default (matching `8-up-portrait` layout)
- Layout: 17% banner header + 70% white body (QR + text) + 13% colored footer band (rebalanced from 17/66/17)
- QR code: 30mm (previously 19mm), generated via `QRCode.toCanvas(width: 400)` for sharp rendering
- **Text sizing (Canvas):** Name 14px bold, Fields 9px bold (District/Chapter/Office/Rank), ID 8px bold
- **Text sizing (DOM):** Name `text-[14px]`, Fields `text-[9px]`, ID `text-[8px]`
- All delegate details are individually labeled lines: District: X, Chapter: X, Office: X (if enabled), Rank: X (if enabled), ID: XXXXXXXX
- Canvas badge respects `showRank`/`showOffice` from `event_config` — fields hidden when disabled for the event
- Line spacing: 18px gap between each text line, 16px gap between QR bottom and name (canvas)
- DOM badge: `marginTop: 1.5mm`, `lineHeight: 1.4`
- Banner fetched with 5s timeout + `encodeURI()` + graceful fallback (empty banner)
- **Never use `dangerouslySetInnerHTML` with SVG for QR** — html2canvas cannot render it
- **Never use `position:absolute` children with percentage heights for capture** — DOM clone collapses

### 11. QR Code Resolution (4-pass checkInByCode)
```typescript
// Pass order in checkInByCode():
1. UUID qr_hash lookup (> 10 chars, scoped to active event via event_id)
2. external_id lookup (> 4 chars, scoped to active event via event_id)
3. delegate_id lookup (> 4 chars, only when lookupId !== code, scoped to active event)
4. 4-digit deterministic code fallback (≤ 10 chars, scans up to 5000 delegates, event-scoped)
```
- All 4 passes now scoped to active event: `.eq('event_id', eventId)` added to each lookup
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
1. **4-digit QR code collisions** at >10K delegates — deterministic hash, only 10K slots
2. **Audit log has no retention policy** — fire-and-forget inserts with admin-only manual clear-by-period; no automated retention/rotation
3. **`getAllDelegates()` + `getAllDataForExport()`** — fetch entire table into memory, will fail at 25K
4. **Context re-render storms** — all context consumers re-render on any state change
5. **No rate limiting** — 50 concurrent officers could exhaust Supabase connection pool
6. **Event data isolation is client-enforced** — RLS policies on `delegates` do not enforce `event_id` scoping; isolation relies on application-level queries, hard gates, post-filters, and scoped RPCs. A bypass of the service layer could leak cross-event data.

## Known Technical Debt

| Item | Description | Priority | Target |
|------|-------------|----------|--------|
| QR code collisions | 4-digit hash → 10K codes for 25K delegates | CRITICAL | Phase 1 |
| No connection health UI | Officers don't know if writes failed silently | HIGH | Phase 1 |
| Context performance | Every AppContext change re-renders entire tree | HIGH | Phase 1 |
| Realtime subscription scope | Subscribes to entire table, not filtered by event | HIGH | Phase 1 |
| Single-row settings | `system_settings` is single-row JSONB — potential write conflicts | MEDIUM | Phase 2 |
| No audit log | No immutable record of operations | RESOLVED | v1.6/v1.8 |
| Audit log retention | No automated retention/rotation; manual admin clear-by-period only | MEDIUM | Phase 2 |
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
