# Runbook — Zero-Tolerance Delegate Deduplication (Sprint 21)

Operational companion to the Sprint 21 duplicate-prevention fix.
The goal: **one person = one delegate row** per event, enforced by the
database, while preserving all attendance/history when existing duplicates
are merged.

## What this changes

- **Identity model** — a person is identified by
  `(event_id, title_key, name_first_key, name_last_key, phone_normalized)`:
  - `phone_normalized` = canonical `0XXXXXXXXXX` (digits-only; `+234…` /
    `00 234…` / `234…` / `803…` all normalize to `0803…`).
  - `title_key` / `name keys` = `UPPER`, whitespace-collapsed, punctuation-stripped
    (so `Mr.` == `mr` == `MR`).
  - **TITLE is part of the identity** — `Mr A` and `Mrs A` sharing the same
    phone + email are TWO different delegates and are never merged.
  - Email is used as the identifier only when the incoming phone is blank.
- **DB backstop** — `UNIQUE INDEX idx_delegates_same_person` hard-rejects any
  insert that would create the same person twice (applies where a phone exists).
  The import merge RPC handles a late `unique_violation` gracefully (skips/merges)
  instead of aborting the batch.
- **Merge over delete** — the cleanup merges each duplicate cluster into the
  most-complete record and re-parents `checkins` / `session_responses` /
  `badge_print_logs` to the survivor. Nothing is silently lost.

## Files

| Step | File | Purpose |
|------|------|---------|
| A | `supabase_migration_sprint21_dedup_schema.sql` | schema/columns/trigger, backfill, RPC rewrite |
| B | `supabase_migration_sprint21_dedup_cleanup.sql` | backup, merge existing dups, install unique index |

Both are idempotent and safe to re-run (B rebuilds its work tables each run).

## Order of operations

> Run ONLY Step 1 first, then Step 2. **Never create the unique index before
> Step 2** — it fails while duplicate rows exist.

### Step 1 — Schema migration (A)

Supabase Dashboard → **SQL Editor** → paste the full contents of
`supabase_migration_sprint21_dedup_schema.sql` → **Run**.

What happens:
- Adds `phone_normalized`, `title_key`, `name_first_key`, `name_last_key`.
- Adds `normalize_phone_sql()` / `normalize_name_key()` + the
  `trg_delegates_identity_norm` trigger.
- **Backfills all existing rows**: canonicalizes stored phones, sets empty
  titles to `Mr`, recomputes the identity columns in one pass.
- Rewrites `import_delegates_batch_merge` to match on the identity
  (phone-primary / email-fallback) and to survive a `unique_violation`.

Sanity check after this step:

```sql
-- phones should now all be canonical 0XXXXXXXXXX (no prefix '234', '8', '+')
SELECT count(*) AS non_canonical
FROM delegates
WHERE phone IS NOT NULL AND phone <> normalize_phone_sql(phone);
```

Expected: `0`.

### Step 2 — Cleanup + backstop (B)

Paste `supabase_migration_sprint21_dedup_cleanup.sql` → **Run**.

What happens:
1. Computes duplicate clusters by identity (via `vdedup_ranked` /
   `vdedup_pairs` views).
2. Backs up every duplicate row + its attendance/history rows into
   `delegates_dedup_backup` and `delegates_dedup_fk_backup`.
3. `merge_delegate_duplicates()`:
   - keeps the most-complete row per cluster,
   - re-homes `checkins`, `session_responses`, `badge_print_logs` to the survivor,
   - deletes rows that would conflict with rows the survivor already owns,
   - deletes the surplus duplicate records.
4. Creates `UNIQUE INDEX idx_delegates_same_person` (only safe now that dups
   are gone).
5. Prints the merge result and runs a verification query.

Sample healthy result:

```
survivors | merged_delegates | rehomed_rows | removed_conflicting
  151     | 159              | 10           | 7
```

## Verification

Run after Step 2 (also the last statement in the cleanup file):

```sql
-- MUST return 0 rows
SELECT event_id, title_key, name_first_key, name_last_key,
       COALESCE(phone_normalized, '') AS phone,
       count(*) AS copies
FROM delegates
WHERE NULLIF(phone_normalized, '') IS NOT NULL
GROUP BY 1, 2, 3, 4, 5
HAVING count(*) > 1;
```

Optional — preview duplicates WITHOUT mutating (run before Step 2 if you want
a dry count first):

```sql
SELECT count(*) AS clusters, sum(c.copies - 1) AS removable
FROM (
  SELECT COALESCE(phone_normalized, 'EMAIL:' || lower(trim(coalesce(email, '')))) AS k,
         count(*) AS copies
  FROM delegates
  WHERE NULLIF(phone_normalized, '') IS NOT NULL
     OR NULLIF(lower(trim(coalesce(email, ''))), '') IS NOT NULL
  GROUP BY event_id, title_key, name_first_key, name_last_key, k
  HAVING count(*) > 1
) c;
```

## Re-importing the file that caused duplicates

After Step 1, the merge RPC matches on the canonical identity, so re-importing
an old roster (e.g. `Delegates export.csv`, `NC1 Registration File.csv`) will:

- **merge** the rows into the existing records,
- gap-fill any empty fields,
- never create a second row for the same person.

## Rollback / restore

Backup artifacts are left behind deliberately:

| Table | Contents |
|-------|----------|
| `delegates_dedup_backup` | every deleted duplicate delegate row |
| `delegates_dedup_fk_backup` | the deleted rows' checkins / session responses / badge log rows (JSON payloads) |

To restore a merged duplicate (rarely needed):

1. `INSERT INTO delegates SELECT * FROM delegates_dedup_backup WHERE delegate_id = '<dup_id>';`
2. Re-insert its attendance rows from `delegates_dedup_fk_backup` (`payload` →
   matching table; the FK backup rows carry their own ids).

To fully undo the Sprint 21 DB changes (not recommended once verified):

```sql
DROP INDEX IF EXISTS idx_delegates_same_person;
DROP TRIGGER IF EXISTS trg_delegates_identity_norm ON delegates;
ALTER TABLE delegates
  DROP COLUMN IF EXISTS phone_normalized,
  DROP COLUMN IF EXISTS title_key,
  DROP COLUMN IF EXISTS name_first_key,
  DROP COLUMN IF EXISTS name_last_key;
DROP FUNCTION IF EXISTS import_delegates_batch_merge(p_delegates JSONB, p_event_id UUID);
DROP FUNCTION IF EXISTS normalize_phone_sql(TEXT);
DROP FUNCTION IF EXISTS normalize_name_key(TEXT);
DROP FUNCTION IF EXISTS delegates_identity_norm_trigger();
```

> The client-side merge in Data Module (`deduplicateDelegates`) follows the
> same identity model for future cleanup runs.