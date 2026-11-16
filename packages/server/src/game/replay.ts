import { applyAction, createGame, type CardCatalog, type GameState } from '@cardgame/engine';
import type { GameRecord, LoggedAction } from './types.js';

export interface Replayed {
  state: GameState;
  seq: number;
}

/**
 * Rebuilds a game's current state from what was persisted: the decks and seed
 * recreate the opening deal exactly (the engine is deterministic), then every
 * logged action is applied again in order.
 */
export function replayGame(
  catalog: CardCatalog,
  record: GameRecord,
  actions: readonly LoggedAction[],
): Replayed {
  const [first, second] = [...record.players].sort((a, b) => a.seat - b.seat);
  if (!first || !second || record.seed === null) throw new Error(`Game ${record.id} cannot be replayed`);

  const created = createGame(catalog, first.deck, second.deck, record.seed, {
    prizeCount: record.prizeCount,
  });
  if (!created.ok) throw new Error(`Game ${record.id}: createGame failed`);
  let state = (created.value as { state: GameState }).state;

  let seq = 0;
  for (const logged of [...actions].sort((a, b) => a.seq - b.seq)) {
    if (logged.seq !== seq + 1) throw new Error(`Game ${record.id}: gap in action log at ${logged.seq}`);
    const r = applyAction(catalog, state, logged.seat, logged.action);
    if (!r.ok) {
      throw new Error(`Game ${record.id}: logged action ${logged.seq} was rejected (${r.error.code})`);
    }
    state = r.value.state;
    seq = logged.seq;
  }
  return { state, seq };
}
