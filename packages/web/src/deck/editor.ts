import {
  RULES,
  maxCopiesInDeck,
  validateDeck,
  type Card,
  type CardCatalog,
  type DeckEntry,
  type DeckError,
  type Nature,
} from '@cardgame/engine';

/** How many copies of each card are in the deck being edited: cardId -> count. */
export type DeckCounts = Record<string, number>;

export const DECK_SIZE = RULES.deckSize;

/** Most copies of this card a deck may hold (Infinity for ordinary power cards). */
export const copyLimit = (card: Card): number => maxCopiesInDeck(card, RULES.maxCopies);

/** Adds one copy, unless the limit is reached (then returns the same object). */
export function addCard(counts: DeckCounts, card: Card): DeckCounts {
  const have = counts[card.id] ?? 0;
  if (have >= copyLimit(card)) return counts;
  return { ...counts, [card.id]: have + 1 };
}

export function removeCard(counts: DeckCounts, cardId: string): DeckCounts {
  const have = counts[cardId] ?? 0;
  if (have <= 0) return counts;
  const next = { ...counts };
  if (have === 1) delete next[cardId];
  else next[cardId] = have - 1;
  return next;
}

export function fromEntries(entries: readonly DeckEntry[]): DeckCounts {
  const counts: DeckCounts = {};
  for (const e of entries) counts[e.cardId] = (counts[e.cardId] ?? 0) + e.count;
  return counts;
}

/** Entries sorted by card id, for a stable request body. */
export function toEntries(counts: DeckCounts): DeckEntry[] {
  return Object.keys(counts)
    .filter((id) => (counts[id] ?? 0) > 0)
    .sort()
    .map((cardId) => ({ cardId, count: counts[cardId]! }));
}

export const totalCards = (counts: DeckCounts): number =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);

/** The same rule check the server runs (the engine's `validateDeck`). Empty = valid. */
export const deckProblems = (catalog: CardCatalog, counts: DeckCounts): DeckError[] =>
  validateDeck(catalog, toEntries(counts));

export function kindTotals(catalog: CardCatalog, counts: DeckCounts): Record<Card['kind'], number> {
  const totals = { creature: 0, item: 0, power: 0 };
  for (const [id, n] of Object.entries(counts)) {
    const card = catalog[id];
    if (card) totals[card.kind] += n;
  }
  return totals;
}

const KIND_ORDER: Record<Card['kind'], number> = { creature: 0, item: 1, power: 2 };
const STAGE_ORDER = { basic: 0, stage1: 1, stage2: 2 } as const;

/** Creatures (basic first), then items, then power cards; alphabetical within each group. */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (a.kind === 'creature' && b.kind === 'creature' && a.stage !== b.stage) {
      return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    }
    return a.name.localeCompare(b.name);
  });
}

export interface CardFilter {
  kind: Card['kind'] | 'all';
  text: string;
  nature: Nature | 'all';
}

export function filterCards(cards: readonly Card[], f: CardFilter): Card[] {
  const text = f.text.trim().toLowerCase();
  return cards.filter((card) => {
    if (f.kind !== 'all' && card.kind !== f.kind) return false;
    if (f.nature !== 'all') {
      if (card.kind === 'creature') {
        if (card.nature !== f.nature) return false;
      } else if (card.kind === 'power') {
        if (card.power !== f.nature) return false;
      } else {
        return false;
      }
    }
    return text === '' || card.name.toLowerCase().includes(text);
  });
}

/** One line describing a card's rules text, used in lists and tooltips. */
export function cardSummary(card: Card): string {
  switch (card.kind) {
    case 'creature': {
      const attacks = card.attacks.map((a) => `${a.name} ${a.damage}`).join(', ');
      return `${card.stage === 'basic' ? 'Basic' : card.stage === 'stage1' ? 'Stage 1' : 'Stage 2'} ${card.nature} · ${card.hp} HP · ${attacks}`;
    }
    case 'item':
      return card.text;
    case 'power':
      return card.power === 'doubleNeutral' ? 'Counts as two neutral power cards' : `${card.power} power`;
  }
}
