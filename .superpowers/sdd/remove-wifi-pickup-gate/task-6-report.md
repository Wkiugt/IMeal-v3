# Task 6 — Documentation synchronization report

## Changes

- Updated `docs/README.md` to remove the serving trusted-network qualification and identify Kitchen identity/permission plus server-side pickup rules as authoritative.
- Updated `docs/01-product-requirements.md` goals, serving semantics, employee-code recovery wording, §13 policy, P95 metric, and canonical policy table. Added the required exact §13 scope statement.
- Updated `docs/02-technical-requirements.md` diagram, authorization language, network topology, API catalog role requirements, retained-route clarification, conflict-code list, security requirements, and serving P95 wording. PostgreSQL isolation and Entra outbound HTTPS guidance remain.
- Updated `docs/03-product-flows.md` to remove the off-LAN disabled/public-fallback state, make the resolve sequence network-neutral, retain serving-window and generic transport/database recovery, and assert valid Kitchen resolve/confirm regardless of client network location.
- Updated `docs/04-ui-ux-design.md` to remove LAN-specific scanner/confirm copy and acceptance criterion while retaining the distinct serving-window state and generic recovery matrix.
- Updated `docs/05-backend-structure.md` overview, resolve steps, security invariants, routing wording, and acceptance criteria to retain server-side Kitchen permission and pickup invariants without network-location authorization.
- Updated `docs/06-execution-plan.md` global constraints, Phase 6/task 6.2, Phase 6 exit, Task 0.3, security gate, UAT, rollout, production verification, and release blockers; removed the obsolete Task 6.6 internal-network checklist while preserving HTTPS/public reachability and PostgreSQL isolation.
- Updated root `README.md`, `docs/local-role-testing.md`, and `docs/mobile-ui-1to1-implementation.md` local Expo instructions to use `start --lan`, `android`, `ios`, and `web` without manual API IP assignments. Documented automatic `http://<Metro-host>:3000/api` derivation for connected devices and retained same-LAN, `0.0.0.0`, port, firewall, and camera guidance. `EXPO_PUBLIC_API_URL` is documented only as the production/optional tunnel, reverse-proxy, or non-default-port override; Admin Web `VITE_API_URL` instructions were preserved.
- Updated `.env.example` so `EXPO_PUBLIC_API_URL` is empty with an optional local-Expo derivation comment. `VITE_API_URL=http://localhost:3000` is unchanged.

## Focused verification

- `git diff --check -- README.md .env.example docs/README.md docs/01-product-requirements.md docs/02-technical-requirements.md docs/03-product-flows.md docs/04-ui-ux-design.md docs/05-backend-structure.md docs/06-execution-plan.md docs/local-role-testing.md docs/mobile-ui-1to1-implementation.md`
  - Result: passed with no whitespace errors.
- Focused search across `apps/api/src`, `apps/mobile/src`, the seven canonical docs, root `README.md`, the two local-run docs, and `.env.example` for `InternalIpGuard`, `Access denied: Internal IP required.`, the mobile internal-LAN message, and `INTERNAL_NETWORK_REQUIRED`.
  - Result: 0 matches.
- Focused search across mobile local-run docs/config for manual `EXPO_PUBLIC_API_URL` assignments, `10.0.2.2`, `192.168.1.100`, and `<DEV_MACHINE_LAN_IP>.*3000/api`.
  - Result: no manual mobile API IP assignments; only the empty `.env.example` variable and documented non-local override examples remain.
- Focused search across canonical docs for `LAN-only`, `off-LAN`, `public fallback`, `internal serving network`, and serving/network-location authorization wording.
  - Result: no obsolete policy matches; retained generic LAN reachability, infrastructure, PostgreSQL isolation, and internal worker references are intentional.
- Focused search for accidental `PUT`/`CUT` edit markers in named docs/config.
  - Result: 0 matches.

No formatter, linter, project-wide suite, or source-code change was run for this documentation-only task.

## Corrective review round

- Removed the pre-existing root `README.md` content from the Task 6 commit index with `git reset 975dcc4 -- README.md`; the current 561-line user-modified README remains intact in the worktree with only the intended mobile edits.
- Removed the loopback reverse-proxy example from `docs/mobile-ui-1to1-implementation.md`; reverse-proxy overrides now require an operator-provided device-reachable URL.
- Reworded `.env.example` to explicitly state automatic Metro-host derivation for ordinary local Expo runs, production requirement, and optional tunnel/reverse-proxy/non-default-port overrides; kept `EXPO_PUBLIC_API_URL=` and `VITE_API_URL=http://localhost:3000`.
- Removed the residual public/internal contrast from `docs/README.md` and stated that all clients use the normal HTTPS API path.

Focused corrective checks:

- `git diff --check -- .env.example docs/README.md docs/mobile-ui-1to1-implementation.md .superpowers/sdd/remove-wifi-pickup-gate/task-6-report.md`
  - Result: passed with no whitespace errors.
- Focused search for `EXPO_PUBLIC_API_URL=http://localhost/api`, `10.0.2.2`, `192.168.1.100`, and `<DEV_MACHINE_LAN_IP>.*3000/api` in the mobile docs/config.
  - Result: 0 matches.
- Focused search for `mạng nội bộ` in `docs/README.md`.
  - Result: 0 matches.
