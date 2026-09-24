export type SessionStorageResult<T> =
  { ok: true; value: T } | { ok: false; error: unknown };

export async function attemptSessionStorage<T>(
  operation: () => Promise<T>,
): Promise<SessionStorageResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}
