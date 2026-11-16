"use client";

import Link from "next/link";
import { OutcomeReceipt } from "../../components/battle/OutcomeReceipt";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { arenaApi, ARENA_QUEUE_STORAGE_KEY, ARENA_SESSION_STORAGE_KEY, type ArenaCard, type ArenaQueueTicket, type ArenaSession, type ArenaView, arenaSessionExpired } from "../../lib/arena";
import { collectionService } from "../../lib/cards/collection";
import { session as tabStorage } from "../../lib/storage";
import { FighterToken, ChargeEffect, AttackEffect } from "./ArenaEffects";
import { useArenaConnection } from "./useArenaConnection";
import { useWallet } from "../../lib/wallet/WalletProvider";
import styles from "./arena.module.css";

/** Fighters matching the search, devnet cards in the wallet first, then by Dex number. */
function pickable(cards: ArenaCard[], owned: string[], query: string) {
  const q = query.trim().toLowerCase();
  const matches = q ? cards.filter((c) => c.name.toLowerCase().includes(q) || c.types.some((t) => t.toLowerCase() === q)) : cards;
  return [...matches].sort((a, b) => Number(owned.includes(b.id)) - Number(owned.includes(a.id)));
}

export default function ArenaPage() {
  const pathname = usePathname();
  const router = useRouter();
  const liveBattleRoute = pathname === "/battle/live";
  const { session: wallet, playerName } = useWallet();
  const [cards, setCards] = useState<ArenaCard[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [cardId, setCardId] = useState("pikachu");
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<ArenaQueueTicket | null>(null);
  const [session, setSession] = useState<ArenaSession | null>(null);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const keys = useRef(new Set<string>());
  const aim = useRef<{ x: number; y: number } | null>(null);
  const { view, setView, connection } = useArenaConnection(session, keys, aim, setError);

  useEffect(() => {
    if (liveBattleRoute && !tabStorage.get(ARENA_SESSION_STORAGE_KEY) && !tabStorage.get(ARENA_QUEUE_STORAGE_KEY)) { router.replace("/loadout"); return; }
    const pending = tabStorage.get(ARENA_QUEUE_STORAGE_KEY);
    if (pending) {
      try { setQueue(JSON.parse(pending) as ArenaQueueTicket); }
      catch { tabStorage.remove(ARENA_QUEUE_STORAGE_KEY); }
    }
    const saved = tabStorage.get(ARENA_SESSION_STORAGE_KEY);
    if (saved) {
      try { const restored = JSON.parse(saved) as ArenaSession; if (restored.id && restored.token) { setSession(restored); setQueue(null); } else throw new Error("Invalid saved session"); }
      catch { tabStorage.remove(ARENA_SESSION_STORAGE_KEY); }
    }
    arenaApi.cards().then(setCards).catch((cause: Error) => setError(cause.message));
  }, [liveBattleRoute, router]);

  useEffect(() => {
    if (!queue) return;
    let active = true;
    const check = async () => {
      try {
        const status = queue.status === "matched" ? queue : await arenaApi.queueStatus(queue);
        if (!active) return;
        if (status.status === "matched" && status.arena) {
          tabStorage.set(ARENA_SESSION_STORAGE_KEY, JSON.stringify(status.arena));
          tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
          setQueue(null);
          setSession(status.arena);
        }
      } catch (cause) {
        if (!active) return;
        setError((cause as Error).message);
        if (arenaSessionExpired(cause)) {
          tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
          setQueue(null);
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 700);
    return () => { active = false; window.clearInterval(timer); };
  }, [queue]);

  useEffect(() => { if (playerName) setName(playerName.slice(0, 24)); }, [playerName]);
  useEffect(() => {
    if (!wallet) { setOwned([]); return; }
    let active = true;
    collectionService.getOwnedCollectibles(wallet.address).then((assets) => {
      if (!active) return;
      setOwned(assets.map((asset) => asset.content.metadata.attributes.find((a) => a.trait_type === "Card Name")?.value?.toLowerCase() ?? "").filter(Boolean));
    }).catch(() => { if (active) setOwned([]); });
    return () => { active = false; };
  }, [wallet]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "j", "k", " ", "shift"].includes(key)) event.preventDefault();
      keys.current.add(key);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  const findMatch = async () => {
    if (!name.trim() || !cardId) { setError("Enter a name and choose a fighter."); return; }
    setBusy(true); setError("");
    try {
      const ticket = await arenaApi.enqueue(name.trim(), cardId, 1500);
      tabStorage.remove(ARENA_SESSION_STORAGE_KEY);
      tabStorage.set(ARENA_QUEUE_STORAGE_KEY, JSON.stringify(ticket));
      setQueue(ticket);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const cancelSearch = async () => {
    if (!queue) return;
    setBusy(true);
    try {
      await arenaApi.cancelQueue(queue);
      tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
      setQueue(null);
      setError("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const leave = () => { if (view?.status === "finished" || connection === "expired") tabStorage.remove(ARENA_SESSION_STORAGE_KEY); keys.current.clear(); setSession(null); setView(null); setError(""); if (liveBattleRoute) router.push("/loadout"); };
  const forfeit = async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      setView(await arenaApi.forfeit(session));
      keys.current.clear();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const hold = (key: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture(event.pointerId); keys.current.add(key); },
    onPointerUp: () => keys.current.delete(key), onPointerCancel: () => keys.current.delete(key),
  });
  const me = view?.fighters[view.you];
  const them = view?.fighters[1 - view.you];
  const outcome = view?.winner === "draw" ? "Draw" : view?.winner ? (view.winner === `player${view.you + 1}` ? "You win!" : "You lose") : "";
  const pointAim = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !me) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    aim.current = { x: (event.clientX - bounds.left) / bounds.width * 960 - me.x, y: (event.clientY - bounds.top) / bounds.height * 540 - me.y };
  };

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}>POKE<span>.FUN</span></Link><strong>{liveBattleRoute ? "LIVE BATTLE" : "LIVE 1V1 ARENA"}</strong><span className={styles.connection}>{session ? connection : queue ? "SEARCHING" : "FREE DEMO"}</span></header>
    {!liveBattleRoute && <section className={styles.intro}><p>One card · one opponent · real-time combat</p><h1>Enter the arena</h1><p>Land basic attacks to build energy. Spend it on your special, aim for an opening, and dodge incoming hits. No real money or card transfers.</p></section>}
    {error && <div className={styles.error} role="alert">{error}</div>}
    {liveBattleRoute && !session ? <section className={styles.panel}><div className={styles.waiting}><h2>Connecting to live battle…</h2></div></section> : queue && !session ? <section className={styles.panel}><div className={styles.waiting}><h2>Finding an opponent…</h2><p>You’re in the live queue. The next available player will be matched with you automatically.</p><button className={styles.secondary} disabled={busy} onClick={() => void cancelSearch()}>Cancel search</button></div></section> : !session ? <div className={styles.setup}>
      <section className={styles.panel}><h2>Choose your fighter</h2><label htmlFor="arena-name">Your name</label><input id="arena-name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" />
        <label htmlFor="arena-search">Fighter</label><input id="arena-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${cards.length} fighters`} />
        <div className={styles.cards}>{pickable(cards, owned, query).map((card) => <button type="button" className={styles.card} data-selected={card.id === cardId || undefined} key={card.id} onClick={() => setCardId(card.id)}>
          <img src={card.sprite} alt="" loading="lazy" /><strong>{card.name}</strong><small>{card.types.join(" / ")} · Tier {card.tier}</small><small>Lv. {card.level} · {card.maxHp} HP</small>{owned.includes(card.id) && <em>Devnet card in wallet</em>}
        </button>)}</div>
        <p className={styles.note}>Training fighters are available to everyone. A connected Devnet card is shown for your reference; this free arena does not authorize NFT wagers.</p>
      </section>
      <section className={styles.panel}><h2>Find a real opponent</h2><p className={styles.note}>One click enters the free live queue. When another player is waiting, the match starts automatically.</p><button className={styles.primary} disabled={busy || !cards.length} onClick={() => void findMatch()}>Find match</button><p className={styles.note}>Play from two different browsers or devices to test with a friend. No room code needed.</p></section>
    </div> : <section className={styles.game}>
      <div className={styles.room}><span>LIVE MATCH <strong>{session.id}</strong>{session.entryCents ? ` · Demo $${(session.entryCents / 100).toFixed(2)} entry, no transfer` : " · Free"}</span>{view?.status === "playing" && <button disabled={busy} onClick={() => void forfeit()}>Forfeit match</button>}<button onClick={leave}>{liveBattleRoute ? "Back to loadout" : "Leave view"}</button></div>
      {connection === "expired" && <p role="alert">This arena session has expired. Return to loadout to find a match.</p>}
      {view?.status === "playing" && view.connected?.some((online) => !online) && <p role="status">Combat paused while players reconnect. Rejoin within 30 seconds after both players have first connected.</p>}
      {!view || view.status === "waiting" ? <div className={styles.waiting}><h2>Connecting to arena</h2><p>Loading the match state…</p></div> : <>
        <div className={styles.score}>{[view?.fighters[0], view?.fighters[1]].map((fighter, i) => fighter ? <div key={i}><strong>{fighter.name} · {fighter.card.name}</strong><span>Lv. 50 · {fighter.hp}/{fighter.card.maxHp} HP · {fighter.energy}/3 energy</span><div className={styles.hp}><span style={{ width: `${fighter.hp / fighter.card.maxHp * 100}%` }} /></div><div className={styles.energy} aria-label={`${fighter.energy} of 3 energy`}>{[0, 1, 2].map((slot) => <i key={slot} data-filled={slot < fighter.energy || undefined} />)}</div></div> : null)}<div className={styles.timer}>{Math.ceil((view?.timeLeftMs ?? 0) / 1000)}s</div></div>
        <div className={styles.stage} onPointerMove={pointAim} onPointerLeave={() => { aim.current = null; }}><svg className={styles.effects} viewBox="0 0 960 540" preserveAspectRatio="none" aria-hidden="true">{view.fighters.map((fighter, i) => fighter ? <ChargeEffect key={`charge-${i}`} fighter={fighter} /> : null)}{view.fighters.map((fighter, i) => fighter ? <AttackEffect key={i} fighter={fighter} tick={view.tick} index={i} /> : null)}</svg>{view.fighters.map((fighter, i) => fighter ? <FighterToken key={i} fighter={fighter} index={i} tick={view.tick} you={view.you} /> : null)}{view.status === "finished" && <div className={styles.overlay}><h2>{outcome}</h2><p>{view.winner === "draw" ? "Both fighters are even." : "The arena has a winner."}</p><OutcomeReceipt mode="arenas" id={session.id} token={session.token} /><button onClick={leave}>Play again</button></div>}</div>
        <div className={styles.controls}><div className={styles.dpad}><span /><button aria-label="Move up" {...hold("w")}>↑</button><span /><button aria-label="Move left" {...hold("a")}>←</button><button aria-label="Move down" {...hold("s")}>↓</button><button aria-label="Move right" {...hold("d")}>→</button></div><div className={styles.moves}><button {...hold("j")} disabled={connection !== "online" || view?.status !== "playing" || !!me?.charging}>J / Space<br /><strong>{me?.card.basic.name ?? "Basic"}</strong><small>≈{me?.card.basic.damage} dmg · +1 energy on hit</small></button><button {...hold("k")} disabled={connection !== "online" || view?.status !== "playing" || !!me?.charging || (me?.energy ?? 0) < 2}>K<br /><strong>{me?.card.special.name ?? "Special"}</strong><small>≈{me?.card.special.damage} dmg {me?.card.special.type} · 2 energy · {me?.specialCooldownMs ? `${(me.specialCooldownMs / 1000).toFixed(1)}s` : "ready"}</small></button><button {...hold("shift")} disabled={connection !== "online" || view?.status !== "playing" || !!me?.charging || !!me?.dodgeCooldownMs}>Shift<br /><strong>Dodge</strong><small>{me?.dodgeCooldownMs ? `${(me.dodgeCooldownMs / 1000).toFixed(1)}s` : "ready"}</small></button></div></div>
        <p className={styles.note}>Move: WASD or arrows. Basic: hold J or Space to build energy on hits. Special: press K with 2 energy, then watch its 0.4-second warning area. Dodge: press Shift to dash out or avoid the impact. Hover over the arena to aim Flamethrower; otherwise it auto-aims.</p>
      </>}
    </section>}
  </main>;
}
