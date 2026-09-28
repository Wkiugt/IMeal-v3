import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@imeal/observability';
import {
  installShutdownHandlers,
  ShutdownCoordinator,
} from './shutdown-coordinator.js';

function logger(): StructuredLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('ShutdownCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts active and enters drain idempotently', () => {
    const coordinator = new ShutdownCoordinator(logger());

    expect(coordinator.isDraining()).toBe(false);
    coordinator.beginDrain();
    coordinator.beginDrain();
    expect(coordinator.isDraining()).toBe(true);
    expect(coordinator.registerInFlight()).toBeUndefined();
  });

  it('waits for registered work and ignores duplicate release', async () => {
    const coordinator = new ShutdownCoordinator(logger());
    const release = coordinator.registerInFlight();
    expect(release).toBeTypeOf('function');

    coordinator.beginDrain();
    const draining = coordinator.waitForInFlight(1000);
    release?.();
    release?.();

    await expect(draining).resolves.toBe(true);
  });

  it('returns false when work misses the shutdown deadline', async () => {
    vi.useFakeTimers();
    const coordinator = new ShutdownCoordinator(logger());
    coordinator.registerInFlight();
    coordinator.beginDrain();

    const draining = coordinator.waitForInFlight(100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(draining).resolves.toBe(false);
  });

  it('drains before app close and coalesces SIGTERM/SIGINT shutdown', async () => {
    const coordinator = new ShutdownCoordinator(logger());
    const release = coordinator.registerInFlight();
    const events: string[] = [];
    let finishClose!: () => void;
    const closeFinished = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const app = {
      close: vi.fn(async () => {
        expect(coordinator.isDraining()).toBe(true);
        events.push('app.close');
        await coordinator.beforeApplicationShutdown();
        events.push('prisma.disconnect');
        finishClose();
      }),
    };
    const dispose = installShutdownHandlers(app, coordinator, 1000);

    try {
      process.emit('SIGTERM');
      process.emit('SIGINT');
      process.emit('SIGTERM');
      expect(coordinator.isDraining()).toBe(true);
      expect(app.close).not.toHaveBeenCalled();

      release?.();
      await closeFinished;

      expect(app.close).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['app.close', 'prisma.disconnect']);
    } finally {
      dispose();
    }
  });
});
