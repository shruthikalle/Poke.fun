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
  const history = useMemo(() => market.priceHistory(mint), [market, mint]);
  const [pane, setPane] = useState<Pane>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [offer, setOffer] = useState("");
  const myOffer = listing && market.myOffers.find((o) => o.listingId === listing.id && (o.status === "pending" || o.status === "countered"));
  const pendingOffer = myOffer?.status === "pending" ? myOffer : undefined;
  const counter = myOffer?.status === "countered" ? myOffer : undefined;

  if (!card) return null;
  const value = listing?.priceSol ?? market.valueOf(mint);

  const act = async (run: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(true);
    const r = await run();
    setBusy(false);
    setMessage(r.ok ? { tone: "good", text: success } : { tone: "bad", text: r.error ?? "Something went wrong." });
  };

  const buy = async () => {
    if (!listing) return;
    if (listing.priceSol > market.balanceSol) {
      setMessage({ tone: "bad", text: "Not enough devnet SOL in your wallet. Use “Get devnet SOL” and try again." });
      return;
    }
    setBusy(true);
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
    if (r.ok) { setPane("idle"); setOffer(""); setMessage({ tone: "good", text: `Offer sent to ${listing.seller.name}. Your SOL is in escrow until they answer.` }); }
    else setMessage({ tone: "bad", text: r.error });
  };

  return (
    <Modal title={card.name} onClose={onClose} wide>
      <div className={styles.detail}>
        <div className={styles.detailArt}>
          <CardArt card={card} size="lg" />
          <div className={styles.vaultNote}>
            <span className={styles.lock} aria-hidden="true" />
            <div><b>Devnet test card · stays in the owner&apos;s wallet</b><span>Listing freezes it in the seller&apos;s wallet. Buying moves the SOL and the card in one Solana transaction. No physical card.</span></div>
          </div>
          <a className={styles.mutedNote} href={`https://explorer.solana.com/address/${card.mint}?cluster=devnet`} target="_blank" rel="noreferrer">View on Solana Explorer ↗</a>
        </div>
        <div className={styles.detailInfo}>
          <div className={styles.detailTitle}>
            <h2>{card.name}</h2>
            <span>{card.set} · #{card.number}</span>
          </div>
          <div className={styles.tags}><span className={styles.gradeTag}>{card.grade}</span><span className={styles.rarityTag}>{card.rarity}</span></div>

          <div className={`pf-frame ${styles.priceBox}`}>
            <span>{listing ? "Price" : "Last sale"}</span>
            <strong>{value > 0 ? format(value) : "—"}</strong>
            {!listing && <small>Not listed for sale right now</small>}
          </div>

          {message && <p className={styles.notice} data-tone={message.tone} role="status">{message.text}</p>}
          {market.me && !market.canSign && <p className={styles.notice} data-tone="bad" role="status">This account can&apos;t sign devnet transactions. Sign out and continue with Phantom.</p>}
          {counter && listing && (
            <div className={styles.confirm}>
              <p>{listing.seller.name} countered your {format(counter.priceSol)} offer at <b>{format(counter.counterSol ?? 0)}</b>.</p>
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={busy} onClick={() => void act(() => market.acceptCounter(counter.id), "It's yours! Find it in My Cards.")}>{busy ? "Working…" : `Accept ${format(counter.counterSol ?? 0)}`}</button>
                <button className="pf-btn" disabled={busy} onClick={() => void act(() => market.cancelOffer(counter.id), "Offer withdrawn. Your SOL is back in your wallet.")}>Withdraw offer</button>
              </div>
            </div>
          )}

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
              <p className={styles.mutedNote}>Paid from your wallet ({format(market.balanceSol)} devnet SOL). The seller receives 97.5%; 2.5% goes to the marketplace. Your wallet will ask you to approve.</p>
              {market.balanceSol < listing.priceSol && market.state.onboarding?.faucet && (
                <button className="pf-btn" data-size="sm" disabled={busy} onClick={() => void act(() => market.addFunds(listing.priceSol - market.balanceSol), "Devnet SOL added to your wallet.")}>Get devnet SOL</button>
              )}
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={busy} onClick={buy}>{busy ? "Buying…" : "Confirm purchase"}</button>
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
              <p className={styles.mutedNote}>Asking {format(listing.priceSol)}. Your SOL is held in escrow on-chain until the seller answers. Withdraw it anytime.</p>
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={busy} onClick={sendOffer}>{busy ? "Sending…" : "Send offer"}</button>
                <button className="pf-btn" disabled={busy} onClick={() => setPane("idle")}>Back</button>
              </div>
            </div>
          ) : (
            <div className={styles.actionsRow}>
              {listing && <button className="pf-btn" data-variant="primary" onClick={() => (market.me ? setPane("confirm-buy") : void market.buy(listing.id))}>Buy now</button>}
              {listing && !counter && (pendingOffer
                ? <button className="pf-btn" disabled={busy} onClick={() => void act(() => market.cancelOffer(pendingOffer.id), "Offer withdrawn. Your SOL is back in your wallet.")}>Withdraw offer</button>
                : <button className="pf-btn" onClick={() => (market.me ? setPane("offer") : void market.makeOffer(listing.id, 0))}>Make offer</button>)}
              <button className="pf-btn" onClick={() => onTrade(mint)}>Propose trade</button>
            </div>
          )}

          <PriceChart points={history} />

          {owner && (
            <div className={styles.seller}>
              <PixelAvatar seed={owner.address} size={32} />
              <div>
                <b>{mine ? "You" : owner.name}</b>
                <span>{owner.sales} {owner.sales === 1 ? "sale" : "sales"} · active since {owner.memberSince}</span>
              </div>
            </div>
          )}

          <dl className={styles.specs}>
            <dt>Set</dt><dd>{card.set}</dd>
            <dt>Number</dt><dd>#{card.number}</dd>
            <dt>Rarity</dt><dd>{card.rarity}</dd>
            <dt>Grade</dt><dd>{card.grade}</dd>
            <dt>Originally from</dt><dd>{card.origin}</dd>
          </dl>
        </div>
      </div>
    </Modal>
  );
}
