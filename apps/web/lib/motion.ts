"use client";

import { local } from "./storage";
import { useCallback, useEffect, useState } from "react";

const KEY = "pf-motion-paused";

/** Site-wide motion preference: the OS reduced-motion setting or the "Pause motion" toggle. */
export function useMotionPreference() {
  const [paused, setPausedState] = useState(false);
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReduced(mq.matches);
    setPausedState(local.get(KEY) === "1");
    const onChange = () => setSystemReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setPaused = useCallback((next: boolean) => {
    setPausedState(next);
    local.set(KEY, next ? "1" : "0");
  }, []);

  return { paused, setPaused, reduced: paused || systemReduced };
}
