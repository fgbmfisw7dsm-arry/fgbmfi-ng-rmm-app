# Auth Issue - Session Handoff (2026-08-01)

## Current Status

The user is taking a break. The `test_reg@fgbmfi.ng` user creation works (atomic `create_app_user` deployed and self-test passed) but login still fails with:

```
Authentication service returned an unexpected response. The user account may be incomplete.
(name=Error, code=unknown, details=none, type=object, ctor=Error, stringified=Error: {})
```

## Critical Clue

`stringified=Error: {}` means the original error's `message` is the literal string `'{}'`. This is NOT a generic empty error — it's a specific JSON-string message, likely from a Supabase `AuthRetryableFetchError` whose underlying fetch error stringified to `'{}'`.

## What's Been Pushed (commits on origin/main)

1. **868577f** — Complete auth row integrity fix migration + initial diagnostic logging
2. **0327c01** — Enhanced diagnostic with `stringified=`, `ctor=`, `type=` in the fallback message
3. **46eaf23** — Hardened `getOrCreateProfile` to handle stringified/array JSON responses + new diagnostic SQL files
4. **88aae38** — Wrapped `get_my_profile` RPC call in its own try/catch to capture thrown errors

## When the User Returns

### Step 1: Verify Vercel has the latest build
The deployed bundle hash should contain the new logging. The user can verify by:
- Opening DevTools console
- Trying to log in with `test_reg@fgbmfi.ng`
- Looking for these specific log lines (in order):
  - `[auth.login] Step 1: signInWithPassword for test_reg@fgbmfi.ng`
  - `[auth.login] Step 3: getOrCreateProfile`
  - `[auth.getOrCreateProfile] Step A: get_my_profile for authId=...`
  - `[auth.getOrCreateProfile] Step A result: { profile, profileType, isArray, hasError, errorMsg, errorCode, errorFull }`
  - Either `Step A rpc THREW: ...` (if RPC threw) or Step B/C/D continuation

### Step 2: Capture the console output
The user should copy the ENTIRE console output, not just the error toast. The most useful lines are:
- The `Step A result:` log (shows the raw profile data, type, and any RPC error)
- Any `Step A rpc THREW:` log (shows the full thrown error)
- The `[auth.login] FATAL:` log (shows all diagnostic fields)
- The `parsedProfile` log if it parsed a stringified JSON

### Step 3: Most likely root causes to investigate based on console output

| Console output | Root cause | Fix |
|---|---|---|
| `Step A rpc THREW: AuthRetryableFetchError {...}` with empty body | Network/fetch failure to Supabase | Check CORS, network, or Supabase project status |
| `Step A result: { profile: {...object...}, hasError: false }` but login still fails | Profile is valid but something later in the flow throws | Look for issue AFTER `getOrCreateProfile` returns |
| `Step A result: { profile: null, hasError: false }` | `get_my_profile` returned no row (auth.uid() is null or RLS issue) | Run `supabase_fix_get_my_profile.sql` |
| `Step A result: { profile: "{}", hasError: false }` then parsing fails | `get_my_profile` returned `'{}'` literally | Run `supabase_fix_get_my_profile.sql` to fix the RPC |

### Files available in the project

| File | Purpose |
|---|---|
| `supabase_migration_2026_08_fix_auth_row_integrity.sql` | Main migration (atomic create_app_user, repair, backfill, self-test) |
| `supabase_fix_get_my_profile.sql` | Re-creates get_my_profile with to_jsonb, explicit columns, grants |
| `supabase_quick_auth_state.sql` | Quick diagnostic for current auth state |
| `supabase_diagnostic_full_auth_state.sql` | Comprehensive 11-section auth state diagnostic |
| `supabase_verify_all_users.sql` | All-users integrity check |
| `supabase_repair_n_reg_aggressive.sql` | One-shot repair for n_reg@fgbmfi.ng |
| `supabase_repair_test_reg_aggressive.sql` | One-shot repair for test_reg@fgbmfi.ng |
| `supabase_repair_stubborn_user.sql` | Generic one-shot repair template |

## What I Already Tried

1. Made `create_app_user` atomic (rollback on any failure) — works
2. Added role sanitization in `create_app_user` — works
3. Added self-test in migration — confirms function works
4. Backfilled missing identities for legacy users — 4 of 5 fixed (only n_reg still has identity issues)
5. Made `getOrCreateProfile` handle stringified/array JSON responses
6. Wrapped `get_my_profile` call in try/catch
7. Added detailed logging at every step of the login flow

## What I Haven't Tried Yet

1. **Run `supabase_fix_get_my_profile.sql`** — this rebuilds the function to use `to_jsonb` and explicit columns, which should fix any stringification issues at the source
2. **Check the Supabase project's GoTrue version** — if it's an older version, the `RETURNS JSON` behavior may differ
3. **Check for custom GoTrue config** — the user's Supabase project may have custom JWT settings that affect authentication
4. **Try `signInWithPassword` with a different email format** — maybe the user needs to use a different case (e.g., `Test_Reg@fgbmfi.ng` vs `test_reg@fgbmfi.ng`)

## Quick Recovery Plan

When the user returns, ask them to:
1. Open DevTools console (clear it first)
2. Try to log in with `test_reg@fgbmfi.ng`
3. Copy the ENTIRE console output
4. Share it with me

The console output will tell us exactly what's happening. From there, I can apply a targeted fix.
