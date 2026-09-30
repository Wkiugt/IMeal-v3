import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { OtpService } from './otp.service.js';
import type { ApiMetricsService } from '../common/metrics.service.js';
import type { SessionService } from './session.service.js';

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
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
  const metrics = {
    recordAuthAttempt: vi.fn(),
  } satisfies Pick<ApiMetricsService, 'recordAuthAttempt'>;
  const controller = new AuthController(
    otpService as never,
    sessionService as never,
    metrics as never,
  );
  return { controller, otpService, sessionService, metrics };
}

describe('AuthController OTP and session endpoints', () => {
  it('returns the generic request response and forwards request metadata', async () => {
    const { controller, otpService } = createController();
    otpService.request.mockResolvedValue({ accepted: true });

    await expect(
      controller.requestOtp(
        { email: 'employee@example.test', purpose: 'SESSION_LOGIN' },
        {
          requestId: REQUEST_ID,
          id: 'request-1',
          ip: '198.51.100.10',
          headers: {
            'x-request-id': 'client-supplied-arbitrary',
            'user-agent': 'test',
          },
        },
      ),
    ).resolves.toEqual({ accepted: true });

    expect(otpService.request).toHaveBeenCalledWith(
      { email: 'employee@example.test', purpose: 'SESSION_LOGIN' },
      expect.objectContaining({
        requestId: REQUEST_ID,
        clientIp: '198.51.100.10',
      }),
    );
  });

  it('creates exactly one opaque session and returns only the safe verify response', async () => {
    const { controller, otpService, sessionService, metrics } = createController();
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
      {
        email: 'employee@example.test',
        purpose: 'SESSION_LOGIN',
        code: '123456',
      },
      {
        requestId: REQUEST_ID,
        id: 'request-1',
        ip: '198.51.100.10',
        headers: {
          'x-request-id': 'client-supplied-arbitrary',
          'user-agent': 'test-agent',
        },
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
      requestId: REQUEST_ID,
      metadata: {
        clientIp: '198.51.100.10',
        userAgent: 'test-agent',
      },
    });
    expect(metrics.recordAuthAttempt).toHaveBeenCalledTimes(1);
    expect(metrics.recordAuthAttempt).toHaveBeenCalledWith('success');
    expect(JSON.stringify(response)).not.toContain('123456');
  });
  it('records dependency failure when session creation rejects after OTP verification', async () => {
    const { controller, otpService, sessionService, metrics } = createController();
    otpService.verify.mockResolvedValue({
      userId: 'user-1',
      challengeId: 'challenge-1',
      requestId: REQUEST_ID,
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'employee@example.test',
        name: 'Employee',
        roles: ['staff'],
        permissions: [],
      },
    });
    const dependencyError = new Error('session store unavailable');
    sessionService.create.mockRejectedValue(dependencyError);

    await expect(
      controller.verifyOtp(
        {
          email: 'employee@example.test',
          purpose: 'SESSION_LOGIN',
          code: '123456',
        },
        { requestId: REQUEST_ID, headers: {} },
      ),
    ).rejects.toThrow(dependencyError);
    expect(metrics.recordAuthAttempt).toHaveBeenCalledTimes(1);
    expect(metrics.recordAuthAttempt).toHaveBeenCalledWith(
      'dependency_failure',
    );
  });


  it('replaces malformed incoming IDs before OTP correlation', async () => {
    const { controller, otpService } = createController();
    otpService.request.mockResolvedValue({ accepted: true });

    await controller.requestOtp(
      { email: 'employee@example.test', purpose: 'SESSION_LOGIN' },
      {
        requestId: 'malformed-client-id',
        id: 'also-malformed',
        headers: { 'x-request-id': 'malformed-header' },
      },
    );
    const forwarded = otpService.request.mock.calls[0]?.[1]?.requestId;
    expect(forwarded).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(forwarded).not.toBe('malformed-client-id');
  });

  it('replaces malformed incoming IDs before logout correlation', async () => {
    const { controller, sessionService } = createController();
    sessionService.revoke.mockResolvedValue(undefined);

    await controller.logout(
      {
        requestId: 'malformed-client-id',
        id: 'also-malformed',
        headers: { 'x-request-id': 'malformed-header' },
      },
      {
        id: 'user-1',
        userId: 'user-1',
        email: 'employee@example.test',
        roles: [],
        permissions: [],
        sessionId: 'session-1',
      },
    );

    const forwarded = sessionService.revoke.mock.calls[0]?.[2];
    expect(forwarded).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(forwarded).not.toBe('malformed-client-id');
  });

  it('revokes the current session on logout and preserves the request id', async () => {
    const { controller, sessionService } = createController();
    sessionService.revoke.mockResolvedValue(undefined);

    await expect(
      controller.logout(
        {
          requestId: REQUEST_ID,
          id: 'request-3',
          headers: { 'x-request-id': 'client-supplied-arbitrary' },
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
      REQUEST_ID,
    );
  });
});
