import { useEffect, useRef, useState } from 'react';

export function useMinimumVisibleLoading(
  loading: boolean,
  minimumMs = 450,
): boolean {
  const [visibleLoading, setVisibleLoading] = useState(loading);
  const wasLoading = useRef(loading);
  const startedAt = useRef<number | null>(loading ? Date.now() : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (loading) {
      if (!wasLoading.current) {
        startedAt.current = Date.now();
        setVisibleLoading(true);
      }
      wasLoading.current = true;
      return undefined;
    }

    if (!wasLoading.current) {
      startedAt.current = null;
      setVisibleLoading(false);
      return undefined;
    }

    const elapsed = startedAt.current === null ? minimumMs : Date.now() - startedAt.current;
    const remaining = Math.max(0, minimumMs - elapsed);
    wasLoading.current = false;
    if (remaining === 0) {
      startedAt.current = null;
      setVisibleLoading(false);
      return undefined;
    }

    timer.current = setTimeout(() => {
      timer.current = null;
      startedAt.current = null;
      setVisibleLoading(false);
    }, remaining);

    return undefined;
  }, [loading, minimumMs]);

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  return visibleLoading;
}
