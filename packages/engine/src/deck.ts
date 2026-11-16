import { isBasicCreature, maxCopiesInDeck, type CardCatalog, type CardId } from './cards.js';
import { RULES } from './rules.js';

export interface DeckEntry {
  cardId: CardId;
  count: number;
}

export interface DeckError {
  code:
    | 'WRONG_SIZE'
    | 'UNKNOWN_CARD'
    | 'INVALID_COUNT'
    | 'TOO_MANY_COPIES'
    | 'NO_BASIC_CREATURE';
  message: string;
  cardId?: CardId;
}

/** Returns every problem found; an empty array means the deck is valid. */
export function validateDeck(catalog: CardCatalog, entries: readonly DeckEntry[]): DeckError[] {
  const errors: DeckError[] = [];
  const totals = new Map<CardId, number>();

  for (const entry of entries) {
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      errors.push({
        code: 'INVALID_COUNT',
        message: `Invalid count ${entry.count} for ${entry.cardId}`,
        cardId: entry.cardId,
      });
      continue;
    }
    totals.set(entry.cardId, (totals.get(entry.cardId) ?? 0) + entry.count);
  }

  let size = 0;
  let hasBasic = false;
  for (const [cardId, count] of totals) {
    const card = catalog[cardId];
    if (!card) {
      errors.push({ code: 'UNKNOWN_CARD', message: `Unknown card ${cardId}`, cardId });
      continue;
    }
    size += count;
    if (isBasicCreature(card)) hasBasic = true;
    const max = maxCopiesInDeck(card, RULES.maxCopies);
    if (count > max) {
      errors.push({
        code: 'TOO_MANY_COPIES',
        message: `${card.name}: ${count} copies (max ${max})`,
        cardId,
      });
    }
  }

  if (size !== RULES.deckSize) {
    errors.push({
      code: 'WRONG_SIZE',
      message: `Deck has ${size} cards, must have exactly ${RULES.deckSize}`,
    });
  }
  // Not in the written rules but required: without a basic the game could never start.
  if (!hasBasic) {
    errors.push({
      code: 'NO_BASIC_CREATURE',
      message: 'Deck must contain at least one basic creature',
    });
  }
  return errors;
}

/** Flattens [{cardId, count}] into a list of card ids. */
export function expandDeck(entries: readonly DeckEntry[]): CardId[] {
  return entries.flatMap((e) => Array.from({ length: e.count }, () => e.cardId));
}
