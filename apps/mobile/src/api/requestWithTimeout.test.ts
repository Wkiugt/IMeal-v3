import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestTimeoutError, fetchWithTimeout } from './requestWithTimeout';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
  it('rejects with a timeout error when the request never responds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ),
    );

    const request = fetchWithTimeout(
      'https://api.example.test/auth/local-login',
      {},
      1_000,
    );
    const result = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);
    await result;
  });
});
