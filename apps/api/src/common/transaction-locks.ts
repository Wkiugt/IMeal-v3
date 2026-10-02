import { Prisma } from '@prisma/client';

const USER_LIFECYCLE_LOCK = 'imeal:user-lifecycle';

/**
 * Serializes account lifecycle mutations with registration/delegation writes.
 * Every transaction that mutates account roles, status, sessions, or future
 * disable targets uses this lock before taking user/registration row locks.
 */
export async function lockUserLifecycle(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${USER_LIFECYCLE_LOCK}, 0))
  `;
}
