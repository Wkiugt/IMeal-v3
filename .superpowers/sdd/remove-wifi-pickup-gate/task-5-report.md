# Task 5 Report — Remove client LAN diagnosis

## Change

Updated `apps/mobile/src/api/servingAPI.ts` to remove the resolve-specific `403` branch and its internal-LAN error message. Every non-OK resolve response now uses the existing JSON parsing and `err.message || 'Failed to resolve serving'` fallback.

Preserved:

- `API_BASE` import and URL construction
- Bearer authorization header
- `/serving/resolve` and `/serving/confirm` paths
- Serving request/response types
- Confirm duplicate-serving error mapping
- Generic fetch rejection behavior
- All screen-side recovery and serving behavior

## Verification

Command:

```text
corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
```

Result: passed with exit code 0 and no output.

Targeted source check:

```text
grep for `Access Denied. Ensure you are on the internal LAN and have Kitchen permissions.` and `res.status === 403` in apps/mobile/src/api/servingAPI.ts
```

Result: no matches found.

Skipped formatters, linters, and project-wide test suites as required.
