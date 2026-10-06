# CI Qualification Stabilization Plan

## Scope and constraints

- Stabilize the qualification CI dispatcher and image-evidence contracts only; no product changes.
- Do not edit dependency manifests or `yarn.lock`; dependency worker owns those files.
- Do not commit changes from this work.

## Tasks

1. **Dispatcher investigation and fix**
   - Trace the reported POSIX external `SIGTERM` failure through dispatcher ownership, readiness/terminal polling, descendant cleanup, and exit handling.
   - Reproduce with local Node 24 in an available POSIX environment (WSL/Docker if available), recording dispatcher exit, descendant liveness, and cleanup evidence.
   - Add a failing regression first, then make readiness and terminal states deterministic with bounded condition polling and no large arbitrary sleeps.
   - Exercise the full dispatcher tests repeatedly and run 20 isolated external-`SIGTERM` iterations, checking for descendant leaks.

2. **Image evidence contract and aggregate**
   - Trace producer `imageId`/`sourceTag`, inspected-image identity, scan argv, and SBOM argv for api, worker, and admin-web through `ci-contracts.mjs`, `ci-contracts.test.mjs`, `aggregate-qualification.mjs`, `checks.mjs`, and command definitions.
   - Add failing-before regressions for valid inspected-image scan/SBOM acceptance; tag-only and mismatched scans; mismatched inspected image; SBOM hash mismatch; and other-run/source/workflow/invalid attempts.
   - Normalize producer/validator representations without weakening immutable identity: scan and SBOM must identify exactly the inspected immutable image; reject tampering, ID/hash/provenance mismatches.
   - Verify mandatory producer aggregation fails closed for missing/fail/cancel/skip/provenance conditions, while valid full aggregation passes.
   - Run the contract suite and a throwaway aggregate CLI evidence smoke; exercise real Docker image evidence if available, otherwise document the verified limitation.

3. **Dependency work coordination**
   - Coordinate with the dependency worker on manifests and `yarn.lock`; do not edit those files here.
   - After dependency changes land, re-check only affected CI command/test integration as directed; defer full workspace/static checks to the main agent.

4. **Verification and documentation**
   - Run the requested Node 24 POSIX reproductions, dispatcher suites, repeated SIGTERM loop, contract suite, and aggregate evidence smoke; capture numeric results and limitations.
   - Update existing CI documentation with the actual contract/dispatcher behavior and supported verification path; remove throwaway artifacts.
   - Report root causes, exact changed paths, commands, numeric repeated results, environment limitations, and that no commits were made.
