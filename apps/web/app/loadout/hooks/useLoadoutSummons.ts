"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/battle/battleApi";
import type { CardPick } from "../../../lib/cards/mapping";
import type { SpeciesData } from "../../../lib/pokemon/SpeciesService";
import { errorMessage } from "./useLoadoutResource";
import { cryUrl } from "../../../lib/audio/AudioEngine";

/** Summons use the same embedded species data as authoritative server teams. */
export function useLoadoutSummons(team: CardPick[]) {
  const ids = [...new Set(team.map((pick) => pick.species))].sort().join(",");
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<Map<string, SpeciesData>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!ids) return;
    let active = true;
    setPending(true);
    setErrors(new Map());
    const keys = ids.split(",");
    void Promise.allSettled(keys.map((key) =>
      apiRequest<SpeciesData>("GET", `/api/species/${encodeURIComponent(key)}`),
    )).then((results) => {
      if (!active) return;
      const next = new Map<string, SpeciesData>();
      const failures = new Map<string, string>();
      results.forEach((result, index) => {
        if (result.status === "fulfilled") next.set(keys[index], { ...result.value, cry: result.value.cry ?? cryUrl(result.value.dex) });
        else failures.set(keys[index], errorMessage(result.reason));
      });
      setData(next);
      setErrors(failures);
      setPending(false);
    });
    return () => { active = false; };
  }, [ids, attempt]);

  const error = useMemo(() => [...errors.values()][0] ?? null, [errors]);
  return { data, error, pending, retry: () => setAttempt((value) => value + 1) };
}
