"use client";

import type { CSSProperties } from "react";
import type { ArenaCard } from "../../../lib/arena";
import { TYPE_COLORS } from "../../../lib/battle/roster";
import type { CardPick, MatchFormat } from "../../../lib/cards/mapping";
import type { SpeciesData } from "../../../lib/pokemon/SpeciesService";
import { FighterSprite } from "./CardGrid";
import styles from "../loadout.module.css";

interface Props {
  lead: CardPick | null;
  fighter: ArenaCard | null;
  species: SpeciesData | null;
  format: MatchFormat;
  loading: boolean;
  onSummon: () => void;
}

export function ChampionPreview({ lead, fighter, species, format, loading, onSummon }: Props) {
  const types = species?.types ?? fighter?.types ?? [];
  const moves = format === "champion"
    ? fighter ? [
      { ...fighter.basic, detail: `Basic · +1 energy · ≈${fighter.basic.damage} dmg` },
      { ...fighter.special, detail: `Special · 2 energy · ≈${fighter.special.damage} dmg` },
    ] : []
    : species?.moves.map((move) => ({ ...move, detail: `${move.power} power · ${move.maxPp} PP` })) ?? [];

  return (
    <>
      <div className={styles.champion}>
        <FighterSprite src={species?.sprites.front ?? fighter?.sprite} name={lead?.label ?? "Champion"}
          size={104} loading={loading} />
        <div>
          <p className={styles.label}>{format === "champion" ? "Champion" : "Squad lead"}</p>
          <h2>{species?.name ?? fighter?.name ?? lead?.label ?? "Pick a card"}</h2>
          {lead && <button className={`pf-btn ${styles.resummon}`} data-size="sm" data-variant="ghost"
            disabled={!species || loading} onClick={onSummon}>Summon again</button>}
          <div className={styles.types}>
            {types.map((type) => <span key={type}
              style={{ "--type": TYPE_COLORS[type as keyof typeof TYPE_COLORS] } as CSSProperties}>{type}</span>)}
          </div>
        </div>
      </div>
      {!!moves.length && <ul className={styles.moves}>
        {moves.map((move) => <li key={move.id}
          style={{ "--type": TYPE_COLORS[move.type as keyof typeof TYPE_COLORS] } as CSSProperties}>
          <strong>{move.name}</strong><small>{move.type} · {move.detail}</small>
        </li>)}
      </ul>}
      {format === "champion" && fighter && <p className={styles.hint}>
        Tier {fighter.tier} fighter · {fighter.maxHp} HP · matched only against tier {fighter.tier}.
      </p>}
    </>
  );
}

export function SquadPreview({ team, fighters }: { team: CardPick[]; fighters: Map<string, ArenaCard | null> }) {
  return <div className={styles.squad} aria-label="Your squad of three">
    {team.map((pick, index) => <div key={pick.key} className={`pf-frame ${styles.slot}`}>
      <FighterSprite src={fighters.get(pick.species)?.sprite} name={pick.label} size={64} />
      <strong>{pick.label}</strong>
      <small>{index === 0 ? "Lead" : "Bench"} · {pick.rental ? "Rental" : "Yours"}</small>
    </div>)}
  </div>;
}
