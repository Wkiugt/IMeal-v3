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
    const initialTermListeners = process.listenerCount('SIGTERM');
    const initialIntListeners = process.listenerCount('SIGINT');
    const dispose = installShutdownHandlers(app, coordinator, 1000);
    expect(process.listenerCount('SIGTERM')).toBe(initialTermListeners + 1);
    expect(process.listenerCount('SIGINT')).toBe(initialIntListeners + 1);

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
      await Promise.resolve();
      expect(process.listenerCount('SIGTERM')).toBe(initialTermListeners);
      expect(process.listenerCount('SIGINT')).toBe(initialIntListeners);
      process.emit('SIGTERM');
      process.emit('SIGINT');
      expect(app.close).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('begins drain immediately but waits for listen readiness before close', async () => {
    const coordinator = new ShutdownCoordinator(logger());
    let resolveReady!: () => void;
    const readiness = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const app = { close: vi.fn().mockResolvedValue(undefined) };
    const dispose = installShutdownHandlers(app, coordinator, 1000, readiness);

    try {
      process.emit('SIGTERM');
      expect(coordinator.isDraining()).toBe(true);
      await Promise.resolve();
      expect(app.close).not.toHaveBeenCalled();

      resolveReady();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.close).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('reports close errors and permits a later signal retry', async () => {
    const coordinator = new ShutdownCoordinator(logger());
    const closeError = new Error('close failed');
    const errors: unknown[] = [];
    const app = {
      close: vi
        .fn()
        .mockRejectedValueOnce(closeError)
        .mockResolvedValueOnce(undefined),
    };
    const dispose = installShutdownHandlers(
      app,
      coordinator,
      1000,
      Promise.resolve(),
      (error) => errors.push(error),
    );

    try {
      process.emit('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.close).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([closeError]);

      process.emit('SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.close).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });
});
