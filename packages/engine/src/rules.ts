/**
 * Tunable rule constants. Anything marked ASSUMPTION was not specified in
 * docs/RULES.md yet and should be confirmed by the game designer.
 */
export const RULES = {
  deckSize: 60,
  /** Max copies of one card in a deck (power cards are exempt, except doubleNeutral). */
  maxCopies: 4,
  benchSize: 5,
  prizeCount: 6,
  startingHandSize: 7,
  /** Extra cards the opponent may draw each time a player has to mulligan. */
  mulliganExtraDraw: 2,
  poisonDamage: 10,
  confusionSelfDamage: 20,
  /** ASSUMPTION: a creature may not evolve twice in the same turn. */
  allowMultipleEvolutionsPerTurn: false,
  /** ASSUMPTION: weakness doubles damage. */
  weaknessMultiplier: 2,
  /** ASSUMPTION: resistance subtracts a flat amount. */
  resistanceReduction: 30,
} as const;
