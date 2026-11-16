export const POWER_TYPES = ['fire', 'water', 'leaf', 'ground', 'lightning', 'soul'] as const;
export type PowerType = (typeof POWER_TYPES)[number];

/** Elements: the six power types plus neutral. Creatures have one as their nature. */
export type Element = PowerType | 'neutral';
export type Nature = Element;
/** A symbol in an attack's cost. 'neutral' can be paid with any power card. */
export type CostSymbol = Element;

export type CardId = string;

export type CreatureStage = 'basic' | 'stage1' | 'stage2';
export type StatusEffect = 'asleep' | 'paralyzed' | 'confused';

/** Reference to an effect implemented in code (the "effects are code" part). */
export interface EffectRef {
  handler: string;
  params?: Record<string, unknown>;
}

/** "Flip `flips` coins; at least `needed` must be heads." */
export interface CoinCondition {
  flips: number;
  needed: number;
}

export type AttackEffect =
  | { kind: 'status'; status: StatusEffect; condition?: CoinCondition }
  | { kind: 'poison'; condition?: CoinCondition }
  | { kind: 'custom'; handler: string; params?: Record<string, unknown>; condition?: CoinCondition };

export interface AttackDef {
  name: string;
  damage: number;
  cost: CostSymbol[];
  text?: string;
  effect?: AttackEffect;
}

export interface AbilityDef {
  name: string;
  text: string;
  effect: EffectRef;
}

export interface CreatureCard {
  kind: 'creature';
  id: CardId;
  name: string;
  stage: CreatureStage;
  /** Name of the creature this one evolves from (required for stage1/stage2). */
  evolvesFrom?: string;
  hp: number;
  nature: Nature;
  weakness?: Nature;
  resistance?: Nature;
  /** Number of power cards to discard to retreat. */
  retreatCost: number;
  ability?: AbilityDef;
  attacks: AttackDef[];
}

export interface ItemCard {
  kind: 'item';
  id: CardId;
  name: string;
  text: string;
  effect: EffectRef;
}

/** 'doubleNeutral' counts as two neutral power cards but is limited to 4 copies per deck. */
export type PowerCardType = PowerType | 'doubleNeutral';

export interface PowerCard {
  kind: 'power';
  id: CardId;
  name: string;
  power: PowerCardType;
}

export type Card = CreatureCard | ItemCard | PowerCard;

export type CardCatalog = Readonly<Record<CardId, Card>>;

export function getCard(catalog: CardCatalog, id: CardId): Card {
  const card = catalog[id];
  if (!card) throw new Error(`Unknown card id: ${id}`);
  return card;
}

export function isBasicCreature(card: Card): card is CreatureCard {
  return card.kind === 'creature' && card.stage === 'basic';
}

/** What a power card contributes when attached. Double neutral = two neutral. */
export function energyProvided(card: PowerCard): Element[] {
  return card.power === 'doubleNeutral' ? ['neutral', 'neutral'] : [card.power];
}

/** Max copies allowed in a deck. Normal power cards are unlimited. */
export function maxCopiesInDeck(card: Card, defaultMax: number): number {
  if (card.kind === 'power' && card.power !== 'doubleNeutral') return Infinity;
  return defaultMax;
}
