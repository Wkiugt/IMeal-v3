import { describe, expect, it } from 'vitest';
import { attemptSessionStorage } from './sessionStorage';

describe('session storage failure boundary', () => {
  it.each(['read', 'write', 'delete'])(
    'captures SecureStore %s failures without throwing',
    async (operation) => {
      const error = new Error(`${operation} failed`);
      const result = await attemptSessionStorage<never>(() =>
        Promise.reject(error),
      );

      expect(result).toEqual({ ok: false, error });
    },
  );
});
