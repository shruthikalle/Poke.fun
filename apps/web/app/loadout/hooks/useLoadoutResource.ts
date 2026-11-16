"use client";

import { useCallback, useEffect, useState } from "react";

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong. Please try again.";
}

/** Keys keep a previous wallet's data out of the next wallet's render. */
export function useLoadoutResource<T>(key: string | null, load: (key: string) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    attempt: number;
    data: T | null;
    error: string | null;
  } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    Promise.resolve().then(() => load(key)).then(
      (data) => active && setState({ key, attempt, data, error: null }),
      (cause) => active && setState({ key, attempt, data: null, error: errorMessage(cause) }),
    );
    return () => { active = false; };
  }, [key, attempt, load]);

  const current = state?.key === key && state.attempt === attempt ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: key !== null && !current,
    retry,
  };
}
