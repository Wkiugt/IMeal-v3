# Regression task: real-guard serving authorization

Implement the regression requirements in `apps/api/test/pickup.e2e-spec.ts` on the PR #4 branch.

- Replace the public-source test's overridden `JwtAuthGuard`/`PermissionsGuard` setup with an isolated test application using the real guards under local auth.
- Import `JwtService` from `@nestjs/jwt`, `Reflector` from `@nestjs/core`, and `AuthService` from `../src/auth/auth.service.js`; retain `InternalPickupController`, `JwtAuthGuard`, and `PermissionsGuard` imports.
- Save `AUTH_MODE`, `REQUIRE_AUTH`, and `LOCAL_AUTH_JWT_SECRET`; set them to `local`, `true`, and `test-local-jwt-secret-with-at-least-32-characters`; restore or delete each original value in `finally`.
- Create one `resolvePickup = vi.fn().mockResolvedValue({ session: { id: 'public-source-session' }, items: [] })`.
- Build the isolated module with `controllers: [InternalPickupController]` and providers for mocked `PickupService`, mocked `AuthService`, real `JwtAuthGuard`, real `PermissionsGuard`, and `Reflector`. `AuthService.getPrincipal(sub)` returns a full `AuthenticatedUser`: id/userId are sub, email is sub + '@example.com', kitchen has roles ['kitchen'] and permissions ['kitchen.serve'], staff has roles ['staff'] and permissions [].
- Issue tokens with `new JwtService().sign({ sub, authType: 'local' }, { secret: process.env.LOCAL_AUTH_JWT_SECRET })`.
- Create the Nest app, set `app.getHttpAdapter().getInstance().set('trust proxy', true)` before `app.init()`, and close it in `finally`.
- Send `X-Forwarded-For: 203.0.113.10` on every public-source request.
- Assert POST `/api/serving/resolve`: valid kitchen bearer returns 201 and mocked payload; no bearer returns 401 and never calls resolvePickup; valid staff bearer without kitchen.serve returns 403 and never calls resolvePickup.
- Run the focused regression command before committing:
  `corepack yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/pickup.e2e-spec.ts -t "public source IP|bearer token|kitchen.serve"`
- Commit only this test change with subject: `test(api): preserve serving authorization without LAN gate`.
- Do not modify unrelated files, do not read or stage `.env`, do not dispatch subagents, and skip formatters/linters/project-wide suites.
