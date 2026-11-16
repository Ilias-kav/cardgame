import {
  applyAction,
  createGame,
  legalActions,
  starterCatalog,
  starterDecks,
  type GameState,
  type PlayerIndex,
} from '@cardgame/engine';
import { viewFor, type PlayerView } from '@cardgame/protocol';

/** A game that has finished setup: both players placed their creatures, turn 1 has begun. */
export function playingState(seed = 42): GameState {
  const created = createGame(starterCatalog, starterDecks.fire!, starterDecks.water!, seed);
  if (!created.ok) throw new Error('createGame failed');
  let state = created.value.state;
  for (const seat of [0, 1] as const) {
    for (let i = 0; i < 2; i++) {
      const next = legalActions(starterCatalog, state, seat).find(
        (a) => a.type === 'SETUP_DRAW_EXTRA' || a.type === 'SETUP_PLACE',
      );
      if (!next) break;
      const r = applyAction(starterCatalog, state, seat, next);
      if (!r.ok) throw new Error(r.error.code);
      state = r.value.state;
      if (next.type === 'SETUP_PLACE') break;
    }
  }
  if (state.phase !== 'playing') throw new Error('setup did not finish');
  return state;
}

export function viewOf(state: GameState, seat: PlayerIndex): PlayerView {
  return viewFor(state, seat, null);
}
