import type { Fighter } from "../../lib/arena";
import { TYPE_COLORS } from "../../lib/battle/typeChart";
import type { ElementType } from "../../lib/battle/types";
import styles from "./arena.module.css";

// Must match ConeHalfAngle in services/api/internal/arena/fighters.go.
const CONE_HALF_ANGLE = (26 * Math.PI) / 180;
// Basic moves that read as a swipe get claw marks; others a dash toward the target.
const CLAW_MOVES = /scratch|slash|claw|cut|fury|scythe/i;

const typeColor = (type: string) => TYPE_COLORS[type as ElementType] ?? "#d9e4e8";

export function FighterToken({ fighter, index, tick, you }: { fighter: Fighter; index: number; tick: number; you: number }) {
  const attacking = tick - fighter.lastAttackTick < 6 && fighter.lastAttackTick > 0;
  return <div className={styles.fighter} data-you={index === you || undefined} data-attack={attacking ? fighter.lastAttack : undefined} data-dodging={fighter.dodging || undefined} data-charging={fighter.charging || undefined}
    style={{ left: `${fighter.x / 960 * 100}%`, top: `${fighter.y / 540 * 100}%` }}>
    <div className={styles.fighterLabel}>{fighter.name}</div>
    <div className={styles.fighterHp}><span style={{ width: `${fighter.hp / fighter.card.maxHp * 100}%` }} /></div>
    <div className={styles.fighterSprite}><img src={fighter.card.sprite} alt={fighter.card.name} draggable={false} /></div>
    {fighter.charging && <div className={styles.chargeLabel}>⚠ {Math.ceil(fighter.chargeMsLeft / 100) / 10}s</div>}
  </div>;
}

/** Outline of a cone special: from the attacker to `range`, ±CONE_HALF_ANGLE around the aim. */
function conePath(x: number, y: number, dx: number, dy: number, range: number) {
  const px = -dy, py = dx, spread = range * Math.tan(CONE_HALF_ANGLE);
  const endX = x + dx * range, endY = y + dy * range;
  return `M ${x} ${y} L ${endX + px * spread} ${endY + py * spread} Q ${endX} ${endY} ${endX - px * spread} ${endY - py * spread} Z`;
}

/** Telegraph shown during a special's windup, so the opponent can dodge it. */
export function ChargeEffect({ fighter }: { fighter: Fighter }) {
  if (!fighter.charging) return null;
  const { chargeX: x, chargeY: y, chargeDx: dx, chargeDy: dy } = fighter;
  const { shape, range, type } = fighter.card.special;
  const color = typeColor(type);
  if (shape !== "cone") return <g className={styles.telegraphElectric}><circle cx={x} cy={y} r={range} fill={color} fillOpacity=".13" stroke={color} strokeWidth="5" strokeDasharray="20 12" /></g>;
  return <g className={styles.telegraphFire}><path d={conePath(x, y, dx, dy, range)} fill={color} fillOpacity=".24" stroke={color} strokeWidth="4" strokeDasharray="12 9" /></g>;
}

export function AttackEffect({ fighter, tick, index }: { fighter: Fighter; tick: number; index: number }) {
  if (!fighter.lastAttack || fighter.lastAttackTick === 0 || tick - fighter.lastAttackTick > 12) return null;
  const { attackX: x, attackY: y, attackDx: dx, attackDy: dy, attackTargetX: tx, attackTargetY: ty, lastAttackHit: hit } = fighter;
  const px = -dy, py = dx;
  const move = fighter.lastAttack === "special" ? fighter.card.special : fighter.card.basic;
  const color = typeColor(move.type);
  const key = `${index}-${fighter.lastAttackTick}`;

  if (fighter.lastAttack === "special" && move.shape === "cone") {
    const r = move.range, spread = r * Math.tan(CONE_HALF_ANGLE), gradient = `cone-${index}`;
    const path = `M ${x + dx * 28} ${y + dy * 28} Q ${x + dx * r * .48 + px * spread * .26} ${y + dy * r * .48 + py * spread * .26} ${x + dx * r + px * spread} ${y + dy * r + py * spread} Q ${x + dx * r * .9} ${y + dy * r * .9} ${x + dx * r - px * spread} ${y + dy * r - py * spread} Q ${x + dx * r * .48 - px * spread * .26} ${y + dy * r * .48 - py * spread * .26} ${x + dx * 28} ${y + dy * 28} Z`;
    const [light, mid] = move.type === "Fire" ? ["#fff5a3", "#ffb12b"] : ["#fffbea", color];
    return <g key={key} className={styles.flameEffect}>
      <defs><linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0"><stop stopColor={light} /><stop offset=".45" stopColor={mid} /><stop offset="1" stopColor={move.type === "Fire" ? "#f43b18" : color} stopOpacity=".7" /></linearGradient></defs>
      <path d={path} fill={`url(#${gradient})`} stroke={mid} strokeWidth="5" />
    </g>;
  }

  if (fighter.lastAttack === "special") {
    // Electric keeps the lightning strike; other types burst as a ring.
    if (move.type === "Electric") {
      const strike = `M ${tx - 28} ${Math.max(0, ty - 235)} L ${tx + 12} ${ty - 130} L ${tx - 16} ${ty - 127} L ${tx + 21} ${ty - 50} L ${tx - 8} ${ty - 48} L ${tx + 5} ${ty + 14}`;
      return <g key={key} className={styles.lightningEffect}>
        {[0, 1, 2, 3, 4, 5].map((n) => {
          const angle = n * Math.PI / 3 + index * .4;
          const cx = x + Math.cos(angle) * 120, cy = y + Math.sin(angle) * 120;
          return <path key={n} d={`M ${cx - 18} ${cy - 30} l 18 18 -10 3 22 28`} fill="none" stroke="#b9f5ff" strokeWidth="5" strokeLinejoin="round" opacity=".75" />;
        })}
        {hit && <><path d={strike} fill="none" stroke="#efffff" strokeWidth="17" strokeLinejoin="round" opacity=".75" /><path d={strike} fill="none" stroke="#74ddff" strokeWidth="7" strokeLinejoin="round" /><circle cx={tx} cy={ty} r="37" fill="#b9f7ff" opacity=".55" /></>}
      </g>;
    }
    return <g key={key} className={styles.lightningEffect}>
      <circle cx={x} cy={y} r={move.range} fill={color} fillOpacity=".16" stroke={color} strokeWidth="8" />
      <circle cx={x} cy={y} r={move.range * .6} fill="none" stroke="#ffffff" strokeWidth="4" opacity=".5" />
      {hit && <circle cx={tx} cy={ty} r="37" fill={color} opacity=".6" />}
    </g>;
  }

  if (CLAW_MOVES.test(move.name)) {
    return <g key={key} className={styles.basicEffect}>
      {[-16, 0, 16].map((offset) => <path key={offset} d={`M ${tx - 22 + offset} ${ty - 31} Q ${tx + offset} ${ty - 10} ${tx + 17 + offset} ${ty + 28}`} fill="none" stroke="#fff2d3" strokeWidth="7" strokeLinecap="round" opacity={hit ? 1 : .35} />)}
    </g>;
  }
  return <g key={key} className={styles.basicEffect}>
    <path d={`M ${x} ${y} Q ${(x + tx) / 2} ${(y + ty) / 2 - 26} ${hit ? tx : x + dx * 100} ${hit ? ty : y + dy * 100}`} fill="none" stroke="#fffbe1" strokeWidth="13" strokeLinecap="round" opacity=".85" />
    <path d={`M ${x} ${y + 18} l ${-dx * 48} ${-dy * 48}`} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
  </g>;
}
