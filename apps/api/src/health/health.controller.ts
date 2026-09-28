import { Controller, Get, Headers, Res } from '@nestjs/common';
import { REQUEST_ID_HEADER, resolveRequestId } from '@imeal/observability';
import { HealthService } from './health.service.js';
import type { ApiHealthBody, ApiHealthResult } from './health.types.js';

type HealthReply = {
  status(code: number): unknown;
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
};

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  live(
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
    @Res({ passthrough: true }) response?: HealthReply,
  ): ApiHealthBody {
    const result = this.healthService.live(resolveRequestId(requestId));
    return this.writeResult(result, response);
  }

  @Get('ready')
  async ready(
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
    @Res({ passthrough: true }) response?: HealthReply,
  ): Promise<ApiHealthBody> {
    const result = await this.healthService.ready(resolveRequestId(requestId));
    return this.writeResult(result, response);
  }

  @Get()
  async legacy(
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
    @Res({ passthrough: true }) response?: HealthReply,
  ): Promise<
    ApiHealthBody & { db: 'connected' | 'disconnected'; timestamp: string }
  > {
    const result = await this.healthService.ready(resolveRequestId(requestId));
    const body = {
      ...result.body,
      db: result.body.checks.database === 'ok' ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    } as ApiHealthBody & {
      db: 'connected' | 'disconnected';
      timestamp: string;
    };
    this.writeStatus(result, response);
    this.writeRequestId(body.requestId, response);
    return body;
  }

  private writeResult(
    result: ApiHealthResult,
    response?: HealthReply,
  ): ApiHealthBody {
    this.writeStatus(result, response);
    this.writeRequestId(result.body.requestId, response);
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
