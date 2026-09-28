import { Controller, Get, Headers, Res } from '@nestjs/common';
import { REQUEST_ID_HEADER, resolveRequestId } from '@imeal/observability';
import { HealthService } from './health.service.js';
import type { WorkerHealthBody, WorkerHealthResult } from './health.service.js';

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
  ): WorkerHealthBody {
    const result = this.healthService.live(resolveRequestId(requestId));
    return this.writeResult(result, response);
  }

  @Get('ready')
  async ready(
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
    @Res({ passthrough: true }) response?: HealthReply,
  ): Promise<WorkerHealthBody> {
    const result = await this.healthService.ready(resolveRequestId(requestId));
    return this.writeResult(result, response);
  }

  private writeResult(
    result: WorkerHealthResult,
    response?: HealthReply,
  ): WorkerHealthBody {
    response?.status(result.statusCode);
    if (response?.header) {
      response.header(REQUEST_ID_HEADER, result.body.requestId);
    } else {
      response?.setHeader?.(REQUEST_ID_HEADER, result.body.requestId);
    }
    return result.body;
  }
}
