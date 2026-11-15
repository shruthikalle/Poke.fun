"use client";

import { useMemo, useState } from "react";
import { useCurrency } from "../../lib/market/currency";
import type { Card } from "../../lib/market/types";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { CardArt } from "./CardArt";
import { Modal } from "./Modal";
import styles from "./market.module.css";

/** Propose card-for-card or card + money trades. Opens with a card you want, or a card you'd give. */
export function TradeModal({ market, wantMint, giveMint, onClose }: { market: Marketplace; wantMint?: string; giveMint?: string; onClose: () => void }) {
  const { format, toSol, currency } = useCurrency();
  const [want, setWant] = useState<string | null>(wantMint ?? null);
  const [give, setGive] = useState<string[]>(giveMint ? [giveMint] : []);
  const [extra, setExtra] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [sentTrade, setSentTrade] = useState<{ id: string; summary: string } | null>(null);

  const target = want ? market.state.cards[want] : null;
  const partner = want ? market.ownerOf(want) : null;
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(market.state.cards)
      .filter((c) => market.state.owners[c.mint] !== market.me && (!q || c.name.toLowerCase().includes(q) || c.set.toLowerCase().includes(q)))
      .slice(0, 24);
  }, [market.state, market.me, query]);

  const extraSol = Number(extra) > 0 ? toSol(Number(extra)) : 0;
  const offered = give.reduce((s, m) => s + market.valueOf(m), 0) + extraSol;
  const asked = want ? market.valueOf(want) : 0;
  const ratio = asked ? offered / asked : 0;

  const toggleGive = (mint: string) => setGive((g) => (g.includes(mint) ? g.filter((m) => m !== mint) : [...g, mint]));

  const submit = async () => {
    if (!want || !partner) return;
    setBusy(true); setResult(null);
    const r = await market.proposeTrade({ to: partner.address, give, want: [want], addSol: extraSol });
    setBusy(false);
    if (r.ok) {
      const names = give.map((m) => market.state.cards[m]?.name).filter(Boolean).join(" + ");
      const parts = [names, extraSol ? format(extraSol) : ""].filter(Boolean).join(" + ") || "nothing";
      setSentTrade({ id: r.value.id, summary: `${parts} for ${target?.name ?? "their card"} with ${partner.name}` });
    } else setResult({ tone: "bad", text: r.error });
  };

  if (!market.me) return null;
  const sent = !!sentTrade;

  if (sentTrade) {
    const status = market.myTrades.find((t) => t.id === sentTrade.id)?.status ?? "pending";
    return (
      <Modal title="Propose a trade" onClose={onClose}>
        <div className={styles.listForm}>
          <h3>{status === "accepted" ? "Trade accepted" : status === "declined" ? "Trade declined" : "Trade sent"}</h3>
          <p className={styles.mutedNote}>{sentTrade.summary}</p>
          <p className={styles.notice} data-tone={status === "declined" ? "bad" : "good"} role="status">
            {status === "accepted" ? "Done! Your new card is in My Cards." : status === "declined" ? "They passed on this one. Try adding a little more." : "Waiting for a reply. We'll let you know when they respond."}
          </p>
          <div className={styles.actionsRow}><button className="pf-btn" data-variant="primary" onClick={onClose}>Done</button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Propose a trade" onClose={onClose} wide>
      <div className={styles.trade}>
        <section className={styles.tradeSide}>
          <h3>You give</h3>
          {market.myCards.length ? (
            <div className={styles.pickGrid}>
              {market.myCards.map((c) => <Pick key={c.mint} card={c} on={give.includes(c.mint)} onClick={() => toggleGive(c.mint)} sub={format(market.valueOf(c.mint))} disabled={sent} />)}
            </div>
          ) : <p className={styles.mutedNote}>You don&apos;t own any cards yet. You can still offer money.</p>}
          <label className={styles.fieldLabel}>Add money ({currency}, optional)
            <input className="pf-input" type="number" min="0" step={currency === "SOL" ? "0.01" : "1"} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" disabled={sent} />
          </label>
        </section>

        <section className={styles.tradeSide}>
          <h3>You get</h3>
          {target && partner ? (
            <div className={styles.tradeTarget}>
              <CardArt card={target} size="sm" />
              <div>
                <b>{target.name}</b>
                <span>{target.set} · {target.grade}</span>
                <span>Owned by {partner.name}</span>
                <span>Value {format(asked)}</span>
                {!wantMint && !sent && <button className="pf-btn" data-size="sm" onClick={() => setWant(null)}>Change</button>}
              </div>
            </div>
          ) : (
            <>
              <input className="pf-input" placeholder="Search cards other people own" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
              <div className={styles.pickGrid}>
                {candidates.map((c) => <Pick key={c.mint} card={c} on={false} onClick={() => setWant(c.mint)} sub={format(market.valueOf(c.mint))} />)}
              </div>
            </>
          )}
        </section>
      </div>

      <div className={styles.tradeFoot}>
        <div className={styles.balanceBar} aria-label="Trade balance">
          <span>Your side <b>{format(offered)}</b></span>
          <span className={styles.meter}><i style={{ width: `${Math.min(100, ratio * 100)}%` }} data-tone={ratio >= 0.95 ? "good" : ratio >= 0.8 ? "warn" : "bad"} /></span>
          <span>Their side <b>{format(asked)}</b></span>
        </div>
        {want && <p className={styles.mutedNote}>{ratio >= 0.95 ? "Looks fair. Most traders would accept this." : "Your side is lower than theirs. Add a card or some money to improve your chances."}</p>}
        {result && <p className={styles.notice} data-tone={result.tone} role="status">{result.text}</p>}
        <div className={styles.actionsRow}>
          {sent ? <button className="pf-btn" data-variant="primary" onClick={onClose}>Done</button> : (
            <>
              <button className="pf-btn" data-variant="primary" disabled={busy || !want || (!give.length && !extraSol)} onClick={submit}>{busy ? "Sending…" : "Send trade offer"}</button>
              <button className="pf-btn" disabled={busy} onClick={onClose}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Pick({ card, on, onClick, sub, disabled }: { card: Card; on: boolean; onClick: () => void; sub: string; disabled?: boolean }) {
  return (
    <button className={styles.pick} data-on={on || undefined} onClick={onClick} disabled={disabled} aria-pressed={on}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={card.imageUri} alt="" loading="lazy" />
      <span><b>{card.name}</b><small>{card.grade} · {sub}</small></span>
    </button>
  );
}
