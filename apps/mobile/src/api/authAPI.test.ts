import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiConfig', () => ({ API_ROOT: 'https://api.example.test' }));

import { authAPI } from './authAPI';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authAPI', () => {
  it('requests an OTP with a non-enumerating accepted response', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepted: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(authAPI.requestOtp('person@example.test')).resolves.toEqual({
      accepted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/auth/otp/request',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'person@example.test',
          purpose: 'SESSION_LOGIN',
        }),
      }),
    );
  });

  it('strictly parses an OTP verification session response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sessionToken: 'opaque-session-token',
              expiresAt: '2026-09-24T04:00:00.000Z',
              user: {
                id: 'user-1',
                email: 'person@example.test',
                name: 'Person',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await expect(
      authAPI.verifyOtp({
        email: 'person@example.test',
        code: '123456',
      }),
    ).resolves.toMatchObject({ sessionToken: 'opaque-session-token' });
  });

  it('rejects verification payloads with unknown fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sessionToken: 'opaque-session-token',
              expiresAt: '2026-09-24T04:00:00.000Z',
              user: {
                id: 'user-1',
                email: 'person@example.test',
                name: 'Person',
              },
              allowlisted: true,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await expect(
      authAPI.verifyOtp({
        email: 'person@example.test',
        code: '123456',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
