import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session.guard.js';
import { isTestAuthBypassEnabled } from '../config/environment.js';
import type { AuthenticatedUser } from './authenticated-user.js';

function executionContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('SessionGuard', () => {
  const originalEnv = { ...process.env };
  const resolvedUser: AuthenticatedUser = {
    id: 'u1',
    userId: 'u1',
    email: 'employee@example.test',
    name: 'Employee',
    roles: ['staff'],
    permissions: ['registration.read'],
    sessionId: 'session-1',
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REQUIRE_AUTH;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('resolves the bearer token server-side and replaces client claims', async () => {
    const resolve = vi.fn().mockResolvedValue(resolvedUser);
    const guard = new SessionGuard({ resolve } as never);
    const request = {
      headers: { authorization: 'Bearer opaque-session' },
      user: {
        id: 'attacker',
        roles: ['admin'],
        permissions: ['*'],
        isActive: true,
      },
    };

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('opaque-session');
    expect(request.user).toBe(resolvedUser);
  });

  it('returns the canonical structured SESSION_INVALID error for absent or invalid bearer sessions', async () => {
    const resolve = vi.fn().mockResolvedValue(null);
    const guard = new SessionGuard({ resolve } as never);
    const expectedError = {
      code: 'SESSION_INVALID',
      message: 'Invalid or expired session.',
    };

    await expect(
      guard.canActivate(executionContext({ headers: {} })),
    ).rejects.toMatchObject({ response: expectedError });
    await expect(
      guard.canActivate(
        executionContext({ headers: { authorization: 'Bearer expired-session' } }),
      ),
    ).rejects.toMatchObject({ response: expectedError });
    expect(resolve).toHaveBeenCalledWith('expired-session');
  });

  it('uses only the explicitly configured non-production harness bypass', async () => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'false';
    const resolve = vi.fn();
    const guard = new SessionGuard({ resolve } as never);
    const request: Record<string, unknown> = { headers: {} };

    expect(isTestAuthBypassEnabled()).toBe(true);
    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(request.user).toEqual(
      expect.objectContaining({
        id: 'test-user-id',
        sessionId: 'test-session-id',
      }),
    );
  });

  it('does not allow the bypass outside tests', async () => {
    process.env.NODE_ENV = 'production';
    process.env.REQUIRE_AUTH = 'false';
    const guard = new SessionGuard({ resolve: vi.fn() } as never);

    await expect(
      guard.canActivate(executionContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
