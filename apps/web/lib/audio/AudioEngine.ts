import { local } from "../storage";
import cries from "./cries.generated.json";

export type SfxCue =
  | "hit" | "super-hit" | "not-very-effective" | "crit" | "miss" | "faint" | "switch" | "status"
  | "heal" | "boost" | "drop" | "turn" | "button" | "countdown" | "match-found" | "victory" | "defeat";
export type MusicTrack = "menu" | "battle";
export type AudioBus = "music" | "sfx" | "cries";

export interface AudioSettings { muted: boolean; music: number; sfx: number; cries: number }
export interface AudioSnapshot { settings: AudioSettings; unlocked: boolean; track: MusicTrack | null }

export const DEFAULT_AUDIO: AudioSettings = { muted: false, music: 0.45, sfx: 0.7, cries: 0.8 };
const KEY = "pokefun-audio";
const LEGACY_MUTE_KEY = "pokefun-muted";
const PRELOAD: SfxCue[] = ["button", "hit", "super-hit", "switch", "turn", "faint", "match-found", "victory", "defeat"];
const LOCAL_CRIES = new Set<number>(cries.dex);
const POKEAPI_CRY = /\/cries\/pokemon\/(?:latest|legacy)\/(\d+)\.ogg$/;

const clamp = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Sound is on by default; an old "pokefun-muted" choice is carried over once. */
export function loadAudioSettings(): AudioSettings {
  try {
    const raw = local.get(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        muted: saved.muted === true,
        music: clamp(saved.music, DEFAULT_AUDIO.music),
        sfx: clamp(saved.sfx, DEFAULT_AUDIO.sfx),
        cries: clamp(saved.cries, DEFAULT_AUDIO.cries),
      };
    }
  } catch { /* corrupt value: fall back to defaults */ }
  return { ...DEFAULT_AUDIO, muted: local.get(LEGACY_MUTE_KEY) === "1" };
}

export function cryUrl(dex: number | null | undefined): string | null {
  return dex && dex > 0 ? `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${dex}.ogg` : null;
}

/** Sprite URLs end in the PokéAPI id (forms included), which is also the cry id. */
export function cryFromSprite(sprite: string | null | undefined): string | null {
  const id = sprite ? /\/(\d+)\.(?:png|gif|webp)$/.exec(sprite)?.[1] : undefined;
  return id ? cryUrl(Number(id)) : null;
}

/**
 * One shared Web Audio graph for the whole app: music, SFX and cries buses
 * under a master gain. Nothing is created or fetched before a user gesture.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<AudioBus, GainNode>> = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private listeners = new Set<() => void>();
  private snapshot: AudioSnapshot = { settings: DEFAULT_AUDIO, unlocked: false, track: null };
  private loaded = false;
  private wanted: MusicTrack | null = null;
  private playing: { track: MusicTrack; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCry: AudioBufferSourceNode | null = null;
  private oggSupport: boolean | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => this.snapshot;

  private emit(patch: Partial<AudioSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  init() {
    if (this.loaded || typeof window === "undefined") return;
    this.loaded = true;
    this.emit({ settings: loadAudioSettings() });
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get settings() { return this.snapshot.settings; }

  /** Call from a user gesture; browsers block audio until one happens. */
  unlock() {
    if (typeof window === "undefined") return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        for (const bus of ["music", "sfx", "cries"] as const) {
          const gain = this.ctx.createGain();
          gain.connect(this.master);
          this.buses[bus] = gain;
        }
        this.applyGains(true);
        for (const cue of PRELOAD) void this.load(`/audio/sfx/${cue}.mp3`);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      if (!this.snapshot.unlocked) this.emit({ unlocked: true });
      void this.syncMusic();
    } catch {
      // Audio is optional; an unsupported or blocked context just stays silent.
    }
  }

  /** The SFX bus, for the synthesized fallback cues. */
  output(bus: AudioBus = "sfx"): { ctx: AudioContext; node: AudioNode } | null {
    return this.ctx && this.buses[bus] ? { ctx: this.ctx, node: this.buses[bus]! } : null;
  }

  update(patch: Partial<AudioSettings>) {
    const settings = { ...this.snapshot.settings, ...patch };
    local.set(KEY, JSON.stringify(settings));
    local.remove(LEGACY_MUTE_KEY);
    this.emit({ settings });
    this.applyGains(false);
    void this.syncMusic();
  }

  private applyGains(instant: boolean) {
    if (!this.ctx || !this.master) return;
    const { muted, music, sfx, cries: cryVolume } = this.snapshot.settings;
    const now = this.ctx.currentTime;
    const set = (node: GainNode | undefined, value: number) => {
      if (!node) return;
      node.gain.cancelScheduledValues(now);
      if (instant) node.gain.setValueAtTime(value, now);
      else node.gain.setTargetAtTime(value, now, 0.05);
    };
    set(this.master, muted ? 0 : 1);
    set(this.buses.music, music);
    set(this.buses.sfx, sfx);
    set(this.buses.cries, cryVolume);
  }

  private load(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => { this.buffers.delete(url); return null; });
      this.buffers.set(url, pending);
    }
    return pending;
  }

  private start(buffer: AudioBuffer, bus: AudioBus, { volume = 1, rate = 1, delay = 0 } = {}) {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain).connect(this.buses[bus]!);
    source.start(ctx.currentTime + delay);
    return source;
  }

  /** Resolves false when the cue could not be played from a file. */
  async playSfx(cue: SfxCue, options?: { volume?: number; delay?: number }): Promise<boolean> {
    if (!this.ctx || this.snapshot.settings.muted) return true;
    const buffer = await this.load(`/audio/sfx/${cue}.mp3`);
    if (!buffer) return false;
    this.start(buffer, "sfx", options);
    if (cue === "victory" || cue === "defeat") this.duck(0.15, buffer.duration);
    return true;
  }

  private canPlayOgg() {
    if (this.oggSupport === null) {
      try { this.oggSupport = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== ""; } catch { this.oggSupport = false; }
    }
    return this.oggSupport;
  }

  /** Catalog cries are served locally as MP3 (plays in Safari); others stream as OGG where supported. */
  private resolveCry(url: string): string | null {
    const id = POKEAPI_CRY.exec(url)?.[1];
    if (id && LOCAL_CRIES.has(Number(id))) return `/audio/cries/${id}.mp3`;
    if (url.endsWith(".ogg") && !this.canPlayOgg()) return null;
    return url;
  }

  /** Cries never overlap: a new one cuts the previous one off. */
  async playCry(url: string | null | undefined, options?: { volume?: number; rate?: number; delay?: number }) {
    if (!url || !this.ctx || this.snapshot.settings.muted || this.snapshot.settings.cries === 0) return;
    const resolved = this.resolveCry(url);
    if (!resolved) return;
    const buffer = await this.load(resolved);
    if (!buffer || this.snapshot.settings.muted) return;
    try { this.lastCry?.stop(); } catch { /* already ended */ }
    this.lastCry = this.start(buffer, "cries", options);
    this.duck(0.45, buffer.duration / (options?.rate ?? 1) + (options?.delay ?? 0));
  }

  private duck(level: number, seconds: number) {
    const bus = this.buses.music;
    if (!this.ctx || !bus) return;
    const now = this.ctx.currentTime, base = this.snapshot.settings.music;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(base * level, now, 0.04);
    bus.gain.setTargetAtTime(base, now + seconds, 0.3);
  }

  /** Pages ask for a track while mounted; a quick release/request pair (client navigation) keeps it playing. */
  requestMusic(track: MusicTrack | null) {
    if (this.releaseTimer) { clearTimeout(this.releaseTimer); this.releaseTimer = null; }
    this.wanted = track;
    this.emit({ track });
    void this.syncMusic();
  }

  releaseMusic(track: MusicTrack | null) {
    if (this.wanted !== track) return;
    this.releaseTimer = setTimeout(() => { this.releaseTimer = null; this.requestMusic(null); }, 250);
  }

  private stopMusic() {
    const current = this.playing;
    if (!current || !this.ctx) return;
    this.playing = null;
    const now = this.ctx.currentTime;
    current.gain.gain.setTargetAtTime(0, now, 0.15);
    try { current.source.stop(now + 0.8); } catch { /* already stopped */ }
  }

  private async syncMusic() {
    const want = this.snapshot.settings.muted || this.snapshot.settings.music === 0 ? null : this.wanted;
    if (!this.ctx || this.playing?.track === want) return;
    this.stopMusic();
    if (!want) return;
    const buffer = await this.load(`/audio/music/${want}.mp3`);
    const stillWanted = this.snapshot.settings.muted ? null : this.wanted;
    if (!buffer || stillWanted !== want || this.playing) return;
    const gain = this.ctx.createGain();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
    source.connect(gain).connect(this.buses.music!);
    source.start();
    this.playing = { track: want, source, gain };
  }
}

export const audioEngine = new AudioEngine();
