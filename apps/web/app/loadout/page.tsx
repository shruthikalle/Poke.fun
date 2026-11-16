"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountChip } from "../../components/AccountChip";
import { Emblem } from "../../components/Emblem";
import { CardSummon } from "../../components/summon/CardSummon";
import { useBattleAudio } from "../../lib/audio/useBattleAudio";
import { useMotionPreference } from "../../lib/motion";
import { arenaApi, ARENA_QUEUE_STORAGE_KEY, ARENA_SESSION_STORAGE_KEY, type ArenaQueueTicket } from "../../lib/arena";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { session as tabStorage } from "../../lib/storage";
import { TYPE_COLORS } from "../../lib/battle/roster";
import { collectionService, DEVNET_TEST_COLLECTION_ADDRESS, type DasAsset } from "../../lib/cards/collection";
import { FAUX_ART_WINDOW, resolveCard, type CardPick } from "../../lib/cards/mapping";
import { speciesService, type SpeciesData } from "../../lib/pokemon/SpeciesService";
import { rankService, type RankInfo } from "../../lib/rank/RankService";
import { cancelSolWager, explorerTx, joinSolWager, openSolWager, paidQueueApi, recoverExpiredWager } from "../../lib/sol/wagerClient";
import type { PaidTicket } from "../../lib/sol/paidQueue";
import { useWallet } from "../../lib/wallet/WalletProvider";
import styles from "./loadout.module.css";

interface CardRow { asset: DasAsset | null; pick: CardPick | null; label: string; image: string | null; grade: string | null; reason: string | null }
type QueueTicket = ArenaQueueTicket | PaidTicket;
type QueueState = { status: "idle" } | { status: "searching"; ticket: QueueTicket; since: number } | { status: "found"; ticket: QueueTicket };
const SOL_ENTRIES = [0, 0.01, 0.05, 0.1, 0.25] as const;
const formatEntry = (value: number) => value === 0 ? "Free" : `${value} SOL`;
const isPaid = (ticket: QueueTicket): ticket is PaidTicket => "stakeLamports" in ticket;

function devnetExplorerUrl(asset: DasAsset | null): string | null {
  if (!asset || asset.interface !== "MplCoreAsset" ||
    !asset.grouping?.some((group) => group.group_key === "collection" && group.group_value === DEVNET_TEST_COLLECTION_ADDRESS) ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asset.id)) return null;
  return `https://explorer.solana.com/address/${asset.id}?cluster=devnet`;
}

const ARENA_RENTALS: CardPick[] = ["pikachu", "charmander"].map((species) => ({
  key: `arena-rental-${species}`, species, label: species === "pikachu" ? "Pikachu" : "Charmander",
  image: null, grade: null, level: 50, tier: 1, rental: true, artWindow: FAUX_ART_WINDOW,
}));

function useSpecies(key: string | null) {
  const [data, setData] = useState<{ key: string; species: SpeciesData | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    speciesService.getSpecies(key)
      .then((species) => live && setData({ key, species, failed: false }))
      .catch(() => live && setData({ key, species: null, failed: true }));
    return () => { live = false; };
  }, [key]);
  return data?.key === key ? data : null;
}

function Sprite({ species, size = 96 }: { species: string; size?: number }) {
  const data = useSpecies(species);
  if (!data?.species) return <span className={styles.spriteSkeleton} style={{ width: size, height: size }} />;
  return <img className={styles.sprite} src={data.species.sprites.front} alt={data.species.name} style={{ width: size, height: size }}
    onError={(e) => { if (data.species && e.currentTarget.src !== data.species.sprites.frontStatic) e.currentTarget.src = data.species.sprites.frontStatic; }} />;
}

function CardArt({ src, species }: { src: string; species: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) return species ? <Sprite species={species} size={88} /> : <span className={styles.artMissing}>Card art unavailable</span>;
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function TierPips({ tier }: { tier: number }) {
  return <span className={styles.pips} title={`Power tier ${tier}`}>{[1, 2, 3].map((i) => <i key={i} data-on={i <= tier || undefined} />)}</span>;
}

function RankBadge({ rank }: { rank: { tier: string; rating: number } }) {
  return <span className={styles.rankBadge} data-tier={rank.tier}><Emblem size={18} />{rank.tier}<b>{rank.rating}</b></span>;
}

export default function LoadoutPage() {
  const router = useRouter();
  const { ready, playerName, session, status, walletAuthToken, playAsGuest, signIn } = useWallet();
  const [assets, setAssets] = useState<DasAsset[] | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [rank, setRank] = useState<RankInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState(0);
  const [custom, setCustom] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [queue, setQueue] = useState<QueueState>({ status: "idle" });
  const [queueStale, setQueueStale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryTx, setRecoveryTx] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [summon, setSummon] = useState<{ key: string; n: number } | null>(null);
  const motion = useMotionPreference();
  const audio = useBattleAudio();
  const guest = status === "guest" || !session;
  useFocusTrap(overlayRef, queue.status !== "idle");

  useEffect(() => {
    const saved = tabStorage.get(ARENA_QUEUE_STORAGE_KEY);
    if (!saved) return;
    try {
      const ticket = JSON.parse(saved) as QueueTicket;
      if (ticket.id && ticket.token) setQueue(ticket.status === "matched" ? { status: "found", ticket } : { status: "searching", ticket, since: Date.now() });
    } catch { tabStorage.remove(ARENA_QUEUE_STORAGE_KEY); }
  }, []);

  useEffect(() => {
    if (queue.status !== "searching") return;
    if (queueStale) return;
    if (isPaid(queue.ticket) && !walletAuthToken && !ready) return;
    let live = true;
    const check = async () => {
      try {
        const latest = isPaid(queue.ticket)
          ? await paidQueueApi.status(walletAuthToken ?? "", queue.ticket)
          : await arenaApi.queueStatus(queue.ticket);
        if (live && latest.status === "matched" && latest.arena) setQueue({ status: "found", ticket: latest });
        else if (live && latest.status === "cancelled") { tabStorage.remove(ARENA_QUEUE_STORAGE_KEY); setQueue({ status: "idle" }); }
        else if (live) setQueue((current) => current.status === "searching" && current.ticket.id === latest.id ? { ...current, ticket: latest } : current);
      } catch (cause) {
        if (!live) return;
        if (isPaid(queue.ticket)) {
          setQueueStale(true);
          setNotice("The match server lost this queue. If you deposited SOL, cancel and refund it with Phantom.");
        } else {
          setNotice((cause as Error).message);
          tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
          setQueue({ status: "idle" });
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 700);
    return () => { live = false; window.clearInterval(timer); };
  }, [queue.status, queue.status === "searching" ? queue.ticket.id : "", walletAuthToken, ready, queueStale]);

  useEffect(() => {
    if (queue.status === "searching" && isPaid(queue.ticket)) tabStorage.set(ARENA_QUEUE_STORAGE_KEY, JSON.stringify(queue.ticket));
  }, [queue]);

  useEffect(() => {
    if (queue.status !== "found" || !queue.ticket.arena) return;
    const timer = window.setTimeout(() => {
      tabStorage.set(ARENA_SESSION_STORAGE_KEY, JSON.stringify({ ...queue.ticket.arena, ...(isPaid(queue.ticket) ? { paidQueue: { id: queue.ticket.id, token: queue.ticket.token } } : {}) }));
      tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
      router.push("/battle/live");
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [queue, router]);

  useEffect(() => {
    if (ready && !playerName) signIn({ onCancel: () => router.push("/") });
  }, [ready, playerName, signIn, router]);

  useEffect(() => {
    if (!playerName) return;
    let live = true;
    void rankService.getRank(playerName).then((r) => live && setRank(r));
    setCollectionError(null);
    setAssets(null);
    if (session) void collectionService.getOwnedCollectibles(session.address)
      .then((a) => { if (live) setAssets(a); })
      .catch(() => { if (live) { setCollectionError("Could not verify your cards on Solana Devnet. Try again later."); setAssets([]); } });
    else setAssets([]);
    return () => { live = false; };
  }, [playerName, session]);


  const rows = useMemo<CardRow[]>(() => {
    if (!assets) return [];
    if (guest) return ARENA_RENTALS.map((pick) => ({ asset: null, pick, label: pick.label, image: null, grade: null, reason: null }));
    return assets.map((asset) => {
      const r = resolveCard(asset);
      return r.eligible
        ? { asset, pick: r.pick, label: r.pick.label, image: r.pick.image, grade: r.pick.grade, reason: null }
        : { asset, pick: null, label: asset.content.metadata.attributes.find((a) => a.trait_type === "Card Name")?.value ?? asset.content.metadata.name, image: asset.content.links.image, grade: null, reason: r.reason };
    });
  }, [assets, guest]);

  const eligible = useMemo(() => rows.flatMap((r) => (r.pick ? [r.pick] : [])), [rows]);
  useEffect(() => {
    if (eligible.length && !eligible.some((p) => p.key === selected)) setSelected(eligible[0].key);
  }, [eligible, selected]);

  const lead = eligible.find((p) => p.key === selected) ?? null;
  const paidCardValid = !!lead && rows.some((row) => row.pick?.key === lead.key && !!devnetExplorerUrl(row.asset));
  const leadSpecies = useSpecies(lead?.species ?? null);
  const summonCard = (key: string) => { setNotice(null); setSummon({ key, n: Date.now() }); };

  useEffect(() => {
    if (!leadSpecies?.failed) return;
    setSummon(null);
    setNotice("Couldn't wake this card: creature data didn't load. Check your connection and pick it again.");
  }, [leadSpecies?.failed]);

  const findMatch = async () => {
    if (!lead || !rank || !playerName || finding || (lead.species !== "pikachu" && lead.species !== "charmander")) return;
    setFinding(true);
    setNotice(null);
    try {
      const ownedAsset = process.env.NEXT_PUBLIC_COLLECTION_SOURCE === "devnet" && session && !lead.rental
        ? { assetId: lead.key, walletAddress: session.address }
        : undefined;
      if (entry > 0 && (!walletAuthToken || !session || !paidCardValid)) throw new Error("Sign in with Phantom and select a verified Devnet NFT to enter a SOL match.");
      const ticket = entry > 0
        ? await paidQueueApi.enqueue(walletAuthToken!, { name: playerName, cardId: lead.species, rating: rank.rating, assetId: lead.key, stakeLamports: Math.round(entry * 1_000_000_000) })
        : await arenaApi.enqueue(playerName, lead.species, rank.rating, 0, ownedAsset);
      tabStorage.remove(ARENA_SESSION_STORAGE_KEY);
      setQueueStale(false);
      tabStorage.set(ARENA_QUEUE_STORAGE_KEY, JSON.stringify(ticket));
      setQueue(ticket.status === "matched" ? { status: "found", ticket } : { status: "searching", ticket, since: Date.now() });
      setFinding(false);
    } catch (cause) {
      setNotice((cause as Error).message);
      setFinding(false);
    }
  };

  const cancelSearch = async () => {
    if (queue.status !== "searching") return;
    setFinding(true);
    try {
      if (isPaid(queue.ticket)) {
        const pendingJoin = tabStorage.get(`pf:wager-join:${queue.ticket.id}`);
        if (pendingJoin) {
          if (queueStale) throw new Error("Your second deposit may already be on-chain. Recover it after the escrow deadline below.");
          const latest = await paidQueueApi.action(walletAuthToken ?? "", queue.ticket, { action: "join", signature: pendingJoin });
          if (latest.status === "matched") { tabStorage.remove(`pf:wager-join:${queue.ticket.id}`); setQueue({ status: "found", ticket: latest }); return; }
          throw new Error("Second deposit is pending confirmation; retry in a moment.");
        }
        const pendingKey = `pf:wager-open:${queue.ticket.id}`;
        const pending = tabStorage.get(pendingKey);
        const wager = queue.ticket.wager ?? (pending ? (JSON.parse(pending) as { wager: string }).wager : null);
        if (wager && session && ["awaiting_join", "cancel_required", "open_required"].includes(queue.ticket.status)) {
          await cancelSolWager(session.address, wager);
          if (queue.ticket.wager) await paidQueueApi.action(walletAuthToken ?? "", queue.ticket, { action: "cancel_onchain" }).catch(() => null);
          else await paidQueueApi.cancel(walletAuthToken ?? "", queue.ticket).catch(() => null);
          tabStorage.remove(pendingKey);
        } else if (!queueStale) await paidQueueApi.cancel(walletAuthToken ?? "", queue.ticket);
      } else await arenaApi.cancelQueue(queue.ticket);
      tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
      setQueue({ status: "idle" });
      setQueueStale(false);
    } catch (cause) {
      const latest = isPaid(queue.ticket)
        ? await paidQueueApi.status(walletAuthToken ?? "", queue.ticket).catch(() => null)
        : await arenaApi.queueStatus(queue.ticket).catch(() => null);
      if (latest?.status === "matched" && latest.arena) setQueue({ status: "found", ticket: latest });
      else setNotice((cause as Error).message);
    } finally { setFinding(false); }
  };

  const recoverExpired = async () => {
    if (queue.status !== "searching" || !isPaid(queue.ticket) || !queue.ticket.wager || !session) return;
    setFinding(true);
    try {
      const signature = await recoverExpiredWager(session.address, queue.ticket.wager);
      setNotice("Refund confirmed on Devnet.");
      setRecoveryTx(signature);
      tabStorage.remove(`pf:wager-join:${queue.ticket.id}`);
      tabStorage.remove(ARENA_QUEUE_STORAGE_KEY);
      setQueue({ status: "idle" });
      setQueueStale(false);
    } catch (cause) { setNotice((cause as Error).message); }
    finally { setFinding(false); }
  };

  const approveDeposit = async () => {
    if (queue.status !== "searching" || !isPaid(queue.ticket) || !session || !walletAuthToken) return;
    setFinding(true);
    setNotice(null);
    try {
      const ticket = queue.ticket;
      if (ticket.status === "open_required") {
        const pendingKey = `pf:wager-open:${ticket.id}`;
        const pending = tabStorage.get(pendingKey);
        const opened = pending ? JSON.parse(pending) as { wager: string; signature: string } : await openSolWager(session.address, ticket.stakeLamports);
        tabStorage.set(pendingKey, JSON.stringify(opened));
        const latest = await paidQueueApi.action(walletAuthToken, ticket, { action: "open", ...opened });
        tabStorage.remove(pendingKey);
        setQueue({ status: "searching", ticket: latest, since: Date.now() });
      } else if (ticket.status === "join_required" && ticket.wager) {
        const pendingKey = `pf:wager-join:${ticket.id}`;
        const signature = tabStorage.get(pendingKey) ?? await joinSolWager(session.address, ticket.wager);
        tabStorage.set(pendingKey, signature);
        const latest = await paidQueueApi.action(walletAuthToken, ticket, { action: "join", signature });
        tabStorage.remove(pendingKey);
        setQueue(latest.status === "matched" ? { status: "found", ticket: latest } : { status: "searching", ticket: latest, since: Date.now() });
      }
    } catch (cause) { setNotice((cause as Error).message); }
    finally { setFinding(false); }
  };

  const setCustomEntry = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    const value = rest.length ? `${whole}.${rest.join("").slice(0, 3)}` : whole;
    setCustom(value);
    if (!value) { setEntryError(null); setEntry(0); return; }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0.001) { setEntryError("Minimum entry is 0.001 Devnet SOL"); return; }
    if (amount > 1) { setEntryError("Maximum entry is 1 Devnet SOL"); return; }
    setEntryError(null);
    setEntry(Math.round(amount * 1000) / 1000);
  };

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <header className={styles.top}>
        <Link href="/" className={styles.brand}><Emblem size={22} /><span>Poke.fun</span></Link>
        <span className="pf-eyebrow">Loadout</span>
        <div className={styles.account}>
          {playerName ? <AccountChip classes={{ chip: styles.chip, avatar: styles.chipAvatar, menu: styles.menu, menuItem: styles.menuItem }} /> : null}
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.collection}>
          <h1>Choose your champion</h1>
          {guest && <p className={styles.lede}>Rental creatures. Sign in to battle with your own cards.</p>}
          {collectionError && <p className={styles.warn} role="alert">{collectionError}</p>}

          {!assets ? (
            <div className={styles.grid}>{[0, 1, 2, 3].map((i) => <div key={i} className={styles.cardSkeleton} />)}</div>
          ) : (
            <>
            {!guest && eligible.length === 0 && (
              <div className={styles.empty} role="status">
                <strong>{rows.length === 0 ? "No supported cards in this wallet" : "None of these can battle"}</strong>
                <button className="pf-btn" data-size="sm" onClick={() => playAsGuest()}>Battle as a guest</button>
              </div>
            )}
            <div className={styles.grid} role="radiogroup" aria-label="Cards">
              {rows.map((r) => {
                const key = r.pick?.key ?? r.asset?.id ?? r.label;
                const isSel = !!r.pick && r.pick.key === selected;
                const explorerUrl = devnetExplorerUrl(r.asset);
                return (
                  <div key={key} className={styles.cardSlot}>
                    <button role="radio" aria-checked={isSel} className={`pf-frame ${styles.card}`} data-selected={isSel || undefined} disabled={!r.pick}
                      onClick={() => { if (r.pick) { setSelected(r.pick.key); summonCard(r.pick.key); } }} title={r.reason ?? undefined}>
                      <span className={styles.art}>
                        {r.image ? <CardArt src={r.image} species={r.pick?.species ?? null} /> : r.pick ? <Sprite species={r.pick.species} size={88} /> : null}
                        {r.reason && <span className={styles.reason}>{r.reason}</span>}
                      </span>
                      <span className={styles.cardMeta}>
                        <strong>{r.label}</strong>
                        <span>
                          {r.grade && <em className={styles.grade}>{r.grade}</em>}
                          {r.pick?.rental && <em className={styles.grade}>Rental</em>}
                          {r.pick ? <TierPips tier={r.pick.tier} /> : <small>Can&apos;t battle</small>}
                        </span>
                      </span>
                    </button>
                    {explorerUrl && <a className={styles.explorerLink} href={explorerUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${r.label} on Solana Explorer (Devnet)`}>View on Solana ↗</a>}
                  </div>
                );
              })}
            </div>
            </>
          )}
        </section>

        <aside className={`pf-panel ${styles.panel}`}>
          <div className={styles.champion}>
            {lead ? <Sprite species={lead.species} size={104} /> : <span className={styles.spriteSkeleton} style={{ width: 104, height: 104 }} />}
            <div>
              <p className={styles.label}>Champion</p>
              <h2>{leadSpecies?.species?.name ?? lead?.label ?? "Pick a card"}</h2>
              {lead && leadSpecies?.species && <button className={`pf-btn ${styles.resummon}`} data-size="sm" data-variant="ghost" onClick={() => summonCard(lead.key)}>Summon again</button>}
              <div className={styles.types}>
                {leadSpecies?.species?.types.map((t) => <span key={t} style={{ "--type": TYPE_COLORS[t] } as React.CSSProperties}>{t}</span>)}
              </div>
            </div>
          </div>
          {notice && <p className={styles.warn} role="alert">{notice}</p>}
          {recoveryTx && <a href={explorerTx(recoveryTx)} target="_blank" rel="noopener noreferrer">View refund on Solana ↗</a>}
          {leadSpecies?.failed && !notice && <p className={styles.warn}>Couldn&apos;t load this creature&apos;s moves. Check your connection.</p>}
          <ul className={styles.moves}>
            {(leadSpecies?.species?.moves ?? [null, null, null, null]).map((m, i) => (
              <li key={m?.id ?? i} style={m ? ({ "--type": TYPE_COLORS[m.type] } as React.CSSProperties) : undefined}>
                {m ? <><strong>{m.name}</strong><small>{m.type} · {m.power}</small></> : <span className={styles.moveSkeleton} />}
              </li>
            ))}
          </ul>

          <p className={styles.label}>Format</p>
          <div className={styles.segment}><button className="pf-chip" data-on>Champion 1v1</button><button className="pf-chip" disabled>Squad of 3 · coming soon</button></div>
          <p className={styles.hint}>One card, live against another queued player.</p>

          <p className={styles.label}>Entry</p>
          <div className={styles.chips}>
            {SOL_ENTRIES.map((amount) => <button key={amount} className="pf-chip" data-on={entry === amount && !custom || undefined} onClick={() => { setCustom(""); setEntryError(null); setEntry(amount); }}>{formatEntry(amount)}</button>)}
            <label className={`pf-input ${styles.custom}`} data-on={!!custom || undefined}>
              <span>SOL</span>
              <input inputMode="decimal" placeholder="0.000" value={custom} aria-label="Custom entry in Devnet SOL" onChange={(event) => setCustomEntry(event.target.value)} aria-invalid={!!entryError || undefined} aria-describedby={entryError ? "entry-error" : undefined} />
            </label>
          </div>
          {entryError && <p id="entry-error" className={styles.warn} role="alert">{entryError}</p>}
          <div className={styles.pot} hidden={!!entryError}>
            <span>{entry ? <><strong>{formatEntry(entry)}</strong> per player · {formatEntry(entry * 2)} pot</> : "Free live match"}</span>
            <em>{entry ? "Devnet test SOL · Phantom approval required" : "Free match · no transfers"}</em>
          </div>

          <p className={styles.label}>Demo rating</p>
          {rank ? (
            <div className={styles.rank}>
              <RankBadge rank={rank} />
              <span>{rank.wins}–{rank.losses}</span>
            </div>
          ) : <span className={styles.moveSkeleton} />}

          {lead && lead.species !== "pikachu" && lead.species !== "charmander" && <p className={styles.warn}>Live matchmaking currently supports Pikachu and Charmander.</p>}
          {entry > 0 && lead && !paidCardValid && <p className={styles.warn}>Select an on-chain Devnet NFT for a SOL match. Demo marketplace cards play for free.</p>}
          <button className={`pf-btn ${styles.find}`} data-variant="primary" data-size="lg" disabled={!lead || !rank || !!entryError || finding || queue.status !== "idle" || (entry > 0 && (!paidCardValid || !walletAuthToken)) || (lead.species !== "pikachu" && lead.species !== "charmander")} onClick={() => void findMatch()}>{finding ? "Entering queue…" : "Find match"}</button>
        </aside>
      </main>

      {queue.status !== "idle" && <div ref={overlayRef} tabIndex={-1} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Matchmaking">
        <div className={`pf-panel ${styles.matchBox}`}>
          <div className={styles.radar}><Emblem size={56} /></div>
          <p className="pf-eyebrow">{queue.status === "found" ? "Match found" : "Finding a match"}</p>
          <h2>{queue.status === "found" ? `Matched with ${queue.ticket.opponent ?? "another player"}` : isPaid(queue.ticket) && queue.ticket.status === "open_required" ? "Opponent found · deposit your SOL" : isPaid(queue.ticket) && queue.ticket.status === "join_required" ? "Join the funded match" : isPaid(queue.ticket) && queue.ticket.status === "cancel_required" ? "Opponent left · refund your deposit" : "Waiting for another player…"}</h2>
          <p className={styles.hint}>{queue.status === "found" ? "Both Devnet SOL deposits are confirmed. Opening battle." : isPaid(queue.ticket) ? `${formatEntry(queue.ticket.stakeLamports / 1_000_000_000)} per player · ${queue.ticket.status === "awaiting_open" ? "waiting for opponent's deposit" : queue.ticket.status === "awaiting_join" ? "waiting for opponent's deposit" : "closest available rating first"}` : "Searching for a free match · closest available rating first."}</p>
          {queue.status === "searching" && isPaid(queue.ticket) && ["open_required", "join_required"].includes(queue.ticket.status) && <button className="pf-btn" data-variant="primary" disabled={finding} onClick={() => void approveDeposit()}>{finding ? "Confirming on Solana…" : `Approve ${formatEntry(queue.ticket.stakeLamports / 1_000_000_000)} in Phantom`}</button>}
          {queue.status === "searching" && isPaid(queue.ticket) && queue.ticket.openTx && <a href={explorerTx(queue.ticket.openTx)} target="_blank" rel="noopener noreferrer">View first deposit on Solana ↗</a>}
          {queue.status === "searching" && isPaid(queue.ticket) && queue.ticket.joinTx && <a href={explorerTx(queue.ticket.joinTx)} target="_blank" rel="noopener noreferrer">View second deposit on Solana ↗</a>}
          {notice && <p className={styles.warn} role="alert">{notice}</p>}
          {queue.status === "searching" && isPaid(queue.ticket) && queue.ticket.wager && <button className="pf-btn" data-variant="ghost" disabled={finding} onClick={() => void recoverExpired()}>Recover after escrow deadline</button>}
          {queue.status === "searching" && <button className="pf-btn" data-variant="ghost" disabled={finding} onClick={() => void cancelSearch()}>{isPaid(queue.ticket) && queue.ticket.wager ? "Cancel and refund" : "Cancel search"}</button>}
        </div>
      </div>}

      {summon && lead && lead.key === summon.key && (
        <CardSummon key={summon.n} mode="full" card={lead} species={leadSpecies?.species ?? null} level={lead.level}
          reduced={motion.reduced} muted={audio.muted} onToggleMute={audio.toggleMute} playCry={audio.playClip}
          companions={[]}
          onReplay={() => summonCard(lead.key)} onDone={() => setSummon(null)} />
      )}

    </div>
  );
}
