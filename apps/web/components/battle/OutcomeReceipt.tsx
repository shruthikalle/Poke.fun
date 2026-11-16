"use client";

import { useEffect, useState } from "react";
import { describeEligibility, getOutcomeProof, verifyOutcomeProof, type OutcomeProof, type ResultMode } from "../../lib/results";

interface Props { mode: ResultMode; id: string; token: string }

export function OutcomeReceipt({ mode, id, token }: Props) {
  const [receipt, setReceipt] = useState<OutcomeProof | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReceipt(null);
    setError(null);
    void getOutcomeProof(mode, id, token).then(async (proof) => {
      const valid = await verifyOutcomeProof(proof);
      if (valid === false) throw new Error("The result signature did not verify.");
      if (active) { setReceipt(proof); setVerified(valid); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not retrieve the saved result.");
    });
    return () => { active = false; };
  }, [mode, id, token, attempt]);

  const download = () => {
    if (!receipt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${receipt.result.mode}-${receipt.result.matchId}-round-${receipt.result.round}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section aria-label="Saved game result" aria-live="polite">
    {error ? <><p role="alert">{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry result</button></>
      : receipt ? <>
        <p>{verified ? "Server signature verified. Game result saved." : "Signed game result saved. This browser cannot verify Ed25519 signatures."}</p>
        <p>{receipt.result.players.map(describeEligibility).join(" · ")}
          {receipt.result.entryCents ? ` · Agreed entry $${(receipt.result.entryCents / 100).toFixed(2)}` : ""}</p>
        <p>No funds were deposited or paid out. Wager settlement is not connected.</p>
        <button type="button" onClick={download}>Download signed result</button>
      </> : <p>Loading the authoritative game result…</p>}
  </section>;
}
