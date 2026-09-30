# Task 3 API metrics report

## Scope

Task 3 instruments the API's existing request, OTP verification, and pickup confirmation lifecycle seams with the approved bounded application metric taxonomy. API samples remain private source snapshots; no public API metrics route or fallback producer was added.

## Changed files

- `apps/api/src/common/metrics.service.ts` — shared API metric service using the Task 1 contract and Task 2 registry.
- `apps/api/src/common/metrics.service.spec.ts` — bounded request/auth/serving recording, duration, redaction, and `/metrics` exclusion tests.
- `apps/api/src/common/api-metrics-source.ts` — strict `api_application` source adapter with sink-unavailable/rejected failure states.
- `apps/api/src/common/api-metrics-source.spec.ts` — fresh sink delivery and collector-failure tests.
- `apps/api/src/common/http-logging.interceptor.ts` and `.spec.ts` — exactly-once request count/duration recording for success, errors, and shutdown rejection; `/metrics` excluded.
- `apps/api/src/auth/otp.service.ts` and `.spec.ts` — verify-only success/failure/dependency-failure recording with no sensitive labels.
- `apps/api/src/pickup/pickup.service.ts` and `.spec.ts` — exactly-once serving result/duration and idempotency-conflict recording; committed success is preserved when post-commit event emission fails.
- `apps/api/src/app.module.ts` — one shared registry/service and existing interceptor injection; no second global interceptor.

## Verification

- `yarn workspace @imeal/observability build` — **PASS**.
- `yarn workspace @imeal/api test --run src/common/http-logging.interceptor.spec.ts src/auth/otp.service.spec.ts src/pickup/pickup.service.spec.ts src/common/metrics.service.spec.ts src/common/api-metrics-source.spec.ts` — **PASS**; 5 files, 74 tests.
- `yarn workspace @imeal/api test --run src/pickup/pickup.service.spec.ts` — **PASS**; 1 file, 51 tests.
- `yarn workspace @imeal/api test --run src/common/http-logging.interceptor.spec.ts src/auth/otp.service.spec.ts src/pickup/pickup.service.spec.ts` — **PASS**; 3 files, 70 tests.
- `yarn workspace @imeal/api build` — **PASS**.

## Boundary and safety

- API `/metrics` remains excluded and no API controller, public endpoint, broker, or protocol transport was added.
- Unavailable or rejected API-to-worker sinks produce `collector_failure` snapshots rather than zeros.
- Route, method, status, auth, serving, and idempotency labels are bounded by the shared contract; sensitive request, OTP, identity, provider, and exception values are not labels.
- Metric failures are non-throwing and cannot alter API responses or transactions. A post-commit kitchen-event failure cannot turn a committed pickup confirmation into a failed response.
- No `ApiExceptionFilter` metric duplication was introduced; the existing request interceptor owns request finalization metrics.
