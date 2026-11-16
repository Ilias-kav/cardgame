import type { CreatureCard } from './cards.js';
import { RULES } from './rules.js';

export interface DamageResult {
  amount: number;
  weaknessApplied: boolean;
  resistanceApplied: boolean;
}

/**
 * Final damage of an attack: weakness first, then resistance, never below 0.
 * Zero base damage stays zero. The attacker's nature decides which applies.
 */
export function computeAttackDamage(
  base: number,
  attacker: CreatureCard,
  defender: CreatureCard,
): DamageResult {
  let amount = base;
  let weaknessApplied = false;
  let resistanceApplied = false;
  if (amount > 0 && defender.weakness === attacker.nature) {
    amount *= RULES.weaknessMultiplier;
    weaknessApplied = true;
  }
  if (amount > 0 && defender.resistance === attacker.nature) {
    amount -= RULES.resistanceReduction;
    resistanceApplied = true;
  }
  return { amount: Math.max(0, amount), weaknessApplied, resistanceApplied };
}
