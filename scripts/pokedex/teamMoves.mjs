// Chooses each species' team-battle moveset once, at import time, so the Go
// server and the offline simulator read the same list instead of re-deriving it.
//
// Only moves the effect model fully supports are eligible. Damaging moves prefer
// level-up moves (falling back to TM/tutor/egg moves only when there are none),
// favour same-type moves, then type coverage, scored by power × accuracy ×
// expected hits. The best support move (status, stat boost, healing or weather)
// takes the fourth slot when it scores at least SUPPORT_THRESHOLD. A species with
// no supported damaging move gets no moveset; the engines give it only Struggle.

export const SUPPORT_THRESHOLD = 40;
const AILMENT_VALUE = { sleep: 80, paralysis: 70, toxic: 70, burn: 65, poison: 50, confusion: 45, freeze: 60 };
const WEATHER_TYPES = { rain: ["Water"], sun: ["Fire"], sand: ["Rock", "Ground", "Steel"], hail: ["Ice"], snow: ["Ice"] };

const expectedHits = (e) => (!e?.minHits ? 1 : e.minHits === e.maxHits ? e.minHits : 3.1); // 2–5 hits average 3.1

// The species' own attacking stat decides whether physical or special moves suit it.
function damageScore(move, species) {
  const stab = species.types.includes(move.type) ? 1.5 : 1;
  const stat = move.category === "physical" ? species.base.atk : species.base.spa;
  return move.power * move.accuracy * stab * expectedHits(move.effect) * stat;
}

// Boosting the stat a species attacks with (and speed) is worth more than defence.
function statWeight(stat, base) {
  if (stat === "atk") return base.atk >= base.spa ? 30 : 10;
  if (stat === "spa") return base.spa >= base.atk ? 30 : 10;
  return stat === "spe" ? 30 : 15;
}

/** Value of a support move for this species; also the server AI's base value. */
export function supportScore(move, species, damagingTypes) {
  const types = species.types;
  const e = move.effect ?? {};
  if (e.weather) {
    const boosted = WEATHER_TYPES[e.weather].some((t) => types.includes(t) || (e.weather === "rain" || e.weather === "sun") && damagingTypes.includes(t));
    return boosted ? 50 : 0;
  }
  let score = 0;
  if (e.ailment && e.target === "opponent") score += AILMENT_VALUE[e.ailment] * (e.neverMiss ? 1 : move.accuracy / 100);
  for (const [stat, change] of Object.entries(e.stats ?? {})) {
    score += e.statTarget === "self" ? statWeight(stat, species.base) * change : -15 * change;
  }
  if (e.healing && e.target === "self") score += 1.2 * e.healing;
  if (e.forceSwitch) score += 20;
  if (e.ohko) score += 30 * (move.accuracy / 100);
  return score;
}

const byScore = (score) => (a, b) => score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function teamMoves(species, moves) {
  const resolve = (ids) => [...new Set(ids)].map((id) => moves[id] && { ...moves[id], id }).filter((m) => m && !m.unsupported);
  const levelUp = resolve(species.learnset.map((l) => l.move));
  const other = resolve(species.otherMoves);
  const damaging = (list) => list.filter((m) => m.category !== "status" && m.power > 0);
  const support = (list) => list.filter((m) => m.category === "status" || m.effect?.ohko);
  const attacks = damaging(levelUp).length ? damaging(levelUp) : damaging(other);
  if (!attacks.length) return [];
  attacks.sort(byScore((m) => damageScore(m, species)));

  const supports = support(levelUp).length ? support(levelUp) : support(other);
  const attackTypes = attacks.map((m) => m.type);
  supports.sort(byScore((m) => supportScore(m, species, attackTypes)));
  const best = supports.find((m) => supportScore(m, species, attackTypes) >= SUPPORT_THRESHOLD);

  const limit = best ? 3 : 4;
  const picked = [];
  const add = (m) => { if (picked.length < limit && !picked.includes(m.id)) picked.push(m.id); };
  for (const m of attacks) if (picked.length < Math.min(2, limit) && species.types.includes(m.type)) add(m);
  for (const m of attacks) if (!picked.some((id) => moves[id].type === m.type)) add(m);
  for (const m of attacks) add(m);
  if (best) picked.push(best.id);
  return picked;
}
