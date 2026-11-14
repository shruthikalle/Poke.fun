"use client";

import { session as tabStorage } from "../../lib/storage";

import { useCallback, useEffect, useState } from "react";
import { api, type Card, type Match, type Session } from "../../lib/api";
import "./legacy.css";

const SESSION_KEY = "pokefun-session";

function BattleCard({ player, label }: { player: NonNullable<Match["players"][number]>; label: string }) {
  const hp = Math.max(0, Math.round((player.hp / player.card.maxHp) * 100));
  return (
    <article className={`battle-card ${player.card.element.toLowerCase()}`}>
      <span className="card-label">{label}</span>
      <div className="card-symbol" aria-hidden="true">
        {player.card.element === "Fire" ? "✦" : player.card.element === "Water" ? "≈" : "✿"}
      </div>
      <h3>{player.card.name}</h3>
      <p className="player-name">{player.name} · {player.card.element}</p>
      <div className="stat-line"><span>HP</span><strong>{player.hp}/{player.card.maxHp}</strong></div>
      <div className="hp-track"><div style={{ width: `${hp}%` }} /></div>
      <div className="stat-line"><span>Energy</span><strong>{player.energy}</strong></div>
    </article>
  );
}

export default function Home() {
  const [cards, setCards] = useState<Card[]>([]);
  const [name, setName] = useState("");
  const [cardId, setCardId] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = tabStorage.get(SESSION_KEY);
    if (saved) {
      try { setSession(JSON.parse(saved) as Session); } catch { tabStorage.remove(SESSION_KEY); }
    }
    api.cards().then((data) => {
      setCards(data);
      setCardId((current) => current || data[0]?.id || "");
    }).catch((cause: Error) => setError(cause.message));
  }, []);

  const refresh = useCallback(async (current: Session) => {
    try {
      setMatch(await api.match(current));
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refresh(session);
    const timer = window.setInterval(() => void refresh(session), 1000);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  async function enter(mode: "create" | "join") {
    if (!name.trim() || !cardId || (mode === "join" && !roomCode.trim())) {
      setError("Enter a name, choose a card, and add a room code if joining.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = mode === "create"
        ? await api.create(name.trim(), cardId)
        : await api.join(roomCode.trim().toUpperCase(), name.trim(), cardId);
      tabStorage.set(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      await refresh(next);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function attack(attackId: string) {
    if (!session) return;
    setBusy(true);
    try {
      setMatch(await api.attack(session, attackId));
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    tabStorage.remove(SESSION_KEY);
    setSession(null);
    setMatch(null);
    setError("");
  }

  const you = match?.players[match.you];
  const opponent = match?.players[1 - match.you];
  const winnerText = match?.winner === "draw" ? "Draw — both cards were knocked out."
    : match?.winner ? (match.winner === `player${match.you + 1}` ? "You won!" : "You lost.") : "";

  return (
    <div className="legacy">
    <main>
      <header className="site-header"><div className="brand">POKE<span>.FUN</span></div><span className="badge">ONE-CARD DEMO</span></header>
      <div className="intro"><p className="eyebrow">TURN-BASED 1V1</p><h1>One card. One opponent. Your move.</h1><p>Pick a card, share a room code, and battle a friend in another browser. Both attacks resolve together each turn.</p></div>
      {error && <div className="error" role="alert">{error}</div>}

      {session && !match && <button className="secondary reset-session" onClick={leave}>Start a new match</button>}

      {!session && <div className="setup-grid">
        <section className="panel">
          <h2>Choose your fighter</h2>
          <label htmlFor="player-name">Your name</label>
          <input id="player-name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" />
          <div className="card-grid">{cards.map((card) => <button className={`choose-card ${card.id === cardId ? "selected" : ""}`} key={card.id} type="button" onClick={() => setCardId(card.id)}>
            <span className="element">{card.element}</span><strong>{card.name}</strong><small>{card.maxHp} HP · 2 attacks</small>
          </button>)}</div>
        </section>
        <section className="panel join-panel"><h2>Start playing</h2><button className="primary" disabled={busy || !cards.length} onClick={() => void enter("create")}>Create match</button><div className="divider">or join a friend</div><label htmlFor="room-code">Room code</label><input id="room-code" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="8-character code" maxLength={8} /><button className="secondary" disabled={busy || !cards.length} onClick={() => void enter("join")}>Join match</button><p className="hint">Free demo match. No wallet or stakes yet.</p></section>
      </div>}

      {session && match && <section className="arena">
        <div className="room-bar"><div><span className="muted">ROOM CODE</span><strong className="room-code">{match.id}</strong></div><button className="text-button" onClick={() => void navigator.clipboard.writeText(match.id)}>Copy code</button><button className="text-button" onClick={leave}>Leave view</button></div>
        {match.status === "waiting" ? <div className="waiting"><h2>Waiting for opponent</h2><p>Share room code <strong>{match.id}</strong>. Have your friend open this app in another browser or a private window and join with the code.</p></div> : <>
          <div className="battle-top"><span>TURN {match.turn}</span><strong>{winnerText || (match.submitted[match.you] ? "Attack locked in · waiting for opponent" : "Choose an attack")}</strong></div>
          <div className="fighters">{opponent && <BattleCard player={opponent} label="OPPONENT" />}<div className="versus">VS</div>{you && <BattleCard player={you} label="YOU" />}</div>
          {match.status === "playing" && you && <div className="attacks"><h2>Your attacks</h2><div className="attack-grid">{you.card.attacks.map((move) => <button key={move.id} disabled={busy || match.submitted[match.you] || you.energy < move.cost} onClick={() => void attack(move.id)}><strong>{move.name}</strong><span>{move.damage} damage · {move.cost ? `costs ${move.cost} energy` : `gains ${move.gain} energy`}</span></button>)}</div></div>}
          {match.status === "finished" && <div className="result"><h2>{winnerText}</h2><button className="primary" onClick={leave}>Play another match</button></div>}
          <div className="history"><h2>Battle log</h2>{match.history.length ? [...match.history].reverse().map((turn) => <p key={turn.number}>Turn {turn.number}: {match.players[0]?.name} used {turn.attacks[0]} for {turn.damage[0]} damage. {match.players[1]?.name} used {turn.attacks[1]} for {turn.damage[1]} damage.</p>) : <p>First turn is waiting for attacks.</p>}</div>
        </>}
      </section>}
      <footer>Fictional sample cards. Wallet verification and onchain stakes are future milestones.</footer>
    </main>
    </div>
  );
}
