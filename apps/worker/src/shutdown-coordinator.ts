import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import type { StructuredLogger } from '@imeal/observability';
import {
  createWorkerStructuredLogger,
  workerLogFields,
  WORKER_STRUCTURED_LOGGER,
} from './common/structured-logger.js';

const DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30;
const MAX_SHUTDOWN_TIMEOUT_SECONDS = 300;

export type ShutdownRegistration = () => void;

type Waiter = {
  resolve: (drained: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

function shutdownTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SHUTDOWN_TIMEOUT_SECONDS?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return DEFAULT_SHUTDOWN_TIMEOUT_SECONDS * 1000;
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds)) {
    return DEFAULT_SHUTDOWN_TIMEOUT_SECONDS * 1000;
  }
  return Math.min(Math.max(seconds, 1), MAX_SHUTDOWN_TIMEOUT_SECONDS) * 1000;
}

@Injectable()
export class ShutdownCoordinator
  implements BeforeApplicationShutdown, OnApplicationShutdown {
  private draining = false;
  private inFlight = 0;
  private readonly waiters = new Set<Waiter>();

  constructor(
    @Optional()
    @Inject(WORKER_STRUCTURED_LOGGER)
    private readonly logger: StructuredLogger = createWorkerStructuredLogger(),
  ) {}

  beginDrain(): void {
    if (this.draining) return;
    this.draining = true;
    this.resolveDrained();
  }

  isDraining(): boolean {
    return this.draining;
  }

  registerInFlight(): ShutdownRegistration | undefined {
    if (this.draining) return undefined;
    this.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
      this.resolveDrained();
    };
  }

  waitForInFlight(timeoutMs: number): Promise<boolean> {
    if (this.inFlight === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve(false);
        }, Math.max(0, timeoutMs)),
      };
      this.waiters.add(waiter);
    });
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.beginDrain();
    const drained = await this.waitForInFlight(shutdownTimeoutMs());
    this.logger[drained ? 'info' : 'warn'](
      drained ? 'worker.shutdown.drained' : 'worker.shutdown.timeout',
      workerLogFields(
        drained ? 'worker.shutdown.drained' : 'worker.shutdown.timeout',
        {
          count: this.inFlight,
          ...(drained ? {} : { errorCode: 'SHUTDOWN_TIMEOUT' }),
        },
      ),
    );
  }

  onApplicationShutdown(): void {
    this.logger.info(
      'worker.shutdown.completed',
      workerLogFields('worker.shutdown.completed', { count: this.inFlight }),
    );
  }

  private resolveDrained(): void {
    if (this.inFlight !== 0) return;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(true);
    }
    this.waiters.clear();
  }
}
