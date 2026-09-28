import { describe, expect, it, vi } from 'vitest';
import {
  currentRequestId,
  establishRequestContext,
  firstHeader,
  runWithRequestContext,
  setResponseRequestId,
} from './request-context.js';
import type { RequestContextRequest } from './request-context.js';
import { REQUEST_ID_PATTERN } from '@imeal/observability';
describe('request context', () => {
  it('preserves a valid UUIDv4 from a case-insensitive header', () => {
    const request: RequestContextRequest = {
      headers: {
        'X-Request-Id': '550e8400-e29b-41d4-a716-446655440000',
      },
    };

    const requestId = establishRequestContext(request);

    expect(requestId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(request.requestId).toBe(requestId);
    expect(firstHeader(request.headers, 'x-request-id')).toBe(requestId);
  });

  it.each([undefined, 'attacker-value'])(
    'replaces malformed or missing IDs with UUIDv4 values',
    (value) => {
      const request: RequestContextRequest = {
        headers: { 'x-request-id': value },
      };
      const requestId = establishRequestContext(request);

      expect(requestId).toMatch(REQUEST_ID_PATTERN);
      expect(request.requestId).toBe(requestId);
    },
  );

  it('sets response headers for Fastify and Node-style replies', () => {
    const fastifyReply = { header: vi.fn() };
    const nodeReply = { setHeader: vi.fn() };

    setResponseRequestId(fastifyReply, '550e8400-e29b-41d4-a716-446655440000');
    setResponseRequestId(nodeReply, '550e8400-e29b-41d4-a716-446655440001');

    expect(fastifyReply.header).toHaveBeenCalledWith(
      'x-request-id',
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(nodeReply.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      '550e8400-e29b-41d4-a716-446655440001',
    );
  });

  it('makes the resolved ID available to nested handlers', () => {
    expect(
      runWithRequestContext('550e8400-e29b-41d4-a716-446655440000', () =>
        currentRequestId(),
      ),
    ).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
});
