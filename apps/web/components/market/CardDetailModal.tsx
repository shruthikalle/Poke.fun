"use client";

import { useMemo, useState } from "react";
import { useCurrency } from "../../lib/market/currency";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { PixelAvatar } from "../PixelAvatar";
import { CardArt } from "./CardArt";
import { Modal } from "./Modal";
import { PriceChart } from "./PriceChart";
import styles from "./market.module.css";

type Pane = "idle" | "confirm-buy" | "offer";

const suggest = (amount: number, currency: string) => (currency === "SOL" ? amount.toFixed(2) : String(Math.round(amount)));

export function CardDetailModal({ mint, market, onClose, onTrade, onTradeAway, onList }: {
  mint: string; market: Marketplace; onClose: () => void; onTrade: (wantMint: string) => void; onTradeAway: (giveMint: string) => void; onList: (mint: string) => void;
}) {
  const { format, toSol, fromSol, currency } = useCurrency();
  const card = market.state.cards[mint];
  const listing = market.listingFor(mint);
  const owner = market.ownerOf(mint);
  const mine = !!market.me && owner?.address === market.me;
  const imported = market.importOf(mint);
  const history = useMemo(() => market.priceHistory(mint), [market, mint]);
  const [pane, setPane] = useState<Pane>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [offer, setOffer] = useState("");
  const pendingOffer = listing && market.myOffers.find((o) => o.listingId === listing.id && o.status === "pending");

  if (!card) return null;
  const value = listing?.priceSol ?? market.valueOf(mint);

  const buy = async () => {
    if (!listing) return;
    setBusy(true);
    const short = listing.priceSol - market.balanceSol;
    if (short > 0) {
      const topUp = await market.addFunds(Math.ceil(short * 100) / 100);
      if (!topUp.ok) { setBusy(false); setMessage({ tone: "bad", text: topUp.error }); return; }
    }
    const r = await market.buy(listing.id);
    setBusy(false); setPane("idle");
    setMessage(r.ok ? { tone: "good", text: "It's yours! Find it in My Cards." } : { tone: "bad", text: r.error });
  };

  const sendOffer = async () => {
    if (!listing) return;
    const amount = Number(offer);
    if (!(amount > 0)) { setMessage({ tone: "bad", text: "Enter an amount above zero." }); return; }
    setBusy(true);
    const r = await market.makeOffer(listing.id, toSol(amount));
    setBusy(false);
    if (r.ok) { setPane("idle"); setOffer(""); setMessage({ tone: "good", text: `Offer sent to ${listing.seller.name}. You'll hear back in a moment.` }); }
    else setMessage({ tone: "bad", text: r.error });
  };

  return (
    <Modal title={card.name} onClose={onClose} wide>
      <div className={styles.detail}>
        <div className={styles.detailArt}>
          <CardArt card={card} size="lg" />
          <div className={styles.vaultNote}>
            <span className={styles.lock} aria-hidden="true" />
            <div><b>Secured to physical storage</b><span>The graded card sits in an insured vault. Ownership moves to you the moment you buy; request the physical card anytime.</span></div>
          </div>
        </div>
        <div className={styles.detailInfo}>
          <div className={styles.detailTitle}>
            <h2>{card.name}</h2>
            <span>{card.set} · #{card.number}</span>
          </div>
          <div className={styles.tags}><span className={styles.gradeTag}>{card.grade}</span><span className={styles.rarityTag}>{card.rarity}</span>{imported && <span className={styles.badge} data-tone="violet">Imported</span>}</div>

          <div className={`pf-frame ${styles.priceBox}`}>
            <span>{listing ? "Price" : "Estimated value"}</span>
            <strong>{format(value)}</strong>
            {!listing && <small>Not listed for sale right now</small>}
          </div>

          {message && <p className={styles.notice} data-tone={message.tone} role="status">{message.text}</p>}

          {mine ? (
            <div className={styles.actionsRow}>
              {listing ? (
                <>
                  <button className="pf-btn" data-variant="primary" onClick={() => onList(mint)}>Edit price</button>
                  <button className="pf-btn" disabled={busy} onClick={async () => { setBusy(true); const r = await market.cancelListing(listing.id); setBusy(false); setMessage(r.ok ? { tone: "good", text: "Listing removed. It's back in your collection." } : { tone: "bad", text: r.error }); }}>Remove listing</button>
                </>
              ) : (
                <>
                  <button className="pf-btn" data-variant="primary" onClick={() => onList(mint)}>List for sale</button>
                  <button className="pf-btn" onClick={() => onTradeAway(mint)}>Trade</button>
                </>
              )}
              <span className={styles.mutedNote}>{listing ? "Your listing is live in the Marketplace." : "This card is in your collection."}</span>
            </div>
          ) : pane === "confirm-buy" && listing ? (
            <div className={styles.confirm}>
              <p>Buy <b>{card.name}</b> ({card.grade}) from {listing.seller.name} for <b>{format(listing.priceSol)}</b>?</p>
              {market.balanceSol >= listing.priceSol
                ? <p className={styles.mutedNote}>Paid from your balance ({format(market.balanceSol)}). Balance after: {format(market.balanceSol - listing.priceSol)}</p>
                : <p className={styles.mutedNote}>Your balance covers {format(market.balanceSol)}. The remaining <b>{format(listing.priceSol - market.balanceSol)}</b> goes on your card on file (demo).</p>}
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={busy} onClick={buy}>{busy ? "Buying…" : market.balanceSol >= listing.priceSol ? "Confirm purchase" : "Pay and buy"}</button>
                <button className="pf-btn" disabled={busy} onClick={() => setPane("idle")}>Back</button>
              </div>
            </div>
          ) : pane === "offer" && listing ? (
            <div className={styles.confirm}>
              <label className={styles.fieldLabel}>Your offer ({currency})
                <input className="pf-input" type="number" min="0" step={currency === "SOL" ? "0.01" : "1"} value={offer} autoFocus
                  placeholder={suggest(fromSol(listing.priceSol * 0.92), currency)}
                  onChange={(e) => setOffer(e.target.value)} />
              </label>
              <p className={styles.mutedNote}>Asking {format(listing.priceSol)}. Sellers usually accept offers within 10%.</p>
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={busy} onClick={sendOffer}>{busy ? "Sending…" : "Send offer"}</button>
                <button className="pf-btn" disabled={busy} onClick={() => setPane("idle")}>Back</button>
              </div>
            </div>
          ) : (
            <div className={styles.actionsRow}>
              {listing && <button className="pf-btn" data-variant="primary" onClick={() => (market.me ? setPane("confirm-buy") : void market.buy(listing.id))}>Buy now</button>}
              {listing && <button className="pf-btn" disabled={!!pendingOffer} onClick={() => (market.me ? setPane("offer") : void market.makeOffer(listing.id, 0))}>{pendingOffer ? "Offer pending…" : "Make offer"}</button>}
              <button className="pf-btn" onClick={() => onTrade(mint)}>Propose trade</button>
            </div>
          )}

          <PriceChart points={history} />

          {owner && (
            <div className={styles.seller}>
              <PixelAvatar seed={owner.address} size={32} />
              <div>
                <b>{mine ? "You" : owner.name}</b>
                <span>★ {owner.rating.toFixed(1)} · {owner.sales} sales · member since {owner.memberSince}</span>
              </div>
            </div>
          )}

          <dl className={styles.specs}>
            <dt>Set</dt><dd>{card.set}</dd>
            <dt>Number</dt><dd>#{card.number}</dd>
            <dt>Rarity</dt><dd>{card.rarity}</dd>
            <dt>Grade</dt><dd>{card.grade}</dd>
            <dt>Originally from</dt><dd>{card.origin} (verified)</dd>
            {imported && <><dt>Added from</dt><dd>{imported.source === "phantom" ? "Phantom" : "Collector's Crypt"}, imported by you</dd></>}
          </dl>
        </div>
      </div>
    </Modal>
  );
}
