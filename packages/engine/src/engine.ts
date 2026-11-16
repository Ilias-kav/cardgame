import type { Action } from './actions.js';
import type { CardCatalog } from './cards.js';
import { defaultEffects, type EffectRegistry } from './effects.js';
import { runMainAction } from './main.js';
import { err, ok, type Result, type Transition } from './result.js';
import { Rng } from './rng.js';
import { setupDrawExtra, setupPlace } from './setup.js';
import type { GameState, PlayerIndex } from './state.js';
import { settle, type Env } from './turn.js';
import { cloneState } from './util.js';

/**
 * The single entry point for changing a game. Pure: it never mutates `state`
 * and never touches the network, database or clock. All randomness comes from
 * the seeded generator whose state is stored in `state.rngState`.
 *
 * `effects` is the registry of effect handlers (items, abilities, custom attack
 * effects); pass your own to add card-specific code.
 */
export function applyAction(
  catalog: CardCatalog,
  state: GameState,
  player: PlayerIndex,
  action: Action,
  effects: EffectRegistry = defaultEffects,
): Result<Transition> {
  if (state.phase === 'finished') return err('GAME_OVER', 'The game is over');

  switch (action.type) {
    case 'SETUP_DRAW_EXTRA':
      return setupDrawExtra(state, player, action.count);
    case 'SETUP_PLACE':
      return setupPlace(catalog, state, player, action.active, action.bench);
    default:
      break;
  }

  if (state.phase !== 'playing') return err('WRONG_PHASE', 'The game is not in progress');

  if (action.type !== 'PROMOTE') {
    if (state.pendingDecisions.length > 0) {
      return err('DECISION_PENDING', 'A player has to choose a creature to promote first');
    }
    if (player !== state.currentPlayer) return err('NOT_YOUR_TURN', 'It is not your turn');
    if (state.turnStage !== 'main') return err('NOT_MAIN_PHASE', 'The turn is already over');
  }

  const draft = cloneState(state);
  const rng = new Rng(draft.rngState);
  const env: Env = { catalog, rng, events: [], effects };
  const failure = runMainAction({ state: draft, env, player }, action);
  if (failure) return { ok: false, error: failure };

  settle(draft, env);
  draft.rngState = rng.state;
  return ok({ state: draft, events: env.events });
}
