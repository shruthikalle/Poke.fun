"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { session } from "../storage";
import { audioEngine, type AudioSettings, type MusicTrack, type SfxCue } from "./AudioEngine";
import styles from "./audio.module.css";

export interface AudioApi {
  settings: AudioSettings;
  unlocked: boolean;
  setSettings(patch: Partial<AudioSettings>): void;
  toggleMute(): void;
  playSfx(cue: SfxCue, options?: { volume?: number; delay?: number }): Promise<boolean>;
  playCry(url: string | null | undefined, options?: { volume?: number; rate?: number; delay?: number }): void;
}

const AudioContextApi = createContext<AudioApi | null>(null);
const HINT_KEY = "pokefun-sound-hint";
const CLICKABLE = "button:not([disabled]), [role='button'], a.pf-btn, [role='tab'], [role='menuitem']";

export function AudioProvider({ children }: { children: ReactNode }) {
  const { settings, unlocked, track } = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot, audioEngine.getServerSnapshot);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    audioEngine.init();
    const unlock = () => audioEngine.unlock();
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(CLICKABLE) : null;
      if (target && !target.closest("[data-sfx='off']")) void audioEngine.playSfx("button", { volume: 0.4 });
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("click", click, true);
    };
  }, []);

  // Browsers keep audio locked until the first tap; say so once, only when music is waiting.
  useEffect(() => {
    if (unlocked || settings.muted || !track || session.get(HINT_KEY)) { setHint(false); return; }
    const timer = setTimeout(() => setHint(true), 1500);
    return () => clearTimeout(timer);
  }, [unlocked, settings.muted, track]);
  useEffect(() => { if (hint && unlocked) { session.set(HINT_KEY, "1"); setHint(false); } }, [hint, unlocked]);

  const setSettings = useCallback((patch: Partial<AudioSettings>) => audioEngine.update(patch), []);
  const toggleMute = useCallback(() => audioEngine.update({ muted: !audioEngine.settings.muted }), []);
  const playSfx = useCallback((cue: SfxCue, options?: { volume?: number; delay?: number }) => audioEngine.playSfx(cue, options), []);
  const playCry = useCallback((url: string | null | undefined, options?: { volume?: number; rate?: number; delay?: number }) => { void audioEngine.playCry(url, options); }, []);
  const api = useMemo(() => ({ settings, unlocked, setSettings, toggleMute, playSfx, playCry }), [settings, unlocked, setSettings, toggleMute, playSfx, playCry]);

  return (
    <AudioContextApi.Provider value={api}>
      {children}
      {hint && (
        <button type="button" className={styles.hint} onClick={() => audioEngine.unlock()}>
          <SpeakerIcon muted={false} /> Tap for sound
        </button>
      )}
    </AudioContextApi.Provider>
  );
}

export function useAudio(): AudioApi {
  const api = useContext(AudioContextApi);
  if (!api) throw new Error("useAudio must be used inside <AudioProvider>");
  return api;
}

/** Plays a music track while the calling page is mounted; null keeps it quiet. */
export function useMusic(track: MusicTrack | null) {
  useEffect(() => {
    audioEngine.requestMusic(track);
    return () => audioEngine.releaseMusic(track);
  }, [track]);
}

export function SpeakerIcon({ muted, size = 14 }: { muted: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
      <path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor" />
      {muted
        ? <path d="M11 5l4 6M15 5l-4 6" stroke="currentColor" strokeWidth="1.6" />
        : <path d="M11 5.5c1 .8 1 4.2 0 5M13 4c2 1.8 2 6.2 0 8" stroke="currentColor" strokeWidth="1.4" fill="none" />}
    </svg>
  );
}
