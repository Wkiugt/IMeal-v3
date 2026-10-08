import {
  JsonStructuredLogger,
  type SafeLogFields,
  type StructuredLogger,
} from '@imeal/observability';

export const API_STRUCTURED_LOGGER = Symbol('API_STRUCTURED_LOGGER');

export type ApiLogFields = Partial<
  Pick<
    SafeLogFields,
    | 'requestId'
    | 'statusCode'
    | 'durationMs'
    | 'errorCode'
    | 'errorClass'

    | 'providerCode'
    | 'method'
    | 'path'
    | 'route'
    | 'message'
    | 'stack'
    | 'status'
    | 'count'
    | 'total'
    | 'attempt'
    | 'retry'
  >
>;
export function createApiStructuredLogger(): StructuredLogger {
  return new JsonStructuredLogger(
    'api',
    process.env.RELEASE_VERSION?.trim() || 'unconfigured',
  );
}

export function apiLogFields(
  event: string,
  fields: ApiLogFields = {},
): SafeLogFields {
  return {
    service: 'api',
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event,
    ...fields,
  };
}
