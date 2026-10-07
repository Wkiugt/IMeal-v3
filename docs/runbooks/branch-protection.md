# Branch protection

GitHub branch protection and rulesets cannot be set from application code.
This repository does not contain a GitHub admin token, and maintainers must
not use a GitHub admin token, personal access token, or API client from this
repository to apply these rules. A repository admin sets them in the GitHub
UI. Applying this document is an external action. It does not prove that
protection is enabled, and it does not qualify staging or production.

The workflow name is `staging-readiness`. GitHub reports each job as
`staging-readiness / <job name>`. For pull-request qualification of
`deploy/develop` and `deploy/staging`, require only the aggregate secretless
check below. That job already fail-closes unless every producer job result is
`success` and every evidence lane is `PASS`.

Producer GitHub job IDs are `static`, `suites`, `mobile-export`,
`mobile-smoke`, `db`, `tooling`, `security`, and `images`. `security` is one
matrix job (`fail-fast: false`) over `audit` and `secrets`. `images` is one
matrix job (`fail-fast: false`) over `api`, `worker`, and `admin-web`. GitHub
`needs` reports the combined matrix job result. It does not provide per-child
needs keys. Lane granularity stays in the eleven evidence artifacts: `static`,
`suites`, `mobile-export`, `mobile-smoke`, `db`, `tooling`, `security-audit`,
`security-secrets`, `images-api`, `images-worker`, and `images-admin-web`. The
aggregate downloads each artifact by that explicit name.

Do not require individual producer display names. Do not require matrix child
contexts such as `staging-readiness / Security matrix (audit)` or
`staging-readiness / Image build scan SBOM matrix (api)`. GitHub may append
matrix values to those job names; those contexts are not stable. Do not select
a matrix suffix such as `(audit)` or `(api)`.

## deploy/develop

Settings for `deploy/develop`:

- Require a pull request before merging.
- Require at least one approval.
- Dismiss stale pull request approvals when new commits are pushed.
- Do not allow bypass for normal contributors. Admins may be included in the
  restriction if the organization policy requires it; this repository does not
  grant a bypass.
- Block force pushes.
- Block deletion.
- Require the status checks below. They must be reported by a pull request
  against `deploy/develop`. Do not require
  `staging-readiness / Protected staging qualification (ephemeral Compose)`:
  that job does not run on pull requests or on `deploy/develop`, and a skipped
  required check blocks merge.

Required status checks:

- `staging-readiness / Secretless qualification (disposable PostgreSQL)`

`Secretless qualification (disposable PostgreSQL)` is disposable CI only. A
green result is not staging qualification and is not production qualification.
It is the stable pull-request gate because it validates every producer job and
every evidence lane. It does not read protected staging secrets, and secretless
CI must not be recorded as a protected staging PASS.

## deploy/staging

Settings for `deploy/staging`:

- Require a pull request before merging. The source must be a reviewed
  `deploy/develop` or release branch, not an unreviewed direct commit.
- Do not allow direct pushes for normal contributors.
- Block force pushes.
- Block deletion.
- Require the same secretless status check listed above. That job runs on
  `pull_request`. The protected job does not run on pull requests, so it must
  not be a required pull-request status check.
- After merge, a push to `deploy/staging` may start
  `staging-readiness / Protected staging qualification (ephemeral Compose)`.
  That job uses the GitHub environment `staging`.

Environment `staging`:

- Required reviewers: at least one, before the protected job can read
  environment secrets or variables.
- Deployment branches: only `deploy/staging`.
- Do not allow self-approval when the organization setting exists.
- The environment is not created by this repository. Until an admin creates it
  and adds a required reviewer, protected staging qualification cannot succeed.

The protected job fail-closes when `STAGING_ENV_FILE`,
`STAGING_SMOKE_SESSION_TOKEN`, `STAGING_API_ORIGIN`, `STAGING_WORKER_ORIGIN`,
`STAGING_ADMIN_ORIGIN`, `STAGING_IMAGE_DIGESTS_JSON`, or
`STAGING_ROLLBACK_ARTIFACT` is absent. It does not hardcode a staging domain.
Secretless CI must not be recorded as a protected staging PASS.
