#!/usr/bin/env bash
set -Eeuo pipefail

readonly MIGRATION_NAME='20260928000000_phase0_domain_correctness'
readonly GATE_WORKDIR="${GATE_WORKDIR:-/app}"
readonly MIGRATION_SQL_DIR="${MIGRATION_SQL_DIR:-/app/infra/migrations/sql}"
readonly GATE_LOG_DIR="${GATE_LOG_DIR:-/tmp/imeal-migration-gate}"

fail() {
  printf 'migration_gate=failed check=%s\n' "$1" >&2
  exit 1
}

require_value() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "$value" ]] || fail "missing_${name}"
}

validate_token() {
  local name="$1"
  local value="${!name}"
  case "$value" in
    *[!A-Za-z0-9._:/-]*) fail "invalid_${name}" ;;
  esac
}

require_value MIGRATION_DATABASE_URL
require_value MIGRATION_TARGET_SCHEMA
require_value MIGRATION_TARGET_IDENTITY
require_value MIGRATION_APPROVAL_ID
require_value RELEASE_VERSION
require_value MIGRATION_EVIDENCE_PATH

migration_url_lower=$(printf '%s' "$MIGRATION_DATABASE_URL" | tr '[:upper:]' '[:lower:]')
case "$MIGRATION_DATABASE_URL" in
  postgresql://*|postgres://*) ;;
  *) fail invalid_MIGRATION_DATABASE_URL ;;
esac
case "$migration_url_lower" in
  *change_me*|*replace-with-*|*example.test*|*pgbouncer*|*:6432/*|*:6432\?*)
    fail invalid_MIGRATION_DATABASE_URL
    ;;
esac
case "$MIGRATION_TARGET_SCHEMA" in
  [A-Za-z_][A-Za-z0-9_]*) ;;
  *) fail invalid_MIGRATION_TARGET_SCHEMA ;;
esac
validate_token MIGRATION_TARGET_IDENTITY
validate_token MIGRATION_APPROVAL_ID
validate_token RELEASE_VERSION
case "$MIGRATION_EVIDENCE_PATH" in
  /*|[A-Za-z]:/*) ;;
  *) fail invalid_MIGRATION_EVIDENCE_PATH ;;
esac
case "$MIGRATION_EVIDENCE_PATH" in
  *[!A-Za-z0-9_./:-]*) fail invalid_MIGRATION_EVIDENCE_PATH ;;
esac
url_schema=$(printf '%s' "$MIGRATION_DATABASE_URL" | sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p')
[[ "$url_schema" == "$MIGRATION_TARGET_SCHEMA" ]] || fail migration_url_schema_mismatch
psql_database_url="$MIGRATION_DATABASE_URL"
psql_database_url="${psql_database_url/\?schema=$MIGRATION_TARGET_SCHEMA\&/\?}"
psql_database_url="${psql_database_url/\&schema=$MIGRATION_TARGET_SCHEMA\&/\&}"
psql_database_url="${psql_database_url/\&schema=$MIGRATION_TARGET_SCHEMA/}"
psql_database_url="${psql_database_url/\?schema=$MIGRATION_TARGET_SCHEMA/}"

if [[ -e "$MIGRATION_EVIDENCE_PATH" || -L "$MIGRATION_EVIDENCE_PATH" ]]; then
  if ! rm -f -- "$MIGRATION_EVIDENCE_PATH"; then
    fail evidence_cleanup
  fi
fi
if [[ -e "$MIGRATION_EVIDENCE_PATH" || -L "$MIGRATION_EVIDENCE_PATH" ]]; then
  fail evidence_cleanup
fi

mkdir -p "$GATE_LOG_DIR" "$(dirname "$MIGRATION_EVIDENCE_PATH")"
work_dir=$(mktemp -d "$GATE_LOG_DIR/run.XXXXXX")
temporary_marker=''
cleanup() {
  if [[ -n "$temporary_marker" && -e "$temporary_marker" ]]; then
    rm -f -- "$temporary_marker"
  fi
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

run_psql_stream() {
  local phase="$1"
  local log_file="$work_dir/${phase}.log"
  if ! {
    printf 'SET search_path TO :"target_schema";\n'
    printf "SELECT 1 / CASE WHEN current_schema() = :'target_schema' THEN 1 ELSE 0 END\n"
    printf '\\g /dev/null\n'
    cat
  } | psql "$psql_database_url" \
    -v ON_ERROR_STOP=1 \
    -v "target_schema=$MIGRATION_TARGET_SCHEMA" \
    -v "gate_phase=$phase" \
    -qAt >"$log_file" 2>&1; then
    fail "$phase"
  fi
}

run_psql_file() {
  local phase="$1"
  local sql_file="$2"
  [[ -f "$sql_file" ]] || fail "missing_${phase}_sql"
  run_psql_stream "$phase" < "$sql_file"
}
parse_preflight_report() {
  local phase="$1"
  local log_file="$work_dir/${phase}.log"
  if ! awk -F'|' '
    BEGIN {
      expected[1] = "registration_snapshot_incomplete"
      expected[2] = "registration_serving_mismatch"
      expected[3] = "roster_assignment_ambiguous"
      expected[4] = "menu_revision_incomplete"
      expected[5] = "penalty_registration_mapping_ambiguous"
      expected[6] = "penalty_registration_duplicate_candidate"
      expected[7] = "future_active_snapshot_incomplete"
    }
    NF >= 3 {
      rows++
      if (rows > 7 || $1 != expected[rows] || $2 !~ /^[0-9]+$/ || $2 != "0") bad=1
    }
    END {
      if (rows != 7 || bad) exit 1
    }
  ' "$log_file"; then
    fail "${phase}_checks"
  fi
}

printf 'SELECT 1;\n' | run_psql_stream target-assert
if ! (
  cd "$GATE_WORKDIR"
  DATABASE_URL="$MIGRATION_DATABASE_URL" \
    yarn workspace @imeal/core prisma migrate deploy >"$work_dir/migrate.log" 2>&1
); then
  fail migrate
fi

run_psql_file preflight "$MIGRATION_SQL_DIR/preflight.sql"

parse_preflight_report preflight
if [[ -z "$MIGRATION_APPROVAL_ID" ]]; then
  fail approval
fi

run_psql_file backfill "$MIGRATION_SQL_DIR/backfill.sql"
run_psql_file postflight "$MIGRATION_SQL_DIR/preflight.sql"
parse_preflight_report postflight

run_psql_stream post-validation <<'SQL'
ALTER TABLE registrations
  VALIDATE CONSTRAINT registration_lifecycle_snapshot_complete;
ALTER TABLE registrations
  VALIDATE CONSTRAINT registration_serving_consistency;
SQL

umask 077
temporary_marker=$(mktemp "${MIGRATION_EVIDENCE_PATH}.tmp.XXXXXX")
completed_at=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
printf '{"release":"%s","migration":"%s","targetSchema":"%s","approvalId":"%s","completedAt":"%s"}\n' \
  "$RELEASE_VERSION" \
  "$MIGRATION_NAME" \
  "$MIGRATION_TARGET_IDENTITY" \
  "$MIGRATION_APPROVAL_ID" \
  "$completed_at" >"$temporary_marker"
chmod 0444 "$temporary_marker"
mv -f -- "$temporary_marker" "$MIGRATION_EVIDENCE_PATH"
temporary_marker=''

printf 'migration_gate=passed release=%s migration=%s target=%s approval=%s\n' \
  "$RELEASE_VERSION" "$MIGRATION_NAME" "$MIGRATION_TARGET_IDENTITY" "$MIGRATION_APPROVAL_ID"
