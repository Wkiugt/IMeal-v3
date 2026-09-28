import { AsyncLocalStorage } from 'node:async_hooks';
import { REQUEST_ID_HEADER, resolveRequestId } from '@imeal/observability';

export type RequestHeaders = Record<string, string | string[] | undefined>;

export type RequestContextRequest = {
  headers?: RequestHeaders;
  requestId?: string;
  id?: string;
  routeOptions?: { url?: string };
  route?: { path?: string };
  url?: string;
  method?: string;
};

export type RequestContextReply = {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
};

export type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export function firstHeader(
  headers: RequestHeaders | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function requestIdFromRequest(
  request: RequestContextRequest,
): string | undefined {
  return request.requestId ?? request.id;
}

export function establishRequestContext(
  request: RequestContextRequest,
  reply?: RequestContextReply,
): string {
  const requestId = resolveRequestId(
    firstHeader(request.headers, REQUEST_ID_HEADER),
  );
  request.requestId = requestId;
  setResponseRequestId(reply, requestId);
  return requestId;
}

export function setResponseRequestId(
  reply: RequestContextReply | undefined,
  requestId: string,
): void {
  if (reply?.header) {
    reply.header(REQUEST_ID_HEADER, requestId);
  } else {
    reply?.setHeader?.(REQUEST_ID_HEADER, requestId);
  }
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function runWithRequestContext<T>(
  requestId: string,
  callback: () => T,
): T {
  return storage.run({ requestId }, callback);
}
