// Turns PokéAPI move metadata into the team battle's data-driven move effects,
// and decides which moves the effect model covers. Pure functions: no I/O.
//
// Covered: status conditions (burn, poison, bad poison, paralysis, sleep,
// freeze) and confusion, stat stages (including accuracy/evasion), priority,
// multi-hit, drain and recoil, healing (also HP costs), flinch, critical-hit
// stages, one-hit KOs, forced switches and the four weathers. A move whose
// behaviour depends on anything else (abilities, items, terrain, charging or
// recharge turns, semi-invulnerability, switching out, rampage, conditional
// power, trapping…) is marked unsupported and never offered in the team battle.
// The arena and one-card duel keep their own damage-only move pools.

const STAT = { attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe", accuracy: "acc", evasion: "eva" };
const SELF_TARGETS = new Set(["user", "user-and-allies", "user-or-ally"]);
const FOE_TARGETS = new Set(["selected-pokemon", "all-opponents", "all-other-pokemon", "random-opponent"]);
const AILMENTS = new Set(["paralysis", "sleep", "freeze", "burn", "poison", "confusion"]);
export const WEATHER_MOVES = { "rain-dance": "rain", "sunny-day": "sun", sandstorm: "sand", hail: "hail", snowscape: "snow" };
// Healing that weather scales: ⅔ in sun, ¼ in any other weather, ½ otherwise.
const WEATHER_HEAL = new Set(["synthesis", "moonlight", "morning-sun"]);
// Weather that makes these moves never miss (rain, or hail/snow for Blizzard);
// sun drops Thunder and Hurricane to 50% accuracy.
const WEATHER_ACCURACY = { thunder: "rain", hurricane: "rain", blizzard: "snow" };
// Grass types are immune to powder and spore moves.
const POWDER = new Set(["spore", "sleep-powder", "stun-spore", "poison-powder", "cotton-spore", "rage-powder", "powder", "magic-powder"]);
const THAWS_USER = new Set(["flame-wheel", "sacred-fire", "flare-blitz", "scald", "steam-eruption", "fusion-flare", "pyro-ball", "scorching-sands", "burn-up", "matcha-gotcha"]);
const FORCES_SWITCH = new Set(["circle-throw", "dragon-tail"]); // damaging moves that also drag out the target

// Behaviour outside the model, reviewed against each move's PokéAPI effect text.
const CONDITIONAL = new Set([
  // charge, recharge, semi-invulnerable or delayed turns
  "blast-burn", "bounce", "dig", "dive", "eternabeam", "fly", "frenzy-plant", "future-sight", "doom-desire", "geomancy",
  "giga-impact", "hydro-cannon", "hyper-beam", "meteor-assault", "meteor-beam", "phantom-force", "prismatic-laser",
  "razor-wind", "roar-of-time", "rock-wrecker", "shadow-force", "skull-bash", "sky-attack", "sky-drop", "solar-beam",
  "solar-blade", "electro-shot",
  // the user faints, crashes or pays HP outside the data
  "explosion", "self-destruct", "misty-explosion", "mind-blown", "steel-beam", "high-jump-kick", "jump-kick",
  // switching, trapping or rampage
  "u-turn", "volt-switch", "flip-turn", "parting-shot", "teleport", "outrage", "thrash", "petal-dance", "uproar",
  "jaw-lock", "anchor-shot", "spirit-shackle", "thousand-waves", "no-retreat", "rollout", "ice-ball", "fury-cutter",
  "echoed-voice",
  // power, type or stat that depends on a condition, an ability, an item or terrain
  "acrobatics", "assurance", "avalanche", "beak-blast", "belch", "body-press", "bolt-beak", "brine", "bug-bite",
  "burning-jealousy", "chip-away", "clear-smog", "core-enforcer", "covet", "darkest-lariat", "dragon-energy",
  "dream-eater", "dynamax-cannon", "eerie-spell", "eruption", "water-spout", "expanding-force", "facade", "fake-out",
  "false-swipe", "fell-stinger", "first-impression", "fishious-rend", "flying-press", "focus-punch", "foul-play",
  "freeze-dry", "fire-pledge", "grass-pledge", "water-pledge", "grassy-glide", "hex", "hidden-power", "judgment",
  "lash-out", "last-resort", "multi-attack", "payback", "poltergeist", "power-trip", "stored-power", "psyshock",
  "psystrike", "secret-sword", "pursuit", "rage", "retaliate", "revelation-dance", "revenge", "rising-voltage",
  "scale-shot", "secret-power", "shell-side-arm", "shell-trap", "smelling-salts", "snore", "sparkling-aria",
  "spectral-thief", "steel-roller", "stomping-tantrum", "sucker-punch", "synchronoise", "triple-axel", "triple-kick",
  "venoshock", "wake-up-slap", "weather-ball", "sheer-cold", "terrain-pulse", "upper-hand", "thunderclap",
  // status moves tied to gender, abilities, berries, terrain, stockpiles or a single type
  "captivate", "charge", "gear-up", "magnetic-flux", "growth", "rototiller", "shore-up", "stuff-cheeks", "swallow",
  "venom-drench", "floral-healing", "coaching", "aromatic-mist", "decorate", "heal-pulse",
]);

const english = (names) => names?.find((n) => n.language.name === "en")?.name;
const titleCase = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** Why the effect model can't run a move, or "" when it can. */
function unsupported(m) {
  const meta = m.meta;
  if (WEATHER_MOVES[m.name]) return "";
  if (CONDITIONAL.has(m.name)) return "condition";
  if (!meta) return "no effect data";
  const category = meta.category.name;
  if (category === "unique" || category === "field-effect" || category === "whole-field-effect") return category;
  const ailment = meta.ailment.name;
  if (ailment !== "none" && !AILMENTS.has(ailment)) return ailment;
  if (meta.min_turns && !["sleep", "confusion", "poison"].includes(ailment)) return "multi-turn";
  if (!SELF_TARGETS.has(m.target.name) && !FOE_TARGETS.has(m.target.name)) return "target";
  if (m.damage_class.name !== "status" && !m.power && category !== "ohko") return "variable power";
  return "";
}

/** The effect fields the team battle reads; zero values are omitted. */
function effectOf(m) {
  const meta = m.meta ?? {};
  const category = meta.category?.name ?? "";
  const effect = {};
  const set = (key, value) => { if (value) effect[key] = value; };
  set("priority", m.priority);
  const weather = WEATHER_MOVES[m.name];
  if (weather) return { ...effect, target: "field", weather };
  const self = SELF_TARGETS.has(m.target.name);
  set("target", self ? "self" : "opponent");
  if (m.accuracy === null) effect.neverMiss = true;
  const ailment = meta.ailment?.name;
  if (ailment && ailment !== "none") {
    effect.ailment = ailment === "poison" && meta.min_turns === 15 ? "toxic" : ailment;
    // A pure status move always inflicts its ailment when it lands.
    effect.ailmentChance = meta.ailment_chance || 100;
    if (ailment === "sleep" || ailment === "confusion") {
      set("minTurns", meta.min_turns);
      set("maxTurns", meta.max_turns);
    }
  }
  const stats = {};
  for (const s of m.stat_changes ?? []) stats[STAT[s.stat.name]] = (stats[STAT[s.stat.name]] ?? 0) + s.change;
  if (Object.keys(stats).length) {
    effect.stats = stats;
    effect.statTarget = category === "damage-raise" || (category !== "damage-lower" && self) ? "self" : "opponent";
    effect.statChance = meta.stat_chance || 100;
  }
  set("drain", meta.drain);
  set("healing", meta.healing);
  set("crit", meta.crit_rate);
  set("flinch", meta.flinch_chance);
  if (meta.min_hits) { effect.minHits = meta.min_hits; effect.maxHits = meta.max_hits; }
  if (category === "ohko") effect.ohko = true;
  if (category === "force-switch" || FORCES_SWITCH.has(m.name)) effect.forceSwitch = true;
  if (WEATHER_HEAL.has(m.name)) effect.weatherHeal = true;
  if (WEATHER_ACCURACY[m.name]) effect.weatherAccuracy = WEATHER_ACCURACY[m.name];
  if (POWDER.has(m.name)) effect.powder = true;
  if (THAWS_USER.has(m.name)) effect.thawsUser = true;
  return effect;
}

/** A pokedex.json move entry, or null for a move nothing can use. */
export function importMoveData(id, m) {
  const damaging = ["physical", "special"].includes(m.damage_class.name);
  const reason = unsupported(m);
  // Damage-only engines (arena, duel) need listed power; the team battle needs a supported effect.
  if (damaging && !m.power && reason) return null;
  if (!damaging && reason) return null;
  const move = {
    id,
    name: english(m.names) ?? titleCase(m.name),
    type: titleCase(m.type.name),
    category: damaging ? m.damage_class.name : "status",
    power: m.power ?? 0,
    accuracy: m.accuracy ?? 100, // moves that never miss have no accuracy
    pp: m.pp ?? 10,
  };
  if (reason) move.unsupported = reason; // still a valid damage-only move for the arena and duel
  else move.effect = effectOf(m);
  return move;
}
