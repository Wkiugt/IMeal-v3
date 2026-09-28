import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@imeal/observability';
import { ApiExceptionFilter } from './api-exception.filter.js';

function host(
  request: Record<string, unknown>,
  reply: Record<string, unknown>,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as never;
}

describe('ApiExceptionFilter', () => {
  it('preserves the request context ID in the header and envelope', () => {
    const logger = {
      error: vi.fn(),
    } as unknown as StructuredLogger;
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      headers: {},
    };

    new ApiExceptionFilter(logger).catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: { field: 'email' },
      }),
      host(request, reply),
    );

    expect(reply.header).toHaveBeenCalledWith(
      'x-request-id',
      request.requestId,
    );
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: { field: 'email' },
      },
      requestId: request.requestId,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'http.exception',
      expect.objectContaining({
        requestId: request.requestId,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
      }),
    );
  });

  it('does not log raw exception details', () => {
    const logger = { error: vi.fn() } as unknown as StructuredLogger;
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: 'malformed-client-id',
      id: 'also-malformed',
      headers: { 'x-request-id': 'malformed-header' },
    };
    const exception = new Error('postgresql://user:secret@db/internal');
    new ApiExceptionFilter(logger).catch(exception, host(request, reply));

    expect(reply.status).toHaveBeenCalledWith(500);
    const response = send.mock.calls[0]?.[0] as { requestId?: string };
    expect(response.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.requestId).not.toBe('malformed-client-id');
    expect(
      JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls),
    ).not.toContain('postgresql://user:secret@db/internal');
  });
});
