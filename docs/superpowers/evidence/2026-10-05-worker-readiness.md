# Worker readiness bootstrap runtime evidence

Date: 2026-10-05

Worktree: `deploy/develop`

Scope: disposable Docker Linux worker real-entrypoint qualification for the post-listen scheduler readiness marker. This record is local/disposable evidence only; it does not qualify protected staging, production, external metrics authority, or job success.

## Decision boundary

The repository remains **CONDITIONAL / NO-GO** for staging and production. The smoke validates the worker bootstrap and existing fail-closed health gates with disposable inputs. It does not provide protected source authority, provider credentials, target approval, DNS/TLS, OTP/provider approval, alert delivery, backup/restore approval, or release sign-off.

The successful runtime observation supersedes only the earlier source-wiring qualification that the worker had no `markSchedulerInitialized()` call. It does **not** rewrite or supersede the historical `imeal-worker-prisma7:final-20261004-r5` image record in `docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md`.

## Evidence sources

Raw runtime evidence was captured outside the checkout under:

`C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-worker-readiness-5fbd8b392cdf45b3bc2f68ead371e2d9\evidence\`

- `summary.txt` — expected scenario observations.
- `http.log` — HTTP status/body observations and body-artifact paths.
- `commands.log` — bounded Docker, PostgreSQL, migration-gate, image-build, runtime, signal, and cleanup command records. Secret-bearing values are redacted in the record.
- `collision-result.log`, `invalid-otp-result.log`, and `sigterm-result.log` — bounded scenario results.
- `cleanup-verification.log` — final read-only absence checks.
- `postgres-mounts.json` — exact disposable PostgreSQL mount captured before cleanup.

The independent healthy-database SIGTERM supplement was captured outside the checkout under:

`C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-worker-readiness-healthy-sigterm-060aa3813cf24ca5a94475670ce01061\evidence\`

- `http.log` and `summary.txt` — pre-signal healthy readiness and the post-signal listener-close limitation.
- `worker-shutdown.log` — `worker.started`, `worker.shutdown.drained`, and `worker.shutdown.completed` events; `summary.txt` records graceful exit 0.
- `limitations.log` — no fabricated post-signal HTTP 503.
- `postgres-mounts.json` and `cleanup-verification.log` — exact disposable PostgreSQL mount and final owned-resource absence checks.

The prior harness diagnosis and cleanup limitation are recorded at:

`C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-worker-readiness-78fd9dc873464413bf7be522dab5a377\evidence\root-cause-and-cleanup.log`

The earlier debug cleanup proof is retained at:

`C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-worker-readiness-78fd9dc873464413bf7be522dab5a377\evidence\debug-cleanup-proof.log`

Focused implementation checks were recorded separately:

- `C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-worker-bootstrap-20261005-231827\tsc-static-check.log` — worker TypeScript `--noEmit` check, exit 0, with `--tsBuildInfoFile` directed outside the checkout.
- `C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-worker-bootstrap-20261005-231827\prettier-main-crlf-check.log` — `src/main.ts` check, exit 0.

No worker unit or e2e suite was run for this qualification. The optional diagnostic `lastLoop` test was not added; the diagnostic behavior and existing test files remain untouched.

## Runtime matrix

| Scenario                                             | Observed result                                                                                                                                                                                           | Interpretation                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid disposable marker, environment, and PostgreSQL | `/health/live` HTTP 200. `/health/ready` HTTP 200 with `environment=ok`, `database=ok`, `migration=ok`, `scheduler=ok`, `draining=ok`, and `lastLoop=not_configured`.                                     | Successful real entrypoint reaches healthy readiness after `listen()` and the post-listen scheduler marker. `lastLoop` remains diagnostic and is not a readiness gate.                                                                                                    |
| Metrics authority unavailable                        | `/metrics` HTTP 503 with `Metrics snapshot is unavailable`.                                                                                                                                               | Correct fail-closed metrics behavior; no synthetic snapshot, provider, or health override was used.                                                                                                                                                                       |
| Missing migration marker                             | `/health/live` HTTP 200; `/health/ready` HTTP 503 with `migration=down` and other observed checks safe.                                                                                                   | Migration gate remains required and scheduler initialization does not mask the failure.                                                                                                                                                                                   |
| Mismatched migration marker                          | `/health/live` HTTP 200; `/health/ready` HTTP 503 with `migration=down` and other observed checks safe.                                                                                                   | Marker identity remains bound to the disposable target/release contract.                                                                                                                                                                                                  |
| Invalid OTP environment                              | Worker exited 1 before listening; the bounded probe received no listener response.                                                                                                                        | Environment validation remains fail-closed. The observed error was the existing minimum-length validation; no secret value is recorded.                                                                                                                                   |
| Planned app-level port collision                     | Collision container exited 1 with `EADDRINUSE` on `0.0.0.0:3001`.                                                                                                                                         | Failed `listen()` does not reach the post-listen marker or startup-ready barrier. The runtime used Node `v24.21.0`.                                                                                                                                                       |
| Database stopped after startup                       | `/health/ready` HTTP 503 with `database=down`, while migration and scheduler remained `ok` in the captured response.                                                                                      | Database readiness remains independently required and raw database details stay out of the HTTP body.                                                                                                                                                                     |
| SIGTERM while the database was already stopped       | `/health/ready` HTTP 503 with `database=down` and `draining=down`; the Linux container exited 0 through graceful shutdown.                                                                                | This combined observation is recorded honestly, but it is **not** independent proof that a healthy database transitions to 503 solely because of draining. The healthy-database supplement separately captured no post-signal HTTP 503, so no such transition is claimed. |
| Healthy database SIGTERM supplement                  | Pre-signal `/health/ready` HTTP 200 with all five gates `ok` and `lastLoop=not_configured`; SIGTERM exit 0; post-signal curl exited 52 with HTTP 000/empty reply because the listener had already closed. | Graceful shutdown and shutdown-completed logs were observed, but no post-signal HTTP 503 was captured; do not claim a healthy 200→503 drain transition.                                                                                                                   |

The primary runtime summary reports each bounded scenario as the expected result observed. The two initial positive live probes returned no response while the container was still starting; the subsequent bounded live probe returned HTTP 200 and is the positive observation used above. The healthy-database supplement reports pre-signal HTTP 200 and graceful exit 0, but the listener closed before a post-signal HTTP response could be captured.

## Build and runtime boundary

The migration and worker image build commands exited 0. The resulting images used smoke-owned labels; the worker image used its shipped Node 24 path, normal `CMD ["node", "dist/main"]`, and `USER node`; the UID marker-read helper command exited 0. No host Yarn worker build was used for this qualification, preserving the dirty checkout and generated metadata.

The disposable PostgreSQL readiness race was corrected in the harness, not the worker: `pg_isready` returned 0 during official `postgres:16` initialization while the target database was not yet usable. The bounded readiness probe now uses TCP `psql -h 127.0.0.1 -U postgres -d imeal -v ON_ERROR_STOP=1 -c "SELECT 1;"`; early attempts exited 2 with connection refused and the later probe exited 0 before schema creation. The root-cause log records this correction.

## Cleanup and resource-safety limits

The final corrected run captured the PostgreSQL mount before cleanup and removed the PostgreSQL container with label ownership verification plus `docker rm --force --volumes`. Label-guarded cleanup removed the worker and migration images and the smoke network. The final read-only verification listed the app worker and PostgreSQL containers, network, and both images as absent. The migration gate and UID marker-read helper used `--rm` and their command records show exit 0; they are not separate objects listed by `cleanup-verification.log`.

The healthy-database supplement also captured its disposable PostgreSQL mount before label-owned `docker rm --force --volumes`; its worker, PostgreSQL container, network, and images were absent in the final read-only verification.

The first failed qualification attempt's PostgreSQL container ID and exact smoke label are recorded, but its anonymous volume identity is unavailable because the bounded Docker events query contained no mount/unmount record after the container was destroyed. A separate earlier debug probe records exact container/network names and labels plus successful label-guarded removal, but its exact container ID was not retained; no later exact-ID claim is made. No anonymous volume was guessed or broadly pruned. Therefore this record **does not claim that every resource from every attempt in the session was proven clean**; only the final corrected runs' owned resources are proven absent.

## Qualification limits

- This is disposable Docker/Linux evidence, not protected staging evidence.
- No production approval, real metrics authority, provider delivery, job-success observation, or protected target identity is claimed.
- No unit/e2e test suite was run; the focused worker TypeScript and entrypoint formatting logs are the only implementation checks recorded here.
- The healthy-DB SIGTERM supplement proves pre-signal all gates healthy and graceful exit 0, but not a post-signal HTTP 503; no healthy 200→503 drain transition is claimed. The database-down/draining sample remains a combined observation.
