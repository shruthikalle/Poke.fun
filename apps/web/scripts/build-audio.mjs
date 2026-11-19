// Renders Poke.fun's original chiptune SFX and music, and caches catalog cries as MP3.
// Usage: node scripts/build-audio.mjs [--sfx] [--music] [--cries]   (no flags = everything; needs ffmpeg)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public/audio");
const RATE = 44100;
const args = new Set(process.argv.slice(2));
const all = !args.has("--sfx") && !args.has("--music") && !args.has("--cries");
const tmp = mkdtempSync(join(tmpdir(), "pf-audio-"));

// ---- synthesis primitives -------------------------------------------------
const midi = (name) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + base;
};
const hz = (n) => 440 * 2 ** (((typeof n === "string" ? midi(n) : n) - 69) / 12);
let seed = 7;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
const wave = {
  square: (p, duty = 0.5) => (p % 1 < duty ? 1 : -1),
  triangle: (p) => 1 - 4 * Math.abs((p % 1) - 0.5),
  saw: (p) => 2 * (p % 1) - 1,
  sine: (p) => Math.sin(2 * Math.PI * p),
};

function buffer(seconds) { return new Float32Array(Math.ceil(seconds * RATE)); }

/** Adds one voice. `freq` may be a function of time (s) for glides. */
function tone(buf, { at = 0, dur, freq, to, type = "square", duty = 0.5, gain = 0.3, attack = 0.004, release = 0.04, vibrato = 0, slide = "exp" }) {
  const start = Math.floor(at * RATE), len = Math.floor(dur * RATE);
  let phase = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / RATE, k = i / len;
    let f = to ? (slide === "exp" ? freq * (to / freq) ** k : freq + (to - freq) * k) : freq;
    if (vibrato) f *= 1 + vibrato * Math.sin(2 * Math.PI * 7 * t);
    phase += f / RATE;
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    buf[start + i] += wave[type](phase, duty) * gain * Math.max(0, env);
  }
}

/** Filtered noise burst; `tone` 0..1 picks a darker (0) or brighter (1) colour. */
function hiss(buf, { at = 0, dur, gain = 0.3, color = 0.5, decay = 8, sweep = 0 }) {
  const start = Math.floor(at * RATE), len = Math.floor(dur * RATE);
  let last = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const k = i / len, c = Math.min(1, Math.max(0.02, color + sweep * k));
    last += (noise() - last) * c;
    buf[start + i] += last * gain * Math.exp(-decay * k) * Math.min(1, i / 60);
  }
}

function writeWav(path, buf, peak = 0.89) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const scale = max ? peak / max : 1;
  const data = Buffer.alloc(44 + buf.length * 2);
  data.write("RIFF", 0); data.writeUInt32LE(36 + buf.length * 2, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(buf.length * 2, 40);
  buf.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * scale)) * 32767), 44 + i * 2));
  writeFileSync(path, data);
}

function encode(name, buf, dest, { bitrate = "64k", rate = 22050, peak } = {}) {
  const wav = join(tmp, `${name}.wav`);
  writeWav(wav, buf, peak);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", String(rate), "-b:a", bitrate, join(dest, `${name}.mp3`)]);
}

// ---- sound effects ----------------------------------------------------------
const arp = (buf, notes, step, opts) => notes.forEach((n, i) => tone(buf, { at: i * step, dur: step * 1.1, freq: hz(n), ...opts }));

const SFX = {
  hit(b) { hiss(b, { dur: 0.14, gain: 0.5, color: 0.35, decay: 6 }); tone(b, { dur: 0.13, freq: 190, to: 55, gain: 0.45 }); },
  "super-hit"(b) {
    hiss(b, { dur: 0.3, gain: 0.6, color: 0.5, decay: 5 });
    tone(b, { dur: 0.24, freq: 320, to: 45, type: "saw", gain: 0.45 });
    tone(b, { at: 0.09, dur: 0.18, freq: 150, to: 40, gain: 0.4 });
  },
  "not-very-effective"(b) { tone(b, { dur: 0.16, freq: 150, to: 95, type: "triangle", gain: 0.5 }); hiss(b, { dur: 0.08, gain: 0.15, color: 0.15 }); },
  crit(b) { tone(b, { dur: 0.06, freq: 1568, to: 2093, duty: 0.25, gain: 0.25 }); hiss(b, { at: 0.05, dur: 0.22, gain: 0.55, color: 0.6, decay: 6 }); tone(b, { at: 0.05, dur: 0.2, freq: 260, to: 50, type: "saw", gain: 0.45 }); },
  miss(b) { hiss(b, { dur: 0.32, gain: 0.45, color: 0.05, sweep: 0.5, decay: 3 }); },
  faint(b) { tone(b, { dur: 0.8, freq: 620, to: 70, duty: 0.25, gain: 0.35, vibrato: 0.04, release: 0.2 }); },
  switch(b) { hiss(b, { dur: 0.03, gain: 0.4, color: 0.9 }); tone(b, { at: 0.02, dur: 0.14, freq: 330, to: 1320, duty: 0.25, gain: 0.3 }); tone(b, { at: 0.16, dur: 0.08, freq: 1760, duty: 0.125, gain: 0.18 }); },
  status(b) {
    const len = 0.4;
    for (let i = 0; i < 8; i++) tone(b, { at: i * len / 8, dur: len / 8, freq: i % 2 ? 392 : 466, duty: 0.25, gain: 0.25 });
  },
  heal(b) { arp(b, ["C5", "E5", "G5", "C6", "E6"], 0.065, { duty: 0.125, gain: 0.25, release: 0.03 }); tone(b, { at: 0.33, dur: 0.25, freq: hz("G6"), type: "triangle", gain: 0.2, release: 0.2 }); },
  boost(b) { tone(b, { dur: 0.14, freq: 392, to: 880, duty: 0.25, gain: 0.28 }); tone(b, { at: 0.14, dur: 0.18, freq: 523, to: 1175, duty: 0.25, gain: 0.28 }); },
  drop(b) { tone(b, { dur: 0.14, freq: 880, to: 392, duty: 0.25, gain: 0.28 }); tone(b, { at: 0.14, dur: 0.2, freq: 659, to: 262, duty: 0.25, gain: 0.28 }); },
  turn(b) { tone(b, { dur: 0.05, freq: hz("A5"), duty: 0.25, gain: 0.25 }); tone(b, { at: 0.06, dur: 0.07, freq: hz("E6"), duty: 0.25, gain: 0.25 }); },
  button(b) { tone(b, { dur: 0.035, freq: 1250, to: 900, duty: 0.25, gain: 0.3, release: 0.02 }); },
  countdown(b) { tone(b, { dur: 0.05, freq: 1760, duty: 0.5, gain: 0.25, release: 0.02 }); },
  "match-found"(b) {
    arp(b, ["G4", "C5", "E5", "G5"], 0.08, { duty: 0.25, gain: 0.25 });
    for (const n of ["C5", "E5", "G5", "C6"]) tone(b, { at: 0.34, dur: 0.45, freq: hz(n), duty: 0.25, gain: 0.14, release: 0.25 });
  },
  victory(b) {
    const q = 0.13;
    const lead = [["C5", 1], ["C5", 1], ["C5", 1], ["C5", 3], ["Ab4", 3], ["Bb4", 3], ["C5", 2], ["Bb4", 1], ["C5", 8]];
    let at = 0;
    for (const [n, len] of lead) { tone(b, { at, dur: len * q * 0.95, freq: hz(n), duty: 0.25, gain: 0.3 }); tone(b, { at, dur: len * q * 0.95, freq: hz(n) / 2, duty: 0.5, gain: 0.1 }); at += len * q; }
    for (const [n, start, len] of [["C3", 0, 6], ["Ab2", 6, 3], ["Bb2", 9, 3], ["C3", 12, 11]]) tone(b, { at: start * q, dur: len * q, freq: hz(n), type: "triangle", gain: 0.45 });
  },
  defeat(b) {
    const notes = [["G4", 0.25], ["F#4", 0.25], ["F4", 0.25], ["E4", 0.9]];
    let at = 0;
    for (const [n, d] of notes) { tone(b, { at, dur: d, freq: hz(n), duty: 0.5, gain: 0.25, vibrato: d > 0.5 ? 0.012 : 0, release: 0.15 }); tone(b, { at, dur: d, freq: hz(n) / 4, type: "triangle", gain: 0.4 }); at += d; }
  },
};
const SFX_LENGTH = { victory: 3.2, defeat: 1.9, "match-found": 0.9, faint: 0.85, heal: 0.6 };

// ---- music --------------------------------------------------------------------
const CHORDS = {
  C: ["C", "E", "G"], Am: ["A", "C", "E"], F: ["F", "A", "C"], G: ["G", "B", "D"], Dm: ["D", "F", "A"],
  Em: ["E", "G", "B"], E: ["E", "G#", "B"],
};
const chordNotes = (c, octave) => CHORDS[c].map((n, i) => {
  const value = midi(`${n.replace("#", "")}${octave}`) + (n.includes("#") ? 1 : 0);
  return i && value <= midi(`${CHORDS[c][0].replace("#", "")}${octave}`) ? value + 12 : value;
});

function song({ bpm, chords, lead, bassPattern, drums, harmonyFrom = 8, duty = 0.25 }) {
  const eighth = 60 / bpm / 2, bar = eighth * 8, bars = chords.length;
  const buf = buffer(bars * bar + 0.01);
  chords.forEach((chord, bi) => {
    const t0 = bi * bar;
    // lead: "." holds the previous note, "-" rests
    const steps = lead[bi % lead.length].split(/\s+/);
    for (let s = 0; s < 8; s++) {
      if (steps[s] === "." || steps[s] === "-") continue;
      let len = 1;
      while (steps[s + len] === ".") len++;
      tone(buf, { at: t0 + s * eighth, dur: len * eighth * 0.92, freq: hz(steps[s]), duty, gain: 0.16, vibrato: len > 2 ? 0.01 : 0, release: 0.05 });
      if (bi >= harmonyFrom) tone(buf, { at: t0 + s * eighth, dur: len * eighth * 0.92, freq: hz(steps[s]) / 2 ** (4 / 12), duty: 0.5, gain: 0.05 });
    }
    // arpeggio: chord tones in sixteenths
    const tones = chordNotes(chord, 4);
    for (let s = 0; s < 16; s++) tone(buf, { at: t0 + s * eighth / 2, dur: eighth / 2 * 0.8, freq: hz(tones[[0, 1, 2, 1][s % 4]] + 12 * (s % 8 >= 4 ? 1 : 0)), duty: 0.125, gain: 0.045, release: 0.02 });
    // bass
    const root = chordNotes(chord, 2)[0];
    bassPattern.split(" ").forEach((p, s) => {
      if (p === "-") return;
      tone(buf, { at: t0 + s * eighth, dur: eighth * 0.85, freq: hz(root + (p === "8" ? 12 : p === "5" ? 7 : 0)), type: "triangle", gain: 0.32, release: 0.03 });
    });
    // drums: k = kick, s = snare, h = hat, per sixteenth
    drums.split("").forEach((d, s) => {
      const at = t0 + s * eighth / 2;
      if (d === "k") tone(buf, { at, dur: 0.12, freq: 150, to: 40, type: "sine", gain: 0.5, release: 0.05 });
      if (d === "s") hiss(buf, { at, dur: 0.14, gain: 0.22, color: 0.55, decay: 7 });
      if (d === "h") hiss(buf, { at, dur: 0.035, gain: 0.07, color: 1, decay: 10 });
    });
  });
  return buf;
}

const MUSIC = {
  menu: () => song({
    bpm: 112,
    chords: ["C", "Am", "F", "G", "C", "Am", "Dm", "G", "C", "Am", "F", "G", "C", "Am", "Dm", "G"],
    lead: [
      "E5 - G5 - C6 - B5 G5", "A5 . . G5 E5 - C5 -", "F5 - A5 - C6 . A5 F5", "G5 . . . D5 - G5 -",
      "E5 G5 C6 . B5 . G5 -", "A5 . C6 . B5 A5 G5 E5", "F5 . E5 . D5 . F5 .", "G5 . . . - - - -",
    ],
    bassPattern: "1 - 5 - 8 - 5 -",
    drums: "k-h-s-h-k-hks-h-",
  }),
  battle: () => song({
    bpm: 150,
    chords: ["Am", "F", "G", "Em", "Am", "F", "G", "E", "Am", "F", "G", "Em", "Am", "F", "G", "E"],
    lead: [
      "A4 . C5 . E5 . A5 G5", "F5 . E5 . C5 . A4 .", "G4 . B4 . D5 . G5 F5", "E5 . . . B4 . E5 .",
      "A5 . G5 A5 . E5 C5 E5", "F5 . A5 . C6 . A5 F5", "G5 . F5 . D5 . B4 D5", "E5 . G#5 . B5 . . .",
    ],
    bassPattern: "1 8 1 8 1 8 5 8",
    drums: "khhhskhhkhkhskhs",
    duty: 0.5,
  }),
};

// ---- cries -------------------------------------------------------------------
async function cries() {
  const catalog = JSON.parse(readFileSync(join(ROOT, "lib/cards/catalog.generated.json"), "utf8"));
  const dex = JSON.parse(readFileSync(join(ROOT, "lib/pokemon/offlineDex.generated.json"), "utf8")).species;
  const mapping = readFileSync(join(ROOT, "lib/cards/mapping.ts"), "utf8");
  const rentals = [...(/RENTAL_POOL[^=]*=\s*\[([^\]]*)\]/.exec(mapping)?.[1] ?? "").matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  const ids = new Set(catalog.entries.map((e) => e.dex));
  for (const key of rentals) { const s = dex.find((d) => d.key === key || d.species === key); if (s) ids.add(s.dex); }
  const sorted = [...ids].sort((a, b) => a - b);
  let fetched = 0;
  for (const id of sorted) {
    const dest = join(OUT, "cries", `${id}.mp3`);
    if (existsSync(dest)) continue;
    let ogg = null;
    for (const kind of ["latest", "legacy"]) {
      const res = await fetch(`https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/${kind}/${id}.ogg`);
      if (res.ok) { ogg = Buffer.from(await res.arrayBuffer()); break; }
    }
    if (!ogg) { console.warn(`no cry for #${id}`); continue; }
    const src = join(tmp, `${id}.ogg`);
    writeFileSync(src, ogg);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "22050", "-b:a", "48k", dest]);
    fetched++;
  }
  writeFileSync(join(ROOT, "lib/audio/cries.generated.json"), `${JSON.stringify({ source: "https://github.com/PokeAPI/cries", dex: sorted.filter((id) => existsSync(join(OUT, "cries", `${id}.mp3`))) })}\n`);
  console.log(`cries: ${sorted.length} species, ${fetched} downloaded`);
}

for (const dir of ["sfx", "music", "cries"]) mkdirSync(join(OUT, dir), { recursive: true });
if (all || args.has("--sfx")) {
  for (const [name, render] of Object.entries(SFX)) { const b = buffer(SFX_LENGTH[name] ?? 0.5); render(b); encode(name, b, join(OUT, "sfx")); }
  console.log(`sfx: ${Object.keys(SFX).length} files`);
}
if (all || args.has("--music")) {
  for (const [name, render] of Object.entries(MUSIC)) encode(name, render(), join(OUT, "music"), { bitrate: "80k", rate: 32000, peak: 0.8 });
  console.log(`music: ${Object.keys(MUSIC).length} tracks`);
}
if (all || args.has("--cries")) await cries();
