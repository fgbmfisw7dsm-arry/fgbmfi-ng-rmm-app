# FGBMFI EMS — Operator Quick Reference Guide

**For:** Check-in Officers, Registrars, and Financial Admins  
**Event System:** FGBMFI Nigeria Event Management System (EMS)  
**Version:** 2.0-ready

---

## Getting Started

### Access the System
1. Open your browser and go to: `https://fgbmfi-ng-rmm-app.vercel.app`
2. Log in with your email and password
3. **IMPORTANT:** Select your active event from the dropdown in the top header

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
3. Tap **Torch** if in low light
4. Code auto-detects — delegate is verified instantly
5. If scanning fails: enter the 4-digit backup code printed on the badge manually

### Method 2: Manual Code Entry
1. Type or paste the QR code (36-char UUID) or 4-digit code into the input field
2. System auto-submits when 4 digits or full UUID is entered
3. Green "Verified!" confirmation appears

### Method 3: Database Search
1. Type delegate name or phone number (minimum 2 characters)
2. Matching delegates appear below
3. Click **VERIFY ENTRY** next to the correct delegate
4. After verification: QR code and 4-digit code appear for badge printing

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

---

## Important Rules

| Rule | Why |
|------|-----|
| **One QR code = one delegate** | Each badge is unique |
| **4-digit code is a backup** | Use only when QR scanning fails |
| **Never share login credentials** | Every action is logged against your account |
| **Report network issues immediately** | Offline queue holds up to 10 retries per check-in |
| **Locked events are read-only** | Check-ins stop when event is finalized |
| **Locked events are read-only** | No changes allowed after event finalization |
| **District registrars see only their district** | Self-service data scoping |

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
- **Master List** — Full delegate database (paginated, 50/page)

### Exporting
- **PDF** — Formatted report (use Print to PDF in browser for best results)
- **CSV** — Raw data export for Excel/Google Sheets analysis
- **50 records per page** — Use pagination controls (First/Prev/Next/Last) at the bottom

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't log in | Check email/password. Contact admin if locked out. |
| No events in dropdown | Admin must create and activate the event first. |
| QR scanner keeps spinning | Move phone closer. Ensure QR code fills ~50% of scan window. Use Torch if dim. |
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

*Last updated: July 2026 — Sprint 5*
