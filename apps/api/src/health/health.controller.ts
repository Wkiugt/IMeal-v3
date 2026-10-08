import { Controller, Get, Headers, Req, Res } from '@nestjs/common';
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '@imeal/observability';
import {
  currentRequestId,
  type RequestContextRequest,
} from '../common/request-context.js';
import { HealthService } from './health.service.js';
import type { ApiHealthBody, ApiHealthResult } from './health.types.js';
import { SERVICE_UNAVAILABLE_MESSAGE } from '../common/api-error-messages.js';

type ApiHealthErrorBody = {
  statusCode: 503;
  errorCode: 'SERVICE_UNAVAILABLE';
  message: typeof SERVICE_UNAVAILABLE_MESSAGE;
  requestId: string;
};

type HealthResponseBody = ApiHealthBody | ApiHealthErrorBody;

type HealthReply = {
  status(code: number): unknown;
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
};
function requestContextId(
  headerValue: string | undefined,
  request?: RequestContextRequest,
): string {
  return (
    currentRequestId() ??
    request?.requestId ??
    resolveRequestId(headerValue)
  );
}

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  live(
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
    @Res({ passthrough: true }) response?: HealthReply,
    @Req() request?: RequestContextRequest,
  ): HealthResponseBody {
    const result = this.healthService.live(
      requestContextId(requestId, request),
    );
    return this.writeResult(result, response);
  }

  @Get('ready')
  async ready(
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
    @Res({ passthrough: true }) response?: HealthReply,
    @Req() request?: RequestContextRequest,
  ): Promise<HealthResponseBody> {
    const result = await this.healthService.ready(
      requestContextId(requestId, request),
    );
    return this.writeResult(result, response);
  }

  @Get()
  async legacy(
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
    @Res({ passthrough: true }) response?: HealthReply,
    @Req() request?: RequestContextRequest,
  ): Promise<HealthResponseBody> {
    const result = await this.healthService.ready(
      requestContextId(requestId, request),
    );
    if (result.statusCode !== 200) {
      return this.writeResult(result, response);
    }

    const body = {
      ...result.body,
      db: 'connected' as const,
      timestamp: new Date().toISOString(),
    };
    this.writeStatus(result, response);
    this.writeRequestId(body.requestId, response);
    return body;
  }

  private writeResult(
    result: ApiHealthResult,
    response?: HealthReply,
  ): HealthResponseBody {
    this.writeStatus(result, response);
    this.writeRequestId(result.body.requestId, response);
    if (result.statusCode !== 200) {
      return {
        statusCode: 503,
        errorCode: 'SERVICE_UNAVAILABLE',
        message: SERVICE_UNAVAILABLE_MESSAGE,
        requestId: result.body.requestId,
      };
    }
    return result.body;
  }

  private writeStatus(result: ApiHealthResult, response?: HealthReply): void {
    response?.status(result.statusCode);
  }

  private writeRequestId(requestId: string, response?: HealthReply): void {
    if (response?.header) {
      response.header(REQUEST_ID_HEADER, requestId);
    } else {
      response?.setHeader?.(REQUEST_ID_HEADER, requestId);
    }
  }
}
