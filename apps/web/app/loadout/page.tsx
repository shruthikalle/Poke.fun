"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AccountChip } from "../../components/AccountChip";
import { Emblem } from "../../components/Emblem";
import { CardSummon } from "../../components/summon/CardSummon";
import { useBattleAudio } from "../../lib/audio/useBattleAudio";
import { type CardPick, type MatchFormat, type PowerTier } from "../../lib/cards/mapping";
import speciesIndex from "../../lib/cards/species.generated.json";
import { useMotionPreference } from "../../lib/motion";
import { rankService } from "../../lib/rank/RankService";
import { useWallet } from "../../lib/wallet/WalletProvider";
import { CardGrid } from "./components/CardGrid";
import { ChampionPreview, SquadPreview } from "./components/ChampionPreview";
import { EntryControls } from "./components/EntryControls";
import { QueueDialog } from "./components/QueueDialog";
import { PaidQueueDialog } from "./components/PaidQueueDialog";
import { usePaidLoadoutQueue } from "./hooks/usePaidLoadoutQueue";
import { DEVNET_TEST_COLLECTION_ADDRESS } from "../../lib/cards/collection";
import { explorerTx } from "../../lib/sol/wagerClient";
import { useLoadoutCards } from "./hooks/useLoadoutCards";
import { useLoadoutQueue } from "./hooks/useLoadoutQueue";
import { useLoadoutResource } from "./hooks/useLoadoutResource";
import { useLoadoutSummons } from "./hooks/useLoadoutSummons";
import styles from "./loadout.module.css";

const loadRank = (player: string) => rankService.getRank(player);
const baseSpecies = new Map(speciesIndex.species.map((species) => [species.key, species.species]));

export default function LoadoutPage() {
  const router = useRouter();
  const { ready, playerName, session, status, signIn, walletAuthToken } = useWallet();
  const cards = useLoadoutCards(ready ? session?.address ?? null : null);
  const rank = useLoadoutResource(ready ? playerName : null, loadRank);
  const matchmaking = useLoadoutQueue(ready ? playerName : null);
  const paid = usePaidLoadoutQueue(ready ? playerName : null, walletAuthToken, session?.address ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [squadKeys, setSquadKeys] = useState<string[]>([]);
  const [format, setFormat] = useState<MatchFormat>("champion");
  const [entry, setEntry] = useState(0);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [summon, setSummon] = useState<{ key: string; sequence: number } | null>(null);
  const motion = useMotionPreference();
  const audio = useBattleAudio();

  useEffect(() => {
    if (ready && !playerName) signIn({ onCancel: () => router.push("/") });
  }, [ready, playerName, signIn, router]);

  useEffect(() => {
    if (cards.eligible.some((pick) => pick.key === selected)) return;
    const first = cards.eligible.find((pick) => cards.fighters.get(pick.species)) ?? cards.eligible[0];
    setSelected(first?.key ?? null);
    setSummon(null);
  }, [cards.eligible, cards.fighters, selected]);

  const lead = cards.eligible.find((pick) => pick.key === (format === "squad" ? squadKeys[0] : selected)) ?? null;
  const fighter = lead ? cards.fighters.get(lead.species) ?? null : null;
  const team = useMemo(() => {
    if (!lead) return [];
    const available = cards.eligible.flatMap((pick): CardPick[] => {
      const server = cards.fighters.get(pick.species);
      if (!server) return [];
      return [{ ...pick, level: server.level, tier: server.tier as PowerTier }];
    });
    const canonicalLead = available.find((pick) => pick.key === lead.key);
    if (!canonicalLead) return [];
    if (format === "champion") return [canonicalLead];
    return squadKeys.flatMap((key) => available.find((pick) => pick.key === key) ?? []);
  }, [lead, cards.eligible, cards.fighters, format, squadKeys]);
  const summons = useLoadoutSummons(team);
  const leadSpecies = lead ? summons.data.get(lead.species) ?? null : null;
  const unsupported = !!lead && cards.fighters.get(lead.species) === null;
  const completeTeam = team.length === (format === "squad" ? 3 : 1)
    && team.every((pick) => cards.fighters.get(pick.species));
  const paidCardValid = completeTeam && team.every((pick) => cards.rows.some((row) => row.pick?.key === pick.key
    && row.asset?.interface === "MplCoreAsset"
    && row.asset.grouping?.some((group) => group.group_key === "collection" && group.group_value === DEVNET_TEST_COLLECTION_ADDRESS)));
  const canQueue = !matchmaking.resume && ready && !!playerName && !!rank.data && !!fighter && completeTeam
    && !cards.fightersLoading && !cards.fighterError && !entryError && matchmaking.queue.status === "idle"
    && paid.queue.status === "idle" && !paid.busy && (entry === 0 || (paidCardValid && !!walletAuthToken));

  const summonCard = (key: string) => {
    if (format === "squad") {
      const pick = cards.eligible.find((item) => item.key === key);
      if (!pick) return;
      const base = baseSpecies.get(pick.species) ?? pick.species;
      setSquadKeys((current) => {
        if (current.includes(key)) return current.filter((item) => item !== key);
        if (current.length >= 3 || current.some((item) => { const p = cards.eligible.find((c) => c.key === item); return p && (baseSpecies.get(p.species) ?? p.species) === base; })) return current;
        return [...current, key];
      });
      return;
    }
    setSelected(key);
    setSummon({ key, sequence: Date.now() });
  };
  const findMatch = () => {
    if (!canQueue || !rank.data) return;
    setSummon(null);
    if (entry > 0) {
      void paid.start({ name: playerName!, cardId: team[0].species, assetId: team[0].key, format, cards: team.map((pick) => ({ cardId: pick.species, assetId: pick.key })),
        rating: rank.data.rating, stakeLamports: Math.round(entry * 1_000_000_000) });
    } else void matchmaking.start({ format, team, rating: rank.data.rating, entry: 0, walletAddress: session?.address ?? null });
  };

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <header className={styles.top}>
        <Link href="/" className={styles.brand}><Emblem size={22} /><span>Poke.fun</span></Link>
        <span className="pf-eyebrow">Loadout</span>
        <div className={styles.account}>
          {playerName && <AccountChip classes={{
            chip: styles.chip, avatar: styles.chipAvatar, menu: styles.menu, menuItem: styles.menuItem,
          }} />}
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.collection}>
          <h1>{format === "champion" ? "Choose your champion" : "Choose your squad of 3"}</h1>
          <p className={styles.lede}>
            {status === "guest" ? "Borrow a rental or sign in to use your own cards."
              : "Use wallet cards checked at entry, or choose a practice rental."}
          </p>
          {cards.collection.error && <div className={styles.empty} role="alert">
            <strong>Could not verify your wallet&apos;s cards</strong>
            <span>{cards.collection.error}</span>
            <span>You can still play with rentals.</span>
            <button className="pf-btn" data-size="sm" onClick={cards.collection.retry}>Retry collection</button>
          </div>}
          {session && !cards.collection.loading && !cards.collection.error && cards.ownedCount === 0
            && <div className={styles.empty} role="status">
              <strong>No supported cards in this wallet</strong>
              <span>Choose a rental below. You keep your current account and player name.</span>
            </div>}
          {cards.collection.loading && <p className={styles.hint} role="status">Checking your wallet&apos;s cards…</p>}
          {cards.rows.length > 0
            ? <CardGrid rows={cards.rows} fighters={cards.fighters} selected={selected} selectedKeys={format === "squad" ? squadKeys : undefined} onSelect={summonCard} />
            : cards.fightersLoading || cards.collection.loading
              ? <div className={styles.grid} aria-label="Loading cards" aria-busy="true">
                {[0, 1, 2, 3].map((index) => <div key={index} className={styles.cardSkeleton} />)}
              </div>
              : <p className={styles.hint}>No playable cards loaded. Retry fighter data below.</p>}
        </section>

        <aside className={`pf-panel ${styles.panel}`}>
          {matchmaking.resume && <div role="status" className={styles.empty}>
            <strong>{matchmaking.resume.checking ? "Checking your saved match…" : matchmaking.resume.path ? "You have an active match" : "Could not check your saved match"}</strong>
            {matchmaking.resume.path && <button className="pf-btn" onClick={matchmaking.rejoin}>Rejoin match</button>}
            {matchmaking.resume.error && <><span>{matchmaking.resume.error}</span><button className="pf-btn" onClick={matchmaking.retryPoll}>Retry connection</button></>}
          </div>}
          <ChampionPreview lead={lead} fighter={fighter} species={leadSpecies} format={format}
            loading={cards.fightersLoading || summons.pending}
            onSummon={() => lead && summonCard(lead.key)} />

          <p className={styles.label}>Format</p>
          <div className={styles.segment} role="group" aria-label="Battle format">
            <button className="pf-chip" data-on={format === "champion" || undefined}
              aria-pressed={format === "champion"} onClick={() => { setFormat("champion"); setEntry(0); setEntryError(null); setSummon(null); }}>
              Champion 1v1
            </button>
            <button className="pf-chip" data-on={format === "squad" || undefined}
              aria-pressed={format === "squad"} onClick={() => { setFormat("squad"); setSquadKeys([]); setEntry(0); setEntryError(null); setSummon(null); }}>
              Squad of 3
            </button>
          </div>
          <p className={styles.hint}>
            {format === "champion" ? "One card, live against another queued player."
              : "Select three different Pokémon. The first is your lead; select a card again to remove it."}
          </p>
          {format === "squad" && <SquadPreview team={team} fighters={cards.fighters} />}

          <EntryControls format={format} entry={entry} error={entryError} onEntry={setEntry} onError={setEntryError} />
          {entry > 0 && !paidCardValid && <p className={styles.warn}>Select a verified Devnet test card in your connected wallet to enter a SOL match.</p>}
          {entry > 0 && !walletAuthToken && <p className={styles.warn}>Sign in with Phantom to enter a SOL match.</p>}

          <p className={styles.label}>Player rank</p>
          {rank.data ? <div className={styles.rank}>
            <span className={styles.rankBadge} data-tier={rank.data.tier}>
              <Emblem size={18} />{rank.data.tier}<b>{rank.data.rating}</b>
            </span>
            <span>{rank.data.wins}–{rank.data.losses}</span>
          </div> : rank.loading ? <span className={styles.moveSkeleton} aria-label="Loading rank" /> : null}
          {rank.error && <div role="alert">
            <p className={styles.warn}>Couldn&apos;t load your rank: {rank.error}</p>
            <button className="pf-btn" data-size="sm" onClick={rank.retry}>Retry rank</button>
          </div>}
          {cards.fighterError && <div role="alert">
            <p className={styles.warn}>Couldn&apos;t load fighters: {cards.fighterError}</p>
            <button className="pf-btn" data-size="sm" onClick={cards.retryFighters}>Retry fighters</button>
          </div>}
          {unsupported && <p className={styles.warn}>The server has no fighter for this card. Choose another card or a rental.</p>}
          {summons.error && <div role="alert">
            <p className={styles.warn}>Couldn&apos;t load summon data: {summons.error}</p>
            <button className="pf-btn" data-size="sm" onClick={summons.retry}>Retry summons</button>
          </div>}
          {matchmaking.error && <p className={styles.warn} role="alert">{matchmaking.error}</p>}
          {paid.error && paid.queue.status === "idle" && <p className={styles.warn} role="alert">{paid.error}</p>}
          {paid.recoveryTx && <a href={explorerTx(paid.recoveryTx)} target="_blank" rel="noopener noreferrer">View Devnet SOL refund ↗</a>}
          <button className={`pf-btn ${styles.find}`} data-variant="primary" data-size="lg"
            disabled={!canQueue} onClick={findMatch}>
            {matchmaking.queue.status === "joining" ? "Entering queue…" : matchmaking.error ? "Retry find match" : "Find match"}
          </button>
        </aside>
      </main>

      <QueueDialog queue={matchmaking.queue} entry={entry} error={matchmaking.pollError}
        cancelling={matchmaking.cancelling} onCancel={() => void matchmaking.cancel()} onRetry={matchmaking.retryPoll} />
      <PaidQueueDialog queue={paid.queue} error={paid.error} busy={paid.busy} onApprove={() => void paid.approve()}
        onCancel={() => void paid.cancel()} onRecover={() => void paid.recover()} onRetry={paid.retry} />

      {summon && lead && summon.key === lead.key && leadSpecies && !summons.pending && !summons.error
        && matchmaking.queue.status === "idle" && paid.queue.status === "idle" && <CardSummon key={summon.sequence}
          mode="full" card={lead} species={leadSpecies} level={fighter?.level ?? lead.level}
          reduced={motion.reduced} muted={audio.muted} onToggleMute={audio.toggleMute} playCry={audio.playClip}
          companions={team.slice(1).map((pick) => ({
            card: pick, species: summons.data.get(pick.species) ?? null, level: pick.level,
          }))}
          onReplay={() => summonCard(lead.key)} onDone={() => setSummon(null)} />}
    </div>
  );
}
