import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { OtpService } from './otp.service.js';
import type { SessionService } from './session.service.js';

function createController() {
  const otpService = {
    request: vi.fn(),
    verify: vi.fn(),
  } satisfies Pick<OtpService, 'request' | 'verify'>;
  const sessionService = {
    create: vi.fn(),
    resolve: vi.fn(),
    revoke: vi.fn(),
  } satisfies Pick<SessionService, 'create' | 'resolve' | 'revoke'>;
  const controller = new AuthController(otpService as never, sessionService as never);
  return { controller, otpService, sessionService };
}

describe('AuthController OTP and session endpoints', () => {
  it('returns the generic request response and forwards request metadata', async () => {
    const { controller, otpService } = createController();
    otpService.request.mockResolvedValue({ accepted: true });

    await expect(
      controller.requestOtp(
        { email: 'employee@example.test', purpose: 'SESSION_LOGIN' },
        {
          id: 'request-1',
          ip: '198.51.100.10',
          headers: { 'x-request-id': 'header-request-id', 'user-agent': 'test' },
        },
      ),
    ).resolves.toEqual({ accepted: true });

    expect(otpService.request).toHaveBeenCalledWith(
      { email: 'employee@example.test', purpose: 'SESSION_LOGIN' },
      expect.objectContaining({
        requestId: 'header-request-id',
        clientIp: '198.51.100.10',
      }),
    );
  });

  it('creates exactly one opaque session and returns only the safe verify response', async () => {
    const { controller, otpService, sessionService } = createController();
    otpService.verify.mockResolvedValue({
      userId: 'user-1',
      challengeId: 'challenge-1',
      requestId: 'request-1',
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'employee@example.test',
        name: 'Employee',
        roles: ['staff'],
        permissions: [],
      },
    });
    sessionService.create.mockResolvedValue({
      token: 'opaque-session-token',
      expiresAt: new Date('2026-09-24T15:00:00.000Z'),
    });

    const response = await controller.verifyOtp(
      { email: 'employee@example.test', purpose: 'SESSION_LOGIN', code: '123456' },
      {
        id: 'request-1',
        ip: '198.51.100.10',
        headers: { 'x-request-id': 'header-request-id', 'user-agent': 'test-agent' },
      },
    );

    expect(response).toEqual({
      sessionToken: 'opaque-session-token',
      expiresAt: '2026-09-24T15:00:00.000Z',
      user: {
        id: 'user-1',
        email: 'employee@example.test',
        name: 'Employee',
      },
    });
    expect(sessionService.create).toHaveBeenCalledTimes(1);
    expect(sessionService.create).toHaveBeenCalledWith({
      userId: 'user-1',
      purpose: 'SESSION_LOGIN',
      requestId: 'header-request-id',
      metadata: {
        clientIp: '198.51.100.10',
        userAgent: 'test-agent',
      },
    });
    expect(JSON.stringify(response)).not.toContain('123456');
  });

  it('revokes the current session on logout and preserves the request id', async () => {
    const { controller, sessionService } = createController();
    sessionService.revoke.mockResolvedValue(undefined);

    await expect(
      controller.logout(
        {
          id: 'request-3',
          headers: { 'x-request-id': 'header-request-id' },
        },
        {
          id: 'user-1',
          userId: 'user-1',
          email: 'employee@example.test',
          roles: ['staff'],
          permissions: [],
          sessionId: 'session-1',
        },
      ),
    ).resolves.toEqual({ revoked: true });

    expect(sessionService.revoke).toHaveBeenCalledWith(
      'session-1',
      'LOGOUT',
      'header-request-id',
    );
  });
});
