"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AudioSettings } from "../../lib/audio/AudioEngine";
import { SpeakerIcon, useAudio } from "../../lib/audio/AudioProvider";
import styles from "./SoundControl.module.css";

const LEVELS: { key: Exclude<keyof AudioSettings, "muted">; label: string }[] = [
  { key: "music", label: "Music" },
  { key: "sfx", label: "Effects" },
  { key: "cries", label: "Cries" },
];

/** Sound on/off plus music, effects and cry volume. Shared by every page through AudioProvider. */
export function SoundControl({ className }: { className?: string }) {
  const { settings, toggleMute, setSettings } = useAudio();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className={`${styles.root} ${className ?? ""}`}>
      <button type="button" className={styles.toggle} onClick={toggleMute} aria-pressed={!settings.muted}
        aria-label="Sound" title={settings.muted ? "Sound off" : "Sound on"} data-off={settings.muted || undefined}>
        <SpeakerIcon muted={settings.muted} />
        <span className={styles.state}>{settings.muted ? "Off" : "On"}</span>
      </button>
      <button type="button" className={styles.more} onClick={() => setOpen((o) => !o)}
        aria-label="Sound settings" aria-expanded={open} aria-controls={panelId}>
        <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true" shapeRendering="crispEdges"><path d="M1 2h6v1H6v1H5v1H3V4H2V3H1z" fill="currentColor" /></svg>
      </button>
      {open && (
        <div id={panelId} className={styles.panel} role="group" aria-label="Sound settings">
          <label className={styles.row}>
            <span>Sound</span>
            <input type="checkbox" className={styles.switch} checked={!settings.muted} onChange={toggleMute} />
          </label>
          {LEVELS.map(({ key, label }) => (
            <label key={key} className={styles.row} data-disabled={settings.muted || undefined}>
              <span>{label}</span>
              <input type="range" min={0} max={100} step={5} value={Math.round(settings[key] * 100)} disabled={settings.muted}
                onChange={(e) => setSettings({ [key]: Number(e.target.value) / 100 })} aria-valuetext={`${Math.round(settings[key] * 100)}%`} />
              <output>{Math.round(settings[key] * 100)}</output>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
