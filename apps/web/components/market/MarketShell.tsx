"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBattleAudio } from "../../lib/audio/useBattleAudio";
import { useCurrency } from "../../lib/market/currency";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { useWallet } from "../../lib/wallet/WalletProvider";
import { AccountChip } from "../AccountChip";
import { Emblem } from "../Emblem";
import battle from "../battle/battle.module.css";
import { CurrencyToggle } from "./CurrencyToggle";
import styles from "./market.module.css";

type Section = "market" | "collection";

/** Top bar + page frame shared by the marketplace screens. Uses the battle screen's chrome so it reads as one product. */
export function MarketShell({ section, market, children }: { section: Section; market: Marketplace; children: ReactNode }) {
  const { playerName, connected, signIn } = useWallet();
  const { format } = useCurrency();
  const audio = useBattleAudio();
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const items = [
      ...market.myOffers.map((o) => ({ id: o.id, status: o.status, text: o.status === "accepted" ? `Offer accepted: ${market.state.listings.find((l) => l.id === o.listingId)?.card.name ?? "card"} is yours.` : "Your offer was declined. Try a little closer to the asking price." })),
      ...market.myTrades.map((t) => ({ id: t.id, status: t.status, text: t.status === "accepted" ? "Trade accepted. Your new cards are in My Cards." : "Your trade was declined." })),
    ];
    if (!seen.current) { seen.current = new Map(items.map((i) => [i.id, i.status])); return; }
    for (const i of items) {
      const prev = seen.current.get(i.id);
      seen.current.set(i.id, i.status);
      if (prev === "pending" && i.status !== "pending") setToast(i.text);
    }
  }, [market.myOffers, market.myTrades, market.state.listings]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className={`pf-chrome ${styles.page}`}>
      <header className={`${battle.topbar} ${styles.topbar}`}>
        <div className={battle.topLeft}>
          <Link href="/" className={battle.logo} aria-label="Poke.fun home">
            <Emblem size={22} /><span>Poke<em>.fun</em></span><small>beta</small>
          </Link>
          <nav className={battle.tabs} aria-label="Sections">
            <Link href="/" className={battle.tab}><span className={battle.homeIcon} aria-hidden="true" /><span>Home</span></Link>
            <Link href="/market" className={`${battle.tab} ${styles.navTab}`} data-active={section === "market" || undefined}>
              <span className={battle.tabMain}><strong>Marketplace</strong><span>{market.active.length} cards for sale</span></span>
            </Link>
            <Link href="/collection" className={`${battle.tab} ${styles.navTab}`} data-active={section === "collection" || undefined}>
              <span className={battle.tabMain}><strong>My Cards</strong><span>{connected ? `${market.myCards.length} owned` : "Sign in to view"}</span></span>
            </Link>
            <Link href="/loadout" className={`${battle.tab} ${styles.navTab}`}>
              <span className={battle.tabMain}><strong>Battle</strong><span>Find a match</span></span>
            </Link>
          </nav>
        </div>
        <div className={`${battle.topRight} ${styles.topRight}`}>
          <Link href="/loadout" className={battle.plus} title="Find a new battle" aria-label="New battle" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>+</Link>
          <div className={battle.userArea}>
            <CurrencyToggle />
            {connected && <span className={styles.balance} title="Demo balance">Balance <b>{format(market.balanceSol)}</b></span>}
            {playerName ? (
              <AccountChip classes={{ chip: battle.userChip, avatar: battle.userAvatar, menu: battle.menu, menuItem: battle.menuItem }}
                extra={<Link className={battle.menuItem} href="/collection">My Cards</Link>} />
            ) : (
              <button className={battle.button} onClick={() => signIn()}>Sign in</button>
            )}
            <button className={battle.iconButton} onClick={audio.toggleMute} aria-label={audio.muted ? "Unmute" : "Mute"} aria-pressed={audio.muted}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor" />{audio.muted ? <path d="M11 5l4 6M15 5l-4 6" stroke="currentColor" strokeWidth="1.6" /> : <path d="M11 5.5a3.5 3.5 0 010 5M12.5 3.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.4" fill="none" />}</svg>
            </button>
          </div>
        </div>
      </header>
      <div className={styles.body}>{children}</div>
      {toast && <div className={styles.toast} role="status">{toast}<button onClick={() => setToast(null)} aria-label="Dismiss">×</button></div>}
    </div>
  );
}
