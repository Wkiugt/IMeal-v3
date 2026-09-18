import { useEffect, useRef, useState } from 'react';

type TimeoutHandle = number | NodeJS.Timeout;

export function useScreenLoadingGate(
  focused: boolean,
  ready: boolean,
  minimumMs = 1_500,
): boolean {
  const activeCycle = useRef(focused);
  const cycleId = useRef(0);
  const startedAt = useRef<number | null>(focused ? Date.now() : null);
  const completed = useRef(!focused);
  const latestReady = useRef(ready);
  const timer = useRef<TimeoutHandle | null>(null);
  const [visible, setVisible] = useState(focused);

  useEffect(() => {
    latestReady.current = ready;

    if (!activeCycle.current || completed.current || !focused) return;
    const started = startedAt.current;
    if (started === null || !ready || Date.now() - started < minimumMs) return;

    completed.current = true;
    activeCycle.current = false;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setVisible(false);
  }, [focused, minimumMs, ready]);

  useEffect(() => {
    if (!focused) {
      activeCycle.current = false;
      completed.current = true;
      startedAt.current = null;
      cycleId.current += 1;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setVisible(false);
      return;
    }

    const currentCycle = cycleId.current + 1;
    cycleId.current = currentCycle;
    activeCycle.current = true;
    completed.current = false;
    startedAt.current = Date.now();
    latestReady.current = ready;
    setVisible(true);

    const finishIfReady = () => {
      if (
        cycleId.current !== currentCycle
        || !activeCycle.current
        || completed.current
        || !latestReady.current
      ) {
        return;
      }
      completed.current = true;
      activeCycle.current = false;
      timer.current = null;
      setVisible(false);
    };

    if (minimumMs <= 0 && ready) {
      finishIfReady();
    } else {
      timer.current = setTimeout(finishIfReady, Math.max(0, minimumMs));
    }

    return () => {
      activeCycle.current = false;
      completed.current = true;
      cycleId.current += 1;
      startedAt.current = null;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setVisible(false);
    };
  }, [focused, minimumMs]);

  return visible;
}
