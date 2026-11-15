"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CardTile, type TileBadge } from "../../components/market/CardTile";
import { MarketShell, useShell } from "../../components/market/MarketShell";
import { useMarketModals } from "../../components/market/useMarketModals";
import styles from "../../components/market/market.module.css";
import { useCurrency } from "../../lib/market/currency";
import { MARKET_FEE, type Offer, type Trade } from "../../lib/market/types";
import { useMarketplace, type Marketplace } from "../../lib/market/useMarketplace";
import { useWallet } from "../../lib/wallet/WalletProvider";

const SOURCE_NAME = { "collectors-crypt": "Collector's Crypt", phantom: "Phantom" } as const;

function useNow(ms = 30_000) {
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
function ago(at: number, now: number) {
  if (!now) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function CollectionPage() {
  const market = useMarketplace();
  const modals = useMarketModals(market);
  const { connected, ready, signIn } = useWallet();
  return (
    <MarketShell section="collection" market={market}>
      {!ready ? null : !connected ? <SignedOut onCreate={() => signIn({ mode: "create" })} onSignIn={() => signIn()} /> : <Collection market={market} modals={modals} />}
      {modals.node}
    </MarketShell>
  );
}

function SignedOut({ onCreate, onSignIn }: { onCreate: () => void; onSignIn: () => void }) {
  return (
    <>
      <div className={styles.hero}><div><span className="pf-eyebrow">My Cards</span><h1>Your collection lives here</h1><p>Every card you buy, trade for or bring in from another account shows up here, ready to battle, sell or trade.</p></div></div>
      <div className={`pf-panel ${styles.empty}`} style={{ gridColumn: "1 / -1" }}>
        <div className={styles.emptyArt} aria-hidden="true"><i style={{ ["--r" as string]: "-8deg" }} /><i /><i style={{ ["--r" as string]: "8deg" }} /></div>
        <b>Start your binder</b>
        <p>Create a free account to buy, sell and trade real graded cards. It takes about a minute.</p>
        <div className={styles.emptyActions}>
          <button className="pf-btn" data-variant="primary" onClick={onCreate}>Create account</button>
          <button className="pf-btn" onClick={onSignIn}>Sign in</button>
        </div>
      </div>
    </>
  );
}

function Collection({ market, modals }: { market: Marketplace; modals: ReturnType<typeof useMarketModals> }) {
  const { format } = useCurrency();
  const shell = useShell();
  const now = useNow();
  const worth = market.myCards.reduce((s, c) => s + market.valueOf(c.mint), 0);
  const earned = market.sales.reduce((s, l) => s + (l.soldPriceSol ?? l.priceSol) * (1 - MARKET_FEE), 0);
  const imported = market.myCards.filter((c) => market.importOf(c.mint)).length;
  const inbox = [
    ...market.incomingOffers.filter((o) => o.status === "pending" || o.status === "countered").map((o) => ({ at: o.createdAt, node: <OfferRow key={o.id} offer={o} market={market} now={now} /> })),
    ...market.incomingTrades.filter((t) => t.status === "pending").map((t) => ({ at: t.createdAt, node: <TradeRow key={t.id} trade={t} market={market} now={now} /> })),
  ].sort((a, b) => b.at - a.at);

  const remove = async (listingId: string) => {
    const r = await market.cancelListing(listingId);
    shell.toast(r.ok ? "Listing removed. The card is back in your collection." : r.error);
  };

  return (
    <>
      <div className={styles.hero}>
        <div>
          <span className="pf-eyebrow">My Cards</span>
          <h1>Your collection</h1>
          <p>Every card here is graded and secured to physical storage. Battle with them, list them for sale or trade with other collectors.</p>
        </div>
        <div className={styles.heroActions}>
          <button className="pf-btn" data-variant="primary" onClick={shell.openImport}>Add your cards</button>
          <Link href="/market" className="pf-btn">Browse marketplace</Link>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={`pf-panel ${styles.stat}`}><span>Cards</span><strong>{market.myCards.length}</strong><small>{imported ? `${imported} imported` : "Bought or traded"}</small></div>
        <div className={`pf-panel ${styles.stat}`} data-tone="gold"><span>Collection value</span><strong>{format(worth, { compact: true })}</strong><small>Based on recent sales</small></div>
        <div className={`pf-panel ${styles.stat}`}><span>For sale</span><strong>{market.myListings.length}</strong><small>{market.sales.length ? `${market.sales.length} sold · ${format(earned, { compact: true })} earned` : "Nothing sold yet"}</small></div>
        <div className={`pf-panel ${styles.stat}`}><span>Wallet SOL · Devnet</span><strong>{market.walletBalanceSol === null ? "—" : `${market.walletBalanceSol.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`}</strong><small>Marketplace demo credit: {market.balanceSol} SOL</small></div>
      </div>

      <aside className={`pf-panel ${styles.filters}`} aria-label="Activity">
        <div className={styles.filterHead}><strong>Activity</strong></div>
        <ActivityFeed market={market} now={now} />
      </aside>

      <main className={styles.main}>
        {inbox.length > 0 && (
          <section aria-label="Waiting for you">
            <div className={styles.sectionHead}><h2>Waiting for you · {inbox.length}</h2></div>
            <div className={styles.inbox} style={{ marginTop: 10 }}>{inbox.map((i) => i.node)}</div>
          </section>
        )}

        <div className={styles.sectionHead}>
          <h2>In your collection</h2>
          {market.myCards.length > 0 && <span className={styles.count} style={{ flex: "none" }}>{market.myCards.length} {market.myCards.length === 1 ? "card" : "cards"}</span>}
        </div>

        {market.myCards.length ? (
          <div className={styles.grid}>
            {market.myCards.map((c) => {
              const listing = market.listingFor(c.mint);
              const imp = market.importOf(c.mint);
              const badges: TileBadge[] = [];
              if (listing) badges.push({ text: "For sale", tone: "good" });
              if (imp) badges.push({ text: "Imported", tone: "violet" });
              return (
                <CardTile key={c.mint} card={c} priceSol={listing?.priceSol ?? null} note={`Worth ~${format(market.valueOf(c.mint))}`} badges={badges} listed={!!listing} onOpen={() => modals.detail(c.mint)}>
                  {listing ? (
                    <>
                      <button className="pf-btn" data-size="sm" data-variant="primary" onClick={() => modals.list(c.mint)}>Edit price</button>
                      <button className="pf-btn" data-size="sm" onClick={() => void remove(listing.id)}>Remove</button>
                    </>
                  ) : (
                    <>
                      <button className="pf-btn" data-size="sm" data-variant="primary" onClick={() => modals.list(c.mint)}>List for sale</button>
                      <button className="pf-btn" data-size="sm" onClick={() => modals.trade({ give: c.mint })}>Trade</button>
                    </>
                  )}
                </CardTile>
              );
            })}
          </div>
        ) : (
          <div className={`pf-panel ${styles.empty}`}>
            <div className={styles.emptyArt} aria-hidden="true"><i style={{ ["--r" as string]: "-8deg" }} /><i /><i style={{ ["--r" as string]: "8deg" }} /></div>
            <b>Your binder is empty</b>
            <p>Pick up your first card in the Marketplace, or add graded cards you already own on Collector&apos;s Crypt or in Phantom.</p>
            <div className={styles.emptyActions}>
              <Link href="/market" className="pf-btn" data-variant="primary">Browse the marketplace</Link>
              <button className="pf-btn" onClick={shell.openImport}>Add your cards</button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function Thumbs({ mints, market }: { mints: string[]; market: Marketplace }) {
  return (
    <span className={styles.inboxThumbs}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {mints.slice(0, 2).map((m) => <img key={m} src={market.state.cards[m]?.imageUri} alt="" />)}
    </span>
  );
}

function OfferRow({ offer, market, now }: { offer: Offer; market: Marketplace; now: number }) {
  const { format, toSol, fromSol, currency } = useCurrency();
  const shell = useShell();
  const listing = market.listingById(offer.listingId);
  const who = market.state.sellers[offer.from]?.name ?? "A collector";
  const [countering, setCountering] = useState(false);
  const mid = listing ? (offer.priceSol + listing.priceSol) / 2 : offer.priceSol;
  const [counter, setCounter] = useState(() => (currency === "SOL" ? fromSol(mid).toFixed(2) : String(Math.round(fromSol(mid)))));
  const [busy, setBusy] = useState<string | null>(null);
  if (!listing) return null;

  const respond = async (kind: "accept" | "decline" | "counter") => {
    setBusy(kind);
    const r = await market.respondOffer(offer.id, kind === "counter" ? { action: "counter", priceSol: toSol(Number(counter)) } : { action: kind });
    setBusy(null);
    if (!r.ok) { shell.toast(r.error); return; }
    setCountering(false);
    if (kind === "accept") shell.toast(`Sold! ${listing.card.name} went to ${who}. You got ${format(offer.priceSol * (1 - MARKET_FEE))} after fees.`);
    if (kind === "decline") shell.toast(`Offer declined. ${listing.card.name} is still for sale.`);
    if (kind === "counter") shell.toast(`Counter sent to ${who}.`);
  };

  return (
    <div className={`pf-panel ${styles.inboxItem}`} data-pending={offer.status === "pending" || undefined}>
      <Thumbs mints={[listing.card.mint]} market={market} />
      <div className={styles.inboxText}>
        <span>{offer.status === "countered" ? <>You countered <b>{format(offer.counterSol ?? 0)}</b> to {who}</> : <>{who} offered <b>{format(offer.priceSol)}</b> for your {listing.card.name}</>}</span>
        <small>{offer.status === "countered" ? "Waiting for their reply" : `You're asking ${format(listing.priceSol)} · you'd get ${format(offer.priceSol * (1 - MARKET_FEE))} after the 2.5% fee`} · {ago(offer.createdAt, now)}</small>
      </div>
      <div className={styles.inboxActions}>
        {offer.status === "countered" ? <span className="pf-eyebrow">Countered</span> : countering ? (
          <form className={styles.counter} onSubmit={(e) => { e.preventDefault(); void respond("counter"); }}>
            <input className="pf-input" type="number" min="0" step={currency === "SOL" ? "0.01" : "1"} value={counter} autoFocus onChange={(e) => setCounter(e.target.value)} aria-label={`Counter price (${currency})`} />
            <button className="pf-btn" data-size="sm" data-variant="primary" disabled={!!busy || !(Number(counter) > 0)}>{busy ? "Sending…" : "Send"}</button>
            <button className="pf-btn" data-size="sm" type="button" onClick={() => setCountering(false)}>Back</button>
          </form>
        ) : (
          <>
            <button className="pf-btn" data-size="sm" data-variant="primary" disabled={!!busy} onClick={() => void respond("accept")}>{busy === "accept" ? "Selling…" : "Accept"}</button>
            <button className="pf-btn" data-size="sm" disabled={!!busy} onClick={() => setCountering(true)}>Counter</button>
            <button className="pf-btn" data-size="sm" disabled={!!busy} onClick={() => void respond("decline")}>{busy === "decline" ? "…" : "Decline"}</button>
          </>
        )}
      </div>
    </div>
  );
}

function TradeRow({ trade, market, now }: { trade: Trade; market: Marketplace; now: number }) {
  const { format } = useCurrency();
  const shell = useShell();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const who = market.state.sellers[trade.from]?.name ?? "A collector";
  const name = (m: string) => market.state.cards[m]?.name ?? "a card";
  const theirs = trade.give.reduce((s, m) => s + market.valueOf(m), 0) + trade.addSol;
  const yours = trade.want.reduce((s, m) => s + market.valueOf(m), 0);

  const respond = async (accept: boolean) => {
    setBusy(accept ? "accept" : "decline");
    const r = await market.respondTrade(trade.id, accept);
    setBusy(null);
    shell.toast(!r.ok ? r.error : accept ? `Trade done! ${trade.give.map(name).join(" + ")} is in your collection.` : "Trade declined.");
  };

  return (
    <div className={`pf-panel ${styles.inboxItem}`} data-pending>
      <Thumbs mints={[...trade.give, ...trade.want]} market={market} />
      <div className={styles.inboxText}>
        <span>{who} offers {trade.give.map(name).join(" + ")}{trade.addSol > 0 && <> + <b>{format(trade.addSol)}</b></>} for your {trade.want.map(name).join(" + ")}</span>
        <small>Their side {format(theirs)} · your side {format(yours)} · {ago(trade.createdAt, now)}</small>
      </div>
      <div className={styles.inboxActions}>
        <button className="pf-btn" data-size="sm" data-variant="primary" disabled={!!busy} onClick={() => void respond(true)}>{busy === "accept" ? "Trading…" : "Accept"}</button>
        <button className="pf-btn" data-size="sm" disabled={!!busy} onClick={() => void respond(false)}>{busy === "decline" ? "…" : "Decline"}</button>
      </div>
    </div>
  );
}

function ActivityFeed({ market, now }: { market: Marketplace; now: number }) {
  const { format } = useCurrency();
  const me = market.me;
  const nameOf = (mint: string) => market.state.cards[mint]?.name ?? "a card";
  const person = (a: string) => market.state.sellers[a]?.name ?? "a collector";
  const items: { id: string; at: number; status: string; text: ReactNode }[] = [];

  market.sales.forEach((l) => {
    const price = l.soldPriceSol ?? l.priceSol;
    items.push({ id: `sold-${l.id}`, at: l.soldAt ?? l.listedAt, status: "sold", text: <>Sold {l.card.name} to {person(l.buyer ?? "")} for {format(price)}. You got <b>{format(price * (1 - MARKET_FEE))}</b></> });
  });
  market.purchases.forEach((l) => items.push({ id: `buy-${l.id}`, at: l.soldAt ?? l.listedAt, status: "bought", text: <>Bought {l.card.name} from {l.seller.name} for <b>{format(l.soldPriceSol ?? l.priceSol)}</b></> }));
  market.myListings.forEach((l) => items.push({ id: `list-${l.id}`, at: l.listedAt, status: "listed", text: <>Listed {l.card.name} for <b>{format(l.priceSol)}</b></> }));
  const batches = new Map<string, { at: number; source: keyof typeof SOURCE_NAME; n: number }>();
  Object.entries(market.state.imports).forEach(([mint, rec]) => {
    const mine = rec.by ? rec.by === me : market.state.owners[mint] === me || market.sales.some((l) => l.card.mint === mint);
    if (!mine) return;
    const key = `${rec.source}-${rec.at}`;
    batches.set(key, { at: rec.at, source: rec.source, n: (batches.get(key)?.n ?? 0) + 1 });
  });
  batches.forEach((b, key) => items.push({ id: `imp-${key}`, at: b.at, status: "imported", text: <>Added {b.n} {b.n === 1 ? "card" : "cards"} from {SOURCE_NAME[b.source]}</> }));
  market.myOffers.forEach((o) => {
    const l = market.listingById(o.listingId);
    items.push({ id: o.id, at: o.createdAt, status: o.status, text: <>Offered <b>{format(o.priceSol)}</b> on {l?.card.name ?? "a card"}</> });
  });
  market.myTrades.forEach((t) => {
    const theirSide = (give: string[]) => <>{give.length ? give.map(nameOf).join(" + ") : "money"}{t.addSol ? <> + <b>{format(t.addSol)}</b></> : null}</>;
    if (t.from === market.me) {
      items.push({ id: t.id, at: t.createdAt, status: t.status, text: <>Offered {person(t.to)} {theirSide(t.give)} for {t.want.map(nameOf).join(" + ")}</> });
    } else if (t.status !== "pending") {
      items.push({ id: t.id, at: t.createdAt, status: t.status, text: t.status === "accepted"
        ? <>Traded your {t.want.map(nameOf).join(" + ")} to {person(t.from)} for {theirSide(t.give)}</>
        : <>Turned down {person(t.from)}&apos;s trade for your {t.want.map(nameOf).join(" + ")}</> });
    }
  });
  market.incomingOffers.filter((o) => o.status === "declined").forEach((o) => items.push({ id: `in-${o.id}`, at: o.createdAt, status: "declined", text: <>{person(o.from)}&apos;s offer of {format(o.counterSol ?? o.priceSol)}</> }));

  items.sort((a, b) => b.at - a.at);
  if (!items.length) return <p className={styles.mutedNote}>Purchases, sales, offers and trades show up here.</p>;
  return (
    <ul className={styles.activity}>
      {items.slice(0, 14).map((a) => <li key={a.id}><span>{a.text}</span><em data-status={a.status}>{a.status}</em>{now > 0 && <time>{ago(a.at, now)}</time>}</li>)}
    </ul>
  );
}
