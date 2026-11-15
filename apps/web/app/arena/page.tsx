"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { arenaApi, ARENA_QUEUE_STORAGE_KEY, ARENA_SESSION_STORAGE_KEY, type ArenaCard, type ArenaQueueTicket, type ArenaSession, type ArenaView, type Fighter } from "../../lib/arena";
import { AccountChip } from "../../components/AccountChip";
import { Emblem } from "../../components/Emblem";
import { collectionService } from "../../lib/cards/collection";
import { session as tabStorage } from "../../lib/storage";
import { useWallet } from "../../lib/wallet/WalletProvider";
import styles from "./arena.module.css";

const sprites: Record<string, string> = {
  pikachu: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png",
  charmander: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/4.png",
};

function FighterToken({ fighter, index, tick, you }: { fighter: Fighter; index: number; tick: number; you: number }) {
  const attacking = tick - fighter.lastAttackTick < 6 && fighter.lastAttackTick > 0;
  return <div className={styles.fighter} data-you={index === you || undefined} data-attack={attacking ? fighter.lastAttack : undefined} data-dodging={fighter.dodging || undefined} data-charging={fighter.charging || undefined}
    style={{ left: `${fighter.x / 960 * 100}%`, top: `${fighter.y / 540 * 100}%` }}>
    <div className={styles.fighterLabel}>{fighter.name}</div>
    <div className={styles.fighterHp}><span style={{ width: `${fighter.hp / fighter.card.maxHp * 100}%` }} /></div>
    <div className={styles.fighterSprite}><img src={sprites[fighter.card.id]} alt={fighter.card.name} draggable={false} /></div>
    {fighter.charging && <div className={styles.chargeLabel}>⚠ {Math.ceil(fighter.chargeMsLeft / 100) / 10}s</div>}
  </div>;
}

function ChargeEffect({ fighter }: { fighter: Fighter }) {
  if (!fighter.charging) return null;
  const { chargeX: x, chargeY: y, chargeDx: dx, chargeDy: dy } = fighter;
  if (fighter.card.id === "pikachu") return <g className={styles.telegraphElectric}><circle cx={x} cy={y} r="225" fill="#e8ed7d" fillOpacity=".13" stroke="#f4ee72" strokeWidth="5" strokeDasharray="20 12" /></g>;
  const px = -dy, py = dx;
  const endX = x + dx * 205, endY = y + dy * 205;
  return <g className={styles.telegraphFire}><path d={`M ${x} ${y} L ${endX + px * 96} ${endY + py * 96} Q ${endX} ${endY} ${endX - px * 96} ${endY - py * 96} Z`} fill="#ff9a3b" fillOpacity=".24" stroke="#ffc26e" strokeWidth="4" strokeDasharray="12 9" /></g>;
}

function AttackEffect({ fighter, tick, index }: { fighter: Fighter; tick: number; index: number }) {
  if (!fighter.lastAttack || fighter.lastAttackTick === 0 || tick - fighter.lastAttackTick > 12) return null;
  const { attackX: x, attackY: y, attackDx: dx, attackDy: dy, attackTargetX: tx, attackTargetY: ty } = fighter;
  const px = -dy, py = dx;
  const isSpecial = fighter.lastAttack === "special";
  const flame = isSpecial && fighter.card.id === "charmander";
  const lightning = isSpecial && fighter.card.id === "pikachu";
  const gradient = `flame-${index}`;
  const flamePath = `M ${x + dx * 28} ${y + dy * 28} Q ${x + dx * 98 + px * 25} ${y + dy * 98 + py * 25} ${x + dx * 205 + px * 96} ${y + dy * 205 + py * 96} Q ${x + dx * 185} ${y + dy * 185} ${x + dx * 205 - px * 96} ${y + dy * 205 - py * 96} Q ${x + dx * 98 - px * 25} ${y + dy * 98 - py * 25} ${x + dx * 28} ${y + dy * 28} Z`;
  const strike = `M ${tx - 28} ${Math.max(0, ty - 235)} L ${tx + 12} ${ty - 130} L ${tx - 16} ${ty - 127} L ${tx + 21} ${ty - 50} L ${tx - 8} ${ty - 48} L ${tx + 5} ${ty + 14}`;
  return <g key={`${index}-${fighter.lastAttackTick}`} className={flame ? styles.flameEffect : lightning ? styles.lightningEffect : styles.basicEffect}>
    {flame ? <>
      <defs><linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0"><stop stopColor="#fff5a3" /><stop offset=".45" stopColor="#ffb12b" /><stop offset="1" stopColor="#f43b18" stopOpacity=".7" /></linearGradient></defs>
      <path d={flamePath} fill={`url(#${gradient})`} stroke="#ffda5d" strokeWidth="5" />
      <path d={`M ${x + dx * 34} ${y + dy * 34} L ${x + dx * 175 + px * 32} ${y + dy * 175 + py * 32} L ${x + dx * 145 - px * 28} ${y + dy * 145 - py * 28} Z`} fill="#fff6b9" opacity=".8" />
    </> : lightning ? <>
      {[0, 1, 2, 3, 4, 5].map((n) => {
        const angle = n * Math.PI / 3 + index * .4;
        const cx = x + Math.cos(angle) * 120, cy = y + Math.sin(angle) * 120;
        return <path key={n} d={`M ${cx - 18} ${cy - 30} l 18 18 -10 3 22 28`} fill="none" stroke="#b9f5ff" strokeWidth="5" strokeLinejoin="round" opacity=".75" />;
      })}
      {fighter.lastAttackHit && <><path d={strike} fill="none" stroke="#efffff" strokeWidth="17" strokeLinejoin="round" opacity=".75" /><path d={strike} fill="none" stroke="#74ddff" strokeWidth="7" strokeLinejoin="round" /><circle cx={tx} cy={ty} r="37" fill="#b9f7ff" opacity=".55" /></>}
    </> : fighter.card.id === "pikachu" ? <>
      <path d={`M ${x} ${y} Q ${(x + tx) / 2} ${(y + ty) / 2 - 26} ${fighter.lastAttackHit ? tx : x + dx * 100} ${fighter.lastAttackHit ? ty : y + dy * 100}`} fill="none" stroke="#fffbe1" strokeWidth="13" strokeLinecap="round" opacity=".85" />
      <path d={`M ${x} ${y + 18} l ${-dx * 48} ${-dy * 48}`} fill="none" stroke="#fff17e" strokeWidth="6" strokeLinecap="round" />
    </> : <>
      {[-16, 0, 16].map((offset) => <path key={offset} d={`M ${tx - 22 + offset} ${ty - 31} Q ${tx + offset} ${ty - 10} ${tx + 17 + offset} ${ty + 28}`} fill="none" stroke="#fff2d3" strokeWidth="7" strokeLinecap="round" opacity={fighter.lastAttackHit ? 1 : .35} />)}
    </>}
  </g>;
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
  const [queue, setQueue] = useState<ArenaQueueTicket | null>(null);
  const [session, setSession] = useState<ArenaSession | null>(null);
  const [view, setView] = useState<ArenaView | null>(null);
  const [connection, setConnection] = useState("offline");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const keys = useRef(new Set<string>());
  const aim = useRef<{ x: number; y: number } | null>(null);
  const previous = useRef<ArenaView | null>(null);
  const [feed, setFeed] = useState<{ id: number; text: string; tone?: "you" | "them" | "event" }[]>([]);

  useEffect(() => {
    if (liveBattleRoute && !tabStorage.get(ARENA_SESSION_STORAGE_KEY)) { router.replace("/loadout"); return; }
    const pending = tabStorage.get(ARENA_QUEUE_STORAGE_KEY);
    if (pending) {
      try { setQueue(JSON.parse(pending) as ArenaQueueTicket); }
      catch { tabStorage.remove(ARENA_QUEUE_STORAGE_KEY); }
    }
    const saved = tabStorage.get(ARENA_SESSION_STORAGE_KEY);
    if (saved) {
      try { if (!pending) setSession(JSON.parse(saved) as ArenaSession); }
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
        tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
        setQueue(null);
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

  useEffect(() => {
    if (!session) return;
    let active = true;
    let reconnect: number | undefined;
    const connect = () => {
      if (!active) return;
      setConnection("connecting");
      const ws = new WebSocket(arenaApi.socketUrl(session.id));
      socket.current = ws;
      ws.onopen = () => { ws.send(JSON.stringify({ type: "auth", token: session.token })); setConnection("online"); };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ArenaView & { error?: string };
          if (data.error) { setError(data.error); return; }
          if (active) { setView(data); setError(""); }
        } catch { setError("Invalid arena update"); }
      };
      ws.onclose = () => { if (active) { setConnection("reconnecting"); reconnect = window.setTimeout(connect, 1200); } };
      ws.onerror = () => ws.close();
    };
    arenaApi.view(session).then((next) => { if (active) setView(next); }).catch((cause: Error) => { if (active) setError(cause.message); });
    connect();
    const inputTimer = window.setInterval(() => {
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const held = keys.current;
      ws.send(JSON.stringify({
        dx: Number(held.has("d") || held.has("arrowright")) - Number(held.has("a") || held.has("arrowleft")),
        dy: Number(held.has("s") || held.has("arrowdown")) - Number(held.has("w") || held.has("arrowup")),
        aimX: aim.current?.x ?? 0, aimY: aim.current?.y ?? 0,
        basic: held.has("j") || held.has(" "), special: held.has("k"), dodge: held.has("shift"),
      }));
    }, 50);
    return () => { active = false; window.clearInterval(inputTimer); window.clearTimeout(reconnect); socket.current?.close(); socket.current = null; };
  }, [session]);

  useEffect(() => {
    if (!view) return;
    const before = previous.current;
    previous.current = view;
    if (!before || before.id !== view.id) { setFeed([]); if (view.status === "playing") setFeed([{ id: view.tick, text: "Battle in progress", tone: "event" }]); return; }
    const entries: { id: number; text: string; tone?: "you" | "them" | "event" }[] = [];
    if (before.status === "waiting" && view.status === "playing") entries.push({ id: view.tick, text: "Battle start!", tone: "event" });
    view.fighters.forEach((fighter, i) => {
      const old = before.fighters[i];
      if (!fighter || !old || !fighter.lastAttack || fighter.lastAttackTick === old.lastAttackTick) return;
      const move = fighter.lastAttack === "special" ? fighter.card.special : fighter.card.basic;
      const target = view.fighters[1 - i];
      const lost = target && before.fighters[1 - i] ? before.fighters[1 - i]!.hp - target.hp : 0;
      const result = fighter.lastAttackHit ? lost > 0 ? ` · ${lost} damage` : " · hit" : " · missed";
      entries.push({ id: view.tick * 2 + i, text: `${i === view.you ? "Your" : `${fighter.name}'s`} ${fighter.card.name} used ${move.name}${result}`, tone: i === view.you ? "you" : "them" });
    });
    if (view.status === "finished" && before.status !== "finished") {
      entries.push({ id: view.tick * 2 + 9, text: view.winner === "draw" ? "Time! The battle is a draw." : view.winner === `player${view.you + 1}` ? "You won the battle!" : `${view.fighters[1 - view.you]?.name ?? "Your opponent"} won the battle.`, tone: "event" });
    }
    if (entries.length) setFeed((current) => [...entries.reverse(), ...current].slice(0, 40));
  }, [view]);

  const findMatch = async () => {
    if (!name.trim() || !cardId) { setError("Enter a name and choose a fighter."); return; }
    setBusy(true); setError("");
    try {
      const ticket = await arenaApi.enqueue(name.trim(), cardId, 1500, 1);
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
  const leave = () => { tabStorage.remove(ARENA_SESSION_STORAGE_KEY); keys.current.clear(); setSession(null); setView(null); setError(""); if (liveBattleRoute) router.push("/loadout"); };
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
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><Emblem size={22} /><span>Poke.fun</span></Link>
      <nav className={styles.nav} aria-label="Main"><Link href="/loadout">Battle</Link><Link href="/market">Marketplace</Link><Link href="/collection">My Cards</Link></nav>
      <div className={styles.account}>
        <span className={styles.connection} data-state={session ? connection : queue ? "searching" : "idle"}>{session ? connection : queue ? "searching" : liveBattleRoute ? "live battle" : "free demo"}</span>
        {playerName ? <AccountChip classes={{ chip: styles.chip, avatar: styles.chipAvatar, menu: styles.menu, menuItem: styles.menuItem }} /> : null}
      </div>
    </header>
    {!liveBattleRoute && <section className={styles.intro}><p>One card · one opponent · real-time combat</p><h1>Enter the arena</h1><p>Land basic attacks to build energy. Spend it on your special, aim for an opening, and dodge incoming hits. No real money or card transfers.</p></section>}
    {error && <div className={styles.error} role="alert">{error}</div>}
    {liveBattleRoute && !session ? <section className={styles.panel}><div className={styles.waiting}><h2>Connecting to live battle…</h2></div></section> : queue && !session ? <section className={styles.panel}><div className={styles.waiting}><h2>Finding an opponent…</h2><p>You’re in the live queue. The next available player will be matched with you automatically.</p><button className={styles.secondary} disabled={busy} onClick={() => void cancelSearch()}>Cancel search</button></div></section> : !session ? <div className={styles.setup}>
      <section className={styles.panel}><h2>Choose your fighter</h2><label htmlFor="arena-name">Your name</label><input id="arena-name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" />
        <div className={styles.cards}>{cards.map((card) => <button type="button" className={styles.card} data-selected={card.id === cardId || undefined} key={card.id} onClick={() => setCardId(card.id)}>
          <img src={sprites[card.id]} alt="" /><strong>{card.name}</strong><small>Lv. {card.level} · {card.maxHp} HP</small>{owned.includes(card.id) && <em>Devnet card in wallet</em>}
        </button>)}</div>
        <p className={styles.note}>Training fighters are available to everyone. A connected Devnet card is shown for your reference; this free arena does not authorize NFT wagers.</p>
      </section>
      <section className={styles.panel}><h2>Find a real opponent</h2><p className={styles.note}>One click enters the free live queue. When another player is waiting, the match starts automatically.</p><button className={styles.primary} disabled={busy || !cards.length} onClick={() => void findMatch()}>Find match</button><p className={styles.note}>Play from two different browsers or devices to test with a friend. No room code needed.</p></section>
    </div> : <section className={styles.game}>
      <div className={styles.room}><span>LIVE MATCH <strong>{session.id}</strong>{session.entryCents ? ` · Demo $${(session.entryCents / 100).toFixed(2)} entry, no transfer` : " · Free"}</span><button onClick={leave}>{liveBattleRoute ? "Back to loadout" : "Leave view"}</button></div>
      {!view || view.status === "waiting" ? <div className={styles.waiting}><h2>{view ? "Waiting for your opponent…" : "Connecting to arena"}</h2><p>{view ? "The battle starts as soon as both players are connected." : "Loading the match state…"}</p></div> : <div className={styles.layout}><div className={styles.main}>
        <div className={styles.score}>{[view?.fighters[0], view?.fighters[1]].map((fighter, i) => fighter ? <div key={i}><strong>{fighter.name} · {fighter.card.name}</strong><span>Lv. 50 · {fighter.hp}/{fighter.card.maxHp} HP · {fighter.energy}/3 energy</span><div className={styles.hp}><span style={{ width: `${fighter.hp / fighter.card.maxHp * 100}%` }} /></div><div className={styles.energy} aria-label={`${fighter.energy} of 3 energy`}>{[0, 1, 2].map((slot) => <i key={slot} data-filled={slot < fighter.energy || undefined} />)}</div></div> : null)}<div className={styles.timer}>{Math.ceil((view?.timeLeftMs ?? 0) / 1000)}s</div></div>
        <div className={styles.stage} onPointerMove={pointAim} onPointerLeave={() => { aim.current = null; }}><svg className={styles.effects} viewBox="0 0 960 540" preserveAspectRatio="none" aria-hidden="true">{view.fighters.map((fighter, i) => fighter ? <ChargeEffect key={`charge-${i}`} fighter={fighter} /> : null)}{view.fighters.map((fighter, i) => fighter ? <AttackEffect key={i} fighter={fighter} tick={view.tick} index={i} /> : null)}</svg>{view.fighters.map((fighter, i) => fighter ? <FighterToken key={i} fighter={fighter} index={i} tick={view.tick} you={view.you} /> : null)}{view.status === "finished" && <div className={styles.overlay}><h2>{outcome}</h2><p>{view.winner === "draw" ? "Both fighters finished even." : `${me?.card.name ?? "Your fighter"} ${me?.hp ?? 0} HP · ${them?.card.name ?? "Opponent"} ${them?.hp ?? 0} HP`}</p><div className={styles.overlayActions}><button className="pf-btn" data-variant="primary" onClick={leave}>Find another match</button><Link className="pf-btn" data-variant="ghost" href="/collection">My Cards</Link></div></div>}</div>
        <div className={styles.controls}><div className={styles.dpad}><span /><button aria-label="Move up" {...hold("w")}>↑</button><span /><button aria-label="Move left" {...hold("a")}>←</button><button aria-label="Move down" {...hold("s")}>↓</button><button aria-label="Move right" {...hold("d")}>→</button></div><div className={styles.moves}><button {...hold("j")} disabled={view?.status !== "playing" || !!me?.charging}>J / Space<br /><strong>{me?.card.basic.name ?? "Basic"}</strong><small>{me?.card.basic.damage} dmg · +1 energy on hit</small></button><button {...hold("k")} disabled={view?.status !== "playing" || !!me?.charging || (me?.energy ?? 0) < 2}>K<br /><strong>{me?.card.special.name ?? "Special"}</strong><small>{me?.card.special.damage} dmg · 2 energy · {me?.specialCooldownMs ? `${(me.specialCooldownMs / 1000).toFixed(1)}s` : "ready"}</small></button><button {...hold("shift")} disabled={view?.status !== "playing" || !!me?.charging || !!me?.dodgeCooldownMs}>Shift<br /><strong>Dodge</strong><small>{me?.dodgeCooldownMs ? `${(me.dodgeCooldownMs / 1000).toFixed(1)}s` : "ready"}</small></button></div></div>
        <p className={styles.note}>Move: WASD or arrows. Basic: hold J or Space to build energy on hits. Special: press K with 2 energy, then watch its 0.4-second warning area. Dodge: press Shift to dash out or avoid the impact. Hover over the arena to aim Flamethrower; otherwise it auto-aims.</p>
      </div>
        <aside className={styles.feed} aria-label="Battle feed">
          <p className="pf-eyebrow">Battle feed</p>
          <ol aria-live="polite">{feed.length ? feed.map((entry) => <li key={entry.id} data-tone={entry.tone}>{entry.text}</li>) : <li data-tone="event">Land a hit to start the feed.</li>}</ol>
          <p className={styles.feedNote}>The server referees every move, hit and timer, so both players see the same result.</p>
        </aside>
      </div>}
    </section>}
  </main>;
}
