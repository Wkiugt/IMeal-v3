# Task 2 Report — Remove IP-Based Serving Authorization

## Changes

- Deleted `apps/api/src/auth/internal-ip.guard.ts`.
- Updated `apps/api/src/pickup/internal-pickup.controller.ts` to remove the `InternalIpGuard` import and use exactly `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
- Preserved all three controller aliases, both `@RequirePermission('kitchen.serve')` decorators, the `@CurrentUser()` principal on confirmation, request bodies, and `PickupService` behavior.

## Focused regression

Command:

```text
corepack yarn workspace @imeal/api test:e2e pickup.e2e-spec.ts
```

Output:

```text
The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.11 C:/Users/0xKoigzzzz/orca/workspaces/IMeal/feat-update-UI/apps/api

stdout | test/pickup.e2e-spec.ts
◇ injected env (0) from ..\\..\\packages\\domain\\.env.test // tip: ⌘ custom filepath { path: '/custom/path/.env' }

 ❯ test/pickup.e2e-spec.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/pickup.e2e-spec.ts [ test/pickup.e2e-spec.ts ]
Error: DATABASE_URL is not set in environment or .env.test
 ❯ ../../packages/domain/test/setup.ts:14:9
     12|
     13| if (!process.env.DATABASE_URL) {
     14|   throw new Error('DATABASE_URL is not set in environment or .env.test…
     15| }

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
     Tests  no tests
   Start at  15:17:57
   Duration  292ms (transform 29ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)

Process exited with code 1
```

## Status

Source edit complete. Focused regression was attempted but could not execute because `DATABASE_URL` is unset in the environment or `.env.test`.

## Concerns

The focused test environment requires a disposable PostgreSQL test database configuration; no source-level test result was available in this workspace.
