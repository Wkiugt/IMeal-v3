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

export function isCurrentScanOperation(
  currentGeneration: number,
  operationGeneration: number,
): boolean {
  return currentGeneration === operationGeneration;
}

export function canResetScan(isConfirming: boolean): boolean {
  return !isConfirming;
}
