import { energyProvided, getCard, type CardCatalog, type CostSymbol, type Element } from './cards.js';
import type { CardInstance } from './state.js';

/** Every attached power card as elemental units (double neutral = two neutral units). */
function attachedUnits(catalog: CardCatalog, attached: readonly CardInstance[]): Element[] {
  const units: Element[] = [];
  for (const inst of attached) {
    const card = getCard(catalog, inst.cardId);
    if (card.kind === 'power') units.push(...energyProvided(card));
  }
  return units;
}

/**
 * Can the attached power cards pay this attack cost? Typed symbols need a unit
 * of that type; neutral symbols can be paid with any remaining unit. Paying
 * does not discard anything: power cards stay attached after an attack.
 */
export function canPayCost(
  catalog: CardCatalog,
  attached: readonly CardInstance[],
  cost: readonly CostSymbol[],
): boolean {
  const available = new Map<Element, number>();
  for (const unit of attachedUnits(catalog, attached)) {
    available.set(unit, (available.get(unit) ?? 0) + 1);
  }
  let neutralNeeded = 0;
  for (const symbol of cost) {
    if (symbol === 'neutral') {
      neutralNeeded++;
      continue;
    }
    const have = available.get(symbol) ?? 0;
    if (have <= 0) return false;
    available.set(symbol, have - 1);
  }
  let remaining = 0;
  for (const n of available.values()) remaining += n;
  return remaining >= neutralNeeded;
}

/**
 * Checks the cards chosen to pay a retreat cost. Each card is worth its number
 * of power units (double neutral = 2). The total must reach the cost, and no
 * chosen card may be unnecessary. Returns an error message, or null if valid.
 */
export function validateRetreatPayment(
  catalog: CardCatalog,
  attached: readonly CardInstance[],
  discard: readonly string[],
  cost: number,
): string | null {
  if (new Set(discard).size !== discard.length) return 'A card was listed twice';
  const values: number[] = [];
  for (const iid of discard) {
    const inst = attached.find((c) => c.iid === iid);
    if (!inst) return `Card ${iid} is not attached to the active creature`;
    const card = getCard(catalog, inst.cardId);
    if (card.kind !== 'power') return `Card ${iid} is not a power card`;
    values.push(energyProvided(card).length);
  }
  const total = values.reduce((a, b) => a + b, 0);
  if (total < cost) return `Retreat costs ${cost}, but the discarded cards only pay ${total}`;
  if (values.some((v) => total - v >= cost)) return 'You discarded more cards than necessary';
  return null;
}
