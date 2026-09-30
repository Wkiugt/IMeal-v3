# Task 6 deployment isolation and runtime configuration report

## Implemented boundary

- Staging and production worker services publish no host port and attach only to the private `data` network. The worker metrics listener is not attached to the `app`/edge network.
- Staging Caddy keeps the explicit public `/metrics` `404` handler. Production Caddy now has the same explicit handler before the API and Admin Web fallback handlers, so the SPA cannot turn public `/metrics` into a successful response.
- Staging and production Compose require these opaque worker source-reference
  bindings with no defaults: `WORKER_METRICS_POSTGRES_SOURCE`,
  `WORKER_METRICS_OBJECT_STORAGE_SOURCE`,
  `WORKER_METRICS_BACKUP_EVIDENCE_SOURCE`, and
  `WORKER_METRICS_SECURITY_BOUNDARY_SOURCE`. They also require the
  target-bound `WORKER_METRICS_TARGET_FINGERPRINT` with no default. Protected
  deployment environments must supply reference IDs and the target fingerprint;
  the repository supplies no values.
- Production Compose requires the protected API transport bindings
  `WORKER_METRICS_TRANSPORT_URL`, `WORKER_METRICS_TRANSPORT_TOKEN`, and
  `API_METRICS_EVIDENCE_DIGEST`; staging and production worker services
  require the worker transport token and evidence digest. Production bindings
  were added in commit `fd4d0aa`; all values remain out-of-band and opaque.
- `.env.example` documents only commented binding names and the
  target-fingerprint requirement. It contains no source values, credentials,
  URLs, targets, or payloads. Without protected staging bindings, target
  fingerprint, API evidence digest, and release metadata, the API publisher
  and production-mode worker validator remain fail-closed before release.
- Commits `07fd8b8`, `755e310`, and `43f1746` complete the typed private
  HTTPS registry/feed transport and four concrete source providers, with DI
  wiring into the worker collector. Strict-schema validation and fail-closed
  mapping are repository-complete and tested; no external source is contacted
  without protected deployment inputs.
- The source registry URL/protocol, protected source identifiers,
  credentials/workload identity/mTLS, exporter semantics, and target
  fingerprints/digests remain external inputs. No credentials or real
  endpoints were used. M-23 remains registry-bound and has no cryptographic
  target binding.


## Focused verification

- `node --test scripts/staging/compose-config.test.mjs scripts/staging/runtime-integration.test.mjs` — 12 tests passed. The checks render both staging and production Compose, verify no public worker ports, verify the worker is data-network-only, verify all four required bindings are passed through opaquely in both overlays, verify both Caddy `/metrics` routes are non-success before fallback, and verify internal metrics safety/public metrics rejection.
- `yarn workspace @imeal/worker test --run src/metrics/metrics-environment.spec.ts` — 1 file, 5 tests passed.
- `yarn workspace @imeal/worker build` — passed.
- `caddy validate --config Caddyfile.production` — not observed because the `caddy` executable is unavailable in this environment; the staging Compose test's optional Caddy validation passed when applicable.

## External status

No staging credentials, staging target, external source registry URL or
protocol, protected source identifiers, credentials/workload identity/mTLS,
exporter semantics, source payloads, target fingerprints/digests, alert
delivery, or deployment approval were provisioned or observed. The typed
transport/providers and repository boundary checks are local implementation
evidence only. `STG-METRICS-01` remains **BLOCKED** and staging remains
**CONDITIONAL / NO-GO** until real private sources, bindings, target evidence,
alert delivery, and independent qualification exist.

## Runtime wiring update

- Commit `22e5b25` provides the private structured API-to-worker transport;
  no public worker port or public API metrics route is introduced.
- Commit `84edd67` adds the API publisher with explicit
  `API_METRICS_EVIDENCE_DIGEST` metadata, an initial non-blocking flush, and a
  fixed 30-second interval. Each attempt has a 5-second timeout; single-flight
  state remains held until the underlying call settles after timeout, and
  shutdown drain registration prevents overlap or new work while draining.
- Commit `fd4d0aa` adds the required production API transport URL/token and API
  evidence digest plus worker transport token/evidence digest bindings. No
  credentials, targets, URLs containing secrets, or synthetic runtime values
  are committed.
- Commits `85bdf01` and `199eab2` register the authoritative collector
  orchestrator in the worker lifecycle: initial collection, fixed 60-second
  schedule, and shutdown stop. Worker application snapshots continue on the
  30-second interval.
- Commits `07fd8b8`, `755e310`, and `43f1746` complete the typed private
  HTTPS registry/feed transport and four concrete source providers. They are
  DI-wired into the worker collector, enforce strict schemas, and fail closed
  when registry configuration, protected source identifiers, payloads, target
  fingerprints/digests, or release metadata are absent or invalid.
- These repository providers do not constitute real source observations,
  target-bound evidence, or complete 23-metric runtime qualification. M-23
  remains registry-bound without cryptographic target binding.
