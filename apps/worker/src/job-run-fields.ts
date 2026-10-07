import { randomUUID } from 'node:crypto';
import { Prisma } from '@imeal/core';

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const RELEASE = /^[A-Za-z0-9._:+-]{1,80}$/;

const FAILURE_MESSAGES: Record<string, string> = {
  REGISTRATION_FAILURE: 'One or more registrations failed',
  BOOKKEEPING_FAILURE: 'Job bookkeeping failed',
  REMINDER_FAILURE: 'Reminder publication failed',
  OTP_DELIVERY_FAILURE: 'OTP delivery loop failed',
  OTP_DELIVERY_PARTIAL: 'One or more OTP deliveries failed',
  NOTIFICATION_DISPATCH_FAILURE: 'Notification dispatch loop failed',
};

export function recordedRelease(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.RELEASE_VERSION?.trim();
  return value && RELEASE.test(value) ? value : null;
}

export function jobRunBookkeeping(input: {
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  successCount?: number;
  failureCount?: number;
  failureCode?: string;
}): {
  failureCode: string | null;
  failureMessage: string | null;
  successCount: number | null;
  failureCount: number | null;
  releaseVersion: string | null;
} {
  const failureCode =
    input.status === 'FAILED' && input.failureCode && FAILURE_CODE.test(input.failureCode)
      ? input.failureCode
      : null;
  const successCount =
    typeof input.successCount === 'number' &&
    Number.isInteger(input.successCount) &&
    input.successCount >= 0
      ? input.successCount
      : null;
  const failureCount =
    typeof input.failureCount === 'number' &&
    Number.isInteger(input.failureCount) &&
    input.failureCount >= 0
      ? input.failureCount
      : null;
  return {
    failureCode,
    failureMessage: failureCode ? (FAILURE_MESSAGES[failureCode] ?? null) : null,
    successCount,
    failureCount,
    releaseVersion: recordedRelease(),
  };
}

export async function recordScheduledJobRun(
  create: ((data: Prisma.JobRunCreateInput) => Promise<unknown>) | undefined,
  input: {
    prefix: 'otp_delivery_' | 'notification_dispatch_';
    status: 'COMPLETED' | 'FAILED';
    successCount: number;
    failureCount: number;
    failureCode?: string;
  },
): Promise<void> {
  if (typeof create !== 'function') return;
  const data = {
    id: randomUUID(),
    jobName: `${input.prefix}${randomUUID()}`,
    status: input.status,
    completedAt: new Date(),
    ...jobRunBookkeeping(input),
  } satisfies Prisma.JobRunCreateInput;
  await create(data);
}
