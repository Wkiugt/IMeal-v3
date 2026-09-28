import {
  JsonStructuredLogger,
  type SafeLogFields,
  type StructuredLogger,
} from '@imeal/observability';

export const WORKER_STRUCTURED_LOGGER = Symbol('WORKER_STRUCTURED_LOGGER');

export function workerRelease(): string {
  return process.env.RELEASE_VERSION?.trim() || 'unconfigured';
}

export type WorkerLogFields = Partial<
  Pick<
    SafeLogFields,
    | 'requestId'
    | 'jobName'
    | 'jobRunId'
    | 'statusCode'
    | 'durationMs'
    | 'errorCode'
    | 'providerCode'
    | 'method'
    | 'route'
    | 'status'
    | 'count'
    | 'total'
    | 'attempt'
    | 'retry'
  >
>;

export function workerLogFields(
  event: string,
  fields: WorkerLogFields = {},
): SafeLogFields {
  return {
    service: 'worker',
    release: workerRelease(),
    event,
    ...fields,
  };
}

export function createWorkerStructuredLogger(): StructuredLogger {
  return new JsonStructuredLogger('worker', workerRelease());
}
