# Branch protection

GitHub branch protection and rulesets cannot be set from application code.
This repository does not contain a GitHub admin token, and maintainers must
not use a GitHub admin token, personal access token, or API client from this
repository to apply these rules. A repository admin sets them in the GitHub
UI. Applying this document is an external action. It does not prove that
protection is enabled, and it does not qualify staging or production.

The workflow name is `staging-readiness`. GitHub reports each job as
`staging-readiness / <job name>`. Select those exact strings. Do not select a
matrix suffix such as `(audit)` or `(api)`; those names are not stable and are
not used.

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

- `staging-readiness / Static checks`
- `staging-readiness / Workspace suites`
- `staging-readiness / Mobile production export`
- `staging-readiness / Mobile HTTP smoke`
- `staging-readiness / Disposable PostgreSQL suites`
- `staging-readiness / Staging tooling and Compose tests`
- `staging-readiness / Security audit`
- `staging-readiness / Security secrets`
- `staging-readiness / Image build scan SBOM api`
- `staging-readiness / Image build scan SBOM worker`
- `staging-readiness / Image build scan SBOM admin-web`
- `staging-readiness / Secretless qualification (disposable PostgreSQL)`

`Secretless qualification (disposable PostgreSQL)` is disposable CI only. A
green result is not staging qualification and is not production qualification.

## deploy/staging

Settings for `deploy/staging`:

- Require a pull request before merging. The source must be a reviewed
  `deploy/develop` or release branch, not an unreviewed direct commit.
- Do not allow direct pushes for normal contributors.
- Block force pushes.
- Block deletion.
- Require the same secretless status checks listed above. Those jobs run on
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
