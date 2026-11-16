"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/battle/battleApi";
import { useWallet } from "../../lib/wallet/WalletProvider";
import type { OutcomeProof } from "../../lib/results";

type Result = OutcomeProof["result"];

export default function HistoryPage() {
  const { playerName } = useWallet();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");

  useEffect(() => { if (playerName && !name) { setName(playerName); setQuery(playerName); } }, [playerName, name]);
  useEffect(() => {
    if (!query) return;
    let active = true;
    apiRequest<{ results: Result[] }>("GET", `/api/history?player=${encodeURIComponent(query)}`)
      .then((data) => { if (active) { setResults(data.results); setError(""); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load history."); });
    return () => { active = false; };
  }, [query]);

  return <main style={{ maxWidth: 800, margin: "3rem auto", padding: "0 1rem", color: "white" }}>
    <Link href="/">← Home</Link>
    <h1>Match history</h1>
    <p>Finished matches on this server, grouped by public player name. Names are not verified accounts yet.</p>
    <form onSubmit={(event) => { event.preventDefault(); setQuery(name.trim()); }} style={{ display: "flex", gap: 8, margin: "1.5rem 0" }}>
      <input aria-label="Player name" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} style={{ flex: 1, padding: 10 }} />
      <button type="submit">Search</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {!error && query && results.length === 0 && <p>No finished matches for {query}.</p>}
    <ul style={{ listStyle: "none", padding: 0 }}>
      {results.map((result) => {
        const seat = result.players[0].name.toLowerCase() === query.toLowerCase() ? "p1" : "p2";
        const opponent = result.players[seat === "p1" ? 1 : 0].name;
        const outcome = result.winner === "draw" ? "Draw" : result.winner === seat ? "Win" : "Loss";
        return <li key={result.id} style={{ border: "1px solid #777", borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <strong>{outcome} vs {opponent}</strong> · {result.mode} · round {result.round}
          <div>{new Date(result.endedAt).toLocaleString()} · {result.reason}</div>
          <Link href={`/replay/${encodeURIComponent(result.id)}`}>Watch replay →</Link>
        </li>;
      })}
    </ul>
  </main>;
}
