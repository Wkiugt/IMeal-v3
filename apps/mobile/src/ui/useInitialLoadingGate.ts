import { useEffect, useRef, useState } from 'react';

type TimeoutHandle = number | NodeJS.Timeout;

export function useInitialLoadingGate(
  loading: boolean,
  failed = false,
  minimumMs = 2_000,
): boolean {
  const armed = useRef(loading && !failed);
  const completed = useRef(!armed.current);
  const startedAt = useRef(armed.current ? Date.now() : null);
  const initialFinished = useRef(!armed.current);
  const timer = useRef<TimeoutHandle | null>(null);
  const [visibleLoading, setVisibleLoading] = useState(armed.current);

  useEffect(() => {
    let active = true;

    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    if (completed.current) {
      setVisibleLoading(false);
      return () => {
        active = false;
        clearTimer();
      };
    }

    if (failed) {
      completed.current = true;
      initialFinished.current = true;
      setVisibleLoading(false);
      return () => {
        active = false;
        clearTimer();
      };
    }

    if (!loading) {
      initialFinished.current = true;
    }

    const elapsed =
      startedAt.current === null ? minimumMs : Date.now() - startedAt.current;
    const remaining = Math.max(0, minimumMs - elapsed);
    setVisibleLoading(true);

    if (remaining === 0) {
      if (initialFinished.current) {
        completed.current = true;
        setVisibleLoading(false);
      }
    } else {
      timer.current = setTimeout(() => {
        if (!active) return;
        timer.current = null;
        if (initialFinished.current) {
          completed.current = true;
          setVisibleLoading(false);
        }
      }, remaining);
    }

    return () => {
      active = false;
      clearTimer();
    };
  }, [failed, loading, minimumMs]);

  return visibleLoading;
}
