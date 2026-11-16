"use client";

import { OutcomeReceipt } from "../../components/battle/OutcomeReceipt";
import { session as tabStorage } from "../../lib/storage";

import { useCallback, useEffect, useState } from "react";
import { api, type Card, type Effectiveness, type Match, type Session } from "../../lib/api";

const EFFECT_TEXT: Record<Effectiveness, string> = {
  super: " It's super effective!",
  resisted: " It's not very effective.",
  immune: " It had no effect.",
  normal: "",
};
import "./legacy.css";

const SESSION_KEY = "pokefun-session";

function BattleCard({ player, label }: { player: NonNullable<Match["players"][number]>; label: string }) {
  const hp = Math.max(0, Math.round((player.hp / player.card.maxHp) * 100));
  return (
    <article className={`battle-card ${player.card.element.toLowerCase()}`}>
      <span className="card-label">{label}</span>
      <img className="pokemon-sprite" src={player.card.sprite} alt={player.card.name} width={96} height={96} />
      <h3>{player.card.name}</h3>
      <p className="player-name">{player.name} · {player.card.types.join(" / ")} · Lv. {player.card.level}</p>
      <div className="stat-line"><span>HP</span><strong>{player.hp}/{player.card.maxHp}</strong></div>
      <div className="hp-track"><div style={{ width: `${hp}%` }} /></div>
      <div className="stat-line"><span>Energy</span><strong>{player.energy}</strong></div>
    </article>
  );
}

export default function Home() {
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState("");
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
      setCardId((current) => data.some((c) => c.id === current) ? current : data.find((c) => c.id === "pikachu")?.id ?? data[0]?.id ?? "");
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
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 24 || /[\x00-\x1f\x7f-\x9f]/.test(name) || !cardId || (mode === "join" && !roomCode.trim())) {
      setError("Use a player name of 1–24 bytes without control characters, choose a Pokémon, and add a room code if joining.");
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

  const visibleCards = cards.filter((card) => `${card.name} ${card.id} ${card.types.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const selectedCard = cards.find((card) => card.id === cardId);

  const you = match?.players[match.you];
  const opponent = match?.players[1 - match.you];
  const secondsLeft = match?.status === "playing" && match.deadlineUnixMs
    ? Math.max(0, Math.ceil((match.deadlineUnixMs - Date.now()) / 1000))
    : null;
  const winnerText = match?.winner === "draw" ? "Draw — both cards were knocked out."
    : match?.winner ? (match.winner === `player${match.you + 1}` ? "You won!" : "You lost.") : "";

  return (
    <div className="legacy">
    <main>
      <header className="site-header"><div className="brand">POKE<span>.FUN</span></div><span className="badge">ONE-CARD DEMO</span></header>
      <div className="intro"><p className="eyebrow">TURN-BASED 1V1</p><h1>One card. One opponent. Your move.</h1><p>Pick a card, share a room code, and battle a friend in another browser. All 1,214 embedded Pokémon and forms are available at level 50. Both attacks resolve together each turn.</p></div>
      {error && <div className="error" role="alert">{error}</div>}

      {session && !match && <button className="secondary reset-session" onClick={leave}>Start a new match</button>}

      {!session && <div className="setup-grid">
        <section className="panel">
          <h2>Choose your fighter</h2>
          <label htmlFor="player-name">Your name</label>
          <input id="player-name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" />
          <label htmlFor="pokemon-search">Find a Pokémon</label>
          <input id="pokemon-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, form, or type" />
          <p className="hint">Selected: {selectedCard?.name ?? "None"} · {visibleCards.length} Pokémon found</p>
          <div className="card-grid">{visibleCards.map((card) => <button className={`choose-card ${card.id === cardId ? "selected" : ""}`} key={card.id} type="button" onClick={() => setCardId(card.id)}>
            <img src={card.sprite} alt="" width={64} height={64} loading="lazy" /><span className="element">{card.types.join(" / ")}</span><strong>{card.name}</strong><small>{card.maxHp} HP · {card.attacks.length} {card.attacks.length === 1 ? "attack" : "attacks"} · Tier {card.tier}</small>
          </button>)}</div>
        </section>
        <section className="panel join-panel"><h2>Start playing</h2><button className="primary" disabled={busy || !cards.length} onClick={() => void enter("create")}>Create match</button><div className="divider">or join a friend</div><label htmlFor="room-code">Room code</label><input id="room-code" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="8-character code" maxLength={8} /><button className="secondary" disabled={busy || !cards.length} onClick={() => void enter("join")}>Join match</button><p className="hint">Free demo match. Entry fees come later.</p></section>
      </div>}

      {session && match && <section className="arena">
        <div className="room-bar"><div><span className="muted">ROOM CODE</span><strong className="room-code">{match.id}</strong></div><button className="text-button" onClick={() => void navigator.clipboard.writeText(match.id)}>Copy code</button><button className="text-button" onClick={leave}>Leave view</button></div>
        {match.status === "waiting" ? <div className="waiting"><h2>Waiting for opponent</h2><p>Share room code <strong>{match.id}</strong>. Have your friend open this app in another browser or a private window and join with the code.</p></div> : <>
          <div className="battle-top"><span>TURN {match.turn}</span><strong>{winnerText || (match.submitted[match.you] ? "Attack locked in · waiting for opponent" : "Choose an attack")}</strong>{secondsLeft !== null && <span className={`turn-timer${secondsLeft <= 10 ? " low" : ""}`}>⏱ {secondsLeft}s</span>}</div>
          <div className="fighters">{opponent && <BattleCard player={opponent} label="OPPONENT" />}<div className="versus">VS</div>{you && <BattleCard player={you} label="YOU" />}</div>
          {match.status === "playing" && you && <div className="attacks"><h2>Your attacks</h2><div className="attack-grid">{you.card.attacks.map((move) => <button key={move.id} disabled={busy || match.submitted[match.you] || you.energy < move.cost} onClick={() => void attack(move.id)}><strong>{move.name}</strong><span>{move.id === "struggle" ? "Typeless · 25% max-HP recoil" : `${move.element} · ${move.category}`} · {move.power} power · {move.cost ? `costs ${move.cost} energy` : `gains ${move.gain} energy`}</span></button>)}</div></div>}
          {match.status === "finished" && <div className="result"><h2>{winnerText}</h2><OutcomeReceipt mode="matches" id={session.id} token={session.token} /><button className="primary" onClick={leave}>Play another match</button></div>}
          <div className="history"><h2>Battle log</h2>{match.history.length ? [...match.history].reverse().map((turn) => <p key={turn.number}>Turn {turn.number}: {match.players[0]?.name} used {turn.attacks[0]}{turn.auto[0] ? " (timed out)" : ""} for {turn.damage[0]} damage.{EFFECT_TEXT[turn.effect[0]]} {match.players[1]?.name} used {turn.attacks[1]}{turn.auto[1] ? " (timed out)" : ""} for {turn.damage[1]} damage.{EFFECT_TEXT[turn.effect[1]]}</p>) : <p>First turn is waiting for attacks.</p>}</div>
        </>}
      </section>}
      <footer>Custom simultaneous duels: quick attacks gain 1 energy; heavy attacks cost 2. Damage uses level-50 stats, both defensive types, and STAB. Attacks always hit and have unlimited uses in this format. No secondary effects, Transform, or abilities. Struggle is typeless with 25% max-HP recoil. Players need distinct names.</footer>
    </main>
    </div>
  );
}
