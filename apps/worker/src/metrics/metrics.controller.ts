import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  APPLICATION_SNAPSHOT_TRANSPORT_PATH,
  WORKER_METRICS_TRANSPORT_TOKEN_ENV,
  type MetricSourceSnapshot,
} from '@imeal/observability';
import { WorkerMetricsService } from './metrics.service.js';

export const WORKER_METRICS_TRANSPORT_TOKEN = Symbol(
  WORKER_METRICS_TRANSPORT_TOKEN_ENV,
);

function hasTransportToken(
  authorization: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!authorization?.startsWith('Bearer ') || !expectedToken?.trim()) {
    return false;
  }
  const actualDigest = createHash('sha256')
    .update(authorization.slice('Bearer '.length), 'utf8')
    .digest();
  const expectedDigest = createHash('sha256')
    .update(expectedToken.trim(), 'utf8')
    .digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: WorkerMetricsService,
    @Optional()
    @Inject(WORKER_METRICS_TRANSPORT_TOKEN)
    private readonly transportToken?: string,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async getMetrics(): Promise<string> {
    const snapshot = await this.metrics.getCompleteSnapshot();
    if (snapshot === null) {
      throw new ServiceUnavailableException('Metrics snapshot is unavailable');
    }
    return snapshot;
  }

  @Post(APPLICATION_SNAPSHOT_TRANSPORT_PATH.slice('/metrics/'.length))
  @HttpCode(HttpStatus.NO_CONTENT)
  acceptApiApplicationSnapshot(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): void {
    if (!hasTransportToken(authorization, this.transportToken)) {
      throw new UnauthorizedException('Metrics transport unauthorized');
    }
    try {
      this.metrics.acceptApiApplicationSnapshot(
        body as MetricSourceSnapshot,
      );
    } catch {
      throw new BadRequestException('Invalid application snapshot');
    }
  }
}
