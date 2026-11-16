import {
  validateDeck,
  type CardCatalog,
  type DeckEntry,
  type DeckError,
} from '@cardgame/engine';

export const MAX_DECKS_PER_USER = 20;

/** Sums duplicate entries for the same card, keeping first-seen order. */
export function mergeEntries(entries: readonly DeckEntry[]): DeckEntry[] {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.cardId, (totals.get(e.cardId) ?? 0) + e.count);
  return [...totals].map(([cardId, count]) => ({ cardId, count }));
}

/** Card ids that are not in the catalog. */
export function findUnknownCards(catalog: CardCatalog, entries: readonly DeckEntry[]): string[] {
  return entries.filter((e) => !catalog[e.cardId]).map((e) => e.cardId);
}

export interface DeckHealth {
  cardCount: number;
  valid: boolean;
  errors: DeckError[];
}

/** Validity is always computed from the engine rules, never stored. */
export function checkDeck(catalog: CardCatalog, entries: readonly DeckEntry[]): DeckHealth {
  const errors = validateDeck(catalog, entries);
  return {
    cardCount: entries.reduce((sum, e) => sum + e.count, 0),
    valid: errors.length === 0,
    errors,
  };
}

export interface DeckRow {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toSummary(deck: DeckRow, entries: readonly DeckEntry[], catalog: CardCatalog) {
  const { cardCount, valid } = checkDeck(catalog, entries);
  return { id: deck.id, name: deck.name, cardCount, valid, updatedAt: deck.updatedAt };
}

export function toDetail(deck: DeckRow, entries: readonly DeckEntry[], catalog: CardCatalog) {
  const { cardCount, valid, errors } = checkDeck(catalog, entries);
  return {
    id: deck.id,
    name: deck.name,
    cards: entries,
    cardCount,
    valid,
    errors,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
  };
}
