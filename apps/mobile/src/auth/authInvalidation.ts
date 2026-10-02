export type AuthInvalidationHandler = (offendingToken: string) => void;

let activeHandler: AuthInvalidationHandler | null = null;

export function registerAuthInvalidationHandler(
  handler: AuthInvalidationHandler,
): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function notifyProtectedAuthInvalid(offendingToken: string): void {
  if (!offendingToken) return;
  activeHandler?.(offendingToken);
}
