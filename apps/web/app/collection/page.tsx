"use client";

import Link from "next/link";
import { CardTile } from "../../components/market/CardTile";
import { MarketShell } from "../../components/market/MarketShell";
import { useMarketModals } from "../../components/market/useMarketModals";
import styles from "../../components/market/market.module.css";
import { useCurrency } from "../../lib/market/currency";
import { useMarketplace } from "../../lib/market/useMarketplace";
import { useWallet } from "../../lib/wallet/WalletProvider";

export default function CollectionPage() {
  const market = useMarketplace();
  const modals = useMarketModals(market);
  const { connected, ready, signIn } = useWallet();
  const { format } = useCurrency();
  const worth = market.myCards.reduce((s, c) => s + market.valueOf(c.mint), 0);
  const nameOf = (mint: string) => market.state.cards[mint]?.name ?? "a card";
  const activity = [
    ...market.myOffers.map((o) => {
      const l = market.state.listings.find((x) => x.id === o.listingId);
      return { id: o.id, at: o.createdAt, status: o.status, text: <>Offer of <b>{format(o.priceSol)}</b> on {l?.card.name ?? "a card"} to {l?.seller.name ?? "seller"}</> };
    }),
    ...market.myTrades.map((t) => ({
      id: t.id, at: t.createdAt, status: t.status,
      text: <>Trade: {t.give.length ? t.give.map(nameOf).join(", ") : "nothing"}{t.addSol ? <> + <b>{format(t.addSol)}</b></> : null} for {t.want.map(nameOf).join(", ")} with {market.state.sellers[t.to]?.name ?? "a collector"}</>,
    })),
  ].sort((a, b) => b.at - a.at);

  return (
    <MarketShell section="collection" market={market}>
      <aside className={styles.filters} aria-label="Summary">
        <div className={styles.filterHead}><strong>My Cards</strong></div>
        {connected ? (
          <>
            <div className={styles.statPair}>
              <div><strong>{market.myCards.length}</strong><span>cards</span></div>
              <div><strong>{format(worth, { compact: true })}</strong><span>est. value</span></div>
            </div>
            <div className={styles.statPair}>
              <div><strong>{market.myListings.length}</strong><span>for sale</span></div>
              <div><strong>{format(market.balanceSol, { compact: true })}</strong><span>balance</span></div>
            </div>
            <h4 className={styles.sideTitle}>Activity</h4>
            {activity.length ? (
              <ul className={styles.activity}>
                {activity.map((a) => <li key={a.id}><span>{a.text}</span><em data-status={a.status}>{a.status}</em></li>)}
              </ul>
            ) : <p className={styles.mutedNote}>Offers and trades you make show up here.</p>}
          </>
        ) : <p className={styles.mutedNote}>Sign in to see the cards you own.</p>}
      </aside>

      <main className={styles.main}>
        {!ready ? null : !connected ? (
          <div className={styles.empty}>
            <b>Your collection lives here.</b>
            <span>Create a free account to buy, sell and trade graded cards.</span>
            <button className="pf-btn" data-variant="primary" onClick={() => signIn({ mode: "create" })}>Create account</button>
            <button className={styles.linkButton} onClick={() => signIn()}>I already have an account</button>
          </div>
        ) : market.myCards.length ? (
          <>
            <div className={styles.toolbar}><span className={styles.count}>{market.myCards.length} cards in your collection, all secured to physical storage</span><Link href="/market" className="pf-btn" data-size="sm">Browse marketplace</Link></div>
            <div className={styles.grid}>
              {market.myCards.map((c) => {
                const listing = market.listingFor(c.mint);
                return (
                  <CardTile key={c.mint} card={c} priceSol={listing?.priceSol ?? null} note={`Worth ~${format(market.valueOf(c.mint))}`} onOpen={() => modals.detail(c.mint)}>
                    {listing ? (
                      <><span className={styles.listedTag}>For sale</span><button className="pf-btn" data-size="sm" onClick={() => void market.cancelListing(listing.id)}>Remove</button></>
                    ) : (
                      <button className="pf-btn" data-size="sm" data-variant="primary" onClick={() => modals.list(c.mint)}>List for sale</button>
                    )}
                    <button className="pf-btn" data-size="sm" onClick={() => modals.trade({ give: c.mint })}>Trade</button>
                  </CardTile>
                );
              })}
            </div>
          </>
        ) : (
          <div className={styles.empty}><b>No cards yet.</b><Link href="/market" className="pf-btn" data-variant="primary">Browse the marketplace</Link></div>
        )}
      </main>
      {modals.node}
    </MarketShell>
  );
}
