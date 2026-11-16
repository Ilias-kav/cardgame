import type { Action } from './actions.js';
import { chooseAction, type BotStyle } from './bot.js';
import type { CardCatalog } from './cards.js';
import type { DeckEntry } from './deck.js';
import { applyAction } from './engine.js';
import type { GameEvent } from './events.js';
import { legalActions } from './legal.js';
import { Rng } from './rng.js';
import { createGame } from './setup.js';
import type { GameState, PlayerIndex } from './state.js';

export interface StepInfo {
  before: GameState;
  after: GameState;
  player: PlayerIndex;
  action: Action;
  events: GameEvent[];
}

export interface SimulationOptions {
  seed: number;
  /** Seed for the bots' choices (kept separate from the game's own randomness). */
  botSeed?: number;
  styles?: [BotStyle, BotStyle];
  maxActions?: number;
  onStep?: (step: StepInfo) => void;
}

export interface SimulationResult {
  state: GameState;
  /** Every event from game creation to the end. */
  events: GameEvent[];
  steps: number;
  finished: boolean;
}

/**
 * Plays a whole game between two bots. Throws if the game gets stuck (nobody
 * has a legal action but the game is not over), which would be an engine bug.
 */
export function simulateGame(
  catalog: CardCatalog,
  deckA: readonly DeckEntry[],
  deckB: readonly DeckEntry[],
  options: SimulationOptions,
): SimulationResult {
  const created = createGame(catalog, deckA, deckB, options.seed);
  if (!created.ok) throw new Error(`createGame failed: ${JSON.stringify(created.error)}`);
  let state = (created.value as { state: GameState }).state;
  const events: GameEvent[] = [...(created.value as { events: GameEvent[] }).events];

  const botRng = new Rng(options.botSeed ?? options.seed + 1);
  const styles = options.styles ?? ['aggressive', 'aggressive'];
  const maxActions = options.maxActions ?? 5000;
  let steps = 0;

  while (state.phase !== 'finished' && steps < maxActions) {
    const order: PlayerIndex[] =
      state.phase === 'setup'
        ? [0, 1]
        : [...state.pendingDecisions.map((d) => d.player), state.currentPlayer];

    let acted = false;
    for (const player of order) {
      const legal = legalActions(catalog, state, player);
      if (legal.length === 0) continue;
      const action = chooseAction(legal, botRng, styles[player]);
      const result = applyAction(catalog, state, player, action);
      if (!result.ok) throw new Error(`Legal action rejected: ${action.type} ${result.error.code}`);
      options.onStep?.({ before: state, after: result.value.state, player, action, events: result.value.events });
      state = result.value.state;
      events.push(...result.value.events);
      steps++;
      acted = true;
      break;
    }
    if (!acted) throw new Error(`Game stuck at turn ${state.turn} (${state.turnStage})`);
  }
  return { state, events, steps, finished: state.phase === 'finished' };
}
