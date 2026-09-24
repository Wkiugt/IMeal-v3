import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { OtpService } from './otp.service.js';

function createController() {
  const otpService = {
    request: vi.fn(),
    verify: vi.fn(),
  } satisfies Pick<OtpService, 'request' | 'verify'>;
  const authService = {
    authenticateLocal: vi.fn(),
  };
  const controller = new AuthController(authService as never, otpService as never);
  return { controller, otpService };
}

describe('AuthController OTP endpoints', () => {
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

  it('returns only the safe verified principal without an OTP code', async () => {
    const { controller, otpService } = createController();
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

    const response = await controller.verifyOtp(
      { email: 'employee@example.test', purpose: 'SESSION_LOGIN', code: '123456' },
      { id: 'request-1', ip: '198.51.100.10', headers: {} },
    );

    expect(response).toEqual({
      verified: true,
      user: {
        id: 'user-1',
        email: 'employee@example.test',
        name: 'Employee',
      },
    });
    expect(JSON.stringify(response)).not.toContain('123456');
  });
});
