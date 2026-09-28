BEGIN;
SET LOCAL statement_timeout = '30s';

-- This script is intentionally separate from the expand migration. Run it only
-- after the read-only preflight has been reviewed and approved. Every update is
-- exact-one-to-one, preserves existing non-null values, and is repeatable.

-- Populate historical owner/location fields only from one active effective
-- roster assignment and one effective location row for the registration user
-- and meal date. SnapshotAt is not fabricated from migration time.
WITH assignment_candidates AS (
  SELECT r.id AS registration_id,
         ela.id AS assignment_id,
         ela.employee_name,
         ela.employee_code,
         loc.id AS location_id,
         loc.short_code,
         loc.display_name,
         loc.address,
         loc.effective_from AS location_effective_from
  FROM registrations AS r
  JOIN employee_location_assignments AS ela
    ON ela.user_id = r.user_id
   AND ela.is_active
   AND ela.effective_from <= r.meal_date
   AND (ela.effective_to IS NULL OR ela.effective_to > r.meal_date)
  JOIN locations AS loc
    ON loc.id = ela.location_id
   AND loc.is_active
   AND loc.effective_from <= r.meal_date
   AND (loc.effective_to IS NULL OR loc.effective_to > r.meal_date)
),
one_assignment_candidate AS (
  SELECT registration_id,
         min(assignment_id) AS assignment_id,
         min(employee_name) AS employee_name,
         min(employee_code) AS employee_code,
         min(location_id) AS location_id,
         min(short_code) AS short_code,
         min(display_name) AS display_name,
         min(address) AS address,
         min(location_effective_from) AS location_effective_from
  FROM assignment_candidates
  GROUP BY registration_id
  HAVING count(*) = 1
)
UPDATE registrations AS r
SET owner_name_snapshot = COALESCE(r.owner_name_snapshot, c.employee_name),
    employee_code_snapshot = COALESCE(r.employee_code_snapshot, c.employee_code),
    service_location_id = COALESCE(r.service_location_id, c.location_id),
    service_location_assignment_id = COALESCE(
      r.service_location_assignment_id,
      c.assignment_id
    ),
    service_location_code = COALESCE(r.service_location_code, c.short_code),
    service_location_name = COALESCE(r.service_location_name, c.display_name),
    service_location_address = COALESCE(r.service_location_address, c.address),
    service_location_effective_from = COALESCE(
      r.service_location_effective_from,
      c.location_effective_from
    )
FROM one_assignment_candidate AS c
WHERE r.id = c.registration_id
  AND (
    r.owner_name_snapshot IS NULL
    OR r.employee_code_snapshot IS NULL
    OR r.service_location_id IS NULL
    OR r.service_location_assignment_id IS NULL
    OR r.service_location_code IS NULL
    OR r.service_location_name IS NULL
    OR r.service_location_address IS NULL
    OR r.service_location_effective_from IS NULL
  );

-- Parse only a documented complete JSON object in legacy content. Plain text
-- content (including local synthetic fixtures) is not evidence and remains
-- untouched. Invalid JSON and duplicate revision numbers are skipped rather
-- than causing fabricated or conflicting history.
DO $menu_backfill$
DECLARE
  legacy_revision RECORD;
  parsed_content JSONB;
  parsed_revision INTEGER;
  parsed_created_by TEXT;
BEGIN
  FOR legacy_revision IN
    SELECT id, daily_menu_id, content
    FROM daily_menu_revisions
    WHERE content ~ '(?s)^\s*\{.*\}\s*$'
  LOOP
    BEGIN
      parsed_content := legacy_revision.content::JSONB;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    IF jsonb_typeof(parsed_content) <> 'object'
       OR NOT (parsed_content ? 'revision')
       OR NOT (parsed_content ? 'mealName')
       OR NOT (parsed_content ? 'description')
       OR NOT (parsed_content ? 'imageUrl')
       OR NOT (parsed_content->>'revision' ~ '^[1-9][0-9]{0,8}$')
       OR jsonb_typeof(parsed_content->'mealName') <> 'string'
       OR btrim(parsed_content->>'mealName') = ''
       OR jsonb_typeof(parsed_content->'description') NOT IN ('null', 'string')
       OR jsonb_typeof(parsed_content->'imageUrl') NOT IN ('null', 'string')
    THEN
      CONTINUE;
    END IF;

    parsed_revision := (parsed_content->>'revision')::INTEGER;
    IF EXISTS (
      SELECT 1
      FROM daily_menu_revisions AS other_revision
      WHERE other_revision.daily_menu_id = legacy_revision.daily_menu_id
        AND other_revision.revision = parsed_revision
        AND other_revision.id <> legacy_revision.id
    ) THEN
      CONTINUE;
    END IF;

    parsed_created_by := NULL;
    IF jsonb_typeof(parsed_content->'createdByUserId') = 'string'
       AND EXISTS (
         SELECT 1
         FROM users AS creator
         WHERE creator.id = parsed_content->>'createdByUserId'
       )
    THEN
      parsed_created_by := parsed_content->>'createdByUserId';
    END IF;

    UPDATE daily_menu_revisions AS dmr
    SET revision = COALESCE(dmr.revision, parsed_revision),
        meal_name = COALESCE(dmr.meal_name, parsed_content->>'mealName'),
        description = COALESCE(dmr.description, NULLIF(parsed_content->>'description', '')),
        image_url = COALESCE(dmr.image_url, NULLIF(parsed_content->>'imageUrl', '')),
        created_by_user_id = COALESCE(dmr.created_by_user_id, parsed_created_by)
    WHERE dmr.id = legacy_revision.id;
  END LOOP;
END;
$menu_backfill$;

-- Map each registration only to a verified immutable revision for the same
-- meal date. A date with multiple verified revisions is ambiguous and remains
-- null. When an existing revision is verified, canonical menu snapshots are
-- repaired from that immutable row, including stale non-null mismatches.
WITH verified_revisions AS (
  SELECT dmr.id AS revision_id,
         dm.date AS meal_date,
         dmr.meal_name,
         dmr.description,
         dmr.image_url
  FROM daily_menu_revisions AS dmr
  JOIN daily_menus AS dm ON dm.id = dmr.daily_menu_id
  WHERE dmr.revision IS NOT NULL
    AND btrim(COALESCE(dmr.meal_name, '')) <> ''
),
unique_revisions_by_date AS (
  SELECT meal_date,
         min(revision_id) AS revision_id,
         min(meal_name) AS meal_name,
         min(description) AS description,
         min(image_url) AS image_url
  FROM verified_revisions
  GROUP BY meal_date
  HAVING count(*) = 1
),
existing_revision_candidates AS (
  SELECT r.id AS registration_id,
         v.revision_id,
         v.meal_name,
         v.description,
         v.image_url
  FROM registrations AS r
  JOIN verified_revisions AS v
    ON v.revision_id = r.menu_revision_id
   AND v.meal_date = r.meal_date
  WHERE r.menu_revision_id IS NOT NULL
),
unassigned_revision_candidates AS (
  SELECT r.id AS registration_id,
         v.revision_id,
         v.meal_name,
         v.description,
         v.image_url
  FROM registrations AS r
  JOIN unique_revisions_by_date AS v ON v.meal_date = r.meal_date
  WHERE r.menu_revision_id IS NULL
),
registration_revision_candidates AS (
  SELECT * FROM existing_revision_candidates
  UNION ALL
  SELECT * FROM unassigned_revision_candidates
)
UPDATE registrations AS r
SET menu_revision_id = COALESCE(r.menu_revision_id, c.revision_id),
    menu_name_snapshot = c.meal_name,
    menu_description_snapshot = c.description,
    menu_image_snapshot = c.image_url
FROM registration_revision_candidates AS c
WHERE r.id = c.registration_id
  AND (
    r.menu_revision_id IS NULL
    OR r.menu_name_snapshot IS DISTINCT FROM c.meal_name
    OR r.menu_description_snapshot IS DISTINCT FROM c.description
    OR r.menu_image_snapshot IS DISTINCT FROM c.image_url
  );

-- Map a legacy no-show penalty only when its reason has the exact documented
-- eligible legacy penalties. Invalid/missing/duplicate candidates remain null.
WITH legacy_candidates AS (
  SELECT p.id AS penalty_id,
         r.id AS registration_id,
         r.meal_date
  FROM penalties AS p
  JOIN LATERAL regexp_match(
    p.reason,
    '^NO_SHOW_PENALTY_([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9a-fA-F-]{36})$'
  ) AS legacy_identity(match_parts) ON TRUE
  JOIN registrations AS r
    ON r.id = legacy_identity.match_parts[2]
   AND r.user_id = p.user_id
   AND r.meal_date::text = legacy_identity.match_parts[1]
  WHERE p.registration_id IS NULL
    AND p.meal_date IS NULL
),
unique_penalty_matches AS (
  SELECT penalty_id,
         min(registration_id) AS registration_id,
         min(meal_date) AS meal_date
  FROM legacy_candidates
  GROUP BY penalty_id
  HAVING count(*) = 1
),
registration_match_counts AS (
  SELECT registration_id, count(*) AS match_count
  FROM unique_penalty_matches
  GROUP BY registration_id
),
one_penalty_per_registration AS (
  SELECT m.penalty_id,
         m.registration_id,
         m.meal_date
  FROM unique_penalty_matches AS m
  JOIN registration_match_counts AS c
    ON c.registration_id = m.registration_id
   AND c.match_count = 1
)
UPDATE penalties AS p
SET registration_id = m.registration_id,
    meal_date = m.meal_date
FROM one_penalty_per_registration AS m
WHERE p.id = m.penalty_id
  AND p.registration_id IS NULL
  AND p.meal_date IS NULL;

COMMIT;
