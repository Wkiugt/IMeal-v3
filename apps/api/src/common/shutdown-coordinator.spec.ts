import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@imeal/observability';
import { ShutdownCoordinator } from './shutdown-coordinator.js';

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
});
