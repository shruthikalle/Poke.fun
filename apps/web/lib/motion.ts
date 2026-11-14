"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "pf-motion-paused";

/** Site-wide motion preference: the OS reduced-motion setting or the "Pause motion" toggle. */
export function useMotionPreference() {
  const [paused, setPausedState] = useState(false);
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReduced(mq.matches);
    setPausedState(localStorage.getItem(KEY) === "1");
    const onChange = () => setSystemReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setPaused = useCallback((next: boolean) => {
    setPausedState(next);
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* memory only */ }
  }, []);

  return { paused, setPaused, reduced: paused || systemReduced };
}
