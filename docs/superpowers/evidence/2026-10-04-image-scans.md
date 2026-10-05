# Local image scan evidence

## Scope

These are local Docker image scans, not protected staging release scans. Image tags and image IDs below are the exact locally observed build outputs. No release digest, registry publication, or staging qualification is claimed.

The Trivy policy matches `.github/workflows/staging-readiness.yml`: pinned image `aquasec/trivy@sha256:fa9a2d2a839e69bfc0e774e885c526b5db20dc1feba5bcd1bfb59e51e7855ae0`, `--exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed`. The pinned Syft image is `anchore/syft@sha256:b8c170b8e51bfc4779ec3ef4399942c57290f5ce76a9c3af564c9d00d4946a6b`, output format SPDX JSON. The Trivy vulnerability and Java databases were downloaded at scan time by the pinned scanner; database feed digests/freshness are not separately pinned or claimed. No CVE was ignored beyond the required `ignore-unfixed` policy.

Syft v1.18.1's supported Docker-daemon source syntax is `docker:<image>`, not `docker://<image>`; both workflow SBOM invocations now use the supported prefix and the protected invocation has the required continuation after the pinned image digest. An extracted local run against the final API/worker/Admin aliases generated SPDX JSON and inspected actual `SPDXRef-Package-*` identifiers. This proves the corrected scanner CLI path only; the protected workflow job remains unrun.

## API and worker scans

| Image tag | Observed image ID | Trivy result | Syft SPDX result |
| --- | --- | --- | --- |
| `imeal-api-prisma7:final-20261004` | `sha256:e8fddf93f107b931bf8619f325b027a9aa90757822790db7cf1bc6ce0441fda0` | **FAIL** — Alpine 3.24.2: 0 HIGH/CRITICAL; Node.js: 7 HIGH, 0 CRITICAL | 1,428 packages; 2,967 relationships; 3,779,167 bytes |
| `imeal-worker-prisma7:final-20261004` | `sha256:8450f0a7be06361fb3d580f34b6fb9d26db99fe114e3a36f93cb980700f6ec0d` | **FAIL** — Alpine 3.24.2: 0 HIGH/CRITICAL; Node.js: 7 HIGH, 0 CRITICAL | 1,428 packages; 2,967 relationships; 3,783,499 bytes |

Both API and worker images reported the same fixed Node findings. All seven findings target bundled npm under `/usr/local/lib/node_modules/npm/node_modules`, not the root Yarn lock:

- `brace-expansion@5.0.7` at `/usr/local/lib/node_modules/npm/node_modules/brace-expansion/package.json` — CVE-2026-102276 (fixes `5.0.10`, `3.0.7`, `2.1.5`, `1.1.19`), CVE-2026-102278 (fixes `5.0.11`, `3.0.8`, `2.1.6`, `1.1.20`), CVE-2026-14257 (fixes `5.0.8`, `3.0.3`, `2.1.3`, `1.1.17`), and CVE-2026-69152 (fixes `1.1.18`, `2.1.4`, `3.0.6`, `5.0.9`).
- `ip-address@10.2.0` at `/usr/local/lib/node_modules/npm/node_modules/ip-address/package.json` — CVE-2026-69192; fixed `10.3.1`.
- `tar@7.5.19` at `/usr/local/lib/node_modules/npm/node_modules/tar/package.json` — CVE-2026-73566; fixed `7.5.21`.
- `undici@6.27.0` at `/usr/local/lib/node_modules/npm/node_modules/undici/package.json` — CVE-2026-19534; fixed `6.28.1` (or `7.29.1`/`8.10.2`).

Each advisory is available at `https://avd.aquasec.com/nvd/<CVE-ID>`. These are bundled npm dependencies from the `node:24-alpine` base and are not evidence that the root Yarn resolutions are ineffective. The original image results must be rerun after the supported base-image fix; they are not final release results.

## Historical API, worker, and migration r4 scans

The rebuilt r4 API, worker, and migration images remain preserved as historical local proof; r5 below is the current backend image binding:

| Image tag | Local image ID / digest | Runtime proof | Trivy result | Syft SPDX result |
| --- | --- | --- | --- | --- |
| `imeal-api-prisma7:final-20261004-r4` | `sha256:f6615b623ddaea13bca1dad66d7fc658c5a80a0dd9a24f6df53199d402dfcd4a` | `/health` HTTP 200, `databaseok`, original pinned PgBouncer 1.25.2 + PostgreSQL 15, pool size 1; SIGTERM completed | **PASS** — Alpine 3.24.2 total 0 (HIGH 0, CRITICAL 0) | 1,284 packages; 2,679 relationships; 3,415,668 bytes |
| `imeal-worker-prisma7:final-20261004-r4` | `sha256:4987f4e35a49dfb36a2405d9b9a4d920f5bc038b7ad555eea73924a35b29ffe6` | `/health/live` HTTP 200; `/health/ready` HTTP 503 with `databaseok` because scheduler/last-loop wiring is undefined in the source-side runtime (pre-existing in dev as well as this smoke); SIGTERM completed | **PASS** — Alpine 3.24.2 total 0 (HIGH 0, CRITICAL 0) | 1,284 packages; 2,679 relationships; 3,419,568 bytes |
| `imeal-migration-prisma7:final-20261004-r4` | `sha256:983d5a4e31329a6428fedc74a84c396ccb3895df34ab841745bbf7660cd8604d` | Disposable gate passed `schema migration_r3_smoke` on PostgreSQL 16 with marker `0444`; release `final-20261004-r4` / target `migration-r4-disposable` / approval `approval-r4-disposable` | **PASS** — Alpine 3.24.2 total 0 (HIGH 0, CRITICAL 0) | 1,291 packages; 2,823 relationships; 3,522,834 bytes |

Migration r3 (`sha256:bf3a5f64d14a2e6c332e7e14d894f3c1d1707278e6aa545185da642cab7a5dbe`) is historical positive evidence only; it is not the final migration source binding.

The migration r4 manifest/config binding observed from the rebuilt local image is manifest `sha256:983d5a4e31329a6428fedc74a84c396ccb3895df34ab841745bbf7660cd8604d`, config `sha256:30a323512de3980de7912a2eb29e855aa878272fea1c5e38915612fcd6cc42a1`, and local image ID equal to that manifest digest. The disposable gate recorded `schema migration_r3_smoke` on PostgreSQL 16, marker `0444`, test-only release `final-20261004-r4`, target `migration-r4-disposable`, and approval `approval-r4-disposable`.

## Current API, worker, and migration r5 scans

The current r5 rebuilds are bound to these local image digests. API and worker runtime smoke passed through the original pinned PgBouncer 1.25.2 image with PostgreSQL 15; these are local/disposable qualifications only.

| Image tag | Local image ID / digest | Runtime proof | Trivy result | Syft SPDX result |
| --- | --- | --- | --- | --- |
| `imeal-api-prisma7:final-20261004-r5` | `sha256:3d61b521dbbd59a56f4a490b42159da851454f0aa5e811d23e90631935832826` | `/health` HTTP 200 with `database=ok`/`migration=ok`, original pinned PgBouncer 1.25.2 + PostgreSQL 15, pool size 1; SIGTERM completed | **PASS** — Alpine 3.24.2 total 0 (HIGH 0, CRITICAL 0) | 1,284 packages; 2,679 relationships; 3,405,402 bytes |
| `imeal-worker-prisma7:final-20261004-r5` | `sha256:2dad9742d96d70df76b1d4e8e0424a03ed5a11bee19786a9aeac715d0d406c25` | `/health/live` HTTP 200; `/health/ready` HTTP 503 with `database=ok`/`migration=ok` because scheduler/last-loop wiring is undefined in the source-side runtime (pre-existing); SIGTERM completed | **PASS** — Alpine 3.24.2 total 0 (HIGH 0, CRITICAL 0) | 1,284 packages; 2,679 relationships; 3,409,302 bytes |
| `imeal-migration-prisma7:final-20261004-r5` | `sha256:e0c5823fbb7afde00aa21f1d6e8d7985248024e3a5c6b3ee998abd38ec926537` | Disposable gate passed `schema migration_r3_smoke` on PostgreSQL 16, marker `0444`; test-only target `migration-r5-disposable` / approval `approval-r5-disposable`; no production-release evidence | **PASS** — Alpine 3.24.2 total 0 (HIGH 0, CRITICAL 0) | 1,291 packages; 2,823 relationships; 3,522,834 bytes |

Core package seeding and full database verification passed in Good's r5 source gate (`core` full DB 89). The r5 migration gate is test-only and does not qualify a production release.

The API/worker Trivy JSON `ArtifactName` fields carry the CI image aliases `imeal/api:d61af2c9463b1f3597c8288184fbde0ae41d503e` and `imeal/worker:d61af2c9463b1f3597c8288184fbde0ae41d503e`; their `Metadata.ImageID` values match the r5 local digests above. The migration report retains its `imeal-migration-prisma7:final-20261004-r5` tag name.

These are local image results using the required pinned Trivy policy. JSON reports and SPDX files remain outside the repository:

```text
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-trivy-json-final-r5\api-r5.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-trivy-json-final-r5\worker-r5.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-trivy-json-final-r5\migration-r5.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-trivy-json-final-r5\admin-r5.json (Admin r4 unchanged final)
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-sbom-final-r5\api-r5.spdx.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-sbom-final-r5\worker-r5.spdx.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-sbom-final-r5\migration-r5.spdx.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-sbom-final-r5\admin-r4.spdx.json (Admin r4 unchanged final)
```

The corrected extracted CI Syft proof uses the pinned v1.18.1 `docker:` source prefix (`docker:imeal/${service}:${GITHUB_SHA}`), actual `SPDXRef-Package-*` assertions, and the CI aliases above; the wrapper and disposable migration-gate marker are preserved outside the repository:

```text
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-syft-ci-proof-final\build-image-sbom-api.spdx.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-syft-ci-proof-final\build-image-sbom-worker.spdx.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-syft-ci-proof-final\build-image-sbom-admin-web.spdx.json
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-syft-ci-proof-final\final-image-scan.sh
C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-syft-ci-proof-final\migration-r5-gate.json
```

Historical r4 artifact hashes remain recorded above. Current r5 artifact hashes: Trivy JSON `api-r5.json` = `16c75b5309ab249fbc97bfef8a40b6be9b5084b3afc4bf48ae8d9bdfaf4248fb`; `worker-r5.json` = `67cedbb34e68cdff04ec9828ca6af06e1a86db97dbf662be362973ec1a7bd010`; `migration-r5.json` = `fe648c9dda71a926e35f9ff6ee5ee4bd22375a588fc255e3b2eb99f47ff82542`; Admin r4 unchanged `admin-r5.json` = `1f5d8c519e354f5a904ad608213477236df155fcc1fafaa9fe5013c4ca827f43`. Syft SPDX `api-r5.spdx.json` = `d443e08a82fae4980d1f82c47940c8b63c28b90de44c2d9b044b2c55bbcc1d45`; `worker-r5.spdx.json` = `fe481a46ad26407847833e1202409f043db6ee901de632ee1f9a8a4a9268477b`; `migration-r5.spdx.json` = `b09b55662cc17b5bf8cbc346865fee761215915d25f2fdde09390ef977f394ca`; Admin r4 unchanged `admin-r4.spdx.json` = `6f034de8a2462afa236af5ff03be5d4110bb310f1b42f0b301fcea32788b81f7`.
The preserved wrapper hash is `sha256:550728c3059f27b09c47a1be0532ca1f1cedecb9250e12d26caac1afc53f75a9`; its Syft invocation is `anchore/syft@sha256:b8c170b8e51bfc4779ec3ef4399942c57290f5ce76a9c3af564c9d00d4946a6b docker:imeal/${service}:${GITHUB_SHA} --output spdx-json=...`. The wrapper is an artifact of the local qualification run, not a new CI job.
The current API/worker r5 runtime proof is local/disposable only: API `/health` returned HTTP 200 with database/migration healthy; worker `/health/live` returned HTTP 200 and `/health/ready` returned HTTP 503 solely because the source-side scheduler/last-loop wiring is undefined. No production runtime or release claim is made. The r5 migration gate is disposable/test-only.


## Admin image historical scans

### Original local admin image

`imeal-admin-prisma7:final-20261004` had image ID `sha256:aefb305d07389a051b5f8b3168317f62f4a49d9ea470be137246747841730280`. Trivy **failed** with Alpine 3.21.3 total 44 (HIGH 42, CRITICAL 2), all reported fixed OS findings. Syft generated SPDX JSON with 69 packages, 1,271 relationships, and 866,910 bytes. This result is historical and is not the final admin image.

### Admin r2 historical image

`imeal-admin-prisma7:final-20261004-r2` had image ID `sha256:383f75bda55fde4b2d44047bb4e4c85ea79f7c37604fcd23598f51bc1d0f3e41`, built from verified official `nginx:1.28-alpine` OCI index `sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236`. Trivy **failed** with Alpine 3.23.3 total 61 (HIGH 59, CRITICAL 2), all reported fixed. Syft generated SPDX JSON with 73 packages, 1,299 relationships, and 880,344 bytes. This r2 scan is historical only; it is not a final result.

The r2 fixed package targets were: `c-ares>=1.34.8-r0`; `curl`/`libcurl>=8.22.0-r0`; `libcrypto3`/`libssl3>=3.5.8-r0`; `libexpat>=2.8.5-r0`; `libuuid`/util-linux `>=2.41.6-r1`; `libxml2>=2.13.9-r1`; `musl`/`musl-utils>=1.2.5-r23`; `nghttp2-libs>=1.68.1`; `nginx>=1.28.3-r6`; `pcre2>=10.49-r0`; and `zlib>=1.3.2-r0`. The associated CVE IDs and URLs are recorded in the scan output and use the same `https://avd.aquasec.com/nvd/<CVE-ID>` form.
### Final admin r4 image

`imeal-admin-prisma7:final-20261004-r4` is bound locally to image/manifest `sha256:0c492ba50d70ab4c36efc257b31053714aeb59268f196449b85c8d00d21f702c`. Good's runtime proof observed official Nginx `1.30.5`, UID 101 non-root execution, and HTTP index plus JavaScript asset status 200. Pinned Trivy **passed** the required policy with Alpine 3.24.2 total 0 (HIGH 0, CRITICAL 0). Pinned Syft generated SPDX JSON with 72 packages, 1,271 relationships, and 859,261 bytes.

This is the final admin result currently proven locally. It does not assert protected staging publication or release approval.

Actual Admin r4 web runtime smoke used the image directly on temporary host port `127.0.0.1:18080` and installed headless Chrome via CDP `127.0.0.1:9223`; the container logged Nginx `1.30.5` and served the Vite bundle. The loaded unauthenticated DOM reached `readyState=complete` with title `Quản trị IMeal`, email work-login copy, visible email input (`autocomplete=email`), `Nhận mã OTP` button, and a hidden one-time-code input (`autocomplete=one-time-code`). A JavaScript marker executed in the page, and a safe `smoke-admin@example.invalid` email focus/input/change interaction was observed without submitting or requesting OTP. No console exception, error, or warning was captured. Screenshot: `C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-admin-r4-web-smoke.png` (15,341 bytes, SHA-256 `3195d069c6fc43061d1de114fbaf54952f32aac214301325bd7d2e08930da582`). This proves the unauthenticated Admin web UI and JS execution only; it makes no Admin API, OTP provider, credential, or authenticated-session claim.

## Release boundary

The final local security scans are complete for API r5, worker r5, migration r5, and unchanged final Admin r4. API r5 non-production smoke reached `/health` HTTP 200 with `status=ok`, `database=ok`, `migration=ok`, and `draining=ok` through the original pinned PgBouncer 1.25.2 on port 56433/PostgreSQL 15; worker r5 reached `/health/live` HTTP 200 and `/health/ready` HTTP 503 with environment/database/migration OK, `scheduler=down`, and `lastLoop=not_configured`, and both graceful stops completed. Migration r5 is disposable/test-only; Admin r4 actual web runtime proof is recorded above. No full production readiness, protected staging publication, registry release, OTP/provider, or physical-device claim is made.
