import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));

import { notificationAPI } from './notificationAPI';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('notificationAPI', () => {
  it('maps a pending authenticated list request to API_TIMEOUT', async () => {
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

    const request = notificationAPI.getList('token', { limit: 20 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/notifications?limit=20',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
      }),
    );

    const result = expect(request).rejects.toMatchObject({
      code: 'API_TIMEOUT',
      messageKey: 'errors.apiTimeout',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
  });
});
