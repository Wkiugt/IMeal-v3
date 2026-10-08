# Secret scanner and CI baseline review

Date: 2026-10-04

Scope: source scan, full-history secret scanning, image-security evidence, and static CI review. This review pins the Gitleaks/Trivy/Syft workflow image references and preserves exact-path/exact-value synthetic fixtures. No credential values are emitted by the redacted controls.

## Gitleaks source scan

The existing workflow command was first executed against the checked-in source mounted read-only:

```text
docker run --rm \
  --volume "${GITHUB_WORKSPACE}:/repo:ro" \
  zricethezav/gitleaks:v8.18.4 \
  detect --source=/repo --redact --no-banner --exit-code=1
```

The local worktree run reported `no leaks found`, but Gitleaks also reported that the mounted `.git` worktree pointer references a Windows host path unavailable inside the Linux container. That is not a passing source-security result.

To reproduce the snapshot Git scan, tracked content was exported with `git archive` into a throwaway normal repository, committed once, and mounted read-only. The same default Git invocation found 10 redacted `generic-api-key` findings before the scoped configuration:

- `apps/api/README.md` (badge example)
- `apps/api/src/otp/otp-provider.spec.ts` (test encryption fixture)
- `apps/mobile/src/api/checkInAPI.test.ts` (two idempotency test values)
- `apps/mobile/src/notifications/NotificationProvider.tsx` (storage key identifier)
- `apps/mobile/src/screens/checkIn/SelfCheckInScreen.test.tsx` (idempotency test value)
- `apps/worker/README.md` (badge example)
- `apps/worker/src/otp-delivery-worker.service.spec.ts` (test encryption fixture)
- `packages/contracts/test/contracts.test.ts` (two idempotency test values)

Every finding above has rule ID `generic-api-key`. `git ls-files` confirmed these ten paths are tracked in the committed tree; they are reviewed synthetic fixture/documentation patterns. No credential values were emitted.

A separate source-only `--no-git` traversal found 13 redacted findings: the same 10 tracked fixture/documentation findings plus three findings in two `.superpowers/sdd/.../review-*.diff` review artifacts. The review artifacts were then inspected in context: the detected lines are `pickupAPI.confirmPickup` test cases, and hash comparison against the originating `apps/mobile/src/api/pickupAPI.test.ts` fixture confirmed that all three detected matches are exact copies of the reviewed synthetic idempotency fixture. The two review paths and their originating commits are tracked (`review-e0c274a..task9-fix.diff` from `d64cb135...`, and `review-bbcb622..task9.diff` from `e0c274a...`); they are not an untracked-artifact blanket.

The earlier full-history equivalent reported 32 refs and 362 reachable commits because its bookkeeping combined the 22 refs in the temporary mirror with the 10 refs present in the default normal clone; those are not 32 unique refs. The complete rerun from the common repository directory preserved all 22 source refs, restored them into the normal clone (23 refs after the overlay commit), and measured 361 reachable commits before the overlay plus one overlay commit = 362. With `--log-opts=--all`, pinned v8.30.1 scanned 346 commits and found no leaks. The older 326-commit result came from the incomplete source-worktree mirror that retained only 10 refs and 340 commits before its overlay; it is superseded by this all-ref run.

The root `.gitleaks.toml` extends the pinned scanner's default configuration and declares only `id = "generic-api-key"` plus a rule-specific `condition = "AND"` allowlist. It has no copied detector regex, entropy, or keyword fields, so the inherited detector remains authoritative. Each exception requires the rule ID, one of the 14 exact tracked fixture/test/documentation/review paths, and one fully anchored exact reviewed synthetic or public-image-metadata detector match. `regexTarget = "secret"` was tested but cannot match this upstream rule because its `Secret` field is the complete detector match; the reviewed config therefore uses `regexTarget = "match"` with the same fully anchored complete match. It does not ignore tests globally, use a global path allowlist, or broaden generic-api-key suppression.

The final configuration's top-level `minVersion = "v8.30.1"` is aligned to the pinned v8.30.1 image. The complete all-ref history scan described below is pre-review-overlay historical evidence: it used the same final configuration but is not byte-identical to the frozen post-review source snapshot, so it is not presented as the current final all-ref overlay. Any v8.18.4 compatibility run belongs to the earlier checkpoint configuration with `minVersion = "v8.18.4"` and is historical only; it is not evidence for the final v8.30.1 configuration.

The reviewed r5 tag value at its exact allowlisted documentation path remained ignored, while the same full table line at an unallowlisted path remained detected (`leaks found: 1`). A different high-entropy value at that exact allowlisted path was also detected (`leaks found: 1`). A separate generated AWS-shaped test seed outside the repository was detected (`leaks found: 2` in the control containing AWS access/secret and a GitHub token). All seeded scans used `--redact`; no credential values were emitted.

The previous checkpoint current-source snapshot (before the final test cleanup and targeted formatting) scanned 16.91 MB with pinned v8.30.1 and reported `no leaks found`. The preceding post-review, pre-runbook-deletion source snapshot scanned 17.32 MB in 2.99s with pinned v8.30.1 and reported `no leaks found` (exit 0). The final extended-freeze current-source snapshot after the mobile/runbook/docs-inventory cleanup scanned 17.31 MB in 3.08s with pinned v8.30.1 and reported `no leaks found` (exit 0). The complete all-ref history scan is retained as pre-review-overlay historical evidence: with the same configuration and `--log-opts=--all`, it scanned 346 commits and 15.05 MB and reported `no leaks found`, but it is not byte-identical to the final extended-freeze source snapshot. Its temporary mirror/normal clone and three-byte empty JSON report remain outside the repository under `C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-gitleaks-history-allrefs-final`.

The workflow Gitleaks image now resolves to:

```text
zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
```

The old v8.18.4 image is retained for historical checkpoint compatibility evidence only; it is not the final scanner/configuration pair:

```text
zricethezav/gitleaks:v8.18.4@sha256:75bdb2b2f4db213cde0b8295f13a88d6b333091bbfbf3012a4e083d00d31caba
```

## Trivy and Syft availability

The workflow's pinned Trivy reference exists in the registry and was pulled successfully:

```text
aquasec/trivy@sha256:fa9a2d2a839e69bfc0e774e885c526b5db20dc1feba5bcd1bfb59e51e7855ae0
```

The workflow Syft reference is now pinned to the resolved v1.18.1 image digest:

```text
anchore/syft@sha256:b8c170b8e51bfc4779ec3ef4399942c57290f5ce76a9c3af564c9d00d4946a6b
```

The final local image scans were executed with the pinned Trivy and Syft references above. API r5, worker r5, migration r5, and unchanged Admin r4 results are recorded in `docs/superpowers/evidence/2026-10-04-image-scans.md`; migration r3 and backend r4 remain historical only. The corrected extracted CI Syft step uses the supported `docker:` source prefix, and the four-image local scanner proof is preserved outside the repository; protected staging publication remains a separate gate.

## CI baseline review

Static review of `.github/workflows/staging-readiness.yml` found these controls present:

- `deploy/develop` and `deploy/staging` are the only push qualification branches.
- Pull requests run secretless checks without protected deployment.
- Protected deployment requires a `deploy/staging` push or a manual dispatch on exactly `deploy/staging` with `deploy_staging=true`.
- Corepack Yarn activation precedes immutable install, with setup-node Yarn caching disabled.
- The disposable PostgreSQL service and exact CI `DATABASE_URL` are wired to Prisma validation/generation and database checks.
- Prisma validation/generation occurs before typecheck; migration deployment occurs before DB test suites.
- Protected staging inputs are required, image digests are validated as immutable and matched into the environment file, external images are pulled and scanned, Compose is rendered/started, and teardown runs with `always()`.

Remaining final acceptance boundary:

1. The local migration runtime smoke/binding and corrected CI SBOM-step proof are complete. The protected staging job remains unrun because protected inputs and release approval are unavailable; no protected PASS is claimed.

No protected staging readiness claim is made.
