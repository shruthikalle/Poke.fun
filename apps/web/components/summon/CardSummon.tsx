"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TYPE_COLORS } from "../../lib/battle/roster";
import { FAUX_ART_WINDOW, type ArtWindow, type CardPick } from "../../lib/cards/mapping";
import type { SpeciesData } from "../../lib/pokemon/SpeciesService";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { Burst } from "./Burst";
import { PixelArt } from "./PixelArt";
import styles from "./summon.module.css";

export type SummonCard = Pick<CardPick, "image" | "label" | "grade"> & { artWindow?: ArtWindow };

const VINTAGE_WINDOW: ArtWindow = { x: 0.09, y: 0.11, w: 0.82, h: 0.37 };
export type SummonSpecies = Pick<SpeciesData, "name" | "types" | "sprites"> & Partial<Pick<SpeciesData, "artwork" | "cry" | "base" | "moves">>;
export type SummonPhase = "loading" | "reveal" | "awaken" | "emerge" | "land" | "live";

/** What the player did to the summoned creature. Hook for analytics, sounds or future pet stats. */
export type CreatureInteraction =
  | { kind: "pet" }
  | { kind: "turn"; angle: number }
  | { kind: "move-preview"; moveId: string };

interface Companion { card: SummonCard; species: SummonSpecies | null; level?: number }

interface Props {
  card: SummonCard;
  species: SummonSpecies | null;
  mode: "full" | "mini";
  level?: number;
  /** Skip straight to a short crossfade. */
  reduced?: boolean;
  muted?: boolean;
  playCry?: (url: string) => void;
  onToggleMute?: () => void;
  /** Full mode: bench creatures summoned beside the lead once it lands. */
  companions?: Companion[];
  onPhase?: (phase: SummonPhase) => void;
  onInteract?: (interaction: CreatureInteraction) => void;
  /** Full: "Ready" pressed. Mini: the sprite has landed. */
  onDone?: () => void;
  /** Full: "Summon again" pressed. */
  onReplay?: () => void;
  /** Mini: which side the card flies in from, which sprite to show and how much to scale it. */
  from?: "left" | "right";
  facing?: "front" | "back";
  spriteScale?: number;
  /** Mini: keep the sprite on screen after landing instead of handing over to the caller. */
  keepSprite?: boolean;
}

const TIMELINE: [SummonPhase, number][] = [["reveal", 0], ["awaken", 1100], ["emerge", 1700], ["land", 2600], ["live", 3200]];
const MINI_MS = 950;
const STAT_LABELS: [keyof NonNullable<SummonSpecies["base"]>, string][] = [["hp", "HP"], ["atk", "Atk"], ["def", "Def"], ["spa", "SpA"], ["spd", "SpD"], ["spe", "Spe"]];

function preloadImage(src: string | null | undefined, ms = 5000): Promise<boolean> {
  if (!src) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), ms);
    img.onload = () => { clearTimeout(t); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = src;
  });
}

function usePreload(card: SummonCard, species: SummonSpecies | null, sprite: string | undefined) {
  const [ready, setReady] = useState<{ card: boolean; art: boolean; sprite: boolean } | null>(null);
  const key = `${card.image}|${species?.artwork}|${sprite}`;
  useEffect(() => {
    if (!species) return;
    let live = true;
    setReady(null);
    if (species.cry) { const a = new Audio(); a.preload = "auto"; a.src = species.cry; }
    void Promise.all([preloadImage(card.image), preloadImage(species.artwork), preloadImage(sprite)])
      .then(([c, a, s]) => live && setReady({ card: c, art: a, sprite: s }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!species]);
  return ready;
}

function CardFace({ card, species, color }: { card: SummonCard; species: SummonSpecies; color: string }) {
  if (card.image) return <img src={card.image} alt="" draggable={false} />;
  return (
    <div className={styles.faux} style={{ "--type": color } as React.CSSProperties}>
      <span>{card.label}</span>
      <div>{species.artwork ? <img src={species.artwork} alt="" draggable={false} /> : <img src={species.sprites.frontStatic} alt="" draggable={false} />}</div>
      <small>Rental</small>
    </div>
  );
}

function MiniSummon({ card, species, from = "right", facing = "front", spriteScale = 1.4, keepSprite, reduced, onDone }: Props) {
  const sprite = species ? (facing === "back" ? species.sprites.back : species.sprites.front) : undefined;
  const ready = usePreload(card, species, sprite);
  const done = useRef(onDone);
  done.current = onDone;
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => { setLanded(true); done.current?.(); }, reduced ? 250 : MINI_MS);
    return () => clearTimeout(t);
  }, [ready, reduced]);

  if (!species) return <div className={styles.mini}><span className={styles.miniLoading} /></div>;
  const color = TYPE_COLORS[species.types[0]];
  const fallback = facing === "back" ? species.sprites.backStatic : species.sprites.frontStatic;
  return (
    <div className={styles.mini} data-from={from} data-ready={ready ? "" : undefined} data-reduced={reduced || undefined} data-landed={landed || undefined}
      style={{ "--type": color, "--mini-scale": spriteScale } as React.CSSProperties}>
      {!ready ? <span className={styles.miniLoading} /> : (
        <>
          {!landed && (
            <div className={styles.miniCard}>
              <div className={styles.half} data-half="l"><CardFace card={card} species={species} color={color} /></div>
              <div className={styles.half} data-half="r"><CardFace card={card} species={species} color={color} /></div>
            </div>
          )}
          {!landed && <span className={styles.miniRing} />}
          {(keepSprite || !landed) && (
            <img className={styles.miniSprite} src={ready.sprite ? sprite : fallback} alt={species.name} draggable={false} />
          )}
        </>
      )}
    </div>
  );
}

function Creature({ species, level, onInteract, playCry }: { species: SummonSpecies; level: number; onInteract?: Props["onInteract"]; playCry?: Props["playCry"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const [face, setFace] = useState(1);
  const [turn, setTurn] = useState(0);
  const [hop, setHop] = useState(0);
  const [flash, setFlash] = useState<{ color: string; seq: number } | null>(null);
  const color = TYPE_COLORS[species.types[0]];

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      if (drag.current) {
        const dx = e.clientX - drag.current.x;
        if (Math.abs(dx) > 4) drag.current.moved = true;
        setTurn(Math.max(-70, Math.min(70, dx * 0.6)));
      } else {
        setFace(e.clientX > box.left + box.width / 2 ? -1 : 1);
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.moved) {
        setTurn((t) => { onInteract?.({ kind: "turn", angle: t }); return 0; });
      } else {
        setHop((h) => h + 1);
        onInteract?.({ kind: "pet" });
        if (species.cry) playCry?.(species.cry);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [onInteract, playCry, species.cry]);

  return (
    <>
      <div className={styles.creatureWrap} ref={ref}>
        <button className={styles.creature} aria-label={`Pet ${species.name}`} data-dragging={drag.current ? "" : undefined}
          style={{ "--face": face, "--turn": `${turn}deg` } as React.CSSProperties}
          onPointerDown={(e) => { e.preventDefault(); drag.current = { x: e.clientX, moved: false }; }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHop((h) => h + 1); onInteract?.({ kind: "pet" }); if (species.cry) playCry?.(species.cry); } }}>
          <span key={hop} className={styles.hop} data-hop={hop > 0 || undefined}>
            <span className={styles.breathe}>
              <img className={styles.liveSprite} src={species.sprites.front} alt={species.name} draggable={false}
                onError={(e) => { if (e.currentTarget.src !== species.sprites.frontStatic) e.currentTarget.src = species.sprites.frontStatic; }} />
            </span>
          </span>
          {flash && <span key={flash.seq} className={styles.flash} style={{ "--flash": flash.color } as React.CSSProperties} />}
        </button>
        {hop > 0 && (
          <span key={`h${hop}`} className={styles.hearts} aria-hidden="true">
            {[0, 1, 2, 3].map((i) => <i key={i} style={{ "--i": i } as React.CSSProperties}>{i % 2 ? "✦" : "♥"}</i>)}
          </span>
        )}
      </div>
      <div className={styles.nameplate}>
        <strong>{species.name}</strong>
        <span className={styles.types}>{species.types.map((t) => <b key={t} style={{ "--type": TYPE_COLORS[t] } as React.CSSProperties}>{t}</b>)}</span>
        <small>L{level}</small>
      </div>
      {species.moves && species.base && (
        <aside className={styles.info} style={{ "--type": color } as React.CSSProperties}>
          <p className={styles.infoLabel}>Moves</p>
          <ul className={styles.moves}>
            {species.moves.map((m, i) => (
              <li key={m.id} style={{ "--type": TYPE_COLORS[m.type] } as React.CSSProperties}
                onPointerEnter={() => { setFlash({ color: TYPE_COLORS[m.type], seq: Date.now() + i }); onInteract?.({ kind: "move-preview", moveId: m.id }); }}>
                <strong>{m.name}</strong><small>{m.type} · {m.power}</small>
              </li>
            ))}
          </ul>
          <p className={styles.infoLabel}>Base stats</p>
          <dl className={styles.stats}>
            {STAT_LABELS.map(([k, label]) => (
              <div key={k}><dt>{label}</dt><dd><i style={{ width: `${Math.min(100, (species.base![k] / 180) * 100)}%` }} /></dd><span>{species.base![k]}</span></div>
            ))}
          </dl>
        </aside>
      )}
    </>
  );
}

function FullSummon(props: Props) {
  const { card, species, level = 50, reduced, muted, playCry, onToggleMute, companions = [], onPhase, onInteract, onDone, onReplay } = props;
  const ready = usePreload(card, species, species?.sprites.front);
  const [phase, setPhase] = useState<SummonPhase>("loading");
  const [burst, setBurst] = useState({ key: 0, x: 0.5, y: 0.3 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const windowEl = useRef<HTMLDivElement>(null);
  const cryPlayed = useRef(false);
  useFocusTrap(stage, true);
  const color = species ? TYPE_COLORS[species.types[0]] : "#f4c35a";
  const win = card.image ? card.artWindow ?? VINTAGE_WINDOW : FAUX_ART_WINDOW;
  const riseSrc = species?.artwork ?? card.image ?? species?.sprites.frontStatic ?? null;
  const riseCrop = !species?.artwork && card.image ? win : undefined;

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const go = useCallback((p: SummonPhase) => {
    setPhase(p);
    onPhase?.(p);
  }, [onPhase]);

  const cry = useCallback(() => {
    if (cryPlayed.current || !species?.cry) return;
    cryPlayed.current = true;
    playCry?.(species.cry);
  }, [playCry, species?.cry]);

  useEffect(() => {
    if (!ready || !species) return;
    cryPlayed.current = false;
    if (reduced) {
      go("live");
      cry();
      return;
    }
    clear();
    for (const [p, at] of TIMELINE) {
      timers.current.push(setTimeout(() => {
        go(p);
        if (p === "emerge") {
          const s = stage.current?.getBoundingClientRect();
          const w = windowEl.current?.getBoundingClientRect();
          if (s && w) setBurst((b) => ({ key: b.key + 1, x: (w.left + w.width / 2 - s.left) / s.width, y: (w.top + w.height / 2 - s.top) / s.height }));
          cry();
        }
      }, at));
    }
    return clear;
  }, [ready, species, reduced, go, cry]);

  const skip = useCallback(() => {
    clear();
    go("live");
    cry();
  }, [go, cry]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "live") onDone?.();
      else skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, skip, onDone]);

  const onTilt = (e: React.PointerEvent) => {
    if (phase !== "reveal" || !cardEl.current) return;
    const r = cardEl.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cardEl.current.style.setProperty("--ry", `${px * 24}deg`);
    cardEl.current.style.setProperty("--rx", `${-py * 18}deg`);
    cardEl.current.style.setProperty("--mx", `${(px + 0.5) * 100}%`);
  };

  const live = phase === "live";
  return (
    <div ref={stage} tabIndex={-1} className={styles.stage} data-phase={phase} data-reduced={reduced || undefined} role="dialog" aria-modal="true" aria-label={species ? `Summoning ${species.name}` : "Summoning"}
      style={{ "--type": color, "--wx": win.x, "--wy": win.y, "--ww": win.w, "--wh": win.h } as React.CSSProperties} onPointerMove={onTilt}>
      <div className={styles.stageBg} aria-hidden="true" />
      <div className={styles.controls}>
        {onToggleMute && <button className="pf-btn" data-size="sm" data-variant="ghost" onClick={onToggleMute} aria-pressed={muted}>{muted ? "Sound off" : "Sound on"}</button>}
        {!live && <button className="pf-btn" data-size="sm" data-variant="ghost" onClick={skip}>Skip</button>}
      </div>

      {(!ready || !species) && (
        <div className={styles.loading}><span className={styles.cardShimmer} /><p className="pf-eyebrow">Waking your card…</p></div>
      )}

      {ready && species && (
        <>
          <div className={styles.platform} aria-hidden="true"><span className={styles.dust} /></div>
          <div className={styles.cardWrap}>
            <div className={styles.float}>
              <div className={styles.card} ref={cardEl}>
                <div className={styles.frame}><CardFace card={card} species={species} color={color} /></div>
                <div className={styles.window} ref={windowEl}><CardFace card={card} species={species} color={color} /></div>
                <span className={styles.foil} />
                <span className={styles.sweep} />
                <span className={styles.glow} />
              </div>
            </div>
            <div className={styles.caption}><strong>{card.label}</strong>{card.grade && <em>{card.grade}</em>}</div>
          </div>

          {(phase === "emerge" || phase === "land") && riseSrc && (
            <div className={styles.rise}>
              <PixelArt className={styles.pixel} src={riseSrc} crop={riseCrop} size={220} steps={[64, 32, 16]} startDelay={430} stepMs={140} />
            </div>
          )}
          <Burst className={styles.burst} fireKey={burst.key} color={color} origin={burst} />

          {(phase === "land" || live) && (
            <div className={styles.chip}>
              {card.image ? <img src={card.image} alt="" /> : <span className={styles.chipFaux} />}
              <span><strong>{card.label}</strong><small>{card.grade ?? "Rental"}</small></span>
            </div>
          )}
          {phase === "land" && (
            <div className={styles.creatureWrap}><span className={styles.drop}><img className={styles.liveSprite} src={species.sprites.front} alt="" /></span></div>
          )}
          {live && <Creature species={species} level={level} onInteract={onInteract} playCry={playCry} />}

          {live && companions.map((c, i) => (
            <div key={`${c.card.label}-${i}`} className={styles.companion} data-slot={i === 0 ? "l" : "r"}>
              <div className={styles.companionStage}>
                <MiniSummon card={c.card} species={c.species} mode="mini" keepSprite reduced={reduced} spriteScale={1.6} from={i === 0 ? "left" : "right"} />
              </div>
              <span className={styles.companionName}>{c.species?.name ?? c.card.label}<small>{c.card.grade ? "Yours" : "Rental"}</small></span>
            </div>
          ))}

          {live && (
            <div className={styles.actions}>
              {onReplay && <button className="pf-btn" data-variant="ghost" onClick={onReplay}>Summon again</button>}
              <button className="pf-btn" data-variant="primary" data-size="lg" onClick={onDone}>Ready</button>
            </div>
          )}
          {live && <p className={styles.tip}>Tap to pet · drag to turn · hover a move</p>}
        </>
      )}
    </div>
  );
}

/** Turns a collectible card into its in-game creature. `full` is the Loadout stage; `mini` is the battle send-out. */
export function CardSummon(props: Props) {
  return props.mode === "full" ? <FullSummon {...props} /> : <MiniSummon {...props} />;
}
