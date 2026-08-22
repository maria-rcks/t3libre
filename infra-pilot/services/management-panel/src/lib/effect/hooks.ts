import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { Stream as StreamType } from 'effect';
import { Effect, Stream, Schedule, either, pipe, Option, Fiber, Runtime } from 'effect';

export interface EffectState<A, E> {
  data: A | null;
  error: E | null;
  loading: boolean;
}

export function useEffectful<A, E>(
  effect: () => Effect.Effect<A, E, never>,
  deps: any[] = []
): EffectState<A, E> & { refresh: () => void } {
  const [state, setState] = useState<EffectState<A, E>>({
    data: null,
    error: null,
    loading: true,
  });

  const fetchRef = useRef<(() => void) | null>(null);

  const run = useCallback(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));

    const cancel = Effect.runCallback(effect(), {
      onSuccess: (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      onFailure: (error) => {
        if (!cancelled) setState({ data: null, error: error as E, loading: false });
      },
    });

    fetchRef.current = cancel;
    return () => {
      cancelled = true;
      fetchRef.current?.();
    };
  }, deps);

  useEffect(() => {
    const cancel = run();
    return () => cancel?.();
  }, [run]);

  return { ...state, refresh: run };
}

export function useMutation<A, E, P extends any[] = []>(
  effectFactory: (...args: P) => Effect.Effect<A, E, never>
): {
  execute: (...args: P) => Promise<A>;
  state: EffectState<A, E>;
  reset: () => void;
} {
  const [state, setState] = useState<EffectState<A, E>>({
    data: null,
    error: null,
    loading: false,
  });

  const execute = useCallback(async (...args: P): Promise<A> => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const result = await Effect.runPromise(effectFactory(...args));
      setState({ data: result, error: null, loading: false });
      return result;
    } catch (error) {
      setState({ data: null, error: error as E, loading: false });
      throw error;
    }
  }, deps);

  const reset = useCallback(() => {
    setState({ data: null, error: null, loading: false });
  }, []);

  return { execute, state, reset };
}

export function useEffectStream<A, E>(
  streamFactory: () => StreamType.Stream<A, E, never>,
  deps: any[] = []
): { data: A[]; error: E | null; loading: boolean; running: boolean } {
  const [data, setData] = useState<A[]>([]);
  const [error, setError] = useState<E | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData([]);
    setError(null);
    setRunning(true);

    const subscription = Stream.runForEach(streamFactory(), (item) =>
      Effect.sync(() => {
        if (!cancelled) setData(prev => [...prev, item]);
      })
    );

    Effect.runCallback(subscription, {
      onSuccess: () => { if (!cancelled) setRunning(false); },
      onFailure: (e) => { if (!cancelled) { setError(e as E); setRunning(false); } },
    });

    return () => { cancelled = true; };
  }, deps);

  return { data, error, loading: running, running };
}

export const useAsyncEffect = useEffectful;
