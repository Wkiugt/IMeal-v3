## Summary
- remove client-IP pickup authorization while preserving authenticated Kitchen and kitchen.serve boundaries
- add public-source pickup regression and remove mobile LAN-specific 403 diagnosis
- centralize Expo API origin resolution with Metro host discovery and migrate all mobile callers
- synchronize canonical pickup and local Expo documentation

## Scope note
README.md changes are intentionally retained; generated tsconfig.build.tsbuildinfo changes were reverted before merge.

## Verification
- corepack yarn test:unit — 104/104 passed
- pickup.service.spec.ts — 18/18 passed
- public-source pickup e2e — 1/1 passed with X-Forwarded-For: 203.0.113.10
- real-guard serving-boundary regression — 201 kitchen bearer/public source, 401 missing bearer, 403 missing kitchen.serve
- API/mobile TypeScript checks passed
- yarn install --immutable passed with existing YN0086 warning
- complete pre-merge checks passed with a disposable PostgreSQL test database; worker tests emit an existing expected database-error log
- device UI smoke remains unavailable because adb/device credentials were unavailable

## Files
See the PR Files tab for the cleaned 23-file change set. Generated `tsconfig.build.tsbuildinfo` files and the discarded local resolver wrapper/spec are excluded.