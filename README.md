<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FGBMFI Nigeria — Regional Events Management System (EMS)

Event management platform for FGBMFI Nigeria conventions, regional council meetings (RCM),
district conferences, leadership retreats, trainings, and special events.

- **Stack:** React 19 + TypeScript + Vite + Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Deployment:** Vercel (SPA, hash-based routing)
- **Live Site:** `https://fgbmfi-ng-rmm-app.vercel.app`
- **Version:** 1.11

## Feature Highlights

- **Check-In:** QR scanning with **automatic camera selection** (rear camera on phones/tablets, front camera on PCs/laptops), UUID-only badge QR codes, 3-pass delegate resolution, duplicate protection, and online badge reprint (print / PDF / image / share).
- **Delegate Management:** Per-district paginated Master List, full-dataset PDF/CSV export, CSV bulk import with scrambled-import recovery, and district harmonization.
- **Financials:** Offerings, pledges and redemptions with per-event pledge categories, payment modes, session grouping, and PDF/CSV exports.
- **Reports Center:** Attendance list/matrix, financial matrix, pledge summary, sessions (altar-call FT/SLV/MI/HGB + voice distribution) — all exportable.
- **Badge Printing:** 5 professional layouts generated client-side via pdf-lib with UUID QR codes and private storage bucket.
- **Roles (11):** National/Regional/District/Executive Admin, National/Regional/District/Legacy Registrar, Finance, and Event Admin.
  - **Executive Admin** = national-registrar access **+ financial visibility** (all report tabs incl. financial/pledge data and Dashboard financials; read-only on financial entries).
- **Security:** Full Supabase hardening (RPC privilege lockdown, `check_login_account` service-role-only, sealed auth-users view, RLS fixes, orphan-table cleanup), admin-guarded RPCs, self-service **Change Password** for all roles, and automated **audit-log archiving** via pg_cron.
- **Audit Log:** Immutable record with pagination, admin clear-by-period, and automatic 180-day archive.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set env vars in `.env.local`:
   - `VITE_SUPABASE_URL` — Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — Supabase anon/public key
3. Run the app:
   `npm run dev`

## Documentation

- `AGENTS.md` — AI agent operational context, architecture, roles, and security constraints
- `OPERATOR_GUIDE.md` — quick reference for officers and registrars
- `ARCHITECTURE-v2.md` — v2 roadmap (Next.js 15, Prisma, TanStack Query)
- In-app **Operations Manual + Volunteer Training Guide**: `#/help` (exportable to PDF)