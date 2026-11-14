"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Emblem } from "../../../components/Emblem";
import { CardSummon } from "../../../components/summon/CardSummon";
import { useBattleAudio } from "../../../lib/audio/useBattleAudio";
import { MOCK_SCENARIO_KEY, type MockScenario } from "../../../lib/cards/collection";
import { CARD_CATALOG, type CatalogEntry } from "../../../lib/cards/mapping";
import { useMotionPreference } from "../../../lib/motion";
import { speciesService, type SpeciesData } from "../../../lib/pokemon/SpeciesService";
import styles from "./gallery.module.css";

type Layout = "Full art" | "Vintage" | "Modern";
const layoutOf = (e: CatalogEntry): Layout => (e.artWindow.w === 1 ? "Full art" : e.set.startsWith("base") ? "Vintage" : "Modern");
const SCENARIOS: MockScenario[] = ["default", "one", "ineligible", "empty", "large"];

interface Check { done: number; total: number; failed: string[]; staticSprite: string[]; noArtwork: string[]; noCry: string[] }

export function SummonGallery() {
  const audio = useBattleAudio();
  const motion = useMotionPreference();
  const [set, setSet] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [full, setFull] = useState<{ entry: CatalogEntry; species: SpeciesData | null; n: number } | null>(null);
  const [minis, setMinis] = useState<Record<string, { species: SpeciesData; n: number }>>({});
  const [check, setCheck] = useState<Check | null>(null);
  const [scenario, setScenario] = useState<MockScenario>(() => (typeof window === "undefined" ? "default" : (localStorage.getItem(MOCK_SCENARIO_KEY) as MockScenario | null) ?? "default"));

  const cards = useMemo(() => CARD_CATALOG.entries.filter((e) =>
    (set === "all" || e.set === set) && (!query || `${e.name} ${e.species} ${e.number}`.toLowerCase().includes(query.toLowerCase()))), [set, query]);

  const playFull = (entry: CatalogEntry) => {
    const n = Date.now();
    setFull({ entry, species: null, n });
    speciesService.getSpecies(entry.species).then((species) => setFull((f) => (f?.n === n ? { ...f, species } : f))).catch(() => setFull(null));
  };
  const playMini = (entry: CatalogEntry) => {
    speciesService.getSpecies(entry.species).then((species) => setMinis((m) => ({ ...m, [entry.id]: { species, n: Date.now() } }))).catch(() => {});
  };

  const checkAll = async () => {
    const keys = [...new Set(CARD_CATALOG.entries.map((e) => e.species))];
    const result: Check = { done: 0, total: keys.length, failed: [], staticSprite: [], noArtwork: [], noCry: [] };
    setCheck({ ...result });
    for (let i = 0; i < keys.length; i += 6) {
      await Promise.all(keys.slice(i, i + 6).map(async (k) => {
        try {
          const s = await speciesService.getSpecies(k);
          if (!s.sprites.front.endsWith(".gif")) result.staticSprite.push(k);
          if (!s.artwork) result.noArtwork.push(k);
          if (!s.cry) result.noCry.push(k);
        } catch {
          result.failed.push(k);
        }
        result.done++;
      }));
      setCheck({ ...result });
    }
  };

  const chooseScenario = (s: MockScenario) => {
    setScenario(s);
    localStorage.setItem(MOCK_SCENARIO_KEY, s);
  };

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}><Emblem size={20} /><span>Poke.fun</span></Link>
        <span className="pf-eyebrow">Dev · Summon gallery</span>
        <span className={styles.version}>Catalog {CARD_CATALOG.version} · {CARD_CATALOG.entries.length} cards</span>
      </header>

      <section className={styles.tools}>
        <div className={styles.chips} role="radiogroup" aria-label="Set">
          {[{ id: "all", name: "All sets" }, ...CARD_CATALOG.sets].map((s) => (
            <button key={s.id} role="radio" aria-checked={set === s.id} data-on={set === s.id || undefined} onClick={() => setSet(s.id)}>{s.name}</button>
          ))}
        </div>
        <input className={styles.search} placeholder="Search name or species" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search cards" />
        <button className="pf-btn" data-size="sm" onClick={checkAll} disabled={!!check && check.done < check.total}>Check all species</button>
        <label className={styles.scenario}>Mock collection
          <select value={scenario} onChange={(e) => chooseScenario(e.target.value as MockScenario)}>
            {SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </section>

      {check && (
        <p className={styles.check} role="status">
          Checked {check.done}/{check.total} species · failed {check.failed.length}{check.failed.length ? ` (${check.failed.join(", ")})` : ""} ·
          static sprite fallback {check.staticSprite.length}{check.staticSprite.length ? ` (${check.staticSprite.slice(0, 8).join(", ")}${check.staticSprite.length > 8 ? "…" : ""})` : ""} ·
          no artwork {check.noArtwork.length} · no cry {check.noCry.length}
        </p>
      )}

      <p className={styles.count}>{cards.length} cards</p>
      <ul className={styles.grid}>
        {cards.map((e) => (
          <li key={e.id} className={styles.card}>
            <div className={styles.art}>
              <img src={e.image} alt="" loading="lazy" decoding="async" />
              <span className={styles.window} style={{ left: `${e.artWindow.x * 100}%`, top: `${e.artWindow.y * 100}%`, width: `${e.artWindow.w * 100}%`, height: `${e.artWindow.h * 100}%` }} />
              {minis[e.id] && (
                <div className={styles.miniStage}>
                  <CardSummon key={minis[e.id].n} mode="mini" keepSprite card={{ image: e.image, label: e.name, grade: null, artWindow: e.artWindow }}
                    species={minis[e.id].species} reduced={motion.reduced} spriteScale={1.4} />
                </div>
              )}
            </div>
            <div className={styles.meta}>
              <strong>{e.name}</strong>
              <small>{e.setName} #{e.number} · {e.species} · tier {e.tier}</small>
              <span className={styles.layout} data-layout={layoutOf(e)}>{layoutOf(e)}</span>
            </div>
            <div className={styles.buttons}>
              <button className="pf-btn" data-size="sm" data-variant="primary" onClick={() => playFull(e)}>Full</button>
              <button className="pf-btn" data-size="sm" data-variant="ghost" onClick={() => playMini(e)}>Mini</button>
            </div>
          </li>
        ))}
      </ul>

      {full && (
        <CardSummon key={full.n} mode="full" card={{ image: full.entry.image, label: full.entry.name, grade: null, artWindow: full.entry.artWindow }}
          species={full.species} level={full.entry.level} reduced={motion.reduced} muted={audio.muted} onToggleMute={audio.toggleMute}
          playCry={audio.playClip} onReplay={() => playFull(full.entry)} onDone={() => setFull(null)} />
      )}
    </div>
  );
}
