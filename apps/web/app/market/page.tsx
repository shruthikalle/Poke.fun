"use client";

import { useMemo, useState } from "react";
import { CardTile } from "../../components/market/CardTile";
import { MarketShell } from "../../components/market/MarketShell";
import { useMarketModals } from "../../components/market/useMarketModals";
import styles from "../../components/market/market.module.css";
import { useCurrency } from "../../lib/market/currency";
import { useMarketplace } from "../../lib/market/useMarketplace";

type Sort = "featured" | "price-asc" | "price-desc" | "newest" | "name";
const GRADE_ORDER = ["PSA 10", "BGS 9.5", "CGC 9.5", "PSA 9", "CGC 9", "PSA 8"];

export default function MarketplacePage() {
  const market = useMarketplace();
  const modals = useMarketModals(market);
  const { currency, toSol, format } = useCurrency();
  const [query, setQuery] = useState("");
  const [sets, setSets] = useState<string[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<Sort>("featured");

  const facets = useMemo(() => {
    const count = (key: "set" | "rarity" | "grade") => {
      const m = new Map<string, number>();
      market.active.forEach((l) => m.set(l.card[key], (m.get(l.card[key]) ?? 0) + 1));
      return m;
    };
    return { set: count("set"), rarity: count("rarity"), grade: count("grade") };
  }, [market.active]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = Number(minPrice) > 0 ? toSol(Number(minPrice)) : 0;
    const max = Number(maxPrice) > 0 ? toSol(Number(maxPrice)) : Infinity;
    const list = market.active.filter((l) =>
      (!q || `${l.card.name} ${l.card.set} ${l.card.number} ${l.seller.name}`.toLowerCase().includes(q)) &&
      (!sets.length || sets.includes(l.card.set)) && (!rarities.length || rarities.includes(l.card.rarity)) && (!grades.length || grades.includes(l.card.grade)) &&
      l.priceSol >= min && l.priceSol <= max);
    const sorted = [...list];
    if (sort === "price-asc") sorted.sort((a, b) => a.priceSol - b.priceSol);
    if (sort === "price-desc") sorted.sort((a, b) => b.priceSol - a.priceSol);
    if (sort === "newest") sorted.sort((a, b) => b.listedAt - a.listedAt);
    if (sort === "name") sorted.sort((a, b) => a.card.name.localeCompare(b.card.name));
    if (sort === "featured") sorted.sort((a, b) => b.priceSol * (b.card.grade === "PSA 10" ? 1.5 : 1) - a.priceSol * (a.card.grade === "PSA 10" ? 1.5 : 1));
    return sorted;
  }, [market.active, query, sets, rarities, grades, minPrice, maxPrice, sort, toSol]);

  const clear = () => { setSets([]); setRarities([]); setGrades([]); setMinPrice(""); setMaxPrice(""); setQuery(""); };
  const filtered = sets.length + rarities.length + grades.length > 0 || !!minPrice || !!maxPrice || !!query;
  const total = results.reduce((s, l) => s + l.priceSol, 0);

  return (
    <MarketShell section="market" market={market}>
      <div className={styles.hero}>
        <div>
          <span className="pf-eyebrow">Marketplace</span>
          <h1>Find your next champion</h1>
          <p>Devnet test cards traded on-chain. Pay with devnet SOL; the card lands in your wallet and can battle right away.</p>
        </div>
      </div>
      {market.state.warning && <p className={styles.notice} data-tone="bad" role="status" style={{ gridColumn: "1 / -1" }}>{market.state.ready ? `Some marketplace data may be out of date: ${market.state.warning}` : "Can't reach the marketplace right now. Make sure the Poke.fun API is running with MARKET_PROGRAM_ID set."}</p>}
      <aside className={`pf-panel ${styles.filters}`} aria-label="Filters">
        <div className={styles.filterHead}><strong>Filters</strong>{filtered && <button className={styles.linkButton} onClick={clear}>Clear all</button>}</div>
        <Facet title="Set" options={facets.set} value={sets} onChange={setSets} />
        <Facet title="Rarity" options={facets.rarity} value={rarities} onChange={setRarities} />
        <Facet title="Grade" options={facets.grade} value={grades} onChange={setGrades} order={GRADE_ORDER} />
        <fieldset className={styles.facet}>
          <legend>Price ({currency})</legend>
          <div className={styles.priceRange}>
            <input className="pf-input" type="number" min="0" placeholder="Min" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} aria-label="Minimum price" />
            <span>to</span>
            <input className="pf-input" type="number" min="0" placeholder="Max" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} aria-label="Maximum price" />
          </div>
        </fieldset>
        <div className={styles.sideNote}>
          <span className={styles.lock} aria-hidden="true" />
          <span><b>Settled on Solana devnet.</b> Listed cards stay in the seller&apos;s wallet, frozen until they sell. Payment and card move in one transaction. Test assets only; nothing is vaulted.</span>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <label className={`pf-input ${styles.search}`}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" /></svg>
            <input placeholder="Search cards, sets or sellers" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
          </label>
          <span className={styles.count}>{results.length} {results.length === 1 ? "card" : "cards"}{total > 0 && <> · {format(total, { compact: true })} total</>}</span>
          <label className={styles.sort}>Sort
            <select className="pf-input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="newest">Newly listed</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        {results.length ? (
          <div className={styles.grid}>
            {results.map((l) => (
              <CardTile key={l.id} card={l.card} priceSol={l.priceSol} onOpen={() => modals.detail(l.card.mint)}
                badges={l.seller.address === market.me ? [{ text: "Your listing", tone: "good" }] : l.card.grade === "PSA 10" ? [{ text: "Top grade" }] : undefined} />
            ))}
          </div>
        ) : (
          <div className={`pf-panel ${styles.empty}`}>
            <div className={styles.emptyArt} aria-hidden="true"><i style={{ ["--r" as string]: "-8deg" }} /><i /><i style={{ ["--r" as string]: "8deg" }} /></div>
            {market.active.length ? (
              <>
                <b>No cards match</b>
                <p>Try fewer filters or a different search.</p>
                <button className="pf-btn" data-variant="primary" onClick={clear}>Clear filters</button>
              </>
            ) : (
              <>
                <b>{market.state.ready ? "Nothing for sale yet" : market.state.warning ? "Marketplace unavailable" : "Loading the marketplace…"}</b>
                <p>{market.state.ready ? "List a card from My Cards to be the first seller." : market.state.warning ? "Listings appear once the marketplace index is reachable." : "Reading listings from Solana devnet."}</p>
              </>
            )}
          </div>
        )}
      </main>
      {modals.node}
    </MarketShell>
  );
}

function Facet({ title, options, value, onChange, order }: { title: string; options: Map<string, number>; value: string[]; onChange: (v: string[]) => void; order?: string[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...options.entries()].sort((a, b) => (order ? order.indexOf(a[0]) - order.indexOf(b[0]) : b[1] - a[1] || a[0].localeCompare(b[0])));
  const entries = all ? sorted : sorted.filter(([name], i) => i < 8 || value.includes(name));
  return (
    <fieldset className={styles.facet}>
      <legend>{title}</legend>
      {entries.map(([name, n]) => {
        const on = value.includes(name);
        return (
          <button key={name} type="button" className="pf-chip" data-on={on || undefined} aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== name) : [...value, name])}>
            {name}<small>{n}</small>
          </button>
        );
      })}
      {sorted.length > 8 && <button type="button" className={styles.linkButton} onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${sorted.length}`}</button>}
    </fieldset>
  );
}
