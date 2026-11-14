"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BattleEvent, BattleState } from "../battle/types";

export type AudioCue = "hit" | "super-hit" | "faint" | "switch" | "turn" | "victory" | "defeat";

export interface AudioCueProvider {
  play(cue: AudioCue): void;
  /** One-off clip by URL, e.g. a creature's cry. */
  playClip?(url: string): void;
  dispose?(): void;
}

type Tone = { freq: number; to?: number; dur: number; type?: OscillatorType; delay?: number; gain?: number };

const TONES: Record<AudioCue, Tone[]> = {
  hit: [{ freq: 220, to: 90, dur: 0.12, type: "square", gain: 0.08 }],
  "super-hit": [{ freq: 330, to: 80, dur: 0.18, type: "sawtooth", gain: 0.08 }, { freq: 160, to: 60, dur: 0.12, type: "square", delay: 0.08, gain: 0.06 }],
  faint: [{ freq: 440, to: 70, dur: 0.6, type: "triangle", gain: 0.1 }],
  switch: [{ freq: 520, to: 880, dur: 0.09, type: "square", gain: 0.05 }],
  turn: [{ freq: 660, dur: 0.05, type: "sine", gain: 0.04 }],
  victory: [523, 659, 784, 1046].map((freq, i) => ({ freq, dur: 0.16, type: "square" as const, delay: i * 0.14, gain: 0.06 })),
  defeat: [392, 330, 262].map((freq, i) => ({ freq, dur: 0.22, type: "triangle" as const, delay: i * 0.2, gain: 0.08 })),
};

/** Synthesized chiptune placeholders so the cues are audible offline. */
export class SynthAudioProvider implements AudioCueProvider {
  private ctx: AudioContext | null = null;

  play(cue: AudioCue) {
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      if (ctx.state === "suspended") void ctx.resume();
      for (const tone of TONES[cue]) {
        const start = ctx.currentTime + (tone.delay ?? 0);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.type ?? "square";
        osc.frequency.setValueAtTime(tone.freq, start);
        if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.dur);
        gain.gain.setValueAtTime(tone.gain ?? 0.06, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + tone.dur + 0.02);
      }
    } catch {
      // Audio is decorative; ignore unsupported or blocked contexts.
    }
  }

  playClip(url: string) {
    try {
      const audio = new Audio(url);
      audio.volume = 0.5;
      void audio.play().catch(() => {});
    } catch {
      // Unsupported format or blocked autoplay; the clip is optional.
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

export function cueForEvent(event: BattleEvent, state: BattleState | null): AudioCue | null {
  switch (event.type) {
    case "damage": return event.effectiveness === "super" || event.crit ? "super-hit" : event.effectiveness === "immune" ? null : "hit";
    case "faint": return "faint";
    case "switch": return "switch";
    case "turn": return event.turn > 1 ? "turn" : null;
    case "win": return event.winner === state?.you ? "victory" : event.winner === "draw" ? null : "defeat";
    default: return null;
  }
}

const MUTE_KEY = "pokefun-muted";

/**
 * Battle sound cues with a persisted mute toggle.
 * TODO(audio): swap SynthAudioProvider for an ElevenLabs-backed provider
 * (generated SFX / commentary clips keyed by AudioCue).
 */
export function useBattleAudio(createProvider: () => AudioCueProvider = () => new SynthAudioProvider()) {
  const [muted, setMuted] = useState(false);
  const provider = useRef<AudioCueProvider | null>(null);
  const factory = useRef(createProvider);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === "1");
    provider.current = factory.current();
    return () => provider.current?.dispose?.();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      localStorage.setItem(MUTE_KEY, m ? "0" : "1");
      return !m;
    });
  }, []);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const play = useCallback((cue: AudioCue) => {
    if (!mutedRef.current) provider.current?.play(cue);
  }, []);

  const playClip = useCallback((url: string) => {
    if (!mutedRef.current) provider.current?.playClip?.(url);
  }, []);

  return { muted, toggleMute, play, playClip };
}
