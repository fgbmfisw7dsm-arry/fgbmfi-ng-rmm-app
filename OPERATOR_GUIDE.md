# FGBMFI EMS — Operator Quick Reference Guide

**For:** Check-in Officers, Registrars, Event Admins, Financial Admins, and Executive Admins  
**Event System:** FGBMFI Nigeria Event Management System (EMS)  
**Version:** 2.0-ready (v1.11)

---

## Getting Started

### Access the System
1. Open your browser and go to: `https://fgbmfi-ng-rmm-app.vercel.app`
2. Log in with your email and password
3. **IMPORTANT:** Select your active event from the dropdown in the top header

### Change Your Own Password (Self-Service)
1. Click the **account avatar** at the top-right (opens the account menu)
2. Choose **"Change Password"**
3. Enter your **current password**, a **new password** (min 6 characters), and confirm
4. Your password updates immediately and you stay signed in — no administrator needed.
   Other sessions on your other devices are signed out automatically for security.

### Connection Status
- **Green dot** = Connected (ready to operate)
- **Yellow dot** = Slow connection (continue, but expect delays)
- **Red dot** = Disconnected (check your data signal — check-ins queued locally)
- If you see **"N pending"** badge, check-ins are queued and will sync automatically

---

## Check-In Operations

### Method 1: Fast Check-in (QR Scanner)
1. Click the **SCAN QR** button (blue button right of the code input)
2. Point camera at the delegate's QR code badge
3. **Camera is selected automatically** — phones use the rear camera; laptops/PCs use the front camera. No manual switching needed.
4. Tap **Torch** if in low light
5. Code auto-detects — delegate is verified instantly
6. If scanning fails: type the delegate's ID or external ID manually

### Method 2: Manual Code Entry
1. Type or paste the QR code (UUID) or delegate/external ID into the input field
2. System auto-submits when a complete ID is entered
3. Green "Verified!" confirmation appears

### Method 3: Database Search
1. Type delegate name or phone number (minimum 2 characters)
2. Matching delegates appear below
3. Click **VERIFY ENTRY** next to the correct delegate
4. After verification: QR code appears for badge printing

### Session-Specific Check-in
- Use the dropdown "Target Verification Scope" to switch between:
  - **Event Arrival (Master Record)** — records first entry
  - **Session Title** — records session-specific attendance

---

## Badge Operations

### Badge Reprint (Delegate forgot badge)
1. After verifying a delegate, click **Reprint Badge** next to their record
2. New QR + backup code generates
3. Click **Print Badge** to send to printer

### Lost Badge Replacement (Security measure)
1. Click **Lost Badge** (amber button) — ONLY for genuinely lost badges
2. Old QR code is instantly invalidated
3. New QR + code generates
4. **Admins and Registrars only**

### Badge Printing (Pre-Event Batch Production — Admins & Event Admins)
- **Badge Status filter** replaces the old Registration filter: pick **All / Badge Printed / Badge Not Printed** (default **Not Printed** — badges print before check-in).
- **"Skip Already Printed"** toggle is ON by default, so generation only picks up unprinted badges; turn **OFF** to force a reprint (e.g. damaged badges).
- **Batches Per Run** (default 1) limits how many PDF sub-batches one click produces — keep 1 for storage-safe, staged production.
- **Production cycle:** Generate → Download → click **Printed** (flips every delegate in the batch to Badge *Printed*) → Delete the batch to free storage → Generate again (only unprinted remain). Each round advances cleanly with no duplicates.
- **Batch Queue** shows each batch as `#N (District)` — e.g. `#7 (South East 1)`, or `(All Districts)`.
- **Clear Badge Printed Flags** (admin, Batches tab) resets every delegate to *Not Printed* for the active event after tests. Batch records are kept.
- **Generated PDF panel** has Download / Open in New Tab / Print + **✕ Close** to clear a preview between operations.

---

## Important Rules

| Rule | Why |
|------|-----|
| **One QR code = one delegate** | Each badge QR is a unique UUID |
| **Delegate ID / external ID are fallbacks** | Use when QR scanning fails |
| **Never share login credentials** | Every action is logged against your account |
| **Report network issues immediately** | Offline queue holds up to 10 retries per check-in |
| **Locked events are read-only** | No changes allowed after event finalization |
| **District registrars see only their district** | Self-service data scoping |
| **Executive Admins can view financials, not edit** | Financial reports + dashboard totals are readable; recording/editing offerings & pledges stays with Admins/Event Admins/Finance |

---

## Financial Operations

### Recording Offerings
1. Go to **Financials** from the sidebar
2. Select session (or leave as General)
3. Enter amount, payer name, and optional remarks
4. Type = **OFFERING** or **PLEDGE_REDEMPTION**
5. Click save

### Recording Pledges
1. In Financials, switch to **Pledges** tab
2. Click **New Pledge**
3. Enter donor details, amount pledged, district
4. Redemptions are tracked against each pledge automatically

---

## Reports

### Available Reports
- **Attendance List** — District-grouped list of verified delegates
- **Attendance Matrix** — Cross-tabulation by rank and office per district
- **Financial Matrix** — Session-by-session financial breakdown
- **Pledge Summary** — Pledged vs redeemed per donor
- **Master List** — Full delegate database (paginated, 25/page)

> **Note (Executive Admin role):** Executive Admins can open **all** report tabs including Financial Matrix and Pledge summary/list, and the Dashboard shows financial totals to them. They cannot record or edit financial entries (that remains Admins / Event Admins / Finance).

### Exporting
- **PDF** — Formatted report (use Print to PDF in browser for best results)
- **CSV** — Raw data export for Excel/Google Sheets analysis
- **25 records per page** — Use pagination controls (First/Prev/Next/Last) at the bottom

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't log in | Check email/password. Contact admin if locked out. |
| No events in dropdown | Admin must create and activate the event first. |
| QR scanner keeps spinning | Move phone closer. Ensure QR code fills ~50% of scan window. Use Torch if dim. The scanner auto-uses the rear camera on phones. |
| "Event Locked" message | Event is finalized. Contact admin to reactivate if needed. |
| Red connection dot | Check your internet. Switch to mobile data if WiFi is unstable. Pending check-ins are queued. |
| "Connection failed" on check-in | Check-in added to offline queue. Will auto-retry in 10 seconds. |
| Search not working | Type at least 2 characters. Check your district scope (registrar role). |
| Delegate already verified | System prevents double-check-in. Search for delegate to confirm. |
| Badge won't print | Ensure printer is connected. Try browser print dialog (Ctrl+P). |

## Keyboard Shortcuts (Power Users)

| Shortcut | Action |
|----------|--------|
| Enter (in search) | Triggers search |
| Tab | Move between fields |
| Ctrl+P | Print (badge/report) |

---

## Support

- **System Admin:** Contact your ICT committee representative
- **Technical Issues:** Email `ict@fgbmfi-nigeria.org.ng`
- **Emergency:** Call ICT hotline during events

---

*Last updated: August 2026 — v1.11 (Executive Admin role, self-service Change Password, automatic front/rear camera selection, security hardening)*
