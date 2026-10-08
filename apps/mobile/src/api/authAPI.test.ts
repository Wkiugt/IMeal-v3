import { afterEach, describe, expect, it, vi } from 'vitest';

const expoConfig = vi.hoisted(() => ({
  hostUri: undefined as string | undefined,
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig },
}));

import { API_ROOT } from './apiConfig';
import { authAPI } from './authAPI';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authAPI', () => {
  it('requests an OTP with a non-enumerating accepted response', async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
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
      `${API_ROOT}/auth/otp/request`,
      expect.objectContaining({
        body: JSON.stringify({
          email: 'person@example.test',
          purpose: 'SESSION_LOGIN',
        }),
      }),
    );
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(new URL(requestUrl).origin).toBe(new URL(API_ROOT).origin);
    expect(new URL(requestUrl).pathname).toBe('/auth/otp/request');
    expect(requestUrl).not.toBe(`${API_ROOT}/api/auth/otp/request`);
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

  it('maps timeouts to API_TIMEOUT for every auth operation', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const requests = [
      authAPI.requestOtp('person@example.test'),
      authAPI.verifyOtp({
        email: 'person@example.test',
        code: '123456',
      }),
      authAPI.bootstrapSession('opaque-session-token'),
      authAPI.logout('opaque-session-token'),
    ];
    const results = requests.map((request) =>
      expect(request).rejects.toMatchObject({ code: 'API_TIMEOUT' }),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(results);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      `${API_ROOT}/auth/otp/request`,
      `${API_ROOT}/auth/otp/verify`,
      `${API_ROOT}/auth/me`,
      `${API_ROOT}/auth/logout`,
    ]);
  });
});
