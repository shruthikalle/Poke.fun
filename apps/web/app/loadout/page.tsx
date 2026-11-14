"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountChip } from "../../components/AccountChip";
import { Emblem } from "../../components/Emblem";
import { SignInDialog } from "../../components/SignInDialog";
import { CardSummon } from "../../components/summon/CardSummon";
import { useBattleAudio } from "../../lib/audio/useBattleAudio";
import { useMotionPreference } from "../../lib/motion";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { TYPE_COLORS } from "../../lib/battle/roster";
import { collectionService, type DasAsset } from "../../lib/cards/collection";
import { buildTeam, FORMAT_LABEL, RENTAL_POOL, resolveCard, type CardPick, type MatchFormat } from "../../lib/cards/mapping";
import { matchmakingService, saveTicket, type MatchSearch, type MatchTicket } from "../../lib/match/MatchmakingService";
import { speciesService, type SpeciesData } from "../../lib/pokemon/SpeciesService";
import { rankService, type RankInfo } from "../../lib/rank/RankService";
import { ENTRY_PRESETS, formatDollars, MAX_ENTRY, stakeService } from "../../lib/stake/StakeService";
import { useWallet } from "../../lib/wallet/WalletProvider";
import styles from "./loadout.module.css";

interface CardRow { asset: DasAsset | null; pick: CardPick | null; label: string; image: string | null; grade: string | null; reason: string | null }

type Queue = { status: "idle" } | { status: "searching"; since: number } | { status: "found"; ticket: MatchTicket; countdown: number };

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

function useSpeciesList(keys: string[]) {
  const [map, setMap] = useState<Record<string, SpeciesData>>({});
  const joined = keys.join(",");
  useEffect(() => {
    let live = true;
    for (const key of joined ? joined.split(",") : []) {
      speciesService.getSpecies(key).then((s) => live && setMap((m) => (m[key] ? m : { ...m, [key]: s }))).catch(() => {});
    }
    return () => { live = false; };
  }, [joined]);
  return map;
}

function SummonedSprite({ pick, from, reduced }: { pick: CardPick; from: "left" | "right"; reduced: boolean }) {
  const data = useSpecies(pick.species);
  return (
    <div className={styles.summoned}>
      <CardSummon mode="mini" keepSprite card={pick} species={data?.species ?? null} from={from} reduced={reduced} spriteScale={1.2} />
    </div>
  );
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
  const { ready, playerName, session, status, playAsGuest } = useWallet();
  const [signInOpen, setSignInOpen] = useState(false);
  const [assets, setAssets] = useState<DasAsset[] | null>(null);
  const [rank, setRank] = useState<RankInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [format, setFormat] = useState<MatchFormat>("champion");
  const [entry, setEntry] = useState(5);
  const [custom, setCustom] = useState("");
  const [queue, setQueue] = useState<Queue>({ status: "idle" });
  const [now, setNow] = useState(0);
  const search = useRef<MatchSearch | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [summon, setSummon] = useState<{ key: string; n: number } | null>(null);
  const motion = useMotionPreference();
  const audio = useBattleAudio();
  useFocusTrap(overlayRef, queue.status !== "idle");
  const guest = status === "guest" || !session;

  useEffect(() => {
    if (ready && !playerName) setSignInOpen(true);
  }, [ready, playerName]);

  useEffect(() => {
    if (!playerName) return;
    let live = true;
    void rankService.getRank(playerName).then((r) => live && setRank(r));
    if (session) void collectionService.getOwnedCollectibles(session.address).then((a) => live && setAssets(a));
    else setAssets([]);
    return () => { live = false; };
  }, [playerName, session]);

  useEffect(() => { if (status === "guest") setEntry(0); }, [status]);

  const rows = useMemo<CardRow[]>(() => {
    if (!assets) return [];
    if (guest) return RENTAL_POOL.map((pick) => ({ asset: null, pick, label: pick.label, image: null, grade: null, reason: null }));
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
  const team = useMemo(() => (lead ? buildTeam(lead, eligible, format) : []), [lead, eligible, format]);
  const leadSpecies = useSpecies(lead?.species ?? null);
  const bench = useMemo(() => (format === "squad" ? team.slice(1) : []), [format, team]);
  const benchSpecies = useSpeciesList(bench.map((p) => p.species));
  const summonCard = (key: string) => { setNotice(null); setSummon({ key, n: Date.now() }); };

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!leadSpecies?.failed) return;
    setSummon(null);
    setNotice("Couldn't wake this card: creature data didn't load. Check your connection and pick it again.");
  }, [leadSpecies?.failed]);
  const quote = stakeService.quote(entry);
  const preview = rank ? rankService.preview(rank.rating, rank.rating) : null;

  const findMatch = () => {
    if (!lead || !rank || !playerName) return;
    setQueue({ status: "searching", since: Date.now() });
    const s = matchmakingService.find({ player: playerName, rating: rank.rating, format, tier: lead.tier, entry, team });
    search.current = s;
    s.result.then((ticket) => setQueue({ status: "found", ticket, countdown: 3 })).catch(() => setQueue({ status: "idle" }));
  };
  const cancelSearch = () => {
    search.current?.cancel();
    search.current = null;
  };

  useEffect(() => {
    if (queue.status === "idle") return;
    const id = setInterval(() => {
      setNow(Date.now());
      setQueue((q) => (q.status === "found" && q.countdown > 0 ? { ...q, countdown: q.countdown - 1 } : q));
    }, 1000);
    return () => clearInterval(id);
  }, [queue.status]);

  useEffect(() => {
    if (queue.status === "found" && queue.countdown === 0) {
      saveTicket(queue.ticket);
      router.push("/battle");
    }
  }, [queue, router]);

  useEffect(() => () => search.current?.cancel(), []);

  const closeSignIn = useCallback(() => {
    setSignInOpen(false);
    if (!playerName) router.push("/");
  }, [playerName, router]);
  const onSignedIn = useCallback(() => setSignInOpen(false), []);

  const [entryError, setEntryError] = useState<string | null>(null);
  const setCustomEntry = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    const v = rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
    setCustom(v);
    if (!v) { setEntryError(null); setEntry(5); return; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1) { setEntryError("Minimum entry is $1"); return; }
    if (n > MAX_ENTRY) { setEntryError(`Maximum entry is $${MAX_ENTRY}`); return; }
    setEntryError(null);
    setEntry(Math.round(n * 100) / 100);
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
          <p className="pf-eyebrow">{guest ? "Rental creatures" : "Your collection"}</p>
          <h1>Choose your champion</h1>
          <p className={styles.lede}>
            {guest
              ? "Guests battle with rental creatures. Sign in to play with the cards you own."
              : "The card you pick is the creature you battle with, and the one your entry rides on."}
          </p>

          {!assets ? (
            <div className={styles.grid}>{[0, 1, 2, 3].map((i) => <div key={i} className={styles.cardSkeleton} />)}</div>
          ) : (
            <>
            {!guest && eligible.length === 0 && (
              <div className={styles.empty} role="status">
                <strong>{rows.length === 0 ? "No cards in this wallet yet" : "None of these cards can battle yet"}</strong>
                <span>{rows.length === 0 ? "Cards you own show up here automatically." : "Only supported creature cards can be played."} You can still battle as a guest with rental creatures.</span>
                <button className="pf-btn" data-size="sm" onClick={() => playAsGuest()}>Battle as a guest</button>
              </div>
            )}
            <div className={styles.grid} role="radiogroup" aria-label="Cards">
              {rows.map((r) => {
                const key = r.pick?.key ?? r.asset?.id ?? r.label;
                const isSel = !!r.pick && r.pick.key === selected;
                return (
                  <button key={key} role="radio" aria-checked={isSel} className={styles.card} data-selected={isSel || undefined} disabled={!r.pick}
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
              <h2>{leadSpecies?.species?.name ?? lead?.label ?? "—"}</h2>
              {lead && leadSpecies?.species && <button className={`pf-btn ${styles.resummon}`} data-size="sm" data-variant="ghost" onClick={() => summonCard(lead.key)}>Summon again</button>}
              <div className={styles.types}>
                {leadSpecies?.species?.types.map((t) => <span key={t} style={{ "--type": TYPE_COLORS[t] } as React.CSSProperties}>{t}</span>)}
              </div>
            </div>
          </div>
          {notice && <p className={styles.warn} role="alert">{notice}</p>}
          {leadSpecies?.failed && !notice && <p className={styles.warn}>Couldn&apos;t load this creature&apos;s moves. Check your connection.</p>}
          <ul className={styles.moves}>
            {(leadSpecies?.species?.moves ?? [null, null, null, null]).map((m, i) => (
              <li key={m?.id ?? i} style={m ? ({ "--type": TYPE_COLORS[m.type] } as React.CSSProperties) : undefined}>
                {m ? <><strong>{m.name}</strong><small>{m.type} · {m.power}</small></> : <span className={styles.moveSkeleton} />}
              </li>
            ))}
          </ul>

          <p className={styles.label}>Format</p>
          <div className={styles.segment} role="radiogroup" aria-label="Format">
            {(["champion", "squad"] as const).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} data-on={format === f || undefined} onClick={() => setFormat(f)}>{FORMAT_LABEL[f]}</button>
            ))}
          </div>
          <p className={styles.hint}>{format === "champion" ? "Only your champion fights. One card, four moves, no switching." : "Your champion leads. Two more come from your cards, then from the rental pool both players share."}</p>
          {format === "squad" && (
            <div className={styles.squad}>
              {team.map((p, i) => (
                <div key={p.key} className={styles.slot}><Sprite species={p.species} size={44} /><span>{p.label}</span><small>{i === 0 ? "Lead" : p.rental ? "Rental" : "Yours"}</small></div>
              ))}
            </div>
          )}

          <p className={styles.label}>Entry</p>
          <div className={styles.chips}>
            {ENTRY_PRESETS.map((n) => (
              <button key={n} data-on={entry === n && !custom || undefined} disabled={guest && n > 0} onClick={() => { setCustom(""); setEntryError(null); setEntry(n); }}>{formatDollars(n)}</button>
            ))}
            <label className={styles.custom} data-on={!!custom || undefined}>
              <span>$</span>
              <input inputMode="decimal" placeholder="Custom" value={custom} disabled={guest} aria-label="Custom entry in dollars" onChange={(e) => setCustomEntry(e.target.value)} aria-invalid={!!entryError || undefined} aria-describedby={entryError ? "entry-error" : undefined} />
            </label>
          </div>
          {entryError && <p id="entry-error" className={styles.warn} role="alert">{entryError}</p>}
          <div className={styles.pot} hidden={!!entryError}>
            <span>{entry ? <>Winner takes <strong>{formatDollars(quote.winnerTakes)}</strong></> : <>Free match, ranked only</>}</span>
            <em>Demo: no real money</em>
          </div>
          {guest && <p className={styles.hint}>Sign in to play with an entry.</p>}

          <p className={styles.label}>Your rank</p>
          {rank ? (
            <div className={styles.rank}>
              <RankBadge rank={rank} />
              <span>{rank.wins}–{rank.losses}</span>
              {preview && <span className={styles.delta}><b data-tone="up">Win +{preview.win}</b> <b data-tone="down">Loss {preview.loss}</b></span>}
            </div>
          ) : <span className={styles.moveSkeleton} />}

          <button className={`pf-btn ${styles.find}`} data-variant="primary" data-size="lg" disabled={!lead || !rank || !leadSpecies?.species || !!entryError || queue.status !== "idle"} onClick={findMatch}>Find match</button>
        </aside>
      </main>

      {queue.status !== "idle" && (
        <div ref={overlayRef} tabIndex={-1} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Matchmaking">
          <div className={`pf-panel ${styles.matchBox}`}>
            {queue.status === "searching" ? (
              <>
                <div className={styles.radar}><Emblem size={56} /></div>
                <p className="pf-eyebrow">Finding a match</p>
                <h2>Searching… {Math.max(0, Math.floor((now - queue.since) / 1000))}s</h2>
                <p className={styles.hint}>{FORMAT_LABEL[format]} · {rank?.tier} rank · tier {lead?.tier} cards · {formatDollars(entry)} entry</p>
                <button className="pf-btn" data-variant="ghost" onClick={cancelSearch}>Cancel</button>
              </>
            ) : (
              <>
                <p className="pf-eyebrow">Match found</p>
                <div className={styles.versus}>
                  <div>
                    <SummonedSprite pick={queue.ticket.you.team[0]} from="left" reduced={motion.reduced} />
                    <strong>{playerName}</strong>
                    <RankBadge rank={{ tier: rank?.tier ?? "", rating: queue.ticket.you.rating }} />
                    <small>{queue.ticket.you.team.map((p) => p.label).join(" · ")}</small>
                  </div>
                  <span className={styles.vs}>VS</span>
                  <div>
                    <SummonedSprite pick={queue.ticket.opponent.team[0]} from="right" reduced={motion.reduced} />
                    <strong>{queue.ticket.opponent.trainer.name}</strong>
                    <RankBadge rank={queue.ticket.opponent} />
                    <small>{queue.ticket.opponent.team.map((p) => p.label).join(" · ")}</small>
                  </div>
                </div>
                <div className={styles.pot}>
                  <span>{queue.ticket.entry ? <>Entry {formatDollars(queue.ticket.entry)} each · Winner takes <strong>{formatDollars(stakeService.quote(queue.ticket.entry).winnerTakes)}</strong></> : "Free match, ranked only"}</span>
                  {rank && <span className={styles.delta}><b data-tone="up">Win +{rankService.preview(rank.rating, queue.ticket.opponent.rating).win}</b> <b data-tone="down">Loss {rankService.preview(rank.rating, queue.ticket.opponent.rating).loss}</b></span>}
                </div>
                <h2 className={styles.countdown}>Battle starts in {queue.countdown}</h2>
              </>
            )}
          </div>
        </div>
      )}

      {summon && lead && lead.key === summon.key && (
        <CardSummon key={summon.n} mode="full" card={lead} species={leadSpecies?.species ?? null} level={lead.level}
          reduced={motion.reduced} muted={audio.muted} onToggleMute={audio.toggleMute} playCry={audio.playClip}
          companions={bench.map((p) => ({ card: p, species: benchSpecies[p.species] ?? null, level: p.level }))}
          onReplay={() => summonCard(lead.key)} onDone={() => setSummon(null)} />
      )}

      <SignInDialog open={signInOpen} onClose={closeSignIn} onSignedIn={onSignedIn} />
    </div>
  );
}
