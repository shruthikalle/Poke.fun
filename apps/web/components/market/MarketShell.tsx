"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBattleAudio } from "../../lib/audio/useBattleAudio";
import { useCurrency } from "../../lib/market/currency";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { useWallet } from "../../lib/wallet/WalletProvider";
import { AccountChip } from "../AccountChip";
import { Emblem } from "../Emblem";
import { CurrencyToggle } from "./CurrencyToggle";
import { ImportCardsModal } from "./ImportCardsModal";
import styles from "./market.module.css";

type Section = "market" | "collection";

interface ShellApi { toast: (text: string) => void; openImport: () => void }
const ShellContext = createContext<ShellApi>({ toast: () => {}, openImport: () => {} });
/** Toasts and the "Add your cards" flow, available to anything inside the marketplace pages. */
export const useShell = () => useContext(ShellContext);

/** Header + page frame shared by Marketplace and My Cards, in the same dark pixel style as landing and loadout. */
export function MarketShell({ section, market, children }: { section: Section; market: Marketplace; children: ReactNode }) {
  const { playerName, connected, signIn } = useWallet();
  const { format } = useCurrency();
  const audio = useBattleAudio();
  const [toast, setToast] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const seen = useRef<Map<string, string> | null>(null);
  const nameOf = (mint: string) => market.state.cards[mint]?.name ?? "a card";

  useEffect(() => {
    const items = [
      ...market.myOffers.map((o) => ({ id: o.id, status: o.status, text: o.status === "accepted" ? `Offer accepted: ${market.listingById(o.listingId)?.card.name ?? "the card"} is yours.`
        : o.status === "countered" ? `The seller countered at ${format(o.counterSol ?? 0)}. Answer it in My Cards.`
        : o.status === "declined" ? "Your offer was declined. Try a little closer to the asking price." : "" })),
      ...market.myTrades.map((t) => ({ id: t.id, status: t.status, text: t.status === "accepted" ? "Trade accepted. Your new card is in My Cards." : t.status === "declined" ? "Your trade was declined." : "" })),
      ...market.incomingOffers.map((o) => {
        const l = market.listingById(o.listingId);
        const who = market.state.sellers[o.from]?.name ?? "A collector";
        return { id: `in-${o.id}`, status: o.status, text: o.status === "pending" ? `${who} offered ${format(o.priceSol)} for your ${l?.card.name ?? "card"}.` : o.status === "accepted" && l?.soldPriceSol ? `Sold! ${l.card.name} went to ${who} for ${format(l.soldPriceSol)}.` : o.status === "declined" ? `${who} passed on your counter.` : "" };
      }),
      ...market.incomingTrades.map((t) => ({ id: `in-${t.id}`, status: t.status, text: t.status === "pending" ? `${market.state.sellers[t.from]?.name ?? "A collector"} wants to trade for your ${t.want.map(nameOf).join(", ")}.` : "" })),
    ];
    if (!seen.current) { seen.current = new Map(items.map((i) => [i.id, i.status])); return; }
    for (const i of items) {
      const prev = seen.current.get(i.id);
      seen.current.set(i.id, i.status);
      const incoming = i.id.startsWith("in-");
      const show = incoming ? (prev === undefined && i.status === "pending") || (prev === "countered" && i.status !== "countered") : prev === "pending" && i.status !== "pending";
      if (show && i.text) setToast(i.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.myOffers, market.myTrades, market.incomingOffers, market.incomingTrades]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const openImport = useCallback(() => (connected ? setImporting(true) : signIn({ mode: "create", onSignedIn: () => setImporting(true) })), [connected, signIn]);
  const api = useRef<ShellApi>({ toast: setToast, openImport });
  api.current.openImport = openImport;

  return (
    <ShellContext.Provider value={api.current}>
      <div className={styles.page}>
        <div className={styles.backdrop} aria-hidden="true" />
        <header className={styles.top}>
          <Link href="/" className={styles.brand}><Emblem size={22} /><span>Poke.fun</span></Link>
          <nav className={styles.nav} aria-label="Sections">
            <Link href="/market" data-active={section === "market" || undefined} aria-current={section === "market" ? "page" : undefined}>Marketplace</Link>
            <Link href="/collection" data-active={section === "collection" || undefined} aria-current={section === "collection" ? "page" : undefined}>
              My Cards{market.pendingCount > 0 && <span className={styles.navBadge} aria-label={`${market.pendingCount} waiting for you`}>{market.pendingCount}</span>}
            </Link>
            <Link href="/loadout">Battle</Link>
          </nav>
          <div className={styles.account}>
            <CurrencyToggle />
            {connected && <span className={styles.balance} title="Devnet wallet SOL. Purchases and offers pay from here."><small>Wallet SOL</small><b>{market.walletBalanceSol === null ? "—" : `${market.walletBalanceSol.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`}</b></span>}
            {playerName ? (
              <AccountChip classes={{ chip: styles.chip, avatar: styles.chipAvatar, menu: styles.menu, menuItem: styles.menuItem }}
                extra={<>
                  <Link className={styles.menuItem} href="/collection">My Cards</Link>
                  {connected && <button className={styles.menuItem} role="menuitem" onClick={openImport}>Add your cards</button>}
                </>} />
            ) : (
              <button className="pf-btn" data-size="sm" data-variant="primary" onClick={() => signIn()}>Sign in</button>
            )}
            <button className={styles.iconBtn} onClick={audio.toggleMute} aria-label={audio.muted ? "Unmute" : "Mute"} aria-pressed={audio.muted}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor" />{audio.muted ? <path d="M11 5l4 6M15 5l-4 6" stroke="currentColor" strokeWidth="1.6" /> : <path d="M11 5.5a3.5 3.5 0 010 5M12.5 3.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.4" fill="none" />}</svg>
            </button>
          </div>
        </header>
        <div className={styles.body}>{children}</div>
        {importing && <ImportCardsModal market={market} onClose={() => setImporting(false)} />}
        {toast && <div className={styles.toast} role="status">{toast}<button onClick={() => setToast(null)} aria-label="Dismiss">×</button></div>}
      </div>
    </ShellContext.Provider>
  );
}
