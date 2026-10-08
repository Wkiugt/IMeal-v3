import { v1 } from '@imeal/contracts';

export function projectRegistrationStatus(
  status: string,
  mealServing: unknown,
): v1.RegistrationRecordStatus {
  if (mealServing !== null && mealServing !== undefined) return 'SERVED';
  if (
    status === 'ACTIVE' ||
    status === 'CANCELLED' ||
    status === 'SERVED' ||
    status === 'NO_SHOW'
  ) {
    return status;
  }
  throw new Error('Unknown registration status');
}
