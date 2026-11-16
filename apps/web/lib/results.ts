import { apiRequest } from "./battle/battleApi";

export type ResultMode = "arenas" | "battles" | "matches";

export interface ResultParticipant { seat: "p1" | "p2"; name: string; species: string[]; assets?: string[] }

/** One line per seat: how many of its creatures were verified NFTs. */
export function describeEligibility(player: ResultParticipant): string {
  const owned = player.assets?.filter(Boolean).length ?? 0;
  if (owned === 0) return `${player.name}: rental${player.species.length > 1 ? "s" : ""}`;
  return `${player.name}: ${owned} of ${player.species.length} verified NFT${owned > 1 ? "s" : ""}`;
}

export interface OutcomeProof {
  result: {
    schemaVersion: string;
    id: string;
    matchId: string;
    mode: string;
    round: number;
    /** Verified NFTs are aligned with species ("" = rental); absent for an all-rental seat. */
    players: [ResultParticipant, ResultParticipant];
    /** The entry both seats agreed to at pairing; omitted when free. Not a deposit. */
    entryCents?: number;
    winner: "p1" | "p2" | "draw";
    reason: string;
    stateHash: string;
    endedAt: number;
    funding: "unfunded";
    settlement: "not_connected";
  };
  payload: string;
  signature: string;
  publicKey: string;
  algorithm: "Ed25519";
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function getOutcomeProof(mode: ResultMode, id: string, token: string): Promise<OutcomeProof> {
  return apiRequest("GET", `/api/${mode}/${encodeURIComponent(id)}/result`, undefined, token, AbortSignal.timeout(8000));
}

// This verifies the issuing server's signature, not an independent combat
// replay or proof that a wallet funded the match. External consumers pin its key.
export async function verifyOutcomeProof(proof: OutcomeProof): Promise<boolean | null> {
  if (proof.algorithm !== "Ed25519" || !proof.payload) return false;
  const payload = decodeBase64Url(proof.payload);
  if (JSON.stringify(JSON.parse(new TextDecoder().decode(payload))) !== JSON.stringify(proof.result)) return false;
  const referee = await apiRequest<{ publicKey: string }>("GET", "/api/referee", undefined, undefined, AbortSignal.timeout(8000));
  if (referee.publicKey !== proof.publicKey) return false;
  try {
    const key = await crypto.subtle.importKey("raw", decodeBase64Url(proof.publicKey), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, decodeBase64Url(proof.signature), payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotSupportedError") return null;
    throw error;
  }
}
