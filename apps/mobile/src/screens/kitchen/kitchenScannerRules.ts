export type ConfirmAttempt = {
  pickupSessionId: string;
  idempotencyKey: string;
};

export function getConfirmAttempt(
  pickupSessionId: string,
  existingIdempotencyKey: string | null,
  createIdempotencyKey: () => string,
): ConfirmAttempt {
  return {
    pickupSessionId,
    idempotencyKey: existingIdempotencyKey ?? createIdempotencyKey(),
  };
}
