BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

-- Report label only: no-show eligibility begins at server time 13:30 in
-- Asia/Ho_Chi_Minh. This preflight never marks rows no-show.
-- Rollout scope is conservative and explicit: every non-CANCELLED row and
-- every CANCELLED row on or after the current business date is operational.
-- Only CANCELLED rows before the business date are legacy history and may
-- retain nullable snapshots. The status result set below still reports every
-- row for audit visibility.
WITH
rollout_business_date AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS business_date
),
rollout_registration_scope AS (
  SELECT r.id
  FROM registrations AS r
  CROSS JOIN rollout_business_date AS d
  WHERE r.status <> 'CANCELLED'
     OR r.meal_date >= d.business_date
),
registration_snapshot_incomplete_affected AS (
  SELECT r.id
  FROM registrations AS r
  JOIN rollout_registration_scope AS scope ON scope.id = r.id
  WHERE (
      r.registered_at IS NULL
      OR r.menu_revision_id IS NULL
      OR r.menu_name_snapshot IS NULL
      OR r.owner_name_snapshot IS NULL
      OR r.employee_code_snapshot IS NULL
      OR r.service_location_id IS NULL
      OR r.service_location_assignment_id IS NULL
      OR r.service_location_code IS NULL
      OR r.service_location_name IS NULL
      OR r.service_location_address IS NULL
      OR r.service_location_effective_from IS NULL
      OR r.service_location_snapshot_at IS NULL
      OR (r.status = 'NO_SHOW' AND r.no_show_at IS NULL)
    )
),
registration_snapshot_incomplete_summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(
           SELECT id
           FROM registration_snapshot_incomplete_affected
           ORDER BY id
           LIMIT 20
         )::text[] AS sample_ids
  FROM registration_snapshot_incomplete_affected
),
registration_serving_mismatch_affected AS (
  SELECT r.id
  FROM registrations AS r
  LEFT JOIN meal_servings AS ms ON ms.registration_id = r.id
  WHERE (r.status = 'SERVED' AND ms.id IS NULL)
     OR (r.status IN ('NO_SHOW', 'CANCELLED') AND ms.id IS NOT NULL)
),
registration_serving_mismatch_summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(
           SELECT id
           FROM registration_serving_mismatch_affected
           ORDER BY id
           LIMIT 20
         )::text[] AS sample_ids
  FROM registration_serving_mismatch_affected
),
roster_assignment_ambiguous_affected AS (
  SELECT r.id
  FROM registrations AS r
  JOIN rollout_registration_scope AS scope ON scope.id = r.id
  LEFT JOIN employee_location_assignments AS ela
    ON ela.user_id = r.user_id
   AND ela.is_active
   AND ela.effective_from <= r.meal_date
   AND (ela.effective_to IS NULL OR ela.effective_to > r.meal_date)
  LEFT JOIN locations AS loc
    ON loc.id = ela.location_id
   AND loc.is_active
   AND loc.effective_from <= r.meal_date
   AND (loc.effective_to IS NULL OR loc.effective_to > r.meal_date)
  GROUP BY r.id
  HAVING count(ela.id) <> 1
      OR count(loc.id) <> 1
),
roster_assignment_ambiguous_summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(
           SELECT id
           FROM roster_assignment_ambiguous_affected
           ORDER BY id
           LIMIT 20
         )::text[] AS sample_ids
  FROM roster_assignment_ambiguous_affected
),
menu_revision_incomplete_affected AS (
  SELECT r.id
  FROM registrations AS r
  JOIN rollout_registration_scope AS scope ON scope.id = r.id
  LEFT JOIN daily_menu_revisions AS dmr ON dmr.id = r.menu_revision_id
  LEFT JOIN daily_menus AS dm ON dm.id = dmr.daily_menu_id
  WHERE dmr.id IS NULL
     OR dmr.revision IS NULL
     OR dmr.meal_name IS NULL
     OR dm.id IS NULL
     OR dm.date <> r.meal_date
),
menu_revision_incomplete_summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(
           SELECT id
           FROM menu_revision_incomplete_affected
           ORDER BY id
           LIMIT 20
         )::text[] AS sample_ids
  FROM menu_revision_incomplete_affected
),
legacy_penalty_mapping AS (
  SELECT p.id,
         count(r.id)::int AS registration_match_count
  FROM penalties AS p
  LEFT JOIN LATERAL regexp_match(
    p.reason,
    '^NO_SHOW_PENALTY_([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9a-fA-F-]{36})$'
) AS legacy_identity(match_parts) ON TRUE
  LEFT JOIN registrations AS r
    ON legacy_identity.match_parts IS NOT NULL
   AND r.id = legacy_identity.match_parts[2]
   AND r.user_id = p.user_id
   AND r.meal_date::text = legacy_identity.match_parts[1]
  WHERE p.registration_id IS NULL
  GROUP BY p.id
),
penalty_registration_mapping_ambiguous_affected AS (
  SELECT id
  FROM legacy_penalty_mapping
  WHERE registration_match_count <> 1
),
penalty_registration_mapping_ambiguous_summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(
           SELECT id
           FROM penalty_registration_mapping_ambiguous_affected
           ORDER BY id
           LIMIT 20
         )::text[] AS sample_ids
  FROM penalty_registration_mapping_ambiguous_affected
),
legacy_penalty_candidates AS (
  SELECT p.id AS penalty_id,
         r.id AS registration_id
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
),
duplicate_penalty_registrations AS (
  SELECT registration_id
  FROM legacy_penalty_candidates
  GROUP BY registration_id
  HAVING count(*) > 1
),
penalty_registration_duplicate_candidate_affected AS (
  SELECT c.penalty_id AS id
  FROM legacy_penalty_candidates AS c
  JOIN duplicate_penalty_registrations AS d
    ON d.registration_id = c.registration_id
),
penalty_registration_duplicate_candidate_summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(
           SELECT id
           FROM penalty_registration_duplicate_candidate_affected
           ORDER BY id
           LIMIT 20
         )::text[] AS sample_ids
  FROM penalty_registration_duplicate_candidate_affected
),
future_active_snapshot_incomplete_affected AS (
  SELECT r.id
  FROM registrations AS r
  LEFT JOIN daily_menu_revisions AS dmr
    ON dmr.id = r.menu_revision_id
  LEFT JOIN daily_menus AS dm
    ON dm.id = dmr.daily_menu_id
  LEFT JOIN employee_location_assignments AS ela
    ON ela.id = r.service_location_assignment_id
   AND ela.user_id = r.user_id
  LEFT JOIN locations AS loc
    ON loc.id = r.service_location_id
  WHERE r.status = 'ACTIVE'
    AND r.meal_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    AND (
      r.registered_at IS NULL
      OR r.menu_revision_id IS NULL
      OR btrim(COALESCE(r.menu_name_snapshot, '')) = ''
      OR r.owner_name_snapshot IS NULL
      OR btrim(COALESCE(r.owner_name_snapshot, '')) = ''
      OR r.employee_code_snapshot IS NULL
      OR btrim(COALESCE(r.employee_code_snapshot, '')) = ''
      OR r.service_location_id IS NULL
      OR r.service_location_assignment_id IS NULL
      OR btrim(COALESCE(r.service_location_code, '')) = ''
      OR btrim(COALESCE(r.service_location_name, '')) = ''
      OR btrim(COALESCE(r.service_location_address, '')) = ''
      OR r.service_location_effective_from IS NULL
      OR NOT isfinite(r.service_location_effective_from)
      OR r.service_location_snapshot_at IS NULL
      OR NOT isfinite(r.service_location_snapshot_at)
      OR dmr.id IS NULL
      OR dmr.revision IS NULL
      OR btrim(COALESCE(dmr.meal_name, '')) = ''
      OR dm.id IS NULL
      OR dm.date <> r.meal_date
      OR r.menu_name_snapshot <> dmr.meal_name
      OR r.menu_description_snapshot IS DISTINCT FROM dmr.description
      OR r.menu_image_snapshot IS DISTINCT FROM dmr.image_url
      OR ela.id IS NULL
      OR NOT ela.is_active
      OR ela.user_id <> r.user_id
      OR ela.location_id <> r.service_location_id
      OR ela.effective_from > r.meal_date
      OR (ela.effective_to IS NOT NULL AND ela.effective_to <= r.meal_date)
      OR r.service_location_effective_from <> ela.effective_from
      OR btrim(COALESCE(ela.service_location_code, '')) <>
         btrim(COALESCE(r.service_location_code, ''))
      OR loc.id IS NULL
      OR NOT loc.is_active
      OR loc.effective_from > r.meal_date
      OR (loc.effective_to IS NOT NULL AND loc.effective_to <= r.meal_date)
      OR loc.short_code <> r.service_location_code
    )
),
future_active_snapshot_incomplete_summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(
           SELECT id
           FROM future_active_snapshot_incomplete_affected
           ORDER BY id
           LIMIT 20
         )::text[] AS sample_ids
  FROM future_active_snapshot_incomplete_affected
)
SELECT check_name, affected_count, sample_ids
FROM (
  SELECT 1 AS report_order,
         'registration_snapshot_incomplete' AS check_name,
         affected_count,
         sample_ids
  FROM registration_snapshot_incomplete_summary
  UNION ALL
  SELECT 2,
         'registration_serving_mismatch',
         affected_count,
         sample_ids
  FROM registration_serving_mismatch_summary
  UNION ALL
  SELECT 3,
         'roster_assignment_ambiguous',
         affected_count,
         sample_ids
  FROM roster_assignment_ambiguous_summary
  UNION ALL
  SELECT 4,
         'menu_revision_incomplete',
         affected_count,
         sample_ids
  FROM menu_revision_incomplete_summary
  UNION ALL
  SELECT 5,
         'penalty_registration_mapping_ambiguous',
         affected_count,
         sample_ids
  FROM penalty_registration_mapping_ambiguous_summary
  UNION ALL
  SELECT 6,
         'penalty_registration_duplicate_candidate',
         affected_count,
         sample_ids
  FROM penalty_registration_duplicate_candidate_summary
  UNION ALL
  SELECT 7,
         'future_active_snapshot_incomplete',
         affected_count,
         sample_ids
  FROM future_active_snapshot_incomplete_summary
) AS report
ORDER BY report_order;

SELECT statuses.registration_status,
       count(r.id)::int AS row_count
FROM (
  VALUES ('ACTIVE'), ('CANCELLED'), ('SERVED'), ('NO_SHOW')
) AS statuses(registration_status)
LEFT JOIN registrations AS r
  ON r.status::text = statuses.registration_status
GROUP BY statuses.registration_status
ORDER BY CASE statuses.registration_status
  WHEN 'ACTIVE' THEN 1
  WHEN 'CANCELLED' THEN 2
  WHEN 'SERVED' THEN 3
  WHEN 'NO_SHOW' THEN 4
END;

COMMIT;
