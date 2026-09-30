import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WorkerMetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: WorkerMetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async getMetrics(): Promise<string> {
    const snapshot = await this.metrics.getCompleteSnapshot();
    if (snapshot === null) {
      throw new ServiceUnavailableException('Metrics snapshot is unavailable');
    }
    return snapshot;
  }
}
