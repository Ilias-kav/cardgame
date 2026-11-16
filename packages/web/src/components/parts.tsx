import { creatureCard, type Card, type CardCatalog, type CardInstance, type CreatureInPlay } from '@cardgame/engine';
import { cardSummary } from '../deck/editor.js';
import type { Fx } from '../game/effects.js';
import { secondsLeft } from '../game/hints.js';
import { useNow } from '../useNow.js';

const POWER_GLYPH: Record<string, string> = {
  fire: '🔥',
  water: '💧',
  leaf: '🍃',
  ground: '⛰️',
  lightning: '⚡',
  soul: '👻',
  neutral: '⚪',
  doubleNeutral: '⚪⚪',
};

export const natureGlyph = (nature: string): string => POWER_GLYPH[nature] ?? '❔';

/** A small badge for one attached power card. */
export function PowerChip({
  card,
  selected,
  onClick,
}: {
  card: Card | undefined;
  selected?: boolean;
  onClick?: () => void;
}) {
  const power = card?.kind === 'power' ? card.power : 'neutral';
  const label = card?.name ?? 'Power card';
  const content = (
    <span className={`chip power-${power}${selected ? ' chip-selected' : ''}`} title={label}>
      <span aria-hidden="true">{natureGlyph(power)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
  if (!onClick) return content;
  return (
    <button type="button" className="chip-button" onClick={onClick} aria-pressed={selected} aria-label={label}>
      {content}
    </button>
  );
}

export function PowerChips({ attached, catalog }: { attached: readonly CardInstance[]; catalog: CardCatalog }) {
  if (attached.length === 0) return <span className="muted small">no power cards</span>;
  return (
    <span className="chips">
      {attached.map((a) => (
        <PowerChip key={a.iid} card={catalog[a.cardId]} />
      ))}
    </span>
  );
}

const STAGE_LABEL = { basic: 'Basic', stage1: 'Stage 1', stage2: 'Stage 2' } as const;

/** One creature in play: name, hit points, attached power and status. */
export function CreatureTile({
  creature,
  catalog,
  title,
  selected,
  highlight,
  onClick,
  testId,
  fx,
}: {
  creature: CreatureInPlay;
  catalog: CardCatalog;
  title: string;
  selected?: boolean;
  /** A valid target for what the player is doing right now. */
  highlight?: boolean;
  onClick?: () => void;
  testId?: string;
  /** Floating numbers to show on this creature right now. */
  fx?: Fx[];
}) {
  const card = creatureCard(catalog, creature);
  const hp = Math.max(0, card.hp - creature.damage);
  const pct = Math.max(0, Math.min(100, (hp / card.hp) * 100));
  const classes = ['creature', `nature-${card.nature}`];
  if (selected) classes.push('selected');
  if (highlight) classes.push('target');
  if (fx?.some((f) => f.kind === 'damage')) classes.push('hit');
  return (
    <button type="button" className={classes.join(' ')} onClick={onClick} disabled={!onClick} data-testid={testId}>
      <span className="creature-title">{title}</span>
      <span className="creature-name">
        {natureGlyph(card.nature)} {card.name}
        <span className="stage">{STAGE_LABEL[card.stage]}</span>
      </span>
      <span className="hp" aria-label={`${hp} of ${card.hp} hit points`}>
        <span className="hp-bar" style={{ width: `${pct}%` }} />
        <span className="hp-text">
          {hp}/{card.hp} HP
        </span>
      </span>
      <PowerChips attached={creature.attached} catalog={catalog} />
      <FxLayer fx={fx} />
      {(creature.status || creature.poisoned) && (
        <span className="badges">
          {creature.status && <span className={`badge badge-${creature.status}`}>{creature.status}</span>}
          {creature.poisoned && <span className="badge badge-poisoned">poisoned</span>}
        </span>
      )}
    </button>
  );
}

/** Floating "−30" / "+10" / "KO!" labels that rise and fade (see .fx in styles.css). */
export function FxLayer({ fx }: { fx?: Fx[] }) {
  if (!fx || fx.length === 0) return null;
  return (
    <>
      {fx.map((f, i) => (
        <span key={f.id} className={`fx fx-${f.kind}`} style={{ top: `${34 + i * 18}px` }} data-testid={`fx-${f.kind}`} aria-hidden="true">
          {f.text}
        </span>
      ))}
    </>
  );
}

export function EmptySlot({ label, fx }: { label: string; fx?: Fx[] }) {
  return (
    <div className="slot-empty" aria-label={`${label} (empty)`}>
      {label}
      <FxLayer fx={fx} />
    </div>
  );
}

/** A card shown as a button (hand, catalog). */
export function CardButton({
  card,
  selected,
  onClick,
  badge,
  testId,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  badge?: string;
  testId?: string;
}) {
  const kindClass = card.kind === 'creature' ? `nature-${card.nature}` : card.kind === 'power' ? `power-${card.power}` : 'item';
  return (
    <button
      type="button"
      className={`card ${kindClass}${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={cardSummary(card)}
      data-testid={testId}
    >
      <span className="card-name">
        {card.kind === 'creature' && natureGlyph(card.nature)}
        {card.kind === 'power' && natureGlyph(card.power === 'doubleNeutral' ? 'doubleNeutral' : card.power)} {card.name}
      </span>
      <span className="card-kind">
        {card.kind === 'creature' ? `${STAGE_LABEL[card.stage]} · ${card.hp} HP` : card.kind === 'item' ? 'Item' : 'Power'}
      </span>
      {badge && <span className="card-badge">{badge}</span>}
    </button>
  );
}

/** "Time left: 1:05", red when low. */
export function TurnTimer({ deadline }: { deadline: number | null }) {
  const now = useNow(500);
  const left = secondsLeft(deadline, now);
  if (left === null) return null;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span className={`timer${left <= 15 ? ' timer-low' : ''}`} data-testid="timer">
      ⏱ {mm}:{ss}
    </span>
  );
}
