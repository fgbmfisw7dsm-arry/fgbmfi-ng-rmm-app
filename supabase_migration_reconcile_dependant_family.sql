-- ============================================================================
-- Reconcile Title Variants — DEPENDANT-AWARE NAME KEY (v1.37d) + DISTRICT SCOPING (v1.37e)
-- ----------------------------------------------------------------------------
-- WHY: the reconcile name key `canonical_name_key` stripped only whitespace and
-- hyphen-order, so double titles trapped in the name field
--   (title=Dr, first=(Mrs). Cefort, last=Ige)
--   (title='',  first=Esv Benjamin,    last=Chika)
--   (title=Mr,  first=Amb. John,       last=Usanga)
-- never matched the clean CSV parse (title=Dr, first=Cefort, last=Ige) →
-- reconcile INSERTED a duplicate instead of UPDATING. 30 SW7 duplicate pairs.
--
-- Does a dependant share a name? YES — `Master`/`Mst`/`Miss` denote a
-- dependant (son/daughter) who can legitimately carry the same full name as a
-- parent. So name matching MUST be family-gated: never match/merge a DEP row
-- (master/mst/mstr/miss) with an adult row (Mr/Mrs/professional) of the same
-- name, and never merge Mr vs Mrs (couples).
--
-- v1.37e: name-key and email fallbacks are now DISTRICT-SCOPED (case-insensitive
-- district match) so a single-district portal file (e.g. SW7) never reconciles
-- into a same-name delegate from a different district in the host event.
--
-- FIX (family-prefixed match key, used by index + RPC + dedup):
--   canonical_name_key(fn,ln)  → punctuation+title-stripped, word-sorted name
--   delegate_family_code(...)  → DEP>PRO>M>F>P from title+first+last tokens
--   delegate_match_key(...)    → FAMILY|name_key   (stored in delegates.name_key)
--   re-backfill name_key, rewrite trigger, RPC name fallback uses match key.
--
-- Family resolution (highest precedence first):
--   DEP  dwell markers (master/mst/mstr/miss)   — dependant, NEVER match adults
--   PRO  any professional title present (dr/engr/prof/barr/pastor/rev/evang/
--        esv/pharm/amb/bro/deacon/bishop/arch/chief/alhaji/...) + usages where
--        a pro title appears alongside mr/mrs (e.g. 'Dr (Mrs)' → PRO)
--   M    male honorific (mr)
--   F    female honorific (mrs/ms)
--   P    no title signal
-- Merge compatibility is enforced by the key itself: same family ⇒ same bucket;
-- a DEP row and an adult row produce DIFFERENT buckets and can never collide.
-- ============================================================================

-- Known title tokens (must mirror services/utils.ts KNOWN_TITLES)
-- ---------------------------------------------------------------------------
-- (professional / mr / mrs / ms / dependant sets)

-- ---------------------------------------------------------------------------
-- 1. canonical_name_key: punctuation + title-token stripped, word-sorted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canonical_name_key(fn TEXT, ln TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $f$
  SELECT COALESCE(string_agg(w, ' '), '')
  FROM (
    SELECT w
    FROM regexp_split_to_table(
      regexp_replace(lower(COALESCE(fn,'') || ' ' || COALESCE(ln,'')),
                     '[^a-z0-9]', ' ', 'g'), ' ') AS w
    WHERE length(w) > 0
      AND w NOT IN ('mr','mrs','ms','miss','dr','chief','pastor','rev','engr',
                    'barr','prof','sir','lady','hon','elder','deacon','deaconess',
                    'bishop','apostle','evangelist','ven','snr','bro','sis','prince',
                    'princess','oba','alhaji','alhaja','mallam','hajia',
                    'arc','arch','archt','comrade','evang','evng','pst','eld','sen',
                    'esq','otunba','capt','maj','lt','col','cmdr','adm',
                    'amb','ambassador','master','mst','mstr','esv','pharm','drs','supt')
    ORDER BY w
  ) t;
$f$;

-- ---------------------------------------------------------------------------
-- 2. delegate_family_code: DEP>PRO>M>F>P from title+first+last tokens
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delegate_family_code(p_title TEXT, p_first TEXT, p_last TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $f$
  WITH toks AS (
    SELECT lower(w) AS w
    FROM regexp_split_to_table(
      regexp_replace(lower(COALESCE(p_title,'') || ' ' || COALESCE(p_first,'') || ' ' || COALESCE(p_last,'')),
                     '[^a-z0-9]', ' ', 'g'), ' ') AS w
    WHERE length(w) > 0
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM toks WHERE w IN ('master','mst','mstr','miss')) THEN 'DEP'
    WHEN EXISTS (SELECT 1 FROM toks WHERE w IN (
        'dr','chief','pastor','rev','engr','barr','prof','sir','lady','hon','elder',
        'deacon','deaconess','bishop','apostle','evangelist','ven','snr','bro','sis',
        'prince','princess','oba','alhaji','alhaja','mallam','hajia',
        'arc','arch','archt','comrade','evang','evng','pst','eld','sen','esq','otunba',
        'capt','maj','lt','col','cmdr','adm','amb','ambassador','esv','pharm','drs','supt')) THEN 'PRO'
    WHEN EXISTS (SELECT 1 FROM toks WHERE w = 'mr') THEN 'M'
    WHEN EXISTS (SELECT 1 FROM toks WHERE w IN ('mrs','ms')) THEN 'F'
    ELSE 'P'
  END;
$f$;

-- ---------------------------------------------------------------------------
-- 3. delegate_match_key: FAMILY|name_key  (stored + index + RPC match)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delegate_match_key(p_title TEXT, p_first TEXT, p_last TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $f$
  SELECT delegate_family_code(p_title, p_first, p_last) || '|' || canonical_name_key(p_first, p_last);
$f$;

-- ---------------------------------------------------------------------------
-- 4. Re-backfill delegates.name_key (family-aware) + trigger + index
-- ---------------------------------------------------------------------------
UPDATE delegates SET name_key = delegate_match_key(title, first_name, last_name)
WHERE name_key IS NULL OR name_key = '' OR split_part(name_key, '|', 1) IN ('', 'null');

CREATE OR REPLACE FUNCTION delegates_name_key_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.name_key := delegate_match_key(NEW.title, NEW.first_name, NEW.last_name);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_delegates_name_key ON delegates;
CREATE TRIGGER trg_delegates_name_key
BEFORE INSERT OR UPDATE OF title, first_name, last_name ON delegates
FOR EACH ROW EXECUTE FUNCTION delegates_name_key_trigger();

CREATE INDEX IF NOT EXISTS idx_delegates_event_name_key
  ON delegates(event_id, name_key);

-- ---------------------------------------------------------------------------
-- 5. Rewrite reconcile name fallback to use the family-aware match key.
--    (registration_source stays 'import'; statement_timeout kept.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reconcile_delegate_matches(
  p_delegates JSONB,
  p_event_id UUID,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_item JSONB;
  v_existing_id UUID;
  v_rows_affected INT;
  v_phone_norm TEXT;
  v_email_lower TEXT;
  v_name_key TEXT;
  v_first TEXT;
  v_last TEXT;
  v_district TEXT;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

  PERFORM set_config('statement_timeout', '120000', true);

  IF COALESCE(p_event_id, '00000000-0000-0000-0000-000000000000'::UUID) = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'Reconcile requires a valid target event';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    IF NULLIF(TRIM(v_item->>'first_name'), '') IS NULL AND NULLIF(TRIM(v_item->>'last_name'), '') IS NULL
       AND NULLIF(TRIM(v_item->>'phone'), '') IS NULL AND NULLIF(TRIM(v_item->>'email'), '') IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_phone_norm := normalize_phone_sql(v_item->>'phone');
    v_email_lower := LOWER(TRIM(COALESCE(v_item->>'email', '')));
    v_first := TRIM(COALESCE(v_item->>'first_name', ''));
    v_last := TRIM(COALESCE(v_item->>'last_name', ''));
    v_name_key := delegate_match_key(v_item->>'title', v_first, v_last);

    -- 1) Phone-primary (exact, event-scoped, uses phone_normalized index)
    v_existing_id := NULL;
    IF NULLIF(v_phone_norm, '') IS NOT NULL THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND NULLIF(phone_normalized, '') IS NOT NULL
        AND phone_normalized = v_phone_norm
      LIMIT 1;
    END IF;

    -- 2) Name-key fallback (family-aware, order/title/punctuation-insensitive,
    --    DISTRICT-SCOPED so a portal row never reconciles into a same-name
    --    delegate from a different district).
    v_district := TRIM(COALESCE(v_item->>'district', ''));
    IF v_existing_id IS NULL AND v_name_key <> '|' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND name_key = v_name_key
        AND (v_district = '' OR lower(btrim(coalesce(delegates.district, ''))) = lower(btrim(v_district)))
      LIMIT 1;
    END IF;

    -- 3) Email fallback (only when still unmatched, DISTRICT-SCOPED too)
    IF v_existing_id IS NULL AND v_email_lower <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND NULLIF(TRIM(email), '') IS NOT NULL
        AND LOWER(TRIM(email)) = v_email_lower
        AND (v_district = '' OR lower(btrim(coalesce(delegates.district, ''))) = lower(btrim(v_district)))
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL THEN
      IF p_dry_run THEN
        v_inserted := v_inserted + 1;
        CONTINUE;
      END IF;
      BEGIN
        INSERT INTO delegates (
          title, first_name, last_name, district, chapter,
          phone, email, rank, office, delegate_type,
          qr_hash, event_id, registration_source, external_id
        ) VALUES (
          COALESCE(TRIM(v_item->>'title'), ''),
          v_first,
          v_last,
          TRIM(v_item->>'district'),
          TRIM(v_item->>'chapter'),
          v_phone_norm,
          v_email_lower,
          COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), 'CP'),
          COALESCE(NULLIF(TRIM(v_item->>'office'), ''), 'OTHER'),
          COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), 'Member'),
          COALESCE(v_item->>'qr_hash', gen_random_uuid()::TEXT),
          p_event_id,
          COALESCE(v_item->>'registration_source', 'import'),
          COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), gen_random_uuid()::TEXT)
        );
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_skipped := v_skipped + 1;
      END;
      CONTINUE;
    END IF;

    -- Matched: gap-fill only blank fields (never overwrite non-blank values).
    IF p_dry_run THEN
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    UPDATE delegates SET
      title = CASE WHEN COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '' THEN TRIM(v_item->>'title') ELSE delegates.title END,
      email = CASE WHEN COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND v_email_lower <> '' THEN v_email_lower ELSE delegates.email END,
      district = CASE WHEN COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '' THEN TRIM(v_item->>'district') ELSE delegates.district END,
      chapter = CASE WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '' THEN TRIM(v_item->>'chapter') ELSE delegates.chapter END,
      rank = CASE WHEN COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '' THEN TRIM(v_item->>'rank') ELSE delegates.rank END,
      office = CASE WHEN COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '' THEN TRIM(v_item->>'office') ELSE delegates.office END,
      delegate_type = CASE
        WHEN COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '' THEN TRIM(v_item->>'delegate_type')
        ELSE delegates.delegate_type END,
      phone = CASE
        WHEN COALESCE(NULLIF(TRIM(delegates.phone), ''), '') = '' AND NULLIF(v_phone_norm, '') IS NOT NULL THEN v_phone_norm
        ELSE delegates.phone END
    WHERE delegate_id = v_existing_id
      AND (
        (COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND v_email_lower <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.phone), ''), '') = '' AND NULLIF(v_phone_norm, '') IS NOT NULL)
      );
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected > 0 THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'total', v_inserted + v_updated + v_skipped
  );
END;
$func$;