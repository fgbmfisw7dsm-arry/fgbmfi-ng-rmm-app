# AGENTS.md — FGBMFI Nigeria EMS AI Operational Context

## Project Overview
- **Name:** FGBMFI Nigeria Events Management System (FGBMFI-EMS)
- **Current Version:** 1.1 (Regional Meetings — single codebase, national-scope target)
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
| PDF | html2pdf.js (html2canvas + jsPDF) | — |
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
 ├── PostgreSQL (8 tables)
 ├── Auth (email/password)
 ├── Realtime (subscriptions)
 └── Storage (not currently used)
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
│   ├── ConfigurationError.tsx    # Vite + Supabase config validation
│   ├── ErrorBoundary.tsx         # Class-based React error boundary
│   ├── Layout.tsx                # Shell: header, nav, active event selector
│   ├── Logos.tsx                 # FGBMFI SVG logo component
│   └── StatCard.tsx              # Reusable dashboard stat card
├── context/
│   └── AppContext.ts             # Global state: user, activeEvent, events (NOTE: 404 — may be inline in App.tsx)
├── pages/
│   ├── AdminDashboard.tsx        # Real-time dashboard with charts + activity feed
│   ├── CheckInPage.tsx           # QR code entry + delegate search + verification
│   ├── DataModule.tsx            # Data management: clear event, bulk delete, harmonize
│   ├── EventsModule.tsx          # CRUD events + sessions + lifecycle toggle
│   ├── FinancialsPage.tsx        # Offerings, pledges, redemptions (3-tab)
│   ├── ImportModule.tsx          # CSV bulk delegate import
│   ├── LoginPage.tsx             # Supabase Auth email/password login
│   ├── MasterListModule.tsx      # Full delegate list + inline editing + PDF export
│   ├── NewDelegatePage.tsx       # Single delegate registration form
│   ├── ReportsPage.tsx           # Attendance list, matrix, financial report, pledge summary
│   ├── SetupModule.tsx           # System settings: districts, ranks, offices, titles
│   ├── UserManualModule.tsx      # Static help/guide content
│   └── UsersModule.tsx           # CRUD app_users + role assignment
├── services/
│   ├── mockSupabase.ts           # CLEARED — no longer used
│   ├── supabaseClient.ts         # Supabase client singleton + config check
│   ├── supabaseService.ts        # All DB operations: auth, delegates, checkins, finances, settings
│   └── utils.ts                  # formatCurrency, generateCodeFromId, exportToPDF, downloadJSON
├── .gitignore
├── App.tsx                       # Root: ErrorBoundary → Auth init → AppContext → HashRouter → Routes
├── index.html
├── index.tsx                     # Entry point (ReactDOM.createRoot)
├── metadata.json                 # Supabase metadata snapshot
├── package.json
├── supabase_schema.sql           # Full DDL + RLS + RPCs + seed data
├── tsconfig.json
├── types.ts                      # All interfaces, enums (UserRole, FinancialType, etc.)
└── vite.config.ts
```

## Database Design

### Current Tables (8)

| Table | Purpose | Key Columns | RLS |
|-------|---------|------------|-----|
| `events` | Event catalog | event_id, name, start_date, end_date, is_active, region | Authenticated |
| `delegates` | Single delegate repository | delegate_id, first_name, last_name, district, chapter, phone, email, rank, office, title | Authenticated |
| `sessions` | Event sessions (sub-events) | session_id, event_id (FK), title, start_time, end_time | Authenticated |
| `checkins` | Arrival + session attendance | checkin_id, event_id, delegate_id, session_id (nullable), checked_in_at, checked_in_by | Authenticated |
| `pledges` | Financial pledges | id, event_id, donor_name, district, amount_pledged, amount_redeemed | Authenticated |
| `financial_entries` | Offerings + redemptions | id, event_id, type (OFFERING/PLEDGE_REDEMPTION), amount, session_id, payer_name, pledge_id (FK), remarks | Authenticated |
| `app_users` | System user profiles | id (UUID, FK to auth.users), email, role, district | Authenticated |
| `system_settings` | Global config (single row) | id, titles (jsonb), districts (jsonb), ranks (jsonb), offices (jsonb), regions (jsonb) | Authenticated |

### Critical Indexes (Must Exist Before 25K Scale)
```sql
-- Required for search performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_delegates_name_gin ON delegates USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);
CREATE INDEX idx_delegates_phone ON delegates(phone);
CREATE INDEX idx_checkins_event_delegate ON checkins(event_id, delegate_id);
CREATE INDEX idx_checkins_event_session ON checkins(event_id, session_id);
CREATE INDEX idx_financials_event ON financial_entries(event_id);
CREATE INDEX idx_pledges_event ON pledges(event_id);
```

### Supabase RPCs (3)
- `create_app_user(email, password, role, district)` — creates auth.users + app_users row. **MUST set `aud='authenticated'`, `role='authenticated'`, pull `instance_id` from existing user, use `gen_random_uuid()` for `auth.identities.id`.** See `supabase_migration_2026_08_fix_auth_row_integrity.sql` for the reference implementation.
- `delete_app_user(user_id_to_delete)` — deletes from app_users + auth.users
- `reset_user_password(user_id, new_password)` — updates auth.users password. **MUST use `crypt()` and re-stamp confirmation via `COALESCE` to never un-confirm a user.**
- `get_my_profile()` — returns the caller's `app_users` row (used by `auth.diagnoseLoginFailure` for descriptive login error messages)
- `v_auth_integrity_check` (view) — audit view: `SELECT * FROM v_auth_integrity_check WHERE NOT has_email_identity;` identifies broken users

### Auth Row Integrity (2026-08-01 fix)
Historical `create_app_user` rewrites dropped the `aud`, `instance_id`, and `role` columns on `auth.users`, causing `signInWithPassword()` to silently fail with "Invalid login credentials" for every newly-created user. The fix in `supabase_migration_2026_08_fix_auth_row_integrity.sql` is the reference implementation. **Any future rewrite of `create_app_user` must:**
1. Always set `aud='authenticated'` and `role='authenticated'`
2. Pull `instance_id` from a healthy existing user (or omit if none exists)
3. Use `gen_random_uuid()` for `auth.identities.id` (not `new_user_id`) to avoid PK collision with non-email identities
4. Confirm the user via `email_confirmed_at` (NEVER) → `confirmed_at` (NEVER) → token-clear fallback, each in its own EXCEPTION block
5. Use dynamic SQL (`EXECUTE`) for all UPDATE statements on `auth.users` to tolerate GENERATED ALWAYS columns
6. Build the SET clause dynamically using `information_schema.columns` checks (newer GoTrue versions drop `email_change_token`, `email_change`, `recovery_token`, etc.)

## Authentication & Authorization

### Current Auth Flow
1. **Supabase Auth** handles email/password login via `supabase.auth.signInWithPassword()`
2. **Profile sync:** `auth.getOrCreateProfile()` ensures an `app_users` row exists after login
3. **Session persistence:** Supabase handles token refresh; localStorage fallback for `active_event_id`
4. **Logout:** `supabase.auth.signOut()` + `localStorage.clear()`

### Roles (Current — 3)
| Role | Access Scope | Pages |
|------|-------------|-------|
| `admin` | Full access, event management, user management | All |
| `registrar` | District-scoped (data filtered by `user.district`), check-in ops | Dashboard, CheckIn, Financials, MasterList, Reports |
| `finance` | Financial operations | Dashboard, Financials, Reports |

### Role Enforcement
- **Server-side:** RLS policies on Supabase tables (in `supabase_schema.sql`)
- **Client-side:** `user.role` checks in pages (e.g., admin-only buttons for event CRUD)
- **Data scoping:** `user.district` filters delegate/checkin queries for REGISTRAR role
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
#/admin/reports                      — ReportsPage
#/admin/financials                   — FinancialsPage
#/admin/delegates                    — MasterListModule
#/admin/events                       — EventsModule (admin only)
#/admin/users                        — UsersModule (admin only)
#/admin/import                       — ImportModule
#/admin/setup                        — SetupModule
#/admin/data                         — DataModule
#/checkin                            — CheckInPage
#/register-new                       — NewDelegatePage
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
- `exportToPDF()` in `utils.ts`: clones element → wide viewport (1600px) → html2canvas → html2pdf
- Includes scale=2 for clarity, orientation toggle
- **Does not scale to 25K rows** — use summary-only PDF + full CSV export

### 8. Bulk Import
- `importDelegates()` parses 9-column CSV, inserts all rows in single call
- v2 fix: batch inserts of 500 rows with progress feedback

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
enum UserRole { ADMIN = 'admin', REGISTRAR = 'registrar', FINANCE = 'finance' }
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
- Filter all Supabase queries by `event_id` where applicable
- Call `ensureEventActive()` before any database write
- Use `handleSupabaseError()` to translate Supabase errors consistently
- Validate role (`user.role`) before admin operations (event CRUD, user management)
- Scope registrar queries to `user.district`
- Normalize district names before comparison (`norm()`)

### MUST NOT
- Store `VITE_SUPABASE_ANON_KEY` in code (use env vars)
- Trust client-side role checks alone — RLS policies must enforce on server side
- Allow SQL injection (use Supabase SDK parameterized queries, never raw SQL)
- Expose `app_users` password hashes in responses
- Rely on 4-digit QR codes as sole check-in method above 10K delegates

### Known Vulnerabilities
1. **4-digit QR code collisions** at >10K delegates — deterministic hash, only 10K slots
2. **No audit logging** — no tracking of who did what after the fact
3. **`getAllDelegates()` + `getAllDataForExport()`** — fetch entire table into memory, will fail at 25K
4. **Context re-render storms** — all context consumers re-render on any state change
5. **No rate limiting** — 50 concurrent officers could exhaust Supabase connection pool
6. **No pagination** — list views (`MasterListModule`, search results) render all rows in DOM
7. **`getStats()` fetches checkins paginated** — linear scan of all checkins per dashboard load

## Known Technical Debt

| Item | Description | Priority | Target |
|------|-------------|----------|--------|
| QR code collisions | 4-digit hash → 10K codes for 25K delegates | CRITICAL | Phase 1 |
| No pagination | MasterList + reports fetch ALL rows | CRITICAL | Phase 1 |
| `getAllDataForExport()` | Fetches 4 tables entirely client-side | CRITICAL | Phase 1 |
| No connection health UI | Officers don't know if writes failed silently | HIGH | Phase 1 |
| Context performance | Every AppContext change re-renders entire tree | HIGH | Phase 1 |
| Realtime subscription scope | Subscribes to entire table, not filtered by event | HIGH | Phase 1 |
| No CSV data export | PDF-only export doesn't scale to 25K rows | MEDIUM | Phase 1 |
| Single-row settings | `system_settings` is single-row JSONB — potential write conflicts | MEDIUM | Phase 2 |
| No audit log | No immutable record of operations | MEDIUM | Phase 2 |
| Client-side role enforcement | RLS is fallback, but UI gates are purely client-side | LOW | Phase 2 |
| No TypeScript strict mode | `any` used in several service functions | LOW | Phase 3 |
| Gemini API key in env | Referenced in README but no AI feature implemented | LOW | Phase 4 |

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
6. Check for existing patterns in similar pages/services

### After Each Session
- Update file headers or this AGENTS.md if architecture decisions change
- Record key decisions, blockers, and next steps

### File Modification Priority
1. **Never modify:** `supabaseClient.ts` (client singleton), `types.ts` (foundational types)
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
- [ ] No secrets in code or responses
- [ ] Input validation before Supabase insert/update
- [ ] Supabase RLS policies cover the operation (check `supabase_schema.sql`)
- [ ] `create_app_user` RPC: always set `aud='authenticated'`, `role='authenticated'`, pull `instance_id` from existing user, use `gen_random_uuid()` for `auth.identities.id`
- [ ] `auth.users` rows have `aud`, `instance_id`, `role`, `email_confirmed_at`/`confirmed_at`, and a matching `auth.identities` row (verify via `v_auth_integrity_check`)
