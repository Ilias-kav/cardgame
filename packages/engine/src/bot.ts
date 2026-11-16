import type { Action } from './actions.js';
import type { Rng } from './rng.js';

export type BotStyle = 'uniform' | 'aggressive';

/**
 * Picks one of the legal actions at random. 'uniform' treats all actions alike
 * (good for fuzzing: explores odd corners). 'aggressive' prefers progress:
 * promote when required, attack when possible, avoid ending the turn early.
 */
export function chooseAction(legal: readonly Action[], rng: Rng, style: BotStyle = 'aggressive'): Action {
  if (legal.length === 0) throw new Error('No legal actions');
  const pick = (list: readonly Action[]): Action => list[rng.int(list.length)] as Action;
  if (style === 'uniform') return pick(legal);

  const promote = legal.filter((a) => a.type === 'PROMOTE');
  if (promote.length > 0) return pick(promote);
  const setup = legal.filter((a) => a.type === 'SETUP_DRAW_EXTRA' || a.type === 'SETUP_PLACE');
  if (setup.length > 0) return pick(setup);

  const attacks = legal.filter((a) => a.type === 'ATTACK');
  if (attacks.length > 0 && rng.next() < 0.7) return pick(attacks);

  const others = legal.filter((a) => a.type !== 'END_TURN' && a.type !== 'ATTACK' && a.type !== 'RETREAT');
  if (others.length > 0 && rng.next() < 0.85) return pick(others);
  return pick(legal);
}
