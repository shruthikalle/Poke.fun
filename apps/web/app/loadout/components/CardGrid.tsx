"use client";

import { useState } from "react";
import type { ArenaCard } from "../../../lib/arena";
import { DEVNET_TEST_COLLECTION_ADDRESS, type DasAsset } from "../../../lib/cards/collection";
import type { CardRow } from "../hooks/useLoadoutCards";
import styles from "../loadout.module.css";

function devnetExplorerUrl(asset: DasAsset | null): string | null {
  if (!asset || asset.interface !== "MplCoreAsset"
    || !asset.grouping?.some((group) => group.group_key === "collection" && group.group_value === DEVNET_TEST_COLLECTION_ADDRESS)
    || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asset.id)) return null;
  return `https://explorer.solana.com/address/${asset.id}?cluster=devnet`;
}

export function FighterSprite({ src, name, size = 96, loading = false }: {
  src?: string; name: string; size?: number; loading?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (loading && !src) return <span className={styles.spriteSkeleton} style={{ width: size, height: size }} />;
  if (!src || failed === src) return <span className={styles.artMissing}>Sprite unavailable</span>;
  return <img className={styles.sprite} src={src} alt={name} width={size} height={size}
    onError={() => setFailed(src)} />;
}

function CardArt({ src, fighter }: { src: string | null; fighter: ArenaCard | null | undefined }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return fighter
    ? <FighterSprite src={fighter.sprite} name={fighter.name} size={88} />
    : <span className={styles.artMissing}>Card art unavailable</span>;
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />;
}

export function TierPips({ tier }: { tier: number }) {
  return <span className={styles.pips} title={`Power tier ${tier}`}>
    {[1, 2, 3].map((value) => <i key={value} data-on={value <= tier || undefined} />)}
  </span>;
}

export function CardGrid({ rows, fighters, selected, onSelect }: {
  rows: CardRow[];
  fighters: Map<string, ArenaCard | null>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className={styles.grid} role="group" aria-label="Choose your lead card">
      {rows.map((row) => {
        const key = row.pick?.key ?? row.asset?.id ?? row.label;
        const fighter = row.pick ? fighters.get(row.pick.species) : null;
        const explorer = devnetExplorerUrl(row.asset);
        return (
          <div key={key} className={styles.cardSlot}>
            <button className={`pf-frame ${styles.card}`} aria-pressed={selected === row.pick?.key}
              data-selected={selected === row.pick?.key || undefined} disabled={!row.pick}
              title={row.reason ?? undefined} onClick={() => row.pick && onSelect(row.pick.key)}>
              <span className={styles.art}>
                <CardArt src={row.image} fighter={fighter} />
                {row.reason && <span className={styles.reason}>{row.reason}</span>}
              </span>
              <span className={styles.cardMeta}>
                <strong>{row.label}</strong>
                <span>
                  {row.grade && <em className={styles.grade}>{row.grade}</em>}
                  {row.pick && !row.pick.rental && <em className={styles.grade}>Wallet card · checked at entry</em>}
                  {row.pick?.rental && <em className={styles.grade}>{row.asset ? "Practice rental" : "Rental"}</em>}
                  {row.pick ? <TierPips tier={fighter?.tier ?? row.pick.tier} /> : <small>Can&apos;t battle</small>}
                </span>
              </span>
            </button>
            {explorer && <a className={styles.explorerLink} href={explorer} target="_blank" rel="noopener noreferrer"
              aria-label={`View ${row.label} on Solana Explorer (Devnet)`}>View on Solana ↗</a>}
          </div>
        );
      })}
    </div>
  );
}
