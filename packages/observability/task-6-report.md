# Task 6 deployment isolation and runtime configuration report

## Implemented boundary

- Staging and production worker services publish no host port and attach only to the private `data` network. The worker metrics listener is not attached to the `app`/edge network.
- Staging Caddy keeps the explicit public `/metrics` `404` handler. Production Caddy now has the same explicit handler before the API and Admin Web fallback handlers, so the SPA cannot turn public `/metrics` into a successful response.
- Production Compose requires these opaque worker source-reference bindings with no defaults: `WORKER_METRICS_POSTGRES_SOURCE`, `WORKER_METRICS_OBJECT_STORAGE_SOURCE`, `WORKER_METRICS_BACKUP_EVIDENCE_SOURCE`, and `WORKER_METRICS_SECURITY_BOUNDARY_SOURCE`.
- `.env.example` documents only commented binding names. It contains no source values, credentials, URLs, targets, or payloads. Staging intentionally supplies no binding values; the existing production-mode worker validator therefore remains fail-closed until deployment injects valid opaque references.

## Focused verification

- `node --test scripts/staging/compose-config.test.mjs scripts/staging/runtime-integration.test.mjs` — 12 tests passed. The checks render both staging and production Compose, verify no public worker ports, verify the worker is data-network-only, verify all four production bindings are required and passed through opaquely, verify both Caddy `/metrics` routes are non-success before fallback, and verify internal metrics safety/public metrics rejection.
- `yarn workspace @imeal/worker test --run src/metrics/metrics-environment.spec.ts` — 1 file, 5 tests passed.
- `yarn workspace @imeal/worker build` — passed.
- `caddy validate --config Caddyfile.production` — not observed because the `caddy` executable is unavailable in this environment; the staging Compose test's optional Caddy validation passed when applicable.

## External status

No staging credentials, staging target, external collectors, source payloads, alert delivery, or deployment approval were provisioned or observed. The worker endpoint/configuration and repository boundary checks are local implementation evidence only. `STG-METRICS-01` remains **BLOCKED** and staging remains **CONDITIONAL / NO-GO** until real private sources, bindings, target evidence, alert delivery, and independent qualification exist.
